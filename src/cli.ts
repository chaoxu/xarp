#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from './build.js';
import { dev } from './editor/server.js';
import { narrate, extractNarrationOptions } from './narrate.js';
import { narration as narrationPlugin } from './plugins/index.js';
import { pathExists } from './files.js';
import { isColorScheme } from './color-schemes.js';
import type { BuildOptions, NarrationOptions, NarrationTtsOptions } from './types.js';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      output: { type: 'string', short: 'o' },
      port: { type: 'string', short: 'p' },
      theme: { type: 'string' },
      'color-scheme': { type: 'string' },
      only: { type: 'string' },
      force: { type: 'boolean' },
      prune: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'no-build': { type: 'boolean' },
      provider: { type: 'string' },
      'tts-url': { type: 'string' },
      voice: { type: 'string' },
      speed: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: xarp <build|dev|narrate> [slides.md] [--config xarp.config.mjs] [--output dist] [--port 4175] [--theme name-or-css] [--color-scheme name]\n' +
      '       xarp narrate [slides.md] [--only id1,id2] [--force] [--prune] [--dry-run] [--provider http|openai|say|command] [--tts-url url] [--voice name] [--speed 1.0] [--no-build]',
    );
    return;
  }
  const [command, input, ...extra] = positionals;
  if (!['build', 'dev', 'narrate'].includes(command ?? '') || extra.length) {
    throw new Error('Usage: xarp <build|dev|narrate> [slides.md] [--config xarp.config.mjs]');
  }
  const configPath = resolve(values.config ?? 'xarp.config.mjs');
  let config: Partial<BuildOptions> = {};
  let cwd = process.cwd();
  if (values.config || await pathExists(configPath)) {
    config = (await import(pathToFileURL(configPath).href)).default;
    if (!config || typeof config !== 'object') throw new Error('The config must export an object');
    cwd = dirname(configPath);
  }
  const palette = values['color-scheme'];
  if (palette !== undefined && !isColorScheme(palette)) throw new Error(`Unknown color scheme: ${palette}`);
  const options: BuildOptions = {
    ...config,
    cwd,
    input: input ? resolve(process.cwd(), input) : config.input ?? 'slides.md',
    ...(values.output ? { output: resolve(process.cwd(), values.output) } : {}),
    ...(values.theme !== undefined ? { theme: values.theme } : {}),
    ...(palette !== undefined ? { colorScheme: palette } : {}),
  };

  if (command === 'build') {
    const result = await build(options);
    console.log(result.htmlPath);
    return;
  }

  if (command === 'narrate') {
    const baseNarration: NarrationOptions = extractNarrationOptions(options);
    const ttsOverride: NarrationTtsOptions = { ...(baseNarration.tts ?? {}) };
    if (values.provider !== undefined) {
      if (!['http', 'openai', 'say', 'command'].includes(values.provider)) {
        throw new Error(`Unknown TTS provider: ${values.provider}`);
      }
      ttsOverride.provider = values.provider as NarrationTtsOptions['provider'];
    }
    if (values['tts-url'] !== undefined) ttsOverride.url = values['tts-url'];
    if (values.voice !== undefined) ttsOverride.voice = values.voice;
    if (values.speed !== undefined) {
      const spd = Number(values.speed);
      if (!Number.isFinite(spd) || spd <= 0) throw new Error(`Invalid speed: ${values.speed}`);
      ttsOverride.speed = spd;
    }
    const mergedNarration: NarrationOptions = {
      ...baseNarration,
      ...(Object.keys(ttsOverride).length ? { tts: ttsOverride } : {}),
    };
    const plugins = [...(options.plugins ?? [])];
    const existingIdx = plugins.findIndex(plugin => plugin.name === 'narration');
    if (existingIdx >= 0) plugins[existingIdx] = narrationPlugin(mergedNarration);
    else plugins.push(narrationPlugin(mergedNarration));

    const only = values.only ? values.only.split(',').map(item => item.trim()).filter(Boolean) : undefined;
    const result = await narrate({
      ...options,
      plugins,
      narration: mergedNarration,
      ...(only?.length ? { only } : {}),
      force: values.force === true,
      prune: values.prune === true,
      dryRun: values['dry-run'] === true,
      build: values['no-build'] !== true && values['dry-run'] !== true,
      onProgress(ev) {
        const tag = `[#${ev.slideNumber} ${ev.slideId}:${ev.beatIndex + 1}]`;
        if (ev.type === 'synthesized') {
          console.log(`${tag} synthesized (${ev.duration?.toFixed(2)}s) ${ev.caption || ev.tts}`);
        } else if (ev.type === 'asr-warning') {
          console.warn(`${tag} ASR warning (WER ${(ev.asrErrorRate! * 100).toFixed(0)}%): "${ev.asrTranscript}"`);
        } else if (ev.type === 'retry-asr') {
          console.warn(`${tag} ASR retry #${ev.attempt} (WER ${(ev.asrErrorRate! * 100).toFixed(0)}%): "${ev.asrTranscript}"`);
        }
      },
    });
    const parts = [
      `${result.synthesized} synthesized`,
      `${result.cached} cached`,
      ...(result.customAudio ? [`${result.customAudio} custom`] : []),
      ...(result.missing ? [`${result.missing} unsynthesized`] : []),
      ...(result.pruned ? [`${result.pruned} pruned`] : []),
    ];
    console.log(`Xarp narrate: ${parts.join(', ')} (${result.spokenBeats} spoken / ${result.totalBeats} authored beats)`);
    if (result.buildResult) console.log(result.buildResult.htmlPath);
    return;
  }

  const preview = await dev({ ...options, ...(values.port !== undefined ? { port: Number(values.port) } : {}) });
  console.log(`Xarp: ${preview.url}`);
  if (options.plugins?.some(plugin => plugin.name === 'editing')) {
    console.log('Press E to edit and save to Markdown. Press D to draw when drawing is enabled.');
  }
  if (options.plugins?.some(plugin => plugin.name === 'narration')) {
    console.log(`Watch Mode: ${preview.url}?watch=1 (or press W in the presentation).`);
  }
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await preview.close(); };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
}

main().catch(error => { console.error(`Xarp: ${error.message}`); process.exitCode = 1; });
