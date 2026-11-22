import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { watch } from 'node:fs';
import { readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, resolveProject } from '../build.js';
import { containedFile, isWithin } from '../files.js';
import { narrate } from '../narrate.js';
import { hash, parseSource, requireValue, selectSlides, updateSlideInSource } from '../source.js';
import { editDeck, type DeckAction } from './deck.js';
import { storeImage } from './assets.js';
import { createHistory } from './history.js';
import { renderingChanges } from './rendering.js';
import type { BuildOptions, BuildResult } from '../types.js';
import type { SlideTextEdit } from './slide-edits.js';

const maxBody = 128 * 1024;

export interface EditorApiOptions {
  config: BuildOptions;
  result: () => BuildResult;
  rebuild: () => Promise<BuildResult>;
  version?: () => number;
  setSaving?: (saving: boolean) => void;
}

export interface SaveRequest {
  viewId: string;
  sourceFile: string;
  sourceRevision: string;
  buildRevision?: string;
  slideId: string;
  markdown?: string;
  edits?: SlideTextEdit[];
  image?: string;
  action?: DeckAction["action"];
  to?: number;
}

async function readJson(request: Request, limit = maxBody): Promise<SaveRequest> {
  const length = request.headers.get('content-length');
  requireValue(length === null || Number(length) <= limit, 'Request body is too large');
  const reader = request.body?.getReader();
  requireValue(reader, 'A JSON request body is required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('Request body is too large'); }
    chunks.push(value);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  requireValue(body && typeof body === 'object' && !Array.isArray(body), 'The request must be a JSON object');
  return body as SaveRequest;
}

/** Fixed same-origin routes for one configured deck. This function does not authenticate remote users. */
export async function createEditorApi(options: EditorApiOptions) {
  const project = await resolveProject(options.config);
  requireValue(options.config.plugins?.some(plugin => plugin.name === 'editing'), 'Enable the editing plugin to start the editor service');
  let busy = false;
  let deckHistory: ReturnType<typeof createHistory<string>> | undefined;
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/__xarp/')) return null;
    const json = (body: object, status = 200) => Response.json({ editorApi: true, mode: 'local', ...body }, { status, headers: { 'Cache-Control': 'no-store' } });
    const failure = (message: string, status = 400, extra: object = {}) => json({ ok: false, saved: false, error: message, ...extra }, status);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return failure('Use the loopback editor URL', 403);
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return failure('A same-origin request is required', 403);
    const deck = url.pathname === '/__xarp/deck';
    const asset = url.pathname === '/__xarp/asset';
    const saving = url.pathname === '/__xarp/save' || asset || deck && request.method === 'POST';
    if (!['/__xarp/status', '/__xarp/slide', '/__xarp/save', '/__xarp/deck', '/__xarp/asset'].includes(url.pathname)) return failure('Unknown editor endpoint', 404);
    if (request.method !== (saving ? 'POST' : 'GET')) return failure('Method not allowed', 405);
    if (saving && origin !== url.origin) return failure('A same-origin browser request is required', 403);
    if (saving && request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') return failure('Save requests must use application/json', 415);
    if (saving && busy) return failure('Another save is in progress', 409);
    if (saving) { busy = true; options.setSaving?.(true); }
    try {
      const sourcePath = await containedFile(project.cwd, options.config.input);
      requireValue(sourcePath === project.input, 'The configured source path changed');
      const raw = await readFile(sourcePath, 'utf8');
      const document = parseSource(raw);
      const slides = selectSlides(document, options.config.slides);
      const built = options.result();
      const identity = { viewId: project.viewId, sourceFile: project.sourceFile, sourceRevision: document.revision, buildRevision: built.metadata.buildRevision };
      const editingError = document.editingError ?? built.metadata.editingError;
      const canOrganize = !editingError && !options.config.slides;
      const canResizeDeck = canOrganize && !options.config.sections;
      const capabilities = { images: true, organize: canOrganize, resizeDeck: canResizeDeck };
      const historyState = () => ({ canUndo: deckHistory?.getState() === raw && deckHistory.canUndo(), canRedo: deckHistory?.getState() === raw && deckHistory.canRedo() });
      if (!saving) {
        if (url.searchParams.get('view') !== project.viewId) return failure('The editor is serving a different deck', 409, identity);
        if (url.pathname === '/__xarp/status') return json({ ok: true, canSave: !editingError, capabilities, deckRecovery: deckHistory?.getState() === raw && (deckHistory.canUndo() || deckHistory.canRedo()) && built.metadata.sourceRevision !== document.revision, ...identity, ...(editingError ? { error: editingError } : {}), version: options.version?.() ?? 1 });
        requireValue(!editingError, editingError ?? 'Source editing is unavailable');
        if (deck) return json({ ok: true, ...identity, capabilities, ...historyState(), slides: slides.map(slide => ({ id: slide.id, title: slide.body.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? slide.id })) });
        const slideId = url.searchParams.get('slide');
        const slide = slides.find(item => item.id === slideId);
        requireValue(slide, 'The slide is not in this deck');
        return json({ ok: true, ...identity, slideId, markdown: slide.body });
      }
      const body = await readJson(request, asset ? 12 * 1024 * 1024 : maxBody);
      const savedIdentity = { ...identity, slideId: body.slideId };
      requireValue(!editingError, editingError ?? 'Source editing is unavailable');
      if (body.viewId !== project.viewId || body.sourceFile !== project.sourceFile) return failure('The deck or source does not match', 409, savedIdentity);
      if (body.sourceRevision !== document.revision) return failure('Slide source changed. Copy edits and reload before saving.', 409, savedIdentity);
      if (asset) {
        const path = await storeImage(sourcePath, body.image);
        return json({ ok: true, ...identity, path });
      }
      let updatedSource: string, slideBody: string | undefined, selected: string | undefined;
      if (deck) {
        requireValue(canOrganize, 'Organize the source deck, not a configured slide selection');
        requireValue(canResizeDeck || ['move', 'undo', 'redo'].includes(body.action ?? ''), 'This deck has fixed section counts. Update the configuration before adding or deleting slides.');
        if (body.action === 'undo' || body.action === 'redo') {
          requireValue(deckHistory?.getState() === raw, 'Source changed since the last deck operation; its history no longer applies');
          requireValue(body.action === 'undo' ? deckHistory.canUndo() : deckHistory.canRedo(), 'No deck history in that direction');
          updatedSource = body.action === 'undo' ? deckHistory.undo() : deckHistory.redo();
          // Peek without consuming history before the guarded write succeeds.
          if (body.action === 'undo') deckHistory.redo(); else deckHistory.undo();
        } else {
          ({ updatedSource, selected } = editDeck(raw, body as DeckAction));
        }
      } else {
        requireValue(typeof body.slideId === 'string' && slides.some(slide => slide.id === body.slideId), 'The slide is not in this deck');
        ({ updatedSource, slideBody } = updateSlideInSource(raw, body.slideId, body));
      }
      const temporary = join(dirname(sourcePath), `.${basename(sourcePath)}.xarp-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, updatedSource, { flag: 'wx', mode: (await stat(sourcePath)).mode & 0o777 });
        requireValue(await containedFile(project.cwd, options.config.input) === sourcePath, 'The source path changed during save');
        if (await readFile(sourcePath, 'utf8') !== raw) return failure('Source changed during save. Copy edits and reload.', 409, savedIdentity);
        await rename(temporary, sourcePath);
      } finally { await rm(temporary, { force: true }); }
      if (deck) {
        if (body.action === 'undo') deckHistory!.undo();
        else if (body.action === 'redo') deckHistory!.redo();
        else {
          if (deckHistory?.getState() !== raw) deckHistory = createHistory(raw);
          deckHistory!.setState(updatedSource);
        }
      }
      const receipt = { ...savedIdentity, sourceRevision: hash(updatedSource), saved: true, markdown: slideBody, ...(deck ? { selected, deckChanged: true } : {}) };
      try {
        const previousHtml = await readFile(options.result().htmlPath, 'utf8').catch(error => {
          if (error.code === 'ENOENT') return '';
          throw error;
        });
        const result = await options.rebuild();
        const html = await readFile(result.htmlPath, 'utf8');
        return json({ ok: true, ...receipt, rebuilt: true, buildRevision: result.metadata.buildRevision, html,
          ...renderingChanges(previousHtml, html, result.metadata.slides, body.slideId) });
      } catch (error) {
        return json({ ok: false, ...receipt, rebuilt: false, error: `Source saved, but rebuilding failed: ${(error as Error).message}` }, 500);
      }
    } catch (error) {
      return failure((error as Error).message, (error as Error).message.includes('too large') ? 413 : 400);
    } finally {
      if (saving) { busy = false; options.setSaving?.(false); }
    }
  };
}

export async function nodeRequest(request: IncomingMessage): Promise<Request> {
  const base = `http://${request.headers.host ?? 'localhost'}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  // Stream the body so the API's size limit applies before buffering it.
  const init: RequestInit & { duplex?: string } = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = new ReadableStream({
      start(controller) {
        request.on('data', chunk => controller.enqueue(new Uint8Array(chunk)));
        request.on('end', () => controller.close());
        request.on('error', error => controller.error(error));
      },
      cancel() { request.pause(); },
    });
    init.duplex = 'half';
  }
  return new Request(new URL(request.url ?? '/', base), init);
}

export async function sendResponse(response: Response, output: ServerResponse) {
  output.writeHead(response.status, Object.fromEntries(response.headers));
  output.end(Buffer.from(await response.arrayBuffer()));
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.vtt': 'text/vtt; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg; codecs=opus', '.webm': 'audio/webm',
};

export async function staticResponse(request: Request, output: string): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
  let relativePath: string;
  try { relativePath = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html'; }
  catch { return new Response('Invalid path', { status: 400 }); }
  if (relativePath.split(/[\\/]/).some(part => part === '..' || part.startsWith('.'))) return new Response('Forbidden', { status: 403 });
  try {
    const file = await realpath(resolve(output, relativePath));
    if (!isWithin(await realpath(output), file)) return new Response('Forbidden', { status: 403 });
    const info = await stat(file);
    if (!info.isFile()) return new Response('Not found', { status: 404 });
    const mime = contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const range = request.headers.get('range');
    if (range && range.startsWith('bytes=') && info.size > 0) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match || (!match[1] && !match[2])) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
      }
      let start: number;
      let end: number;
      if (!match[1] && match[2]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
        }
        start = Math.max(0, info.size - suffix);
        end = info.size - 1;
      } else {
        start = Number(match[1]);
        end = match[2] ? Math.min(info.size - 1, Number(match[2])) : info.size - 1;
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
      }
      const bytes = request.method === 'HEAD' ? null : (await readFile(file)).subarray(start, end + 1);
      return new Response(bytes, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Range': `bytes ${start}-${end}/${info.size}`,
          'Content-Length': String(end - start + 1),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        },
      });
    }
    return new Response(request.method === 'HEAD' ? null : await readFile(file), {
      headers: { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return new Response('Not found', { status: 404 });
    throw error;
  }
}

export interface DevOptions extends BuildOptions { port?: number; watch?: boolean }

/** Start a local preview. Call close() to release the listener and watchers. */
export async function dev(options: DevOptions) {
  let result = await build(options);
  const project = await resolveProject(options);
  let version = 1, saving = false, building = false, stopped = false, pendingChanges = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeBuild: Promise<BuildResult> | undefined;
  let watchTask: Promise<void> | undefined;
  const rebuild = async () => {
    activeBuild = build(options);
    try { result = await activeBuild; version++; return result; }
    finally { activeBuild = undefined; }
  };
  const api = options.plugins?.some(plugin => plugin.name === 'editing') ? await createEditorApi({
    config: options, result: () => result, version: () => version, rebuild,
    setSaving(value) {
      saving = value;
      if (value && timer) { clearTimeout(timer); timer = undefined; }
      if (!value && pendingChanges) schedule();
    },
  }) : undefined;
  const requests = new Set<Promise<void>>();
  const hasNarration = Boolean(options.plugins?.some(plugin => plugin.name === 'narration'));
  let narrating = false;
  const handle = async (incoming: IncomingMessage, outgoing: ServerResponse) => {
    try {
      const request = await nodeRequest(incoming);
      const url = new URL(request.url);
      const hostname = url.hostname;
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return await sendResponse(new Response('Forbidden host', { status: 403 }), outgoing);
      const pathname = url.pathname;
      if (request.method === 'GET' && pathname === '/__xarp/version') return await sendResponse(Response.json({ version, sourceRevision: result.metadata.sourceRevision }, { headers: { 'Cache-Control': 'no-store' } }), outgoing);
      if (request.method === 'GET' && pathname === '/__xarp/preview.js') return await sendResponse(new Response(await readFile(fileURLToPath(new URL('../browser/preview.js', import.meta.url))), { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' } }), outgoing);
      if (request.method === 'GET' && ['/', '/index.html'].includes(pathname)) {
        const html = (await readFile(result.htmlPath, 'utf8')).replace('</body>', `<script defer src="/__xarp/preview.js" data-version="${version}"></script></body>`);
        return await sendResponse(new Response(html, { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } }), outgoing);
      }
      if (hasNarration && pathname === '/__xarp/narrate') {
        const jsonReply = (body: object, status = 200) => sendResponse(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), outgoing);
        if (request.method === 'GET') {
          if (url.searchParams.get('view') !== project.viewId) return await jsonReply({ ok: false, error: 'Different deck view' }, 409);
          return await jsonReply({ ok: true, viewId: project.viewId });
        }
        if (request.method !== 'POST') return await jsonReply({ ok: false, error: 'Method not allowed' }, 405);
        if (request.headers.get('origin') !== url.origin) return await jsonReply({ ok: false, error: 'Same-origin browser request required' }, 403);
        if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') return await jsonReply({ ok: false, error: 'JSON body required' }, 415);
        if (saving || building || narrating) return await jsonReply({ ok: false, error: 'Busy rebuilding or synthesizing' }, 409);
        narrating = true;
        if (timer) { clearTimeout(timer); timer = undefined; }
        try {
          const payload = await readJson(request) as unknown as { viewId?: string; only?: unknown; force?: unknown };
          if (payload.viewId !== project.viewId) return await jsonReply({ ok: false, error: 'Deck view mismatch' }, 409);
          const only = Array.isArray(payload.only) ? payload.only.filter((x): x is string => typeof x === 'string') : undefined;
          const force = payload.force === true;
          const synth = await narrate({ ...options, ...(only ? { only } : {}), force, build: false });
          building = true;
          try { await rebuild(); } finally { building = false; }
          return await jsonReply({ ok: true, synthesized: synth.synthesized, cached: synth.cached, sourceRevision: result.metadata.sourceRevision, timeline: result.narration ?? null });
        } catch (err) {
          return await jsonReply({ ok: false, error: (err as Error).message }, 400);
        } finally {
          narrating = false;
          if (pendingChanges) schedule();
        }
      }
      if ((building || narrating) && request.method === 'POST' && pathname.startsWith('/__xarp/')) return await sendResponse(Response.json({ editorApi: true, mode: 'local', ok: false, saved: false, error: 'A rebuild is in progress. Retry shortly.' }, { status: 409 }), outgoing);
      await sendResponse(await api?.(request) ?? await staticResponse(request, result.output), outgoing);
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'text/plain' });
      outgoing.end((error as Error).message);
    }
  };
  const server = createServer((incoming, outgoing) => {
    const request = handle(incoming, outgoing);
    requests.add(request);
    void request.finally(() => requests.delete(request));
  });
  requireValue(options.port === undefined || Number.isInteger(options.port) && options.port >= 0 && options.port <= 65535, 'Invalid port');
  await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(options.port ?? 4175, '127.0.0.1', () => { server.removeListener('error', reject); accept(); }); });
  const schedule = () => {
    if (stopped) return;
    pendingChanges = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (saving || building || narrating) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (stopped) return;
      pendingChanges = false;
      building = true;
      watchTask = (async () => {
        try {
          // A save's own file event needs no second render. External writes do.
          if (hash(await readFile(project.input)) !== result.metadata.sourceRevision) await rebuild();
        } catch (error) { console.error(`Xarp rebuild: ${(error as Error).message}`); }
        finally { building = false; watchTask = undefined; if (pendingChanges) schedule(); }
      })();
    }, 150);
  };
  const watcher = options.watch === false ? undefined : watch(dirname(project.input), (_, file) => { if (file?.toString() === basename(project.input)) schedule(); });
  const address = server.address();
  requireValue(address && typeof address !== 'string', 'The preview listener did not start');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    result: () => result,
    async close() {
      stopped = true; watcher?.close(); if (timer) clearTimeout(timer);
      server.closeAllConnections();
      const closed = new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
      await Promise.allSettled([...requests, ...(activeBuild ? [activeBuild] : []), ...(watchTask ? [watchTask] : [])]);
      await closed;
    },
  };
}
