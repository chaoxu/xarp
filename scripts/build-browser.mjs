import { build } from 'esbuild';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = join(root, 'lib/browser');
await mkdir(destination, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/browser/history.ts', 'src/browser/edit-mapping.ts'],
  outdir: destination, bundle: true, platform: 'browser', format: 'iife',
  minify: true, legalComments: 'eof', target: ['es2022'],
});
await build({
  absWorkingDir: root,
  entryPoints: ['src/browser/editing.js', 'src/browser/drawing.js', 'src/browser/color-schemes.js', 'src/browser/marks.js', 'src/browser/narration.js'],
  outdir: destination, bundle: true, platform: 'browser', format: 'iife',
  legalComments: 'eof', target: ['es2022'],
});
for (const name of ['editing.css', 'drawing.css', 'color-schemes.css', 'narration.css', 'palettes.css', 'sections.css', 'preview.js']) {
  await copyFile(join(root, 'src/browser', name), join(destination, name));
}
const moveable = dirname(require.resolve('moveable/package.json'));
await copyFile(join(moveable, 'dist/moveable.min.js'), join(destination, 'moveable.js'));

async function packageDirectory(name, from = require) {
  try { return dirname(from.resolve(`${name}/package.json`)); }
  catch {
    let directory = dirname(from.resolve(name));
    while (directory !== dirname(directory)) {
      try { if (JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).name === name) return directory; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      directory = dirname(directory);
    }
    throw new Error(`Cannot find package metadata: ${name}`);
  }
}

async function licenseTexts(names) {
  const visited = new Set(), notices = [];
  const fallback = JSON.parse(await readFile(join(root, 'licenses/manifest.json'), 'utf8'));
  async function visit(name, from) {
    const directory = await packageDirectory(name, from);
    if (visited.has(directory)) return;
    visited.add(directory);
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    const files = (await readdir(directory)).filter(file => /^(?:licen[cs]e|copying|notice)(?:$|[.\-_])/i.test(file));
    let text;
    if (files.length) text = (await Promise.all(files.map(file => readFile(join(directory, file), 'utf8')))).join('\n');
    else {
      const record = fallback[name];
      if (!record || record.version !== manifest.version) throw new Error(`Missing license text for ${name} ${manifest.version}`);
      text = await readFile(join(root, 'licenses', record.file), 'utf8');
      if (createHash('sha256').update(text).digest('hex') !== record.sha256) throw new Error(`License checksum mismatch: ${name}`);
    }
    notices.push(`${manifest.name} ${manifest.version}\n${text}`);
    const localRequire = createRequire(join(directory, 'package.json'));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) await visit(dependency, localRequire);
    for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
      try { await packageDirectory(peer, localRequire); } catch { continue; }
      await visit(peer, localRequire);
    }
  }
  for (const name of names) await visit(name, require);
  return notices.join('\n\n---\n\n');
}

// Drauu's published core also inlines nanoevents and perfect-freehand without
// listing them as dependencies, and semantic marks bundle chao-ui's vendored
// roughjs and perfect-freehand modules. Retain those upstream notices in our bundle.
const marksNotices = [
  `roughjs 4.6.6\n${await readFile(join(root, 'themes/chao-ui/vendor/roughjs/LICENSE'), 'utf8')}`,
  `perfect-freehand 1.2.3\n${await readFile(join(root, 'themes/chao-ui/vendor/perfect-freehand/LICENSE'), 'utf8')}`,
].join('\n\n---\n\n');
await writeFile(join(destination, 'LICENSES.txt'), await licenseTexts(['drauu', 'moveable', 'travels', 'mutative', 'markdown-it', 'katex', 'tslib'])
  + '\n\n---\n\n' + await readFile(join(root, 'licenses/drauu-bundled.txt'), 'utf8')
  + '\n\n---\n\n' + marksNotices);
const marpCli = await packageDirectory('@marp-team/marp-cli');
const rendererNotices = await licenseTexts(['@marp-team/marp-cli', '@marp-team/marp-core']);
await writeFile(join(destination, 'RENDERER-LICENSES.txt'), rendererNotices + '\n\n' + await readFile(join(marpCli, 'lib/bespoke.js.LICENSE.txt'), 'utf8'));
