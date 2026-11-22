import { copyFile } from 'node:fs/promises';
import { build } from '@chaoxu/xarp';
import full from './xarp.config.mjs';
import quick from './xarp.quick.config.mjs';

const complete = await build(full);
const selected = await build(quick);
await copyFile(selected.htmlPath, new URL('./dist/quick.html', import.meta.url));
if (selected.narration?.vttUrl) {
  await copyFile(
    new URL(`./dist-quick/${selected.narration.vttUrl}`, import.meta.url),
    new URL(`./dist/${selected.narration.vttUrl}`, import.meta.url),
  );
}
console.log(complete.htmlPath);
console.log(new URL('./dist/quick.html', import.meta.url).pathname);
