import { expect, test } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEditorApi } from '../lib/editor/server.js';
import { editing } from '../lib/plugins/index.js';
import { parseSource } from '../lib/source.js';

const original = '# First\n\n---\n\n# Second\n';
async function fixture(run: (f: any) => Promise<void>, rebuild?: () => Promise<unknown>) {
  const cwd = await mkdtemp(join(tmpdir(), 'xarp-api-'));
  try {
    await writeFile(join(cwd, 'slides.md'), original);
    const metadata = { viewId: 'slides', sourceFile: 'slides.md', sourceRevision: parseSource(original).revision, buildRevision: 'build', slides: ['slide-1', 'slide-2'], editable: true };
    const result = { output: join(cwd, 'dist'), htmlPath: join(cwd, 'result.html'), metadata };
    await writeFile(result.htmlPath, '<html><body>Rebuilt</body></html>');
    const api = await createEditorApi({ config: { cwd, input: 'slides.md', plugins: [editing()] }, result: () => result, rebuild: async () => { if (rebuild) await rebuild(); return result; } });
    const body = { viewId: 'slides', sourceFile: 'slides.md', sourceRevision: metadata.sourceRevision, slideId: 'slide-1', markdown: '# Updated' };
    const request = (overrides = {}, headers = {}) => new Request('http://127.0.0.1:4175/__xarp/save', { method: 'POST', headers: { Origin: 'http://127.0.0.1:4175', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ...body, ...overrides }) });
    await run({ cwd, api, body, request, result });
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

test('stale pages, wrong deck/source/slide, wrong origins and malformed payloads do not write', async () => {
  await fixture(async ({ api, request, cwd }) => {
    for (const override of [{ sourceRevision: 'stale' }, { viewId: 'other' }, { sourceFile: '../outside.md' }, { slideId: 'missing' }, { markdown: 42 }, { edits: [] }]) {
      expect((await api(request(override))).status).toBeGreaterThanOrEqual(400);
      expect(await readFile(join(cwd, 'slides.md'), 'utf8')).toBe(original);
    }
    expect((await api(request({}, { Origin: 'https://example.com' }))).status).toBe(403);
    expect((await api(request({}, { Origin: '' }))).status).toBe(403);
    expect((await api(request({}, { 'Content-Type': 'text/plain' }))).status).toBe(415);
    expect((await api(request({ markdown: 'x'.repeat(130 * 1024) }))).status).toBe(413);
    expect(await readFile(join(cwd, 'slides.md'), 'utf8')).toBe(original);
  });
});

test('saving reports source success separately from rebuilding failure', async () => {
  await fixture(async ({ api, request, cwd }) => {
    const response = await api(request());
    const result = await response.json();
    expect(response.status).toBe(500);
    expect(result).toMatchObject({ saved: true, rebuilt: false, slideId: 'slide-1' });
    expect(await readFile(join(cwd, 'slides.md'), 'utf8')).toBe('# Updated\n\n---\n\n# Second\n');
    expect(result.sourceRevision).toBe(parseSource(await readFile(join(cwd, 'slides.md'), 'utf8')).revision);
  }, async () => { throw new Error('Fixture render failure'); });
});

test('overlapping saves are rejected while the first save rebuilds', async () => {
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(accept => { release = accept; });
  const rendering = new Promise<void>(accept => { entered = accept; });
  await fixture(async ({ api, request, cwd }) => {
    const first = api(request());
    await rendering;
    const second = await api(request({ markdown: '# Overwrite' }));
    expect(second.status).toBe(409);
    release();
    expect((await (await first).json()).saved).toBe(true);
    expect(await readFile(join(cwd, 'slides.md'), 'utf8')).toContain('# Updated');
  }, async () => { entered(); await waiting; });
});

test('status and source reads identify the configured deck and current revision', async () => {
  await fixture(async ({ api }) => {
    const status = await api(new Request('http://localhost:4175/__xarp/status?view=slides'));
    expect(await status.json()).toMatchObject({ editorApi: true, mode: 'local', canSave: true, sourceRevision: parseSource(original).revision });
    const slide = await api(new Request('http://localhost:4175/__xarp/slide?view=slides&slide=slide-2'));
    expect(await slide.json()).toMatchObject({ slideId: 'slide-2', markdown: '# Second' });
    expect((await api(new Request('http://attacker.example/__xarp/status?view=slides'))).status).toBe(403);
  });
});

test('replacing the configured source with an escaping symlink is rejected', async () => {
  await fixture(async ({ api, request, cwd }) => {
    const outside = await mkdtemp(join(tmpdir(), 'xarp-outside-'));
    try {
      const file = join(outside, 'outside.md');
      await writeFile(file, original);
      await rm(join(cwd, 'slides.md'));
      await symlink(file, join(cwd, 'slides.md'));
      expect((await api(request())).status).toBeGreaterThanOrEqual(400);
      expect(await readFile(file, 'utf8')).toBe(original);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});
