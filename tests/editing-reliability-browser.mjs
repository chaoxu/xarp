import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { dev } from '../lib/editor/server.js';
import { editing, drawing } from '../lib/plugins/index.js';

const browser = await puppeteer.launch({ executablePath: process.env.XARP_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const checks = [];
async function withDeck(markdown, run, options = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'xarp-editing-regression-'));
  let preview, page;
  try {
    await mkdir(join(cwd, 'assets'));
    await writeFile(join(cwd, 'assets/bg.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="white"/></svg>');
    await writeFile(join(cwd, 'slides.md'), markdown);
    preview = await dev({ cwd, input: 'slides.md', theme: 'default', plugins: [editing(), drawing()], port: 0, watch: false, ...options });
    page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    page.on('dialog', dialog => void dialog.accept());
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(`${preview.url}?edit=1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.getElementById('te-save')?.textContent === 'Save Slide');
    await run({ page, cwd, preview, source: () => readFile(join(cwd, 'slides.md'), 'utf8') });
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page) console.error(await page.evaluate(() => ({ status: document.getElementById('te-status')?.textContent, hash: location.hash, source: document.getElementById('te-textarea')?.value })));
    throw error;
  } finally { await page?.close(); await preview?.close(); await rm(cwd, { recursive: true, force: true }); }
}
const status = page => page.$eval('#te-status', element => element.textContent);
const text = (page, selector) => page.$eval(selector, element => element.textContent);
const disabled = (page, selector) => page.$eval(selector, element => element.disabled);
async function go(page, number) {
  await page.evaluate(number => { location.hash = String(number); }, number);
  await page.waitForFunction(number => document.getElementById('te-slide')?.textContent.startsWith(`#${number} `), {}, number);
}
async function editText(page, selector, value) {
  await page.click(selector, { count: 2 });
  await page.waitForFunction(selector => document.querySelector(selector)?.isContentEditable, {}, selector);
  await selectContents(page, selector);
  await page.keyboard.type(value); await page.keyboard.press('Escape');
}
async function selectContents(page, selector) {
  await page.$eval(selector, element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
}
async function save(page, selector = '#te-save') {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/__xarp/save');
  await page.click(selector);
  const receipt = await (await response).json();
  assert.equal(receipt.saved, true, JSON.stringify(receipt));
  assert.equal(receipt.rebuilt, true, JSON.stringify(receipt));
  await page.waitForFunction(() => document.getElementById('te-status')?.textContent.startsWith('Saved '));
  return receipt;
}
async function saveMarkdown(page, markdown) {
  if (!await page.$eval('.xarp-editor-drawer', element => element.classList.contains('is-open'))) await page.click('#te-source');
  await page.waitForFunction(() => !document.getElementById('te-textarea').readOnly);
  await page.$eval('#te-textarea', element => { element.focus(); element.select(); });
  await page.keyboard.type(markdown);
  return save(page, '#te-save-src');
}
const plain = '# One\n- item 1\n- item 2\n\n<p id="p1" style="position:absolute;left:80px;top:400px">Para one</p>\n\n<svg width="500" height="140" style="position:absolute;left:80px;top:500px"><text id="svg-label" x="30" y="50">Label</text></svg>\n\n---\n\n# Two\n\nSecond paragraph here\n\n---\n\n# Three\n\n| A | B |\n| - | - |\n| one | two |\n';
try {
  await withDeck('# Formula\n', async ({ page, source }) => {
    const block = '$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$';
    const body = '# Formula\n\n- **Square** $x^2$\n\n' + block + '\n\n```tex\n' + block + '\n```';
    await saveMarkdown(page, body);
    assert.equal(await text(page, 'li strong'), 'Square');
    assert.equal(await text(page, 'li annotation'), 'x^2');
    assert.equal(await page.$eval('.katex-mathml', el => getComputedStyle(el).position), 'absolute');
    assert.match(await page.$eval('.katex-html', el => getComputedStyle(el).fontFamily), /KaTeX_Main/);
    await page.click('#te-source');

    await page.click('li', { count: 2 });
    await selectContents(page, 'li .xarp-edit-math-token');
    await page.keyboard.type('$x^3$');
    await page.keyboard.press('Escape');
    assert.equal(await text(page, 'li annotation'), 'x^3');
    await save(page);
    const changedInline = body.replace('$x^2$', '$x^3$');
    assert.equal((await source()).trim(), changedInline);

    const paragraph = 'section > p';
    await page.click(paragraph, { count: 2 });
    await selectContents(page, paragraph);
    const updatedBlock = block.replace('a &= b', 'a^2 &= b');
    const cdp = await page.createCDPSession();
    await cdp.send('Input.insertText', { text: updatedBlock });
    await cdp.detach();
    await page.keyboard.press('Escape');
    assert.equal((await text(page, '.katex-display annotation')).trim(), updatedBlock.slice(3, -3));
    await save(page);
    assert.equal((await source()).trim(), changedInline.replace('a &= b', 'a^2 &= b'));
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal((await text(page, '.katex-display annotation')).trim(), updatedBlock.slice(3, -3));
    assert.equal(await text(page, 'li annotation'), 'x^3');
    assert.match(await text(page, 'code.language-tex'), /a &= b/);
    checks.push('Adding the first formula loads its styles; inline and multiline formula edits render, save as Markdown, and survive reload');
  });

  await withDeck(plain, async ({ page, source }) => {
    await page.click('#te-source');
    await page.waitForFunction(() => document.getElementById('te-textarea').value.includes('# One'));
    await page.click('#p1');
    const before = await page.$eval('#p1', element => element.getAttribute('style'));
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => document.getElementById('te-drawer-title').textContent.startsWith('slide-2'));
    await page.waitForFunction(() => document.getElementById('te-textarea').value.includes('# Two'));
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.$eval('#p1', element => element.getAttribute('style')), before);
    assert.doesNotMatch(await status(page), /Unsaved/);
    checks.push('Keyboard slide navigation clears selection and updates the Markdown drawer');

    await go(page, 1);
    await page.click('#te-source');
    await page.click('svg.bespoke-marp-active h1'); await page.keyboard.press('ArrowRight');
    await save(page);
    assert.equal(await page.$$eval('svg.bespoke-marp-active li', elements => elements.length), 2);
    assert.match(await source(), /<h1[^>]*>One<\/h1>\n\n- item 1/);
    await editText(page, 'svg.bespoke-marp-active li:nth-child(2)', 'changed item');
    await save(page);
    assert.match(await source(), /- item 1\n- changed item/);
    checks.push('Heading movement preserves an adjacent list and bullet text saves to the correct item');

    await go(page, 2);
    await page.click('svg.bespoke-marp-active section > p'); await page.keyboard.press('ArrowRight');
    assert.match(await status(page), /cannot be mapped/);
    assert.equal(await disabled(page, '#te-save'), true);
    await page.click('#te-undo');
    assert.doesNotMatch(await status(page), /cannot be mapped|Unsaved/);
    await go(page, 3);
    await editText(page, 'svg.bespoke-marp-active td', 'changed cell');
    assert.match(await status(page), /Could not identify/);
    assert.equal(await disabled(page, '#te-save'), true);
    await page.click('#te-undo');
    assert.doesNotMatch(await status(page), /Could not identify|Unsaved/);
    checks.push('Unsupported layout and table edits report their mapping error before Save, and Undo clears it');
  });

  await withDeck(plain, async ({ page }) => {
    await page.click('#svg-label', { count: 2 });
    await page.waitForSelector('.xarp-editor-svg-input');
    await page.keyboard.type('New label'); await page.keyboard.press('Enter');
    assert.equal(await page.$('.xarp-editor-svg-input'), null);
    assert.equal(await text(page, '#svg-label'), 'New label');
    await page.click('#te-undo');
    await page.keyboard.press('Escape');
    assert.equal(await text(page, '#svg-label'), 'Label');
    await page.click('#svg-label', { count: 2 });
    await page.waitForSelector('.xarp-editor-svg-input');
    const cdp = await page.createCDPSession();
    await cdp.send('Input.imeSetComposition', { selectionStart: 2, selectionEnd: 2, text: 'ni' });
    await page.keyboard.press('Enter');
    assert.ok(await page.$('.xarp-editor-svg-input'));
    await cdp.send('Input.insertText', { text: '你' });
    await page.evaluate(() => document.querySelector('.xarp-editor-svg-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true })));
    assert.ok(await page.$('.xarp-editor-svg-input'));
    await page.keyboard.press('Enter');
    assert.equal(await page.$('.xarp-editor-svg-input'), null);
    assert.equal(await text(page, '#svg-label'), '你');
    await page.click('#te-undo'); await page.keyboard.press('Escape');
    assert.equal(await text(page, '#svg-label'), 'Label');
    checks.push('SVG Enter commits text, while composition and keyCode 229 keep the input open');

    await page.click('#p1', { count: 2 });
    await page.$eval('#p1', element => { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    await cdp.send('Input.imeSetComposition', { selectionStart: 2, selectionEnd: 2, text: 'ni' });
    await cdp.send('Input.imeSetComposition', { selectionStart: 5, selectionEnd: 5, text: 'nihao' });
    await cdp.send('Input.insertText', { text: '你好' });
    await page.keyboard.press('Escape');
    assert.equal(await text(page, '#p1'), '你好');
    await page.click('#te-undo'); await page.keyboard.press('Escape');
    assert.equal(await text(page, '#p1'), 'Para one');
    await page.click('#te-redo'); await page.keyboard.press('Escape');
    assert.equal(await text(page, '#p1'), '你好');
    await cdp.detach();
    checks.push('A composed contenteditable edit is one reversible history step');
  });

  await withDeck('![bg](assets/bg.svg)\n\n# Background\n\n<p id="p1">First text</p>\n\n---\n\n# Following\n\n<p id="p2">Second text</p>\n', async ({ page, source }) => {
    assert.equal(await page.$$eval('[data-xarp-navigation]', elements => elements.length), 2);
    await editText(page, '#p1', 'First changed'); await save(page);
    await go(page, 2);
    await editText(page, '#p2', 'Second changed'); await save(page);
    assert.match(await source(), /First changed[\s\S]*---[\s\S]*Second changed/);
    assert.equal(await text(page, '#p1'), 'First changed');
    assert.equal(await text(page, '#p2'), 'Second changed');
    await go(page, 1); await page.keyboard.press('d');
    await page.mouse.move(150, 350); await page.mouse.down(); await page.mouse.move(300, 400); await page.mouse.up();
    await page.waitForSelector('.xarp-drawing-ink > path');
    checks.push('Background slides and subsequent slides edit, save, navigate and draw using their content layer');
  }, { sections: [{ label: 'First', count: 1 }, { label: 'Second', count: 1 }] });

  await withDeck('# Alpha\n\n---\n\n# Beta\n\n<p id="p2">Original</p>\n', async ({ page, source, preview }) => {
    const color = () => page.$eval('#p2', element => getComputedStyle(element).color);
    // Marp skips rendering inactive slides. Inspect their DOM, then check color when visible.
    const inlineColor = () => page.$eval('#p2', element => element.closest('section').style.color);
    const red = '# Alpha\n\n<!-- color: rgb(200, 0, 0) -->';
    const blue = '# Alpha\n\n<!-- color: rgb(0, 0, 200) -->';
    const receipt = await saveMarkdown(page, red);
    assert.deepEqual(receipt.changedSlides, ['slide-2']);
    assert.equal(receipt.deckStyleChanged, false);
    assert.equal(await inlineColor(), 'rgb(200, 0, 0)');
    await page.click('#te-undo');
    assert.match(await status(page), /Unsaved/);
    await page.click('#te-redo');
    assert.equal(await disabled(page, '#te-save'), true);
    await go(page, 2);
    assert.equal(await color(), 'rgb(200, 0, 0)');
    await editText(page, '#p2', 'Pending text');
    await go(page, 1); await saveMarkdown(page, blue);
    assert.equal(await text(page, '#p2'), 'Pending text');
    assert.equal(await inlineColor(), 'rgb(200, 0, 0)');
    assert.match(await status(page), /Unsaved slides: 2/);
    await go(page, 2);
    assert.equal(await color(), 'rgb(200, 0, 0)');
    await page.click('#te-undo');
    assert.equal(await text(page, '#p2'), 'Original');
    assert.equal(await color(), 'rgb(0, 0, 200)');
    assert.equal(await disabled(page, '#te-save'), true);
    await page.click('#te-redo'); await page.keyboard.press('Escape');
    assert.equal(await text(page, '#p2'), 'Pending text');
    await save(page);
    assert.equal(await color(), 'rgb(0, 0, 200)');
    assert.match(await source(), /Pending text/);
    checks.push('Global directives update clean slides and preserve dirty slides until save or Undo to clean');

    await editText(page, '#p2', 'Still pending');
    await go(page, 1);
    await saveMarkdown(page, blue + '\n\n<style>h1 { letter-spacing: 7px }</style>');
    assert.match(await text(page, '#te-notice'), /Reload to see the latest rendering/);
    await page.setViewport({ width: 800, height: 600 });
    assert.equal(await page.$eval('#te-notice', element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth && element.scrollWidth <= element.clientWidth;
    }), true);
    assert.equal(await text(page, '#p2'), 'Still pending');
    assert.match(await status(page), /Unsaved slides: 2/);
    const fresh = await browser.newPage();
    try {
      await fresh.goto(preview.url, { waitUntil: 'networkidle0' });
      assert.equal(await fresh.$eval('h1', element => getComputedStyle(element).letterSpacing), '7px');
    } finally { await fresh.close(); }
    checks.push('Deck CSS changes show a persistent reload notice and retain other unsaved edits');
  });

  await withDeck('# Alpha\n\n<p id="p1">Original</p>\n', async ({ page }) => {
    await saveMarkdown(page, '![bg](assets/bg.svg)\n\n# Alpha\n\n<p id="p1">Original</p>');
    assert.match(await text(page, '#te-notice'), /Reload to see the latest rendering/);
    await page.click('#te-source');
    await page.click('#p1', { count: 2 });
    assert.equal(await page.$eval('#p1', element => element.isContentEditable), false);
    checks.push('A changed background-layer structure requires reload before visual editing resumes');
  });

  await withDeck('# Alpha\n\n---\n\n# Beta\n\n<p id="p2">Original</p>\n', async ({ page }) => {
    await go(page, 2);
    await page.click('#te-source');
    await page.waitForFunction(() => !document.getElementById('te-textarea').readOnly);
    const original = await page.$eval('#te-textarea', element => element.value);
    await page.$eval('#te-textarea', element => { element.focus(); element.setSelectionRange(element.value.length, element.value.length); });
    await page.keyboard.type(' draft');
    await go(page, 1);
    await saveMarkdown(page, '# Alpha\n\n<!-- color: rgb(200, 0, 0) -->\n\n<!-- footer: Shared footer -->');
    await go(page, 2);
    await page.waitForFunction(() => document.getElementById('te-textarea').value.endsWith(' draft'));
    await page.$eval('#te-textarea', element => { element.focus(); element.select(); });
    await page.keyboard.type(original);
    assert.equal(await page.$eval('#p2', element => getComputedStyle(element).color), 'rgb(200, 0, 0)');
    assert.equal(await text(page, 'svg.bespoke-marp-active footer'), 'Shared footer');
    assert.equal(await page.$eval('#te-notice', element => element.hidden), true);
    assert.equal(await disabled(page, '#te-save'), true);
    checks.push('Typing a Markdown draft back to its saved text applies deferred color and footer changes');
  });

  await withDeck('# Alpha\n\n---\n\n![bg](assets/bg.svg)\n\n# Beta\n\n<p id="p2">Original</p>\n\n---\n\n![bg](assets/bg.svg)\n\n# Gamma\n\n<p id="p3">Third</p>\n', async ({ page }) => {
    await go(page, 2); await editText(page, '#p2', 'Pending');
    await go(page, 1); await saveMarkdown(page, '# Alpha\n\n<!-- color: rgb(200, 0, 0) -->');
    assert.equal(await page.$eval('#p3', element => getComputedStyle(element).color), 'rgb(200, 0, 0)');
    assert.equal(await text(page, '#p2'), 'Pending');
    await go(page, 2); await page.click('#te-undo');
    assert.equal(await page.$eval('#p2', element => getComputedStyle(element).color), 'rgb(200, 0, 0)');
    assert.equal(await text(page, '#p2'), 'Original');
    assert.equal(await page.$$eval('svg.bespoke-marp-active figure', elements => elements.length), 1);
    assert.equal(await page.$$eval('svg.bespoke-marp-active > foreignObject', elements => elements.length), 3);
    checks.push('Reconciliation preserves background layers for both unchanged and deferred slide text');
  });

  await withDeck('# Alpha\n\n<p id="p1">Original</p>\n', async ({ page, cwd, source }) => {
    await editText(page, '#p1', 'Saved before rebuild');
    await symlink(join(cwd, 'assets'), join(cwd, 'assets/loop'));
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/__xarp/save');
    await page.click('#te-save');
    const failed = await (await response).json();
    assert.equal(failed.saved, true); assert.equal(failed.rebuilt, false);
    await page.waitForFunction(() => document.getElementById('te-status').textContent.includes('Rebuild failed'));
    assert.match(await source(), /Saved before rebuild/);
    await page.click('#p1', { count: 2 });
    assert.equal(await page.$eval('#p1', element => element.isContentEditable), false);
    await rm(join(cwd, 'assets/loop'));
    await page.click('#te-undo');
    await save(page);
    assert.equal(await page.$eval('#te-notice', element => element.hidden), true);
    await page.click('#p1', { count: 2 });
    assert.equal(await page.$eval('#p1', element => element.isContentEditable), true);
    checks.push('A failed rebuild preserves source and undo, blocks stale editing, and clears its notice after recovery');
  });

  await withDeck('# Alpha\n\n<p id="p1">Original</p>\n', async ({ page }) => {
    await page.setRequestInterception(true);
    page.on('request', async request => {
      if (new URL(request.url()).pathname !== '/__xarp/save') return request.continue();
      const response = await fetch(request.url(), { method: 'POST', headers: { Origin: new URL(request.url()).origin, 'Content-Type': 'application/json' }, body: request.postData() });
      const receipt = await response.json(); delete receipt.changedSlides; delete receipt.deckStyleChanged;
      await request.respond({ status: response.status, contentType: 'application/json', body: JSON.stringify(receipt) });
    });
    await editText(page, '#p1', 'Changed'); await save(page);
    assert.match(await text(page, '#te-notice'), /Reload to see the latest rendering/);
    await page.click('#p1', { count: 2 });
    assert.equal(await page.$eval('#p1', element => element.isContentEditable), true);
    checks.push('Receipts without rendering-change metadata show a reload notice while retaining editing');
  });

  for (const invalidEdit of [false, true]) await withDeck('# Alpha\n\nPlain paragraph.\n', async ({ page, source }) => {
    let retries = 0;
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const path = new URL(request.url()).pathname;
      if (path === '/__xarp/retry') {
        retries++;
        return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...JSON.parse(request.postData()), sourceFile: 'slides.md', slideId: 'slide-1', editorApi: true, mode: 'hosted', ok: true, published: true }) });
      }
      if (path !== '/__xarp/save') return request.continue();
      const response = await fetch(request.url(), { method: 'POST', headers: { Origin: new URL(request.url()).origin, 'Content-Type': 'application/json' }, body: request.postData() });
      const receipt = await response.json();
      await request.respond({ status: response.status, contentType: 'application/json', body: JSON.stringify({ ...receipt, mode: 'hosted', published: false, retryable: true, error: 'Fixture publication failure' }) });
    });
    await editText(page, 'h1', 'Saved heading');
    const saving = page.waitForResponse(response => new URL(response.url()).pathname === '/__xarp/save');
    await page.click('#te-save'); await saving;
    await page.waitForFunction(() => document.getElementById('te-save').textContent === 'Retry Publish');
    const savedSource = await source();
    if (invalidEdit) { await page.click('section > p'); await page.keyboard.press('ArrowRight'); }
    assert.equal(await disabled(page, '#te-save'), false);
    await page.click('#te-save');
    await page.waitForFunction(() => document.getElementById('te-status').textContent.startsWith('Published '));
    assert.equal(retries, 1); assert.equal(await source(), savedSource);
    assert.equal(await page.$eval('#te-notice', element => element.hidden), true);
    if (invalidEdit) await page.click('#te-undo');
    await page.click('section > p', { count: 2 });
    assert.equal(await page.$eval('section > p', element => element.isContentEditable), true);
    checks.push(invalidEdit ? 'Unmappable pending edits do not block publication retry' : 'Publication retry can omit HTML when the browser already holds that rendering');
  });
  console.log(JSON.stringify({ checks: checks.length, passed: checks }));
} finally { await browser.close(); }
