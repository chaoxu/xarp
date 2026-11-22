import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { build, resolveProject } from './build.js';
import { containedFile, pathExists } from './files.js';
import {
  computeAsrErrorRate,
  computeClipHash,
  extractNarrationOptions,
  loadNarrationCache,
  parseSlideNarration,
  probeAudioDuration,
  resolveNarrationDir,
  resolveTtsSignature,
  trimWavSilence,
  type AuthoredBeat,
  type CachedClipRecord,
  type NarrationCache,
} from './narration.js';
import { parseSource, requireValue, selectSlides } from './source.js';
import type { BuildOptions, BuildResult, NarrationOptions, NarrationTtsOptions } from './types.js';

const run = promisify(execFile);

export interface NarrateProgressEvent {
  type: 'cached' | 'synthesizing' | 'synthesized' | 'custom' | 'retry-asr' | 'asr-warning';
  slideId: string;
  slideNumber: number;
  beatIndex: number;
  caption: string;
  tts: string;
  clipHash?: string;
  duration?: number;
  attempt?: number;
  asrTranscript?: string;
  asrErrorRate?: number;
}

export interface NarrateOptions extends BuildOptions {
  narration?: NarrationOptions;
  /** Synthesize only matching slide IDs or 1-based slide numbers (e.g. `['welcome', '3']`). */
  only?: string[];
  /** Re-synthesize matching beats even when present in the cache. */
  force?: boolean;
  /** Delete unreferenced clip files from the cache directory. */
  prune?: boolean;
  /** Inspect planned synthesis and cache state without calling TTS or writing files. */
  dryRun?: boolean;
  /** Run `build()` after updating clips. Defaults to `true` unless `dryRun` is enabled. */
  build?: boolean;
  onProgress?: (event: NarrateProgressEvent) => void;
}

export interface NarrateResult {
  cacheDir: string;
  totalBeats: number;
  spokenBeats: number;
  cached: number;
  synthesized: number;
  customAudio: number;
  missing: number;
  pruned: number;
  buildResult?: BuildResult;
}

let ffmpegChecked: boolean | undefined;
async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegChecked !== undefined) return ffmpegChecked;
  try {
    await run('ffmpeg', ['-version']);
    ffmpegChecked = true;
  } catch {
    ffmpegChecked = false;
  }
  return ffmpegChecked;
}

export { extractNarrationOptions, loadNarrationCache, resolveNarrationDir };

async function saveNarrationCache(cacheDir: string, cache: NarrationCache): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const indexPath = join(cacheDir, 'cache.json');
  const tmpPath = join(cacheDir, `.cache-${randomUUID()}.tmp`);
  const ordered: Record<string, CachedClipRecord> = {};
  for (const key of Object.keys(cache.clips).sort()) ordered[key] = cache.clips[key]!;
  const payload = JSON.stringify({ version: 1, clips: ordered }, null, 2) + '\n';
  await writeFile(tmpPath, payload, 'utf8');
  await rename(tmpPath, indexPath);
}

async function synthesizeRawAudio(
  ttsText: string,
  tts: NarrationTtsOptions | undefined,
  cwd: string,
  scratchDir: string,
  attempt: number,
): Promise<string> {
  const sig = resolveTtsSignature(tts);
  const promptText = `${ttsText}${sig.promptSuffix}`;

  if (sig.provider === 'command') {
    const cmd = tts?.command;
    requireValue(Array.isArray(cmd) && cmd.length > 0 && typeof cmd[0] === 'string', 'Configure tts.command for provider "command"');
    const outPath = join(scratchDir, `raw-${attempt}.wav`);
    await run(cmd[0], cmd.slice(1), {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        XARP_TTS_TEXT: promptText,
        XARP_TTS_RAW_TEXT: ttsText,
        XARP_TTS_OUT: outPath,
        XARP_TTS_VOICE: sig.voice,
        XARP_TTS_SPEED: String(sig.speed),
        XARP_TTS_ATTEMPT: String(attempt),
      },
    });
    requireValue(await pathExists(outPath), `TTS command did not write ${outPath}`);
    return outPath;
  }

  if (sig.provider === 'openai') {
    const url = sig.url || 'https://api.openai.com/v1/audio/speech';
    const apiKey = process.env.XARP_TTS_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: sig.model || 'tts-1',
        voice: sig.voice || 'alloy',
        input: promptText,
        response_format: 'wav',
        speed: sig.speed,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 240);
      throw new Error(`TTS request failed (${response.status}): ${detail}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    requireValue(bytes.length > 64, 'TTS response returned empty audio');
    const outPath = join(scratchDir, `raw-${attempt}.wav`);
    await writeFile(outPath, bytes);
    return outPath;
  }

  if (sig.provider === 'http') {
    requireValue(sig.url.length > 0, 'Set tts.url or XARP_TTS_URL for HTTP TTS synthesis');
    const apiKey = process.env.XARP_TTS_API_KEY ?? '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const payload: Record<string, unknown> = {
      ...(sig.body ?? {}),
      text: promptText,
      speed: sig.speed,
      ...(sig.voice ? { voice: sig.voice } : {}),
      ...(sig.model ? { model: sig.model } : {}),
    };
    const response = await fetch(sig.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 240);
      throw new Error(`TTS request failed (${response.status}): ${detail}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    const ext = contentType.includes('mpeg') ? '.mp3' : contentType.includes('mp4') || contentType.includes('aac') ? '.m4a' : '.wav';
    const bytes = Buffer.from(await response.arrayBuffer());
    requireValue(bytes.length > 64, 'TTS response returned empty audio');
    const outPath = join(scratchDir, `raw-${attempt}${ext}`);
    await writeFile(outPath, bytes);
    return outPath;
  }

  // macOS `say` local fallback
  requireValue(process.platform === 'darwin', 'Set tts.url / XARP_TTS_URL or tts.command on non-macOS hosts');
  const aiffPath = join(scratchDir, `raw-${attempt}.aiff`);
  const wavPath = join(scratchDir, `raw-${attempt}.wav`);
  const sayArgs = ['-o', aiffPath];
  if (sig.voice) sayArgs.push('-v', sig.voice);
  if (sig.speed !== 1) sayArgs.push('-r', String(Math.max(80, Math.min(400, Math.round(180 * sig.speed)))));
  sayArgs.push('--', ttsText);
  await run('/usr/bin/say', sayArgs, { maxBuffer: 8 * 1024 * 1024 });
  if (await hasFfmpeg()) {
    await run('ffmpeg', ['-y', '-v', 'error', '-i', aiffPath, '-ac', '1', '-ar', '24000', wavPath]);
  } else {
    await run('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@24000', '-c', '1', aiffPath, wavPath]);
  }
  return wavPath;
}

async function processAudioClip(
  rawPath: string,
  destDir: string,
  clipHash: string,
  tts: NarrationTtsOptions | undefined,
  scratchDir: string,
  attempt: number,
): Promise<{ relFile: string; fullPath: string; duration: number }> {
  const sig = resolveTtsSignature(tts);
  const normalize = tts?.normalize !== false;
  let workingPath = rawPath;

  const rawBuf = await readFile(rawPath);
  if (normalize && rawBuf.length >= 44 && rawBuf.toString('ascii', 0, 4) === 'RIFF') {
    const trimmed = trimWavSilence(rawBuf, { trimFillerTail: sig.promptSuffix.length > 0 });
    if (trimmed !== rawBuf) {
      workingPath = join(scratchDir, `trimmed-${attempt}.wav`);
      await writeFile(workingPath, trimmed);
    }
  }

  const ffmpeg = await hasFfmpeg();
  const wantFormat = tts?.format ?? (ffmpeg ? 'm4a' : 'wav');
  const finalExt = wantFormat === 'm4a' && ffmpeg ? '.m4a' : (extname(workingPath).toLowerCase() || '.wav');
  const relFile = `clips/${clipHash}${finalExt}`;
  const fullPath = join(destDir, relFile);
  const tmpOut = join(scratchDir, `final-${attempt}${finalExt}`);

  if (ffmpeg && (finalExt === '.m4a' || normalize)) {
    let preDuration = 1;
    try { preDuration = await probeAudioDuration(workingPath); } catch { /* fallback to standard filter */ }
    const filterArgs = normalize
      ? (preDuration >= 0.45 ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11'] : ['-af', 'dynaudnorm=f=75:g=7'])
      : [];
    const codecArgs = finalExt === '.m4a'
      ? ['-ac', '1', '-ar', '48000', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart']
      : ['-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le'];
    await run('ffmpeg', ['-y', '-v', 'error', '-i', workingPath, ...filterArgs, ...codecArgs, tmpOut]);
  } else {
    await copyFile(workingPath, tmpOut);
  }

  const duration = await probeAudioDuration(tmpOut);
  await mkdir(dirname(fullPath), { recursive: true });
  await copyFile(tmpOut, fullPath);
  return { relFile, fullPath, duration };
}

async function runAsrTranscript(audioPath: string, tts: NarrationTtsOptions | undefined, cwd: string): Promise<string | undefined> {
  const verify = tts?.verify;
  const cmd = verify?.command ?? (process.env.XARP_ASR_CMD ? ['sh', '-c', process.env.XARP_ASR_CMD] : undefined);
  if (cmd && cmd.length > 0 && cmd[0]) {
    const { stdout } = await run(cmd[0], cmd.slice(1), {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, XARP_ASR_AUDIO: audioPath },
    });
    return stdout.trim();
  }
  const url = verify?.url ?? process.env.XARP_ASR_URL;
  if (url) {
    const bytes = await readFile(audioPath);
    const form = new FormData();
    form.append('file', new Blob([bytes]), basename(audioPath));
    const response = await fetch(url, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`ASR verification request failed (${response.status})`);
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const json = await response.json() as { text?: string; transcript?: string };
      return String(json.text ?? json.transcript ?? '').trim();
    }
    return (await response.text()).trim();
  }
  return undefined;
}

/** Synthesize missing or changed per-beat narration clips into the project's content-addressed cache. */
export async function narrate(options: NarrateOptions): Promise<NarrateResult> {
  const project = await resolveProject(options);
  const narrationOpts = extractNarrationOptions(options);
  const cacheDir = await resolveNarrationDir(project.cwd, project.output, narrationOpts.dir);
  const rawSource = await readFile(project.input, 'utf8');
  const document = parseSource(rawSource);
  const selected = selectSlides(document, options.slides);

  const onlySet = options.only?.length ? new Set(options.only.map(item => item.trim()).filter(Boolean)) : undefined;
  if (onlySet) {
    for (const token of onlySet) {
      const asNum = Number(token);
      const matched = selected.some((slide, idx) => slide.id === token || (Number.isSafeInteger(asNum) && idx + 1 === asNum));
      requireValue(matched, `Slide filter "${token}" did not match any selected slide`);
    }
  }

  const cache = await loadNarrationCache(cacheDir);
  const activeHashes = new Set<string>();
  const sig = resolveTtsSignature(narrationOpts.tts);
  const maxErrorRate = narrationOpts.tts?.verify?.maxErrorRate ?? 0.35;
  const maxRetries = Math.max(0, narrationOpts.tts?.verify?.retries ?? 2);

  let totalBeats = 0;
  let spokenBeats = 0;
  let cached = 0;
  let synthesized = 0;
  let customAudio = 0;
  let missing = 0;

  const scratchRoot = options.dryRun ? '' : await mkdtemp(join(tmpdir(), 'xarp-narrate-'));
  try {
    for (const [slideIndex, slide] of selected.entries()) {
      const slideNumber = slideIndex + 1;
      const inFilter = !onlySet || onlySet.has(slide.id) || onlySet.has(String(slideNumber));
      const beats: AuthoredBeat[] = parseSlideNarration(slide.body, narrationOpts.glossary);

      for (const [beatIndex, beat] of beats.entries()) {
        totalBeats++;
        if (beat.silent && !beat.audio) continue;

        if (beat.audio) {
          spokenBeats++;
          const customPath = await containedFile(project.cwd, beat.audio);
          const dur = await probeAudioDuration(customPath);
          customAudio++;
          options.onProgress?.({
            type: 'custom',
            slideId: slide.id,
            slideNumber,
            beatIndex,
            caption: beat.caption,
            tts: beat.tts,
            duration: dur,
          });
          continue;
        }

        if (!beat.tts) continue;
        spokenBeats++;
        const clipHash = computeClipHash(beat.tts, narrationOpts.tts);
        activeHashes.add(clipHash);

        const existing = cache.clips[clipHash];
        if (!inFilter) {
          if (existing) cached++;
          else missing++;
          continue;
        }

        if (existing && !options.force) {
          cached++;
          options.onProgress?.({
            type: 'cached',
            slideId: slide.id,
            slideNumber,
            beatIndex,
            caption: beat.caption,
            tts: beat.tts,
            clipHash,
            duration: existing.duration,
          });
          continue;
        }

        if (options.dryRun) {
          missing++;
          continue;
        }

        options.onProgress?.({
          type: 'synthesizing',
          slideId: slide.id,
          slideNumber,
          beatIndex,
          caption: beat.caption,
          tts: beat.tts,
          clipHash,
        });

        const beatScratch = join(scratchRoot, `${clipHash}`);
        await mkdir(beatScratch, { recursive: true });

        let bestCandidate: { relFile: string; fullPath: string; duration: number; transcript?: string; errorRate?: number } | undefined;
        const attempts = maxRetries + 1;

        for (let attempt = 1; attempt <= attempts; attempt++) {
          const rawPath = await synthesizeRawAudio(beat.tts, narrationOpts.tts, project.cwd, beatScratch, attempt);
          const candidateDir = join(beatScratch, `cand-${attempt}`);
          const processed = await processAudioClip(rawPath, candidateDir, clipHash, narrationOpts.tts, beatScratch, attempt);
          const transcript = await runAsrTranscript(processed.fullPath, narrationOpts.tts, project.cwd);

          if (transcript === undefined) {
            bestCandidate = processed;
            break;
          }

          const errCaption = beat.caption ? computeAsrErrorRate(beat.caption, transcript) : 1;
          const errTts = computeAsrErrorRate(beat.tts, transcript);
          const errorRate = Math.min(errCaption, errTts);

          if (!bestCandidate || errorRate < (bestCandidate.errorRate ?? Infinity)) {
            bestCandidate = { ...processed, transcript, errorRate };
          }
          if (errorRate <= maxErrorRate) break;
          if (attempt < attempts) {
            options.onProgress?.({
              type: 'retry-asr',
              slideId: slide.id,
              slideNumber,
              beatIndex,
              caption: beat.caption,
              tts: beat.tts,
              clipHash,
              attempt,
              asrTranscript: transcript,
              asrErrorRate: errorRate,
            });
          }
        }

        requireValue(bestCandidate, `Synthesis produced no candidate for ${slide.id} beat ${beatIndex + 1}`);
        const finalDest = join(cacheDir, bestCandidate.relFile);
        await mkdir(dirname(finalDest), { recursive: true });
        await copyFile(bestCandidate.fullPath, finalDest);

        if (bestCandidate.errorRate !== undefined && bestCandidate.errorRate > maxErrorRate) {
          options.onProgress?.({
            type: 'asr-warning',
            slideId: slide.id,
            slideNumber,
            beatIndex,
            caption: beat.caption,
            tts: beat.tts,
            clipHash,
            duration: bestCandidate.duration,
            asrTranscript: bestCandidate.transcript,
            asrErrorRate: bestCandidate.errorRate,
          });
        }

        cache.clips[clipHash] = {
          hash: clipHash,
          file: bestCandidate.relFile,
          duration: bestCandidate.duration,
          caption: beat.caption,
          tts: beat.tts,
          provider: sig.provider,
          ...(sig.voice ? { voice: sig.voice } : {}),
          speed: sig.speed,
          updatedAt: new Date().toISOString(),
          ...(bestCandidate.transcript !== undefined ? { asrTranscript: bestCandidate.transcript } : {}),
          ...(bestCandidate.errorRate !== undefined ? { asrErrorRate: bestCandidate.errorRate } : {}),
        };
        await saveNarrationCache(cacheDir, cache);
        synthesized++;

        options.onProgress?.({
          type: 'synthesized',
          slideId: slide.id,
          slideNumber,
          beatIndex,
          caption: beat.caption,
          tts: beat.tts,
          clipHash,
          duration: bestCandidate.duration,
          ...(bestCandidate.transcript !== undefined ? { asrTranscript: bestCandidate.transcript } : {}),
          ...(bestCandidate.errorRate !== undefined ? { asrErrorRate: bestCandidate.errorRate } : {}),
        });
      }
    }

    let pruned = 0;
    if (options.prune && !onlySet && !options.dryRun && await pathExists(cacheDir)) {
      // Keep clips referenced by ANY slide in the source document, so multi-view configs stay safe.
      const allDocHashes = new Set<string>(activeHashes);
      for (const slide of document.slides) {
        for (const beat of parseSlideNarration(slide.body, narrationOpts.glossary)) {
          if (!beat.silent && !beat.audio && beat.tts) {
            allDocHashes.add(computeClipHash(beat.tts, narrationOpts.tts));
          }
        }
      }
      for (const [key, rec] of Object.entries(cache.clips)) {
        if (!allDocHashes.has(key)) {
          await rm(join(cacheDir, rec.file), { force: true });
          delete cache.clips[key];
          pruned++;
        }
      }
      const clipsDir = join(cacheDir, 'clips');
      if (await pathExists(clipsDir)) {
        const referencedFiles = new Set(Object.values(cache.clips).map(rec => basename(rec.file)));
        for (const name of await readdir(clipsDir)) {
          if (!referencedFiles.has(name)) {
            await rm(join(clipsDir, name), { force: true });
            pruned++;
          }
        }
      }
      if (pruned > 0) await saveNarrationCache(cacheDir, cache);
    }

    const shouldBuild = options.build ?? !options.dryRun;
    const buildResult = shouldBuild ? await build(options) : undefined;
    return {
      cacheDir,
      totalBeats,
      spokenBeats,
      cached,
      synthesized,
      customAudio,
      missing,
      pruned,
      ...(buildResult ? { buildResult } : {}),
    };
  } finally {
    if (scratchRoot) await rm(scratchRoot, { recursive: true, force: true });
  }
}
