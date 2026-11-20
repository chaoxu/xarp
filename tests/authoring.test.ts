import { expect, test } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editDeck } from '../lib/editor/deck.js';
import { storeImage } from '../lib/editor/assets.js';
import { createEditorApi } from '../lib/editor/server.js';
import { editing } from '../lib/plugins/index.js';
import { parseSource } from '../lib/source.js';
import { build } from '../lib/build.js';

const source = '---\ntheme: default\n---\n\n<!-- slide: named -->\n\n# First\n\n```\n---\n```\n\n---\n\n# Second\n';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

test('deck edits preserve frontmatter, fenced boundaries and named IDs; assign stable unique IDs', () => {
  const moved = editDeck(source, { action: 'move', slideId: 'named', to: 1 });
  const parsed = parseSource(moved.updatedSource);
  expect(parsed.prefix).toContain('theme: default');
  expect(parsed.slides.map(s => s.body)).toEqual(['# Second', '# First\n\n```\n---\n```']);
  expect(parsed.slides[1].id).toBe('named');
  expect(parsed.slides.every(s => s.explicitId)).toBe(true);
  const duplicate = editDeck(moved.updatedSource, { action: 'duplicate', slideId: 'named' });
  const duplicated = parseSource(duplicate.updatedSource);
  expect(duplicated.slides).toHaveLength(3);
  expect(duplicated.slides[2].body).toBe(duplicated.slides[1].body);
  expect(duplicated.slides[2].id).not.toBe('named');
  expect(parseSource(editDeck(duplicate.updatedSource, { action: 'delete', slideId: duplicate.selected }).updatedSource).slides).toHaveLength(2);
  expect(() => editDeck('# Only', { action: 'delete', slideId: 'slide-1' })).toThrow('at least one');
  expect(() => editDeck(source, { action: 'move', slideId: 'named', to: 7 })).toThrow('position');
});

test('image storage rejects symlink destinations and non-images, preserves existing bytes', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'xarp-images-'));
  const outside = await mkdtemp(join(tmpdir(), 'xarp-outside-'));
  try {
    const input = join(cwd, 'slides.md'); await writeFile(input, '# Hi');
    await expect(storeImage(input, Buffer.from('<svg/>').toString('base64'))).rejects.toThrow('PNG');
    await symlink(outside, join(cwd, 'assets'));
    await expect(storeImage(input, png)).rejects.toThrow('regular directory');
    await rm(join(cwd, 'assets'));
    const path = await storeImage(input, png);
    expect(await storeImage(input, png)).toBe(path);
    expect(await readFile(join(cwd, path))).toEqual(Buffer.from(png, 'base64'));
  } finally { await rm(cwd, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('structural saves are guarded and undoable; image uploads ship even with explicit assets', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'xarp-structure-'));
  try {
    await writeFile(join(cwd, 'slides.md'), source);
    const config = { cwd, input: 'slides.md', assets: [], plugins: [editing()] };
    let result = await build(config);
    const api = await createEditorApi({ config, result: () => result, rebuild: async () => result = await build(config) });
    const post = (path: string, payload: object, revision = result.metadata.sourceRevision, origin = 'http://localhost') => api(new Request(`http://localhost/__xarp/${path}`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ viewId: 'slides', sourceFile: 'slides.md', sourceRevision: revision, ...payload }),
    }));
    expect((await post('deck', { action: 'delete', slideId: 'named' }, 'stale'))!.status).toBe(409);
    expect((await post('deck', { action: 'delete', slideId: 'named' }, undefined, 'https://evil.example'))!.status).toBe(403);
    expect(await readFile(join(cwd, 'slides.md'), 'utf8')).toBe(source);
    expect(await (await post('deck', { action: 'move', slideId: 'named', to: 1 }))!.json()).toMatchObject({ saved: true, rebuilt: true, deckChanged: true });
    const moved = await readFile(join(cwd, 'slides.md'), 'utf8');
    expect(await (await post('deck', { action: 'undo' }))!.json()).toMatchObject({ saved: true, rebuilt: true });
    expect(await readFile(join(cwd, 'slides.md'), 'utf8')).toBe(source);
    await post('deck', { action: 'redo' });
    expect(await readFile(join(cwd, 'slides.md'), 'utf8')).toBe(moved);
    const uploaded = await (await post('asset', { image: png }))!.json();
    expect(uploaded.ok).toBe(true);
    await post('save', { slideId: 'named', markdown: `# Image\n\n<img src="${uploaded.path}">` });
    expect(await readFile(join(result.output, uploaded.path))).toEqual(Buffer.from(png, 'base64'));
    expect((await post('deck', { action: 'undo' }))!.status).toBe(400);
    expect((await post('asset', { image: png }, 'stale'))!.status).toBe(409);
    const fixed = await createEditorApi({ config: { ...config, sections: [{ label: 'All', count: 2 }] }, result: () => result, rebuild: async () => result });
    const request = new Request('http://localhost/__xarp/deck', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ viewId: 'slides', sourceFile: 'slides.md', sourceRevision: result.metadata.sourceRevision, action: 'add', slideId: 'named' }) });
    expect((await fixed(request))!.status).toBe(400);
  } finally { await rm(cwd, { recursive: true, force: true }); }
}, 30000);

test('failed structural rebuild exposes recovery and accepts guarded undo', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'xarp-deck-recover-'));
  try {
    await writeFile(join(cwd, 'slides.md'), source);
    const config = { cwd, input: 'slides.md', plugins: [editing()] };
    let result = await build(config), fail = true;
    const api = await createEditorApi({ config, result: () => result, rebuild: async () => { if (fail) throw new Error('Test build failure'); return result = await build(config); } });
    const request = (action: string, revision: string) => new Request('http://localhost/__xarp/deck', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ viewId: 'slides', sourceFile: 'slides.md', sourceRevision: revision, slideId: 'named', action }) });
    const failed = await (await api(request('duplicate', result.metadata.sourceRevision)))!.json();
    expect(failed).toMatchObject({ saved: true, rebuilt: false });
    const status = await (await api(new Request('http://localhost/__xarp/status?view=slides')))!.json();
    expect(status.deckRecovery).toBe(true);
    fail = false;
    expect(await (await api(request('undo', failed.sourceRevision)))!.json()).toMatchObject({ saved: true, rebuilt: true });
    expect(await readFile(join(cwd, 'slides.md'), 'utf8')).toBe(source);
    await storeImage(join(cwd, 'slides.md'), png);
    await expect(build({ ...config, assets: [], output: 'assets/xarp/output' })).rejects.toThrow('output directory');
  } finally { await rm(cwd, { recursive: true, force: true }); }
}, 15000);
