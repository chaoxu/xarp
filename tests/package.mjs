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
  await writeFile(join(directory, 'slides.md'), '# Consumer\n\nFormula $x^2$.\n\n---\n\n# Other slide\n');
  await writeFile(join(directory, 'xarp.config.mjs'), `import { editing, drawing } from '@chaoxu/xarp/plugins';\nexport default { input: 'slides.md', plugins: [editing(), drawing()] };\n`);
  await run(process.execPath, ['node_modules/@chaoxu/xarp/lib/cli.js', 'build'], { cwd: directory });
  const html = await readFile(join(directory, 'dist/index.html'), 'utf8');
  assert(html.includes('Consumer') && html.includes('katex') && html.includes('_xarp/plugins/editing.js'));
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
