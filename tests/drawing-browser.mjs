import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const root=fileURLToPath(new URL('../', import.meta.url));
const chrome=process.env.XARP_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const fixture = `<!doctype html><html><head><style>
    body { margin: 0; }
    svg[data-marpit-svg] { display: none; width: 100%; max-width: 1280px; height: auto; aspect-ratio: 16 / 9; }
    svg.bespoke-marp-active { display: block; }
    section { position: relative; width: 1280px; height: 720px; background: white; }
    nav { position: absolute; bottom: 0; width: 100%; height: 40px; }
  </style></head><body>${[1, 2].map((number, index) => `
    <svg data-marpit-svg class="${index === 0 ? 'bespoke-marp-active' : ''}" viewBox="0 0 1280 720">
      <foreignObject width="1280" height="720"><section xmlns="http://www.w3.org/1999/xhtml">
        <p>Slide ${number}</p><nav data-xarp-navigation><a href="#${number === 1 ? 2 : 1}">Other slide</a></nav>
      </section></foreignObject>
    </svg>`).join('')}</body></html>`;
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(fixture);
    } else if (['/lib/browser/history.js', '/lib/browser/drawing.js'].includes(pathname)) {
      try {
        const content = await readFile(path.join(root, pathname));
        response.writeHead(200, { 'Content-Type': 'text/javascript' });
        response.end(content);
      } catch (error) {
        response.writeHead(500);
        response.end(String(error));
      }
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--disable-gpu', '--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(base);
    await page.addStyleTag({ path: path.join(root, 'lib/browser/drawing.css') });
    await page.addScriptTag({ path: path.join(root, 'lib/browser/history.js') });
    await page.evaluate(() => {
      window.addEventListener('hashchange', () => {
        document.querySelectorAll('svg[data-marpit-svg]').forEach((slide, index) => {
          slide.classList.toggle('bespoke-marp-active', index === Number(location.hash.slice(1)) - 1);
        });
      });
    });
    await page.addScriptTag({ url: `${base}/lib/browser/drawing.js` });
    const count = async expected => {
      await page.waitForFunction(value => document.querySelectorAll('.xarp-drawing-ink > path').length === value, {}, expected);
    };
    const click = async label => {
      const handle = await page.evaluateHandle(text => [...document.querySelectorAll('#xarp-drawing-toolbar button')].find(button => button.textContent === text), label);
      await handle.asElement().click();
      await handle.dispose();
    };
    const enabled = label => page.evaluate(text => ![...document.querySelectorAll('#xarp-drawing-toolbar button')].find(button => button.textContent === text).disabled, label);
    const ink = () => page.$eval('.xarp-drawing-ink', element => element.innerHTML);
    const key = async (mod, shift, letter) => {
      await page.keyboard.down(mod);
      if (shift) await page.keyboard.down('Shift');
      await page.keyboard.press(letter);
      if (shift) await page.keyboard.up('Shift');
      await page.keyboard.up(mod);
    };
    const stroke = async (y = 180) => {
      await page.mouse.move(200, y);
      await page.mouse.down();
      await page.mouse.move(350, y + 30, { steps: 8 });
      await page.mouse.up();
    };

    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const cdp = await page.createCDPSession();
    await cdp.send('Performance.enable');
    const taskDuration = async () => (await cdp.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'TaskDuration').value;
    const before = await taskDuration();
    const idle = await page.evaluate(async () => {
      let layoutReads = 0, paints = 0;
      const getRect = Element.prototype.getBoundingClientRect;
      const observer = new MutationObserver(records => { paints += records.length; });
      observer.observe(document.querySelector('.xarp-drawing-ink'), { subtree: true, childList: true, attributes: true });
      Element.prototype.getBoundingClientRect = function (...args) {
        if (this.matches('section,.xarp-drawing-layer')) layoutReads++;
        return getRect.apply(this, args);
      };
      const animated = document.querySelector('section p');
      const interval = setInterval(() => animated.classList.toggle('animated-frame'), 16);
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));
      } finally {
        clearInterval(interval);
        Element.prototype.getBoundingClientRect = getRect;
        observer.disconnect();
      }
      return { layoutReads, paints };
    });
    console.log(`Idle drawing profile (3s, unrelated class animation): ${JSON.stringify({ ...idle, taskSeconds: await taskDuration() - before })}`);
    assert.equal(idle.layoutReads, 0, 'unrelated slide animation must not trigger idle drawing layout');
    assert.equal(idle.paints, 0, 'unrelated slide animation must not repaint idle drawing');
    await cdp.detach();

    await page.keyboard.press('d');
    await page.mouse.move(200, 160);
    await page.mouse.down();
    await page.mouse.move(350, 190, { steps: 8 });
    await page.mouse.up();
    await count(1);
    await stroke(240);
    await count(2);
    await key('Control', false, 'z');
    await count(1);
    await key('Control', true, 'z');
    await count(2);
    await key('Meta', false, 'z');
    await count(1);
    await key('Meta', true, 'z');
    await count(2);
    await click('Clear slide');
    await count(0);
    await click('Undo');
    await count(2);
    await click('Redo');
    await count(0);
    await click('Undo');
    await count(2);
    await click('Undo');
    await count(1);
    await key('Control', false, 'y');
    await count(2);

    await click('Undo');
    await page.click('[aria-label="Blue pen"]');
    await click('Done');
    await page.keyboard.press('d');
    assert.equal(await enabled('Redo'), true, 'color and mode changes must preserve redo');
    await stroke(300);
    await count(2);
    assert.equal(await enabled('Redo'), false, 'new stroke must discard the redo branch');
    assert.equal(await page.$eval('.xarp-drawing-ink > path:last-child', element => element.getAttribute('stroke')), '#2468c9');

    await page.click('.bespoke-marp-active nav a');
    await count(0);
    await stroke(220);
    await count(1);
    await click('Undo');
    await count(0);
    await page.click('.bespoke-marp-active nav a');
    await count(2);
    await page.setViewport({ width: 1440, height: 900 });
    await count(2);
    await click('Undo');
    await count(1);
    await page.click('.bespoke-marp-active nav a');
    await count(0);
    await click('Redo');
    await count(1);

    const originalInk = await ink();
    const originalBox = await page.$eval('.xarp-drawing-ink > path', element => ({ width: element.getBoundingClientRect().width }));
    await page.setViewport({ width: 640, height: 450 });
    await page.waitForFunction(() => document.querySelector('.xarp-drawing-layer').getBoundingClientRect().width === 640);
    assert.equal(await ink(), originalInk, 'resizing must preserve the SVG coordinates');
    const scaledBox = await page.$eval('.xarp-drawing-ink > path', element => ({ width: element.getBoundingClientRect().width }));
    assert.ok(Math.abs(scaledBox.width * 2 - originalBox.width) < 1, 'ink must scale with the slide');
    await stroke(180);
    const endpoint = await page.$eval('.xarp-drawing-ink > path:last-child', element => {
      const point = element.getPointAtLength(element.getTotalLength()).matrixTransform(element.getScreenCTM());
      return { x: point.x, y: point.y };
    });
    assert.ok(Math.abs(endpoint.x - 350) < 1 && Math.abs(endpoint.y - 210) < 1, 'drawing must track the pointer on a scaled slide');
    await click('Undo');
    assert.equal(await ink(), originalInk, 'undo after resize must preserve earlier ink');
    await page.setViewport({ width: 1440, height: 900 });
    await page.waitForFunction(() => document.querySelector('.xarp-drawing-layer').getBoundingClientRect().width === 1280);

    await click('Clear slide');
    await page.mouse.move(200, 160);
    await page.mouse.down();
    const burst = await page.evaluate(() => {
      const surface = document.querySelector('.xarp-drawing-surface');
      const start = performance.now();
      for (let index = 0; index < 256; index++) {
        surface.dispatchEvent(new PointerEvent('pointermove', {
          pointerId: 1, pointerType: 'mouse', bubbles: true,
          clientX: 250 + index, clientY: 200 + index / 4, pressure: 0.5,
        }));
      }
      surface.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 1, pointerType: 'mouse', bubbles: true, clientX: 700, clientY: 350, pressure: 0.5,
      }));
      surface.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', bubbles: true }));
      const path = document.querySelector('.xarp-drawing-ink > path');
      const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM());
      return { milliseconds: performance.now() - start, right: end.x, bottom: end.y };
    });
    await page.mouse.up();
    console.log(`Drauu stroke (257 move events): ${JSON.stringify(burst)}`);
    assert.ok(Math.abs(burst.right - 700) < 8, 'final horizontal position must survive a completed stroke');
    assert.ok(Math.abs(burst.bottom - 350) < 8, 'final vertical position must survive a completed stroke');
    await count(1);
    const completedBurst = await ink();
    await click('Undo');
    await count(0);
    await click('Redo');
    await count(1);
    assert.equal(await ink(), completedBurst, 'redo must restore the complete stroke');

    await click('Clear slide');
    await page.mouse.move(200, 160); await page.mouse.down();
    await page.evaluate(() => {
      const event = new PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 700, clientY: 160 });
      Object.defineProperty(event, 'getCoalescedEvents', { value: () => [
        new PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 350, clientY: 400 }),
        new PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 400 }),
      ] });
      window.dispatchEvent(event);
    });
    await page.mouse.up();
    assert.ok(await page.$eval('.xarp-drawing-ink > path', path => path.getBoundingClientRect().height > 150), 'coalesced samples must preserve the curve between dispatched events');

    // Interrupt a held pointer without leaving Drauu in a drawing state.
    for (const interrupt of ['escape', 'blur', 'capture', 'cancel', 'overview', 'navigation']) {
      console.log(`Checking drawing interruption: ${interrupt}`);
      await click('Clear slide');
      await page.mouse.move(200, 180); await page.mouse.down(); await page.mouse.move(350, 210, { steps: 8 });
      if (interrupt === 'escape') await page.keyboard.press('Escape');
      if (interrupt === 'cancel') await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' })));
      if (interrupt === 'overview') {
        await page.evaluate(() => { document.body.dataset.bespokeView = 'overview'; });
        await page.waitForFunction(() => document.querySelector('.xarp-drawing-layer').hasAttribute('hidden'));
        await page.evaluate(() => { document.body.dataset.bespokeView = ''; });
        await page.waitForFunction(() => !document.querySelector('.xarp-drawing-layer').hasAttribute('hidden'));
      }
      if (interrupt === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      if (interrupt === 'capture') {
        await page.evaluate(() => document.querySelector('.xarp-drawing-surface').releasePointerCapture(1));
        await page.mouse.move(355, 215);
      }
      if (interrupt === 'navigation') {
        await page.evaluate(() => { location.hash = '#1'; });
        await page.waitForFunction(() => document.querySelector('svg[data-marpit-svg]').classList.contains('bespoke-marp-active'));
        await count(1);
      }
      await page.waitForFunction(() => !document.querySelector('.xarp-drawing-surface').hasPointerCapture(1));
      assert.equal(await page.$eval('.xarp-drawing-surface', surface => surface.hasPointerCapture(1)), false, `${interrupt} must release capture before normal pointerup`);
      const interruptedInk = await ink();
      await page.mouse.move(380, 240);
      assert.equal(await ink(), interruptedInk, `${interrupt} must finish drawing before normal pointerup`);
      await page.mouse.up();
      if (interrupt === 'escape') await page.keyboard.press('d');
      if (interrupt === 'navigation') {
        await page.click('.bespoke-marp-active nav a');
        await page.waitForFunction(() => location.hash === '#2');
      }
      await count(1);
      await click('Undo');
      await count(0);
      await stroke();
      await count(1);
    }

    const beforeIgnoredInput = await ink();
    await page.mouse.click(200, 180, { button: 'right' });
    assert.equal(await ink(), beforeIgnoredInput, 'secondary buttons must not draw');
    await click('Done');
    await stroke();
    assert.equal(await ink(), beforeIgnoredInput, 'presentation mode must not draw');
    await page.keyboard.press('d');
    await page.evaluate(() => { document.body.dataset.bespokeView = 'presenter'; });
    await page.waitForFunction(() => document.querySelector('.xarp-drawing-layer').hidden || document.querySelector('.xarp-drawing-layer').hasAttribute('hidden'));
    await stroke();
    assert.equal(await ink(), beforeIgnoredInput, 'presenter mode must not draw');
    await page.evaluate(() => { document.body.dataset.bespokeView = ''; });
    await page.waitForFunction(() => !document.querySelector('.xarp-drawing-layer').hasAttribute('hidden'));
    await stroke();
    await count(2);

    await page.goto(base);
    await page.addStyleTag({ path: path.join(root, 'lib/browser/drawing.css') });
    assert.equal(await page.evaluate(() => typeof window.XarpHistory), 'undefined');
    await page.addScriptTag({ url: `${base}/lib/browser/history.js` });
    await page.addScriptTag({ url: `${base}/lib/browser/drawing.js` });
    await page.waitForFunction(() => !!document.querySelector('#xarp-drawing-toolbar') && typeof window.XarpHistory?.create === 'function');
    assert.equal(await page.evaluate(() => typeof window.XarpHistory?.create), 'function', 'ordered scripts must initialize history');
    await page.keyboard.press('d');
    await stroke();
    await count(1);
    await click('Undo');
    await count(0);
    await click('Redo');
    await count(1);
    assert.deepEqual(errors, []);
    console.log('PASS drawing: Drauu strokes, shortcuts, undoable clear, branching, slide isolation, scaling, interrupted gestures, input isolation and ordered initialization');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
