import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { watch } from 'node:fs';
import { readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, resolveProject } from '../build.js';
import { containedFile, isWithin } from '../files.js';
import { parseSource, requireValue, selectSlides, updateSlideInSource } from '../source.js';
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
}

async function readJson(request: Request): Promise<SaveRequest> {
  const length = request.headers.get('content-length');
  requireValue(length === null || Number(length) <= maxBody, 'Request body is too large');
  const reader = request.body?.getReader();
  requireValue(reader, 'A JSON request body is required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBody) { await reader.cancel(); throw new Error('Request body is too large'); }
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
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/__xarp/')) return null;
    const json = (body: object, status = 200) => Response.json({ editorApi: true, mode: 'local', ...body }, { status, headers: { 'Cache-Control': 'no-store' } });
    const failure = (message: string, status = 400, extra: object = {}) => json({ ok: false, saved: false, error: message, ...extra }, status);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return failure('Use the loopback editor URL', 403);
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return failure('A same-origin request is required', 403);
    const saving = url.pathname === '/__xarp/save';
    if (!['/__xarp/status', '/__xarp/slide', '/__xarp/save'].includes(url.pathname)) return failure('Unknown editor endpoint', 404);
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
      if (!saving) {
        if (url.searchParams.get('view') !== project.viewId) return failure('The editor is serving a different deck', 409, identity);
        if (url.pathname === '/__xarp/status') return json({ ok: true, canSave: !editingError, ...identity, ...(editingError ? { error: editingError } : {}), version: options.version?.() ?? 1 });
        requireValue(!editingError, editingError ?? 'Source editing is unavailable');
        const slideId = url.searchParams.get('slide');
        const slide = slides.find(item => item.id === slideId);
        requireValue(slide, 'The slide is not in this deck');
        return json({ ok: true, ...identity, slideId, markdown: slide.body });
      }
      const body = await readJson(request);
      const savedIdentity = { ...identity, slideId: body.slideId };
      requireValue(!editingError, editingError ?? 'Source editing is unavailable');
      if (body.viewId !== project.viewId || body.sourceFile !== project.sourceFile) return failure('The deck or source does not match', 409, savedIdentity);
      if (body.sourceRevision !== document.revision) return failure('Slide source changed. Copy edits and reload before saving.', 409, savedIdentity);
      requireValue(typeof body.slideId === 'string' && slides.some(slide => slide.id === body.slideId), 'The slide is not in this deck');
      const { updatedSource, slideBody } = updateSlideInSource(raw, body.slideId, body);
      const next = parseSource(updatedSource);
      const temporary = join(dirname(sourcePath), `.${basename(sourcePath)}.xarp-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, updatedSource, { flag: 'wx', mode: (await stat(sourcePath)).mode & 0o777 });
        requireValue(await containedFile(project.cwd, options.config.input) === sourcePath, 'The source path changed during save');
        if (await readFile(sourcePath, 'utf8') !== raw) return failure('Source changed during save. Copy edits and reload.', 409, savedIdentity);
        await rename(temporary, sourcePath);
      } finally { await rm(temporary, { force: true }); }
      const receipt = { ...savedIdentity, sourceRevision: next.revision, saved: true, markdown: slideBody };
      try {
        const result = await options.rebuild();
        return json({ ok: true, ...receipt, rebuilt: true, buildRevision: result.metadata.buildRevision, html: await readFile(result.htmlPath, 'utf8') });
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
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4',
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
    if (!(await stat(file)).isFile()) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : await readFile(file), { headers: { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' } });
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
  let version = 1, saving = false, building = false, stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rebuild = async () => { result = await build(options); version++; return result; };
  const api = options.plugins?.some(plugin => plugin.name === 'editing') ? await createEditorApi({
    config: options, result: () => result, version: () => version, rebuild,
    setSaving(value) { saving = value; if (value && timer) { clearTimeout(timer); timer = undefined; } },
  }) : undefined;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const request = await nodeRequest(incoming);
      const hostname = new URL(request.url).hostname;
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return await sendResponse(new Response('Forbidden host', { status: 403 }), outgoing);
      const pathname = new URL(request.url).pathname;
      if (request.method === 'GET' && pathname === '/__xarp/version') return await sendResponse(Response.json({ version, sourceRevision: result.metadata.sourceRevision }, { headers: { 'Cache-Control': 'no-store' } }), outgoing);
      if (request.method === 'GET' && pathname === '/__xarp/preview.js') return await sendResponse(new Response(await readFile(fileURLToPath(new URL('../browser/preview.js', import.meta.url))), { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' } }), outgoing);
      if (request.method === 'GET' && ['/', '/index.html'].includes(pathname)) {
        const html = (await readFile(result.htmlPath, 'utf8')).replace('</body>', `<script defer src="/__xarp/preview.js" data-version="${version}"></script></body>`);
        return await sendResponse(new Response(html, { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } }), outgoing);
      }
      if (building && pathname === '/__xarp/save') return await sendResponse(Response.json({ editorApi: true, mode: 'local', ok: false, saved: false, error: 'A rebuild is in progress. Retry shortly.' }, { status: 409 }), outgoing);
      await sendResponse(await api?.(request) ?? await staticResponse(request, result.output), outgoing);
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'text/plain' });
      outgoing.end((error as Error).message);
    }
  });
  requireValue(options.port === undefined || Number.isInteger(options.port) && options.port >= 0 && options.port <= 65535, 'Invalid port');
  await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(options.port ?? 4175, '127.0.0.1', () => { server.removeListener('error', reject); accept(); }); });
  const schedule = () => {
    if (saving || stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = undefined;
      if (building) return schedule();
      building = true;
      try { await rebuild(); } catch (error) { console.error(`Xarp rebuild: ${(error as Error).message}`); }
      finally { building = false; }
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
      await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
    },
  };
}
