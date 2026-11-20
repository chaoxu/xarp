import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hash, requireValue } from '../source.js';

export async function storeImage(input: string, data: unknown) {
  requireValue(typeof data === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(data), 'Invalid image encoding');
  const bytes = Buffer.from(data, 'base64');
  requireValue(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024, 'Image is too large (maximum 8 MiB)');
  const ext = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg'
    : ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString()) ? 'gif'
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null;
  requireValue(ext, 'Choose a PNG, JPEG, GIF or WebP image');
  // Refuse symlink destinations, including internal links. Uploads never replace files.
  let directory = dirname(input);
  for (const name of ['assets', 'xarp']) {
    directory = join(directory, name);
    await mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(directory);
    requireValue(info.isDirectory() && !info.isSymbolicLink(), 'Image folder must be a regular directory');
  }
  const name = `${hash(bytes)}.${ext}`, target = join(directory, name);
  try { await writeFile(target, bytes, { flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    requireValue((await lstat(target)).isFile() && !(await lstat(target)).isSymbolicLink() && (await readFile(target)).equals(bytes), 'Image destination already exists with different content');
  }
  return `assets/xarp/${name}`;
}
