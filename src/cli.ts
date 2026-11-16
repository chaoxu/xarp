#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from './build.js';
import { dev } from './editor/server.js';
import { pathExists } from './files.js';
import type { BuildOptions } from './types.js';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { config: { type: 'string', short: 'c' }, output: { type: 'string', short: 'o' }, port: { type: 'string', short: 'p' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) { console.log('Usage: xarp <build|dev> [slides.md] [--config xarp.config.mjs] [--output dist] [--port 4175]'); return; }
  const [command, input, ...extra] = positionals;
  if (!['build', 'dev'].includes(command ?? '') || extra.length) throw new Error('Usage: xarp <build|dev> [slides.md] [--config xarp.config.mjs]');
  const configPath = resolve(values.config ?? 'xarp.config.mjs');
  let config: Partial<BuildOptions> = {};
  let cwd = process.cwd();
  if (values.config || await pathExists(configPath)) {
    config = (await import(pathToFileURL(configPath).href)).default;
    if (!config || typeof config !== 'object') throw new Error('The config must export an object');
    cwd = dirname(configPath);
  }
  const options: BuildOptions = { ...config, cwd, input: input ? resolve(process.cwd(), input) : config.input ?? 'slides.md', ...(values.output ? { output: resolve(process.cwd(), values.output) } : {}) };
  if (command === 'build') {
    const result = await build(options);
    console.log(result.htmlPath);
  } else {
    const preview = await dev({ ...options, ...(values.port !== undefined ? { port: Number(values.port) } : {}) });
    console.log(`Xarp: ${preview.url}`);
    if (options.plugins?.some(plugin => plugin.name === 'editing')) console.log('Press E to edit and save to Markdown. Press D to draw when drawing is enabled.');
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await preview.close(); };
    process.once('SIGINT', () => void close());
    process.once('SIGTERM', () => void close());
  }
}

main().catch(error => { console.error(`Xarp: ${error.message}`); process.exitCode = 1; });
