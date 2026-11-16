import { expect, test } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dev } from '../lib/editor/server.js';
import { hash } from '../lib/source.js';
import { editing } from '../lib/plugins/index.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(run: (context: any) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), 'xarp-watch-'));
  const file = join(cwd, 'slides.md');
  await writeFile(file, '# First\n\n---\n\n# Second\n');
  const server = await dev({ cwd, input: 'slides.md', plugins: [editing()], port: 0 });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await server.close(); } };
  const body = (markdown = '# Saved') => ({ viewId: 'slides', sourceFile: 'slides.md', slideId: 'slide-1', sourceRevision: server.result().metadata.sourceRevision, markdown });
  const headers = { Origin: server.url.slice(0, -1), 'Content-Type': 'application/json' };
  const save = (payload: unknown = body()) => fetch(new URL('/__xarp/save', server.url), { method: 'POST', headers, body: JSON.stringify(payload) });
  const converged = async () => expect.poll(async () => server.result().metadata.sourceRevision === hash(await readFile(file)), { timeout: 8000 }).toBe(true);
  const stageExists = async () => (await readdir(cwd)).some(name => name.startsWith('.xarp-build-'));
  try { await run({ cwd, file, server, close, body, headers, save, converged, stageExists }); }
  finally { await close(); await rm(cwd, { recursive: true, force: true }); }
}

test('an external write during a rejected save still triggers a rebuild', async () => {
  await fixture(async ({ file, server, body, headers, save, converged }) => {
    const payload = JSON.stringify(body());
    let finish!: () => void;
    let finished = false;
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(payload.slice(0, 1)));
      finish = () => { if (!finished) { finished = true; controller.enqueue(new TextEncoder().encode(payload.slice(1))); controller.close(); } };
    } });
    const pending = fetch(new URL('/__xarp/save', server.url), { method: 'POST', headers, body: stream, duplex: 'half' } as RequestInit);
    try {
      // The incomplete request holds the real save lock. Invalid probes cannot write.
      await expect.poll(async () => (await (await save({})).json()).error, { timeout: 4000 }).toBe('Another save is in progress');
      const external = '# First\n\n---\n\n# External\n';
      await writeFile(file, external);
      await sleep(50); // Let the filesystem notification arrive while the save is held.
      finish();
      expect((await pending).status).toBe(409);
      expect(await readFile(file, 'utf8')).toBe(external);
      await converged();
    } finally { finish(); await pending.catch(() => {}); }
  });
}, 15000);

test('an external write during a save rebuild eventually becomes the served build', async () => {
  await fixture(async ({ file, save, converged, stageExists }) => {
    const pending = save();
    await expect.poll(stageExists, { interval: 5, timeout: 4000 }).toBe(true);
    const external = (await readFile(file, 'utf8')).replace('# Second', '# External during build');
    await writeFile(file, external);
    expect((await (await pending).json()).saved).toBe(true);
    await converged();
    expect(await readFile(file, 'utf8')).toBe(external);
  });
}, 15000);

test('closing the preview waits for an active watch build before cleanup', async () => {
  await fixture(async ({ cwd, file, close, stageExists }) => {
    await writeFile(file, '# Updated externally\n');
    await expect.poll(stageExists, { interval: 5, timeout: 4000 }).toBe(true);
    await close();
    expect((await readdir(cwd)).filter(name => name.startsWith('.xarp-build-') || name.startsWith('.xarp-old-'))).toEqual([]);
  });
}, 15000);
