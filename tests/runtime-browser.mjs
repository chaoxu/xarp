import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { build, dev } from '../lib/index.js';
import { editing, drawing, colorSchemes } from '../lib/plugins/index.js';
import { nodeRequest, sendResponse, staticResponse } from '../lib/editor/server.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'xarp-runtime-'));
const output = join(root, 'output/browser');
await mkdir(output, { recursive: true });
await cp(join(root, 'examples/basic'), join(temporary, 'project'), { recursive: true, filter: path => !path.includes('/dist') && !path.includes('/.xarp-') });
const config = { cwd: join(temporary, 'project'), input: 'slides.md', sections: [{ label: 'Make', count: 2 }, { label: 'Present', count: 2 }] };
const browser = await puppeteer.launch({ executablePath: process.env.XARP_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
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
      await page.waitForSelector('.xarp-drawing-ink > path');
      const cdp = await page.createCDPSession();
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 120, y: 400, button: 'left', clickCount: 1, pointerType: 'pen' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 320, y: 430, button: 'left', buttons: 1, pointerType: 'pen' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 320, y: 430, button: 'left', clickCount: 1, pointerType: 'pen' });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.$$eval('.xarp-drawing-ink > path', paths => paths.length), 2, JSON.stringify(await page.evaluate(() => window.__pointerEvents)));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 140, y: 460 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 340, y: 490 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.$$eval('.xarp-drawing-ink > path', paths => paths.length), 3, JSON.stringify(await page.evaluate(() => window.__pointerEvents)));
      if (plugins.length === 2 && plugins[0].name === 'editing') await page.screenshot({ path: join(output, 'drawing-drauu-1280.png') });
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

  const paletteSource = '# A heading\n\nA [link](#2) and `inline code`.\n\n<svg id="semantic-fig" viewBox="0 0 240 80" width="240" height="80"><circle class="sem-dot" data-pf-mark="dot" data-pf-role="primary" cx="40" cy="40" r="10"/><rect class="sem-bar" data-pf-mark="bar" data-pf-role="caveat" x="90" y="20" width="120" height="36"/></svg>\n\n---\n\n![bg](assets/connection.svg)\n\n# Illustrated\n';
  await writeFile(join(config.cwd, 'colors.md'), paletteSource);
  await writeFile(join(config.cwd, 'custom.css'), '/* @theme custom */\nsection { background: var(--pf-bg); color: var(--pf-fg); font-size: 42px; }');
  for (const theme of ['chao-ui', 'default', 'gaia', 'uncover', 'custom.css']) {
    const persist = theme !== 'custom.css';
    const paletteBuild = await build({ cwd: config.cwd, input: 'colors.md', theme, plugins: [colorSchemes({ persist })] });
    staticDirectory = paletteBuild.output;
    const page = await browser.newPage();
    await page.goto(base);
    const select = 'select[aria-label="Color scheme"]';
    await page.waitForSelector(select);
    const style = () => page.$eval('section', section => {
      const css = getComputedStyle(section);
      return { background: css.backgroundColor, image: css.backgroundImage, ink: css.color, font: css.font,
        padding: css.padding, code: getComputedStyle(section.querySelector('code')).backgroundColor };
    });
    const original = await style();
    await page.select(select, 'ukiyo-e');
    const dark = await style();
    assert.equal(dark.background, 'rgb(38, 70, 83)', theme);
    assert.equal(dark.ink, 'rgb(244, 239, 227)', theme);
    assert.equal(dark.font, original.font, theme);
    assert.equal(dark.padding, original.padding, theme);
    assert.equal(await page.$eval('section p a', el => getComputedStyle(el).color), 'rgb(245, 206, 114)', theme);
    assert.equal(await page.$eval('[data-marpit-advanced-background="content"]', el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', theme);
    await page.reload();
    assert.equal((await style()).background, persist ? dark.background : original.background, theme);
    await page.select(select, 'hanami');
    assert.equal((await style()).background, 'rgb(251, 241, 243)', theme);
    await page.select(select, 'sumi-e');
    const sumie = await style();
    assert.equal(sumie.background, 'rgb(250, 248, 242)', theme);
    assert.equal(sumie.font.includes('IBM Plex Serif'), true, theme);
    assert.equal(await page.$eval('#semantic-fig', el => el.getAttribute('data-pf-hydrated')), '1', theme);
    assert.equal(await page.$eval('#semantic-fig .sem-dot', el => Boolean(el.querySelector('path') || el.tagName.toLowerCase() === 'path')), true, theme);
    await page.select(select, 'shuimo');
    const shuimo = await style();
    assert.equal(shuimo.background, 'rgb(251, 251, 249)', theme);
    assert.equal(shuimo.font.includes('IBM Plex Serif'), true, theme);
    assert.notEqual(shuimo.image, 'none', theme);
    await page.select(select, 'manga');
    const manga = await style();
    assert.equal(manga.background, 'rgb(255, 255, 255)', theme);
    assert.notEqual(manga.image, 'none', theme);
    await page.select(select, 'blueprint');
    const blueprint = await style();
    assert.equal(blueprint.background, 'rgb(10, 52, 94)', theme);
    assert.equal(blueprint.font.includes('IBM Plex Mono'), true, theme);
    await page.select(select, 'han-rubbing');
    const hanRubbing = await style();
    assert.equal(hanRubbing.background, 'rgb(23, 22, 20)', theme);
    assert.equal(hanRubbing.ink, 'rgb(239, 233, 219)', theme);
    await page.select(select, 'oscilloscope');
    const scope = await style();
    assert.equal(scope.background, 'rgb(6, 19, 11)', theme);
    assert.equal(scope.font.includes('IBM Plex Mono'), true, theme);
    await page.select(select, 'win2000');
    assert.equal((await style()).background, 'rgb(236, 233, 216)', theme);
    await page.select(select, 'yosegi');
    const yosegi = await style();
    assert.equal(yosegi.background, 'rgb(246, 235, 214)', theme);
    assert.notEqual(yosegi.image, 'none', theme);
    await page.select(select, 'kumiko');
    assert.equal((await style()).background, 'rgb(250, 245, 235)', theme);
    await page.select(select, 'zellij');
    assert.equal((await style()).background, 'rgb(250, 246, 238)', theme);
    await page.select(select, 'isfahan');
    assert.equal((await style()).background, 'rgb(12, 35, 64)', theme);
    await page.select(select, 'shippo');
    assert.equal((await style()).background, 'rgb(248, 243, 230)', theme);
    await page.select(select, '');
    assert.deepEqual(await style(), original, theme);
    if (theme === 'chao-ui') {
      assert.equal(await page.$eval('#semantic-fig', el => el.getAttribute('data-pf-hydrated')), null);
      assert.equal(await page.$eval('#semantic-fig .sem-dot', el => el.tagName.toLowerCase()), 'circle');
      assert.equal(await page.$eval('#semantic-fig .sem-bar', el => el.tagName.toLowerCase()), 'rect');
    }
    await page.goto(`${base}/?colorScheme=qinglu`);
    assert.equal((await style()).background, 'rgb(226, 204, 163)', theme);
    await page.keyboard.press('c');
    assert.equal((await style()).background, 'rgb(247, 239, 224)', theme);
    await page.select(select, '');
    assert.deepEqual(await style(), original, theme);
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

  const drawingPage = await browser.newPage();
  await drawingPage.goto(preview.url, { waitUntil: 'networkidle0' });
  await drawingPage.keyboard.press('d');
  await drawingPage.mouse.move(150, 300); await drawingPage.mouse.down(); await drawingPage.mouse.move(350, 350, { steps: 8 }); await drawingPage.mouse.up();
  const savedInk = await drawingPage.$eval('.xarp-drawing-ink', element => element.innerHTML);
  assert.ok(savedInk.includes('<path'));
  await drawingPage.keyboard.press('Escape');
  await writeFile(join(config.cwd, 'plain.md'), '# Rebuilt with ink\n\nA paragraph.\n');
  await drawingPage.waitForSelector('#xarp-preview-update');
  assert.equal(await drawingPage.$eval('.xarp-drawing-ink', element => element.innerHTML), savedInk, 'external preview updates must retain ink');
  await drawingPage.keyboard.press('d');
  await drawingPage.keyboard.down('Control'); await drawingPage.keyboard.press('z'); await drawingPage.keyboard.up('Control');
  assert.equal(await drawingPage.$eval('.xarp-drawing-ink', element => element.childElementCount), 0, 'drawing undo must survive a pending preview update');
  await drawingPage.close();
  const palettePage = await browser.newPage();
  await palettePage.goto(preview.url, { waitUntil: 'networkidle0' });
  const picker = 'select[aria-label="Color scheme"]';
  await palettePage.waitForSelector(picker, { hidden: true });
  await palettePage.keyboard.press('e');
  await palettePage.waitForSelector(picker, { visible: true });
  await palettePage.select(picker, 'kimono');
  await palettePage.click('#te-source');
  await palettePage.waitForFunction(() => document.querySelector('#te-textarea')?.value.includes('Rebuilt with ink'));
  await palettePage.$eval('#te-textarea', field => {
    field.value += '\n\n<!-- colorScheme: hanami -->';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await palettePage.click('#te-save-src');
  await palettePage.waitForFunction(() => document.querySelector('#te-status').textContent.startsWith('Saved '));
  assert.match(await readFile(join(config.cwd, 'plain.md'), 'utf8'), /<!-- colorScheme: hanami -->/);
  assert.equal(await palettePage.evaluate(() => document.documentElement.dataset.xarpColorScheme), 'kimono');
  await palettePage.select(picker, '');
  assert.equal(await palettePage.evaluate(() => document.documentElement.dataset.xarpColorScheme), 'hanami');
  await palettePage.reload();
  assert.equal(await palettePage.evaluate(() => document.documentElement.dataset.xarpColorScheme), 'hanami');
  await palettePage.close();
  console.log('PASS runtime: portable offline assets, plugin ordering, mouse/pen/touch, section links, live rebuilds, retained drafts and ink, palette switching across themes and authored defaults');
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
