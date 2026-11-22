import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  build,
  cleanCaptionText,
  computeAsrErrorRate,
  narrate,
  normalizeSpeechText,
  parseSlideNarration,
  parseWavDuration,
  trimWavSilence,
} from '../lib/index.js';
import { narration } from '../lib/plugins/index.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

function makePcmWav(segments: { sec: number; amp: number; freq?: number }[], sampleRate = 16000): Buffer {
  const totalSamples = segments.reduce((sum, seg) => sum + Math.round(seg.sec * sampleRate), 0);
  const dataBytes = totalSamples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  let idx = 0;
  for (const seg of segments) {
    const count = Math.round(seg.sec * sampleRate);
    const freq = seg.freq ?? 220;
    for (let i = 0; i < count; i++) {
      const val = seg.amp === 0 ? 0 : Math.sin((2 * Math.PI * freq * i) / sampleRate) * seg.amp;
      buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(val * 32767))), 44 + idx * 2);
      idx++;
    }
  }
  return buf;
}

describe('narration parsing, speech normalization, and WAV trimming', () => {
  test('parses beat and narration comments with colons while ignoring code fences and presenter notes', () => {
    const md = `
# Linear program

<!-- Presenter note: keep this out of public captions. -->

<!-- narration:
- Step 1: plot $2x + y \\leq 6$ on the first quadrant.
- Optimal vertex (2, 2): objective reaches $x + y = 4$.
  tts: Optimal vertex two comma two, objective reaches X plus Y equals four.
  pause: 0.5
  cue: chime
-->

\`\`\`markdown
<!-- beat: Inside a code block; must be ignored! -->
\`\`\`

<!-- beat: One more check: $a^2 \\geq 0$ by Chao Xu. | step: 2 -->
`;
    const beats = parseSlideNarration(md, { 'Chao Xu': '许超' });
    expect(beats).toHaveLength(3);
    expect(beats[0]!.caption).toBe('Step 1: plot 2x + y ≤ 6 on the first quadrant.');
    expect(beats[0]!.tts).toContain('less than or equal to 6');
    expect(beats[1]!.caption).toBe('Optimal vertex (2, 2): objective reaches x + y = 4.');
    expect(beats[1]!.tts).toBe('Optimal vertex two comma two, objective reaches X plus Y equals four.');
    expect(beats[1]!.pause).toBe(0.5);
    expect(beats[1]!.cue).toBe('chime');
    expect(beats[2]!.step).toBe(2);
    expect(beats[2]!.tts).toContain('a squared greater than or equal to 0 by 许超.');
  });

  test('normalizes math, links, and glossary boundaries cleanly', () => {
    const glossary = { AI: 'artificial intelligence', 'TC^0': 'T C zero', 'Chao Xu': '许超' };
    expect(normalizeSpeechText('MAIN domain uses AI in $TC^0$ with [Chao Xu](https://example.com).', glossary))
      .toBe('MAIN domain uses artificial intelligence in T C zero with 许超.');
    expect(cleanCaptionText('Bound $\\dfrac{a+b}{2} \\geq \\sqrt{ab}$ in **bold**.'))
      .toBe('Bound (a+b)/(2) ≥ √(ab) in bold.');
  });

  test('measures WAV duration, trims filler tail bursts, and computes bilingual ASR error rate', () => {
    const raw = makePcmWav([
      { sec: 0.12, amp: 0 },      // leading silence
      { sec: 1.0, amp: 0.35 },    // main speech
      { sec: 0.4, amp: 0 },       // >= 280ms silence gap
      { sec: 0.25, amp: 0.2 },    // trailing filler burst from prompt suffix
      { sec: 0.1, amp: 0 },
    ]);
    expect(parseWavDuration(raw)).toBeCloseTo(1.87, 2);
    const trimmed = trimWavSilence(raw, { trimFillerTail: true });
    const trimmedDur = parseWavDuration(trimmed)!;
    expect(trimmedDur).toBeGreaterThan(1.0);
    expect(trimmedDur).toBeLessThan(1.2);

    expect(computeAsrErrorRate('Hello 许超 world', 'hello 许超 world!')).toBe(0);
    expect(computeAsrErrorRate('alpha beta gamma delta', 'alpha beta delta')).toBeCloseTo(0.25, 2);
  });
});

describe('piecewise synthesis, incremental caching, ASR retry, and multi-view builds', () => {
  test('only synthesizes changed beats, retries bad ASR draws, shares clips across views, and prunes orphans', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'xarp-narrate-test-'));
    directories.push(cwd);

    const ttsCalls: string[] = [];
    let failFirstDraw = true;
    const lastAudioTranscript = new Map<number, string>();

    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const bodyBuf = Buffer.concat(chunks);

      if (req.url === '/tts') {
        const body = JSON.parse(bodyBuf.toString('utf8')) as { text: string };
        ttsCalls.push(body.text);
        const durSec = body.text.includes('Slide two') ? 0.9 : 0.7;
        const wav = makePcmWav([{ sec: 0.04, amp: 0 }, { sec: durSec, amp: 0.3 }, { sec: 0.04, amp: 0 }]);
        lastAudioTranscript.set(ttsCalls.length, failFirstDraw && body.text.includes('Slide one')
          ? 'completely garbled hallucination'
          : body.text.replace(/ 。。。$/, ''));
        if (failFirstDraw && body.text.includes('Slide one')) failFirstDraw = false;
        res.writeHead(200, { 'Content-Type': 'audio/wav' });
        res.end(wav);
        return;
      }

      if (req.url === '/asr') {
        const transcript = lastAudioTranscript.get(ttsCalls.length) ?? '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: transcript }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    const ttsUrl = `http://127.0.0.1:${port}/tts`;
    const asrUrl = `http://127.0.0.1:${port}/asr`;

    try {
      const initialMd = [
        '<!-- slide: s1 -->',
        '# Intro',
        '<!-- beat: Slide one opening claim. -->',
        '',
        '---',
        '',
        '<!-- slide: s2 -->',
        '# Proof',
        '* Step A',
        '* Step B',
        '<!-- narration:',
        '- Slide two base state.',
        '- Slide two first step.',
        '-->',
        '',
        '---',
        '',
        '<!-- slide: s3 -->',
        '# Conclusion',
        '<!-- beat: Slide three takeaway. -->',
      ].join('\n');
      await writeFile(join(cwd, 'slides.md'), initialMd);

      const narrationConfig = {
        tts: {
          provider: 'http' as const,
          url: ttsUrl,
          format: 'wav' as const,
          promptSuffix: ' 。。。',
          verify: { url: asrUrl, maxErrorRate: 0.25, retries: 2 },
        },
      };

      // 1. Initial synthesis: 4 spoken beats + 1 ASR retry on s1 = 5 HTTP TTS calls
      const first = await narrate({
        cwd,
        input: 'slides.md',
        output: 'dist',
        plugins: [narration(narrationConfig)],
      });
      expect(first.spokenBeats).toBe(4);
      expect(first.synthesized).toBe(4);
      expect(first.cached).toBe(0);
      expect(ttsCalls).toHaveLength(5);

      const timeline1 = JSON.parse(await readFile(join(cwd, 'dist/_xarp/narration/timeline.json'), 'utf8'));
      expect(timeline1.hasAudio).toBe(true);
      expect(timeline1.synthesizedCount).toBe(4);
      expect(timeline1.slides).toHaveLength(3);
      expect(timeline1.slides[1].fragmentCount).toBe(2);
      expect(timeline1.slides[1].beats[1].step).toBe(1);

      const vtt = await readFile(join(cwd, 'dist/_xarp/narration/slides.vtt'), 'utf8');
      expect(vtt).toContain('WEBVTT');
      expect(vtt).toContain('Slide two first step.');

      // 2. Edit ONLY s2's second beat -> only 1 new TTS call, other 3 beats come straight from cache!
      ttsCalls.length = 0;
      const updatedMd = initialMd.replace('Slide two first step.', 'Slide two revised inequality.');
      await writeFile(join(cwd, 'slides.md'), updatedMd);

      const second = await narrate({
        cwd,
        input: 'slides.md',
        output: 'dist',
        plugins: [narration(narrationConfig)],
      });
      expect(second.synthesized).toBe(1);
      expect(second.cached).toBe(3);
      expect(ttsCalls).toHaveLength(1);
      expect(ttsCalls[0]).toContain('Slide two revised inequality.');

      // 3. Build a subset view (s1 + s3 only) -> 0 TTS calls, and dist-sub stages ONLY 2 clips!
      ttsCalls.length = 0;
      await build({
        cwd,
        input: 'slides.md',
        output: 'dist-sub',
        slides: ['s1', 's3'],
        plugins: [narration(narrationConfig)],
      });
      expect(ttsCalls).toHaveLength(0);
      const subClips = await readdir(join(cwd, 'dist-sub/_xarp/narration/clips'));
      expect(subClips).toHaveLength(2);

      // 4. Prune removes the superseded "Slide two first step." clip while keeping all 4 active clips
      const pruned = await narrate({
        cwd,
        input: 'slides.md',
        output: 'dist',
        prune: true,
        build: false,
        plugins: [narration(narrationConfig)],
      });
      expect(pruned.pruned).toBe(1);
      const cachedFiles = await readdir(join(cwd, 'narration/clips'));
      expect(cachedFiles).toHaveLength(4);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
