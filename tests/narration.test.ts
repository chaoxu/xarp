import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  build,
  formatWebVtt,
  narrate,
  parseSlideNarration,
} from '../lib/index.js';
import {
  applyGlossary,
  buildNarrationTimeline,
  cleanCaptionText,
  computeAsrErrorRate,
  normalizeSpeechText,
  parseWavDuration,
  resolveNarrationDir,
  trimWavSilence,
} from '../lib/narration.js';
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
  test('parses beat and narration comments with math pipes, capitalized colons, seg/fit, and pause-only holds', () => {
    const md = `
# Linear program

<!-- Presenter note: keep this out of public captions. -->

<!-- narration:
- Step 1: plot $2x + y \\leq 6$ on the first quadrant.
- Duration: two seconds of intuition &mdash; with $a < b & c > d$.
- Audio: crisp voiceover without triggering a file path.
- Optimal vertex (2, 2): objective reaches $x + y = 4$.
  tts: Optimal vertex two comma two, objective reaches X plus Y equals four.
  pause: 0.5
  cue: chime
-->

\`\`\`markdown
<!-- beat: Inside a code block; must be ignored! -->
\`\`\`

<!-- beat: Norm $\\|v\\| \\geq |x|$ by Chao Xu. | step: 2 | seg: 3 | fit: true -->
<!-- beat: pause: 1 -->
`;
    const beats = parseSlideNarration(md, { 'Chao Xu': '许超' });
    expect(beats).toHaveLength(6);
    expect(beats[0]!.caption).toBe('Step 1: plot 2x + y ≤ 6 on the first quadrant.');
    expect(beats[0]!.tts).toContain('less than or equal to 6');
    expect(beats[1]!.caption).toBe('Duration: two seconds of intuition — with a < b & c > d.');
    expect(beats[1]!.duration).toBeUndefined();
    expect(beats[2]!.caption).toBe('Audio: crisp voiceover without triggering a file path.');
    expect(beats[2]!.audio).toBeUndefined();
    expect(beats[3]!.caption).toBe('Optimal vertex (2, 2): objective reaches x + y = 4.');
    expect(beats[3]!.tts).toBe('Optimal vertex two comma two, objective reaches X plus Y equals four.');
    expect(beats[3]!.pause).toBe(0.5);
    expect(beats[3]!.cue).toBe('chime');
    expect(beats[4]!.caption).toBe('Norm ‖v‖ ≥ |x| by Chao Xu.');
    expect(beats[4]!.step).toBe(2);
    expect(beats[4]!.seg).toBe(3);
    expect(beats[4]!.fit).toBe(true);
    expect(beats[4]!.tts).toContain('norm of v greater than or equal to absolute value of x by 许超.');
    expect(beats[5]!.silent).toBe(true);
    expect(beats[5]!.pause).toBe(1);

    const { timeline } = buildNarrationTimeline({
      viewId: 'deck',
      deckTitle: 'Deck',
      slides: [{ id: 's1', body: md, title: 'Linear program', fragmentCount: 2 }],
      vttUrl: '_xarp/narration/captions.vtt',
    });
    expect(timeline.slides[0]!.beats[5]!.duration).toBe(1);
    const vtt = formatWebVtt(timeline);
    expect(vtt).toContain('a &lt; b &amp; c &gt; d');
  });

  test('normalizes math, links, and single-pass glossary boundaries without re-expansion', () => {
    const glossary = { AI: 'artificial intelligence', 'TC^0': 'T C zero', 'Chao Xu': '许超' };
    expect(normalizeSpeechText('MAIN domain uses AI in $TC^0$ with [Chao Xu](https://example.com).', glossary))
      .toBe('MAIN domain uses artificial intelligence in T C zero with 许超.');
    expect(applyGlossary('a and b', { a: 'ab', b: 'bc' })).toBe('ab and bc');
    expect(cleanCaptionText('Bound $\\left(\\dfrac{a-b}{2}\\right)^2 \\geq 0$ in **bold**.'))
      .toBe('Bound ((a-b)/(2))² ≥ 0 in bold.');
    expect(normalizeSpeechText('Difference $a - b < c$.')).toContain('a minus b less than c');
  });

  test('measures WAV duration (including streaming size=0), trims filler tail opt-in only, and rejects symlinked cache dir', async () => {
    const raw = makePcmWav([
      { sec: 0.12, amp: 0 },      // leading silence
      { sec: 1.0, amp: 0.35 },    // main speech
      { sec: 0.4, amp: 0 },       // >= 280ms silence gap
      { sec: 0.25, amp: 0.2 },    // trailing speech / filler burst
      { sec: 0.1, amp: 0 },
    ]);
    expect(parseWavDuration(raw)).toBeCloseTo(1.87, 2);

    // Default trimFillerTail=false preserves natural multi-clause speech after a 400ms pause!
    const preserved = trimWavSilence(raw);
    expect(parseWavDuration(preserved)!).toBeGreaterThan(1.6);

    // Explicit trimFillerTail=true removes the isolated post-gap filler burst
    const trimmed = trimWavSilence(raw, { trimFillerTail: true });
    const trimmedDur = parseWavDuration(trimmed)!;
    expect(trimmedDur).toBeGreaterThan(1.0);
    expect(trimmedDur).toBeLessThan(1.2);

    // Streaming WAV header with data chunk size = 0
    const streamingWav = Buffer.from(raw);
    streamingWav.writeUInt32LE(0, 40);
    expect(parseWavDuration(streamingWav)).toBeCloseTo(1.87, 2);

    expect(computeAsrErrorRate('Hello 许超 world', 'hello 许超 world!')).toBe(0);
    expect(computeAsrErrorRate('alpha beta gamma delta', 'alpha beta delta')).toBeCloseTo(0.25, 2);

    // Symlink escape check on narration cache directory
    const rootDir = await mkdtemp(join(tmpdir(), 'xarp-symlink-parent-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'xarp-symlink-outside-'));
    directories.push(rootDir, outsideDir);
    await symlink(outsideDir, join(rootDir, 'narration'));
    await expect(resolveNarrationDir(rootDir, join(rootDir, 'dist'), 'narration')).rejects.toThrow(/outside the project/);
  });
});

describe('piecewise synthesis, zero metadata leak, env-independent hashes, and --check mode', () => {
  test('never leaks TTS config to HTML, resolves cached clips without env vars, stages distinct VTTs, and lints with check', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'xarp-narrate-test-'));
    directories.push(cwd);

    const ttsCalls: string[] = [];
    let failFirstDraw = true;
    const lastAudioTranscript = new Map<number, string>();

    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const bodyBuf = Buffer.concat(chunks);

      if (req.url === '/secret-tts-endpoint') {
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

      if (req.url === '/secret-asr-endpoint') {
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
    const ttsUrl = `http://127.0.0.1:${port}/secret-tts-endpoint`;
    const asrUrl = `http://127.0.0.1:${port}/secret-asr-endpoint`;
    const prevEnvUrl = process.env.XARP_TTS_URL;

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
        '- Slide two second step.',
        '-->',
        '',
        '---',
        '',
        '<!-- slide: s3 -->',
        '# Conclusion',
        '<!-- beat: Slide three takeaway. -->',
      ].join('\n');
      await writeFile(join(cwd, 'slides.md'), initialMd);

      // Configure WITHOUT url in config; supply XARP_TTS_URL only during `narrate`
      const narrationConfig = {
        glossary: { secretGlossaryTerm: 'spoken-secret' },
        tts: {
          format: 'wav' as const,
          promptSuffix: ' 。。。',
          trimFillerTail: true,
          verify: { url: asrUrl, maxErrorRate: 0.25, retries: 2 },
        },
      };

      // 0. Before synthesis, `--check` reports 5 missing clips
      const preCheck = await narrate({
        cwd,
        input: 'slides.md',
        output: 'dist',
        check: true,
        plugins: [narration({ captions: true, cues: false })],
        narration: narrationConfig,
      });
      expect(preCheck.missing).toBe(5);
      expect(preCheck.issues.length).toBe(5);

      // 1. Initial synthesis with XARP_TTS_URL in env: 5 spoken beats + 1 ASR retry on s1 = 6 HTTP TTS calls
      process.env.XARP_TTS_URL = ttsUrl;
      const first = await narrate({
        cwd,
        input: 'slides.md',
        output: 'dist',
        // Also pass narrationConfig directly into narration() to verify legacy callers still never leak secrets!
        plugins: [narration(narrationConfig)],
      });
      expect(first.spokenBeats).toBe(5);
      expect(first.synthesized).toBe(5);
      expect(first.cached).toBe(0);
      expect(ttsCalls).toHaveLength(6);

      // Verify ZERO secret/endpoint/glossary leak in exported index.html!
      const builtHtml = await readFile(join(cwd, 'dist/index.html'), 'utf8');
      expect(builtHtml).not.toContain('secret-tts-endpoint');
      expect(builtHtml).not.toContain('secret-asr-endpoint');
      expect(builtHtml).not.toContain('secretGlossaryTerm');
      expect(builtHtml).not.toContain('promptSuffix');

      const timeline1 = first.buildResult!.narration!;
      expect(timeline1.hasAudio).toBe(true);
      expect(timeline1.synthesizedCount).toBe(5);
      expect(timeline1.vttUrl).toMatch(/^_xarp\/narration\/captions-[a-f0-9]{16}\.vtt$/);
      const vtt1 = await readFile(join(cwd, 'dist', timeline1.vttUrl), 'utf8');
      expect(vtt1).toContain('WEBVTT');
      expect(vtt1).toContain('Slide two first step.');

      // 2. Unset XARP_TTS_URL completely (simulating CI or a fresh shell) and run `build()`:
      //    environment-independent clip hash MUST still resolve all 5 cached clips!
      delete process.env.XARP_TTS_URL;
      const ciBuild = await build({
        cwd,
        input: 'slides.md',
        output: 'dist-ci',
        plugins: [narration()],
        narration: narrationConfig,
      });
      expect(ciBuild.narration!.hasAudio).toBe(true);
      expect(ciBuild.narration!.synthesizedCount).toBe(5);

      // `--check` now passes with 0 issues!
      const cleanCheck = await narrate({
        cwd,
        input: 'slides.md',
        output: 'dist',
        check: true,
        plugins: [narration()],
        narration: narrationConfig,
      });
      expect(cleanCheck.issues).toEqual([]);

      // 3. Edit ONLY s2's second beat -> only 1 new TTS call, other 4 beats come straight from cache!
      process.env.XARP_TTS_URL = ttsUrl;
      ttsCalls.length = 0;
      const updatedMd = initialMd.replace('Slide two first step.', 'Slide two revised inequality.');
      await writeFile(join(cwd, 'slides.md'), updatedMd);

      const second = await narrate({
        cwd,
        input: 'slides.md',
        output: 'dist',
        plugins: [narration()],
        narration: narrationConfig,
      });
      expect(second.synthesized).toBe(1);
      expect(second.cached).toBe(4);
      expect(ttsCalls).toHaveLength(1);
      expect(ttsCalls[0]).toContain('Slide two revised inequality.');

      // 4. Build a subset view (s1 + s3 only) -> 0 TTS calls, stages ONLY 2 clips, and produces a distinct VTT filename!
      delete process.env.XARP_TTS_URL;
      ttsCalls.length = 0;
      const subBuild = await build({
        cwd,
        input: 'slides.md',
        output: 'dist-sub',
        slides: ['s1', 's3'],
        plugins: [narration()],
        narration: narrationConfig,
      });
      expect(ttsCalls).toHaveLength(0);
      expect(subBuild.narration!.vttUrl).not.toBe(second.buildResult!.narration!.vttUrl);
      const subClips = await readdir(join(cwd, 'dist-sub/_xarp/narration/clips'));
      expect(subClips).toHaveLength(2);

      // 5. Prune removes the superseded "Slide two first step." clip while keeping all 5 active clips
      const pruned = await narrate({
        cwd,
        input: 'slides.md',
        output: 'dist',
        prune: true,
        build: false,
        plugins: [narration()],
        narration: narrationConfig,
      });
      expect(pruned.pruned).toBe(1);
      const cachedFiles = await readdir(join(cwd, 'narration/clips'));
      expect(cachedFiles).toHaveLength(5);

      // 6. `--check` catches explicit out-of-range `step:`
      await writeFile(join(cwd, 'slides.md'), updatedMd.replace('Slide three takeaway.', 'Slide three takeaway. | step: 4'));
      const badStepCheck = await narrate({
        cwd,
        input: 'slides.md',
        output: 'dist',
        check: true,
        plugins: [narration()],
        narration: narrationConfig,
      });
      expect(badStepCheck.issues.some(msg => msg.includes('explicit step 4 exceeds fragment count (0)'))).toBe(true);
    } finally {
      if (prevEnvUrl === undefined) delete process.env.XARP_TTS_URL;
      else process.env.XARP_TTS_URL = prevEnvUrl;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
