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
    svg[data-marpit-svg] { display: none; width: 1280px; height: 720px; }
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
      window.__drawingHistories = [];
      const create = window.XarpHistory.create;
      window.XarpHistory = {
        ...window.XarpHistory,
        create(...args) {
          const history = create(...args);
          window.__drawingHistories.push(history);
          return history;
        },
      };
      window.addEventListener('hashchange', () => {
        document.querySelectorAll('svg[data-marpit-svg]').forEach((slide, index) => {
          slide.classList.toggle('bespoke-marp-active', index === Number(location.hash.slice(1)) - 1);
        });
      });
    });
    await page.addScriptTag({ url: `${base}/lib/browser/drawing.js` });
    const count = async expected => {
      await page.waitForFunction(value => document.querySelectorAll('.xarp-drawing-layer g > path').length === value, {}, expected);
    };
    const click = async label => {
      const handle = await page.evaluateHandle(text => [...document.querySelectorAll('#xarp-drawing-toolbar button')].find(button => button.textContent === text), label);
      await handle.asElement().click();
      await handle.dispose();
    };
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
      const replaceChildren = Element.prototype.replaceChildren;
      Element.prototype.getBoundingClientRect = function (...args) {
        if (this.matches('section,.xarp-drawing-layer')) layoutReads++;
        return getRect.apply(this, args);
      };
      Element.prototype.replaceChildren = function (...args) {
        if (this.matches('.xarp-drawing-layer > g')) paints++;
        return replaceChildren.apply(this, args);
      };
      const animated = document.querySelector('section p');
      const interval = setInterval(() => animated.classList.toggle('animated-frame'), 16);
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));
      } finally {
        clearInterval(interval);
        Element.prototype.getBoundingClientRect = getRect;
        Element.prototype.replaceChildren = replaceChildren;
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
    assert.equal(await page.evaluate(() => window.__drawingHistories[0].getState().length), 0, 'unfinished stroke must stay outside history');
    await page.mouse.up();
    await count(1);
    assert.equal(await page.evaluate(() => window.__drawingHistories[0].getState().length), 1);
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
    assert.equal(await page.evaluate(() => window.__drawingHistories[0].canRedo()), true, 'color and mode changes must preserve redo');
    await stroke(300);
    await count(2);
    assert.equal(await page.evaluate(() => window.__drawingHistories[0].canRedo()), false, 'new stroke must discard the redo branch');
    assert.equal(await page.$eval('.xarp-drawing-layer g > path:last-child', element => element.getAttribute('stroke')), '#2468c9');

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

    await click('Clear slide');
    await page.mouse.move(200, 160);
    await page.mouse.down();
    const burst = await page.evaluate(async () => {
      const surface = document.querySelector('.xarp-drawing-surface');
      const history = window.__drawingHistories[1];
      const bounds = document.querySelector('.xarp-drawing-layer').getBoundingClientRect();
      const expectedEndpoint = { x: (700 - bounds.left) / bounds.width, y: (350 - bounds.top) / bounds.height };
      let rectReads = 0, pathWrites = 0, formattedCoordinates = 0;
      const getRect = Element.prototype.getBoundingClientRect;
      const setAttribute = Element.prototype.setAttribute;
      const toFixed = Number.prototype.toFixed;
      Element.prototype.getBoundingClientRect = function (...args) {
        if (this.matches('.xarp-drawing-layer')) rectReads++;
        return getRect.apply(this, args);
      };
      Element.prototype.setAttribute = function (name, value) {
        if (this.matches('.xarp-drawing-layer g > path') && name === 'd') pathWrites++;
        return setAttribute.call(this, name, value);
      };
      Number.prototype.toFixed = function (...args) { formattedCoordinates++; return toFixed.apply(this, args); };
      const move = samples => {
        const event = new PointerEvent('pointermove', { pointerId: 1, bubbles: true });
        Object.defineProperty(event, 'getCoalescedEvents', { value: () => samples });
        surface.dispatchEvent(event);
      };
      try {
        const samples = Array.from({ length: 256 }, (_, index) => ({ clientX: 250 + index, clientY: 200 + index / 4 }));
        move(samples);
        const beforeFrame = { rectReads, pathWrites, committedStrokes: history.getState().length };
        await new Promise(requestAnimationFrame);
        const afterFrame = { rectReads, pathWrites, formattedCoordinates };
        move([{ clientX: 700, clientY: 350 }]);
        // Ending the stroke before the next frame must retain its final point.
        surface.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
        const committed = history.getState().at(-1);
        const finalPath = document.querySelector('.xarp-drawing-layer g > path:last-child').getAttribute('d');
        return { beforeFrame, afterFrame, finalFormatted: formattedCoordinates, points: committed.points.length, endpoint: committed.points.at(-1), expectedEndpoint, finalPath };
      } finally {
        Element.prototype.getBoundingClientRect = getRect;
        Element.prototype.setAttribute = setAttribute;
        Number.prototype.toFixed = toFixed;
      }
    });
    await page.mouse.up();
    assert.deepEqual(burst.beforeFrame, { rectReads: 1, pathWrites: 0, committedStrokes: 0 });
    assert.deepEqual(burst.afterFrame, { rectReads: 1, pathWrites: 1, formattedCoordinates: 512 });
    assert.equal(burst.finalFormatted, 514, 'only newly arrived points are formatted');
    assert.equal(burst.points, 258);
    assert.deepEqual(burst.endpoint, burst.expectedEndpoint);
    assert.ok(burst.finalPath.endsWith(`${(burst.expectedEndpoint.x * 1280).toFixed(2)} ${(burst.expectedEndpoint.y * 720).toFixed(2)}`));
    await count(1);
    await click('Undo');
    await count(0);
    await click('Redo');
    await count(1);

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
    console.log('PASS drawing history: stroke grouping, shortcuts, clear, branching, slide isolation, navigation, resize and ordered initialization');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
