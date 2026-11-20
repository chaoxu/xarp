import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { dev, build } from '../lib/index.js';
import { createServer } from 'node:http';
import { createEditorApi, nodeRequest, sendResponse, staticResponse } from '../lib/editor/server.js';
import { editing, drawing } from '../lib/plugins/index.js';

const cwd = await mkdtemp(join(tmpdir(), 'xarp-authoring-'));
const source = '---\ntheme: default\n---\n\n<!-- slide: first -->\n\n# First\n\n<div data-xarp-edit="box" style="position:absolute;left:200px;top:300px;width:100px;height:100px;background:#cf352e"></div>\n\n---\n\n<!-- slide: second -->\n\n# Second\n';
await writeFile(join(cwd, 'slides.md'), source);
await writeFile(join(cwd, 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
const preview = await dev({ cwd, input: 'slides.md', assets: [], plugins: [editing(), drawing()], port: 0, watch: false });
const browser = await puppeteer.launch({ executablePath: process.env.XARP_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(String(error)));
page.on('dialog', dialog => void dialog.accept());
const button = async (selector, label) => {
  const handle = await page.evaluateHandle(({ selector, label }) => [...document.querySelectorAll(`${selector} button`)].find(el => el.textContent === label), { selector, label });
  await handle.asElement().click(); await handle.dispose();
};
const ready = async () => {
  await page.waitForFunction(() => document.getElementById('te-save')?.textContent === 'Save Slide');
};
const organize = async (label, row = null) => {
  await page.click('#te-slides'); await page.waitForSelector('.xarp-slide-organizer[open]');
  await button(row === null ? '.xarp-slide-organizer' : `.xarp-slide-organizer li:nth-child(${row})`, label);
};
try {
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${preview.url}?edit=1`, { waitUntil: 'networkidle0' }); await ready();
  // Align the centre of a 100px box to the slide centre from within snap distance.
  await page.mouse.move(250, 350); await page.mouse.down(); await page.mouse.move(638, 350, { steps: 12 }); await page.mouse.up();
  const center = await page.$eval('[data-xarp-edit="box"]', el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; });
  assert.ok(Math.abs(center - 640) < 1, `snapped centre ${center}`);
  await page.click('#te-undo');
  await page.click('[data-xarp-edit="box"]');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.down('Alt');
  await page.mouse.move(250, 350); await page.mouse.down(); await page.mouse.move(638, 350, { steps: 12 }); await page.mouse.up();
  await page.keyboard.up('Alt');
  const unsnapped = await page.$eval('[data-xarp-edit="box"]', el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; });
  assert.ok(Math.abs(unsnapped - 638) < 1, `Alt bypass centre ${unsnapped}`);
  await page.click('#te-undo');
  console.log('PASS snapping and Alt bypass');

  let releaseUpload;
  const uploadSeen = new Promise(resolve => { releaseUpload = resolve; });
  let heldUpload;
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().endsWith('/__xarp/asset')) { heldUpload = request; releaseUpload(); }
    else void request.continue();
  });
  const chooser = page.waitForFileChooser(); await page.click('#te-image'); await (await chooser).accept([join(cwd, 'image.png')]);
  await uploadSeen;
  await page.evaluate(() => { location.hash = '#2'; });
  await page.waitForFunction(() => document.getElementById('te-slide').textContent.startsWith('#2 '));
  await page.click('#te-source');
  await page.waitForFunction(() => document.getElementById('te-textarea').value === '# Second');
  await heldUpload.continue();
  await page.waitForFunction(() => document.querySelector('section img[src^="assets/xarp/"]')?.complete && document.querySelector('section img[src^="assets/xarp/"]')?.naturalWidth > 0);
  await page.waitForFunction(() => document.getElementById('te-status').textContent.startsWith('Saved'));
  assert.equal(await page.$eval('#te-textarea', el => el.value), '# Second', 'upload must not retarget the source drawer after navigation');
  await page.click('#te-source');
  await page.evaluate(() => { location.hash = '#1'; });
  await page.waitForFunction(() => document.getElementById('te-slide').textContent.startsWith('#1 '));
  assert.match(await readFile(join(cwd, 'slides.md'), 'utf8'), /assets\/xarp\/[a-f0-9]{64}\.png/);
  await page.click('#te-undo');
  assert.equal(await page.$('section img[src^="assets/xarp/"]'), null);
  await page.click('#te-save');
  await page.waitForFunction(() => document.getElementById('te-status').textContent.startsWith('Saved'));
  assert.doesNotMatch(await readFile(join(cwd, 'slides.md'), 'utf8'), /<img/);
  await page.click('#te-redo'); await page.click('#te-save');
  await page.waitForFunction(() => document.getElementById('te-status').textContent.startsWith('Saved'));
  await page.click('#te-snap');
  const imageBox = await page.$eval('section img[src^="assets/xarp/"]', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(imageBox.x, imageBox.y); await page.mouse.down();
  await page.mouse.move(imageBox.x + 35, imageBox.y + 15, { steps: 8 }); await page.mouse.up();
  await page.click('#te-save');
  await page.waitForFunction(() => document.getElementById('te-status').textContent.startsWith('Saved'));
  assert.match(await readFile(join(cwd, 'slides.md'), 'utf8'), /<img[^>]*transform:/);
  console.log('PASS image insertion, copied asset, undo, redo and image positioning');

  await page.keyboard.press('d');
  await button('#xarp-drawing-toolbar', 'Remember: Off');
  await page.mouse.move(300, 500); await page.mouse.down(); await page.mouse.move(450, 540, { steps: 6 }); await page.mouse.up();
  const ink = await page.$eval('.xarp-drawing-ink', el => el.innerHTML);
  assert.ok(ink.includes('path'));
  await page.reload({ waitUntil: 'networkidle0' }); await ready();
  assert.equal(await page.$eval('.xarp-drawing-ink', el => el.children.length), 1);
  await organize('↓', 1);
  assert.match(await page.$eval('#te-status', el => el.textContent), /clear drawing ink/);
  await page.keyboard.press('d');
  // Exercise SVG export via the browser's download handler.
  await mkdir(join(cwd, 'downloads'));
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(cwd, 'downloads') });
  await button('#xarp-drawing-toolbar', 'Export SVG');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.match(await readFile(join(cwd, 'downloads/drawing-first.svg'), 'utf8'), /viewBox="0 0 1280 720"/);
  await button('#xarp-drawing-toolbar', 'Clear slide');
  await page.reload({ waitUntil: 'networkidle0' }); await ready();
  assert.equal(await page.$eval('.xarp-drawing-ink', el => el.children.length), 0);
  console.log('PASS drawing persistence, export, clear and organizer protection');

  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), organize('↓', 1)]); await ready();
  assert.ok((await readFile(join(cwd, 'slides.md'), 'utf8')).indexOf('slide: second') < (await readFile(join(cwd, 'slides.md'), 'utf8')).indexOf('slide: first'));
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), organize('Undo arrangement')]); await ready();
  assert.ok((await readFile(join(cwd, 'slides.md'), 'utf8')).indexOf('slide: first') < (await readFile(join(cwd, 'slides.md'), 'utf8')).indexOf('slide: second'));
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), organize('Duplicate', 1)]); await ready();
  assert.equal(await page.$$eval('svg[data-marpit-svg]', els => els.length), 3);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), organize('Delete', 2)]); await ready();
  assert.equal(await page.$$eval('svg[data-marpit-svg]', els => els.length), 2);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), organize('Add after', 1)]); await ready();
  assert.match(await readFile(join(cwd, 'slides.md'), 'utf8'), /# New slide/);
  console.log('PASS slide move, undo, duplicate, delete and add');
  await page.click('#te-slides'); await page.waitForSelector('.xarp-slide-organizer[open]');
  await mkdir('output/browser', { recursive: true }); await page.screenshot({ path: 'output/browser/authoring-organizer.png' });
  // A committed arrangement whose rebuild fails remains recoverable after reloading stale HTML.
  const recoveryCwd = join(cwd, 'recovery'); await mkdir(recoveryCwd);
  await writeFile(join(recoveryCwd, 'slides.md'), source);
  const recoveryConfig = { cwd: recoveryCwd, input: 'slides.md', plugins: [editing()] };
  let recoveryResult = await build(recoveryConfig), failOnce = true;
  const api = await createEditorApi({ config: recoveryConfig, result: () => recoveryResult, rebuild: async () => {
    if (failOnce) { failOnce = false; throw new Error('Injected rebuild failure'); }
    return recoveryResult = await build(recoveryConfig);
  } });
  const server = createServer(async (incoming, outgoing) => {
    try { const request = await nodeRequest(incoming); await sendResponse(await api(request) ?? await staticResponse(request, recoveryResult.output), outgoing); }
    catch (error) { outgoing.writeHead(500); outgoing.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?edit=1`, { waitUntil: 'networkidle0' }); await ready();
    await organize('Duplicate', 1);
    await page.waitForFunction(() => document.getElementById('te-status').textContent.includes('Open Slides'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !document.getElementById('te-slides').hidden);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), organize('Undo arrangement')]); await ready();
    assert.equal(await readFile(join(recoveryCwd, 'slides.md'), 'utf8'), source);
    // Recovery also works when Undo reaches the first snapshot and only Redo remains.
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), organize('Duplicate', 1)]); await ready();
    const duplicatedSource = await readFile(join(recoveryCwd, 'slides.md'), 'utf8');
    await page.click('#te-source');
    await page.waitForFunction(() => document.getElementById('te-textarea').value.includes('# First'));
    failOnce = true;
    await organize('Undo arrangement');
    await page.waitForFunction(() => document.getElementById('te-status').textContent.includes('Open Slides'));
    assert.equal(await page.$eval('#te-textarea', el => el.readOnly), true);
    for (const selector of ['#te-save-src', '#te-undo', '#te-redo']) assert.equal(await page.$eval(selector, el => el.disabled), true);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !document.getElementById('te-slides').hidden);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), organize('Redo arrangement')]); await ready();
    assert.equal(await readFile(join(recoveryCwd, 'slides.md'), 'utf8'), duplicatedSource);
    console.log('PASS organizer rebuild-failure recovery in both directions after reload, with stale drawer locked');

    recoveryResult = await build({ ...recoveryConfig, plugins: [drawing()] });
    const firstProject = recoveryResult;
    await page.reload({ waitUntil: 'networkidle0' });
    await page.keyboard.press('d'); await button('#xarp-drawing-toolbar', 'Remember: Off');
    await page.mouse.move(300, 500); await page.mouse.down(); await page.mouse.move(450, 540, { steps: 6 }); await page.mouse.up();
    const otherCwd = join(cwd, 'other-project'); await mkdir(otherCwd);
    await writeFile(join(otherCwd, 'slides.md'), duplicatedSource);
    recoveryResult = await build({ ...recoveryConfig, cwd: otherCwd, plugins: [drawing()] });
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('.xarp-drawing-ink', el => el.children.length), 0, 'same URL and slide IDs in another project must not restore first-project ink');
    recoveryResult = firstProject;
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('.xarp-drawing-ink', el => el.children.length), 1, 'returning to the original project restores its ink');
    console.log('PASS drawing isolation between projects at the same preview URL');
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(await page.evaluate(() => ({ status: document.getElementById('te-status')?.textContent, hash: location.hash })));
  await page.screenshot({ path: 'output/browser/authoring-failure.png' }); throw error;
} finally { await browser.close(); await preview.close(); await rm(cwd, { recursive: true, force: true }); }
