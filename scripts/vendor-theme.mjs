import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv[2]) throw new Error('Usage: node scripts/vendor-theme.mjs /path/to/chao-ui');
const source = resolve(process.argv[2]);
const target = fileURLToPath(new URL('../themes/chao-ui/', import.meta.url));
if (source === target || target.startsWith(`${source}/`)) throw new Error('Choose an independent upstream checkout');
const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('The upstream checkout must be clean');
const revision = git('rev-parse', 'HEAD');
const files = ['theme.css', 'slides.css', 'fonts.css', 'diagrams.js', 'marks.js', 'stage.js', 'vendor/', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
await readFile(join(source, 'vendor/manifest.json'));
await mkdir(target, { recursive: true });
for (const file of files) {
  await rm(join(target, file), { recursive: true, force: true });
  await cp(join(source, file), join(target, file), { recursive: true });
}
await writeFile(join(target, 'upstream.json'), JSON.stringify({ repository: 'https://github.com/chaoxu/chao-ui', revision, files }, null, 2) + '\n');
console.log(`Bundled chao-ui ${revision}`);
