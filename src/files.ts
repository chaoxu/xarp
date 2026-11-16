import { lstat, mkdir, readFile, readdir, realpath, copyFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { requireValue } from './source.js';

export function isWithin(root: string, path: string) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

export async function containedFile(root: string, file: string) {
  const canonicalRoot = await realpath(root);
  const candidate = resolve(root, file);
  requireValue(isWithin(canonicalRoot, candidate), 'Path is outside the project');
  const canonical = await realpath(candidate);
  requireValue(isWithin(canonicalRoot, canonical), 'Symlink is outside the project');
  return canonical;
}

export async function copyTree(source: string, target: string, root: string, parents = new Set<string>()) {
  const canonical = await realpath(source);
  requireValue(isWithin(root, canonical), 'Asset symlink is outside the project');
  requireValue(!parents.has(canonical), 'Asset directory contains a symlink cycle');
  const info = await lstat(canonical);
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    const next = new Set([...parents, canonical]);
    for (const name of await readdir(canonical)) await copyTree(resolve(canonical, name), resolve(target, name), root, next);
  } else {
    requireValue(info.isFile(), 'Assets must be regular files or directories');
    await mkdir(dirname(target), { recursive: true });
    await copyFile(canonical, target);
  }
}

export async function pathExists(path: string) {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

export async function outputIsOwned(path: string) {
  if (!await pathExists(path)) return true;
  if ((await lstat(path)).isSymbolicLink()) return false;
  if (!(await lstat(path)).isDirectory()) return false;
  if ((await readdir(path)).length === 0) return true;
  try { return JSON.parse(await readFile(resolve(path, '.xarp-build.json'), 'utf8')).generator === '@chaoxu/xarp'; }
  catch { return false; }
}
