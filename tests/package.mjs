import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'xarp-package-'));
try {
  const packed = JSON.parse((await run('npm', ['pack', '--json', '--pack-destination', directory], { cwd: root, maxBuffer: 4 * 1024 * 1024 })).stdout)[0];
  for (const { path } of packed.files) {
    assert(!/(?:^|\/)(?:node_modules|\.git|output|dist|\.xarp-[^/]*)(?:\/|$)/.test(path), `Unexpected package file: ${path}`);
    if (/\.(?:mjs|js|ts|md|json|css|svg)$/.test(path)) {
      const source = await readFile(join(root, path), 'utf8');
      assert(!/\/Users\/|\/home\/[^/]+\/|\/srv\/|https?:\/\/[^/\s]*\.lab\b/.test(source), `Private reference in ${path}`);
    }
  }
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'xarp-clean-consumer', private: true, type: 'module' }));
  await run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, packed.filename)], { cwd: directory, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(join(directory, 'mock-tts.mjs'), `
import { writeFileSync } from 'node:fs';
const sr = 16000, n = 8000, buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i * 0.12) * 8000), 44 + i * 2);
writeFileSync(process.env.XARP_TTS_OUT, buf);
`);
  await writeFile(join(directory, 'slides.md'), '# Consumer\n\nFormula $x^2$.\n\n<!-- beat: Consumer opening beat. -->\n\n---\n\n# Other slide\n');
  await writeFile(join(directory, 'xarp.config.mjs'), `import { editing, drawing, narration } from '@chaoxu/xarp/plugins';\nexport default { input: 'slides.md', plugins: [editing(), drawing(), narration({ tts: { provider: 'command', command: [process.execPath, 'mock-tts.mjs'], format: 'wav' } })] };\n`);
  await run(process.execPath, ['node_modules/@chaoxu/xarp/lib/cli.js', 'narrate', '--theme', 'gaia', '--color-scheme', 'ukiyo-e'], { cwd: directory });
  const html = await readFile(join(directory, 'dist/index.html'), 'utf8');
  assert(html.includes('Consumer') && html.includes('katex') && html.includes('_xarp/plugins/editing.js') && html.includes('_xarp/plugins/narration.js'));
  assert(html.includes('id="xarp-narration"'));
  assert(html.includes('data-xarp-color-scheme="ukiyo-e"'));
  assert((await readFile(join(directory, 'dist/_xarp/palettes.css'), 'utf8')).includes('--xarp-paper'));
  assert((await readFile(join(directory, 'dist/_xarp/narration/captions.vtt'), 'utf8')).includes('Consumer opening beat.'));
  const notices = await readFile(join(directory, 'dist/_xarp/plugins/LICENSES.txt'), 'utf8');
  for (const name of ['drauu 1.0.0', 'nanoevents 9.1.0', 'perfect-freehand 1.2.2', 'roughjs 4.6.6', 'perfect-freehand 1.2.3']) assert(notices.includes(name), `Missing browser dependency notice: ${name}`);
  await writeFile(join(directory, 'check.mjs'), `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dev } from '@chaoxu/xarp';
import config from './xarp.config.mjs';
const preview = await dev({ ...config, port: 0, watch: false });
try {
  const status = await (await fetch(preview.url + '__xarp/status?view=slides')).json();
  assert.equal(status.canSave, true);
  const response = await fetch(preview.url + '__xarp/save', {
    method: 'POST', headers: { Origin: new URL(preview.url).origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...status, slideId: 'slide-1', markdown: '# Saved from consumer' }),
  });
  const saved = await response.json();
  assert.equal(saved.saved, true); assert.equal(saved.rebuilt, true);
  assert.match(await readFile('slides.md', 'utf8'), /# Saved from consumer/);
  assert.equal((await fetch(preview.url + 'slides.md')).status, 404);
  assert.equal((await fetch(preview.url + '.xarp-build.json')).status, 403);
  assert.equal((await fetch(preview.url + '__xarp/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
} finally { await preview.close(); }
`);
  await run(process.execPath, ['check.mjs'], { cwd: directory, maxBuffer: 4 * 1024 * 1024 });
  console.log(`PASS clean package: ${packed.files.length} files, ${packed.size} packed bytes, production-only install, CLI build, source save and static confinement`);
} finally { await rm(directory, { recursive: true, force: true }); }
