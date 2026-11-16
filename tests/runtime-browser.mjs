import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { build, dev } from '../lib/index.js';
import { editing, drawing } from '../lib/plugins/index.js';
import { nodeRequest, sendResponse, staticResponse } from '../lib/editor/server.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'xarp-runtime-'));
const output = join(root, 'output/browser');
await mkdir(output, { recursive: true });
await cp(join(root, 'examples/basic'), join(temporary, 'project'), { recursive: true, filter: path => !path.includes('/dist') && !path.includes('/.xarp-') });
const config = { cwd: join(temporary, 'project'), input: 'slides.md', sections: [{ label: 'Make', count: 2 }, { label: 'Present', count: 2 }] };
const browser = await puppeteer.launch({ executablePath: process.env.XARP_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'], dumpio: process.env.CI === 'true' });
console.log(`Runtime browser: ${await browser.version()}`);
let staticDirectory;
const server = createServer(async (incoming, outgoing) => {
  try { await sendResponse(await staticResponse(await nodeRequest(incoming), staticDirectory), outgoing); }
  catch (error) { outgoing.writeHead(500); outgoing.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let preview;
try {
  for (const plugins of [[], [drawing()], [editing()], [editing(), drawing()], [drawing(), editing()]]) {
    const result = await build({ ...config, plugins });
    staticDirectory = join(temporary, `portable-${plugins.map(p => p.name).join('-') || 'plain'}`);
    await cp(result.output, staticDirectory, { recursive: true });
    const page = await browser.newPage();
    const errors = [], external = [], failedAssets = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (!request.url().startsWith(base) && !request.url().startsWith('data:')) { external.push(request.url()); void request.abort(); }
      else void request.continue();
    });
    page.on('response', response => { if (response.status() >= 400 && !response.url().includes('/__xarp/') && !response.url().endsWith('/favicon.ico')) failedAssets.push(response.url()); });
    await page.setViewport({ width: 1280, height: 720, hasTouch: true });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.$$eval('section.pf-slide', elements => elements.length), 4);
    const font = await page.$eval('section', element => getComputedStyle(element).fontFamily);
    assert.equal(font.includes('IBM Plex'), true, JSON.stringify({ font, plugins: plugins.map(p => p.name), errors, external, failedAssets }));
    assert.equal(await page.$$eval('[data-xarp-navigation]', elements => elements.length), 4);
    assert.equal(!!await page.$('.xarp-editor-toolbar'), plugins.some(p => p.name === 'editing'));
    assert.equal(!!await page.$('#xarp-drawing-toolbar'), plugins.some(p => p.name === 'drawing'));
    const edit = plugins.some(p => p.name === 'editing'), draw = plugins.some(p => p.name === 'drawing');
    if (edit) {
      await page.keyboard.press('e');
      await page.waitForSelector('body.xarp-edit-active');
      await page.waitForFunction(() => document.getElementById('te-save')?.textContent === 'Copy Edits');
    }
    if (draw) {
      await page.keyboard.press('d');
      await page.waitForSelector('body.xarp-drawing-active');
      assert.equal(await page.evaluate(() => document.body.classList.contains('xarp-edit-active')), false);
      await page.evaluate(() => {
        window.__pointerEvents = [];
        for (const name of ['pointerdown', 'pointerup', 'pointercancel']) document.querySelector('.xarp-drawing-surface').addEventListener(name, event => window.__pointerEvents.push({ type: name, pointerType: event.pointerType, isPrimary: event.isPrimary, button: event.button }));
      });
      await page.mouse.move(100, 300); await page.mouse.down(); await page.mouse.move(300, 350, { steps: 8 }); await page.mouse.up();
      await page.waitForSelector('.xarp-drawing-layer g > path');
      const cdp = await page.createCDPSession();
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 120, y: 400, button: 'left', clickCount: 1, pointerType: 'pen' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 320, y: 430, button: 'left', buttons: 1, pointerType: 'pen' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 320, y: 430, button: 'left', clickCount: 1, pointerType: 'pen' });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.$$eval('.xarp-drawing-layer g > path', paths => paths.length), 2, JSON.stringify(await page.evaluate(() => window.__pointerEvents)));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 140, y: 460 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 340, y: 490 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.$$eval('.xarp-drawing-layer g > path', paths => paths.length), 3, JSON.stringify(await page.evaluate(() => window.__pointerEvents)));
      await cdp.detach();
      if (edit) {
        await page.keyboard.press('e');
        await page.waitForSelector('body.xarp-edit-active');
        assert.equal(await page.evaluate(() => document.body.classList.contains('xarp-drawing-active')), false);
        await page.click('#te-done');
      } else await page.keyboard.press('d');
    } else if (edit) await page.click('#te-done');
    await page.click('svg.bespoke-marp-active [data-xarp-navigation] a[href="#3"]');
    await page.waitForFunction(() => location.hash === '#3');
    await page.waitForSelector('.bespoke-marp-active .katex');
    await page.evaluate(() => document.fonts.ready);
    if (plugins.length === 2 && plugins[0].name === 'editing') {
      await page.screenshot({ path: join(output, 'example-math-1280.png') });
      await page.setViewport({ width: 800, height: 600 });
      await page.screenshot({ path: join(output, 'example-math-800.png') });
      await page.setViewport({ width: 1280, height: 720 });
      await page.evaluate(() => { location.hash = '2'; });
      await page.waitForSelector('.bespoke-marp-active .pf-slide-panel');
      await page.screenshot({ path: join(output, 'example-panels.png') });
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(failedAssets, []);
    await page.close();
  }

  // Ordinary Markdown supports saving and live rebuilds without named markers.
  await writeFile(join(config.cwd, 'plain.md'), '# Original\n\nA paragraph.\n');
  preview = await dev({ cwd: config.cwd, input: 'plain.md', output: 'preview', plugins: [editing(), drawing()], port: 0 });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(preview.url, { waitUntil: 'networkidle0' });
  await writeFile(join(config.cwd, 'plain.md'), '# External rebuild\n\nA paragraph.\n');
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'External rebuild');
  await page.keyboard.press('e');
  await page.waitForFunction(() => document.getElementById('te-save')?.textContent === 'Save Slide');
  await page.click('h1', { count: 2 });
  await page.waitForSelector('h1[contenteditable=true]');
  await page.$eval('h1', element => { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
  await page.keyboard.type('Local saved'); await page.keyboard.press('Escape');
  await page.click('#te-save');
  await page.waitForFunction(() => document.getElementById('te-status')?.textContent?.startsWith('Saved '));
  await page.waitForNetworkIdle();
  assert.match(await readFile(join(config.cwd, 'plain.md'), 'utf8'), /# Local saved/);
  assert.equal(await page.$eval('#te-undo', element => element.disabled), false);
  await page.click('#te-undo');
  assert.equal(await page.$eval('h1', element => element.textContent), 'External rebuild');
  await writeFile(join(config.cwd, 'plain.md'), '# Changed elsewhere\n\nA paragraph.\n');
  await page.waitForSelector('#xarp-preview-update');
  assert.equal(await page.$eval('h1', element => element.textContent), 'External rebuild');
  assert.equal(await page.$eval('#te-redo', element => element.disabled), false);
  assert.deepEqual(errors, []);
  await page.close();
  console.log('PASS runtime: portable offline assets, plugin combinations and ordering, mouse/pen/touch, section links, plain-source save, live rebuild, retained drafts and undo');
} catch (error) {
  console.error('Failure URLs:', (await browser.pages()).map(page => page.url()));
  for (const [index, page] of (await browser.pages()).entries()) await page.screenshot({ path: join(output, `runtime-failure-${index}.png`) }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await preview?.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
