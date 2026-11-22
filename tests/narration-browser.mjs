import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { dev, narrate } from '../lib/index.js';
import { colorSchemes, drawing, editing, narration } from '../lib/plugins/index.js';
import { nodeRequest, sendResponse, staticResponse } from '../lib/editor/server.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'xarp-watch-browser-'));
const outputShots = join(root, 'output/browser');
await mkdir(outputShots, { recursive: true });

function makeToneWav(sec, freq = 330, sampleRate = 24000) {
  const samples = Math.round(sec * sampleRate);
  const dataBytes = samples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples; i++) {
    const env = Math.min(1, i / 400, (samples - i) / 400);
    const val = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.25 * env;
    buf.writeInt16LE(Math.round(val * 32767), 44 + i * 2);
  }
  return buf;
}

const ttsRequests = [];
const ttsServer = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  ttsRequests.push(body.text);
  const wav = makeToneWav(0.65, 260 + (ttsRequests.length % 5) * 40);
  res.writeHead(200, { 'Content-Type': 'audio/wav' });
  res.end(wav);
});
await new Promise(resolve => ttsServer.listen(0, '127.0.0.1', resolve));
const ttsUrl = `http://127.0.0.1:${ttsServer.address().port}/tts`;

let staticDir = '';
const staticServer = createServer(async (incoming, outgoing) => {
  try { await sendResponse(await staticResponse(await nodeRequest(incoming), staticDir), outgoing); }
  catch (err) { outgoing.writeHead(500); outgoing.end(String(err)); }
});
await new Promise(resolve => staticServer.listen(0, '127.0.0.1', resolve));
const staticBase = `http://127.0.0.1:${staticServer.address().port}`;

const browser = await puppeteer.launch({
  executablePath: process.env.XARP_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

let preview;
try {
  const cwd = join(temporary, 'deck');
  await mkdir(join(cwd, 'assets'), { recursive: true });

  // Create an animated stage iframe using chao-ui's stage.js
  await writeFile(join(cwd, 'assets/stage.html'), `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}#stage{width:960px;height:360px}</style></head>
<body><div id="stage"></div>
<script type="module">
import { mountCraftStage } from '../_xarp/theme/stage.js';
window.__lastStageT = -1;
mountCraftStage(document.getElementById('stage'), {
  width: 960,
  height: 360,
  segments: [
    { from: 0, to: 1.0, speed: 1 },
    { from: 1.0, to: 2.0, speed: 1 },
  ],
  draw({ t, marks, labels }) {
    window.__lastStageT = t;
    const x = 120 + (t / 2.0) * 680;
    marks.dot(x, 180, 16, { role: 'primary' });
    labels.place('readout', \`Stage t = \${t.toFixed(2)}s\`, 480, 70, 1, { size: 22, align: 'center', role: 'ink' });
  }
});
</script></body></html>`);

  await writeFile(join(cwd, 'slides.md'), `---
title: Piece-by-Piece Web Cinema
colorScheme: sumi-e
---

<!-- slide: intro -->
# Live HTML Video

Crisp vector text, KaTeX $\\int_0^1 x^2\\,dx = \\frac{1}{3}$, and synced per-beat audio.

<!-- narration:
- Welcome to Watch Mode: every slide stays live HTML and crisp SVG.
- Edit a single sentence and only that beat's audio clip regenerates.
-->

---

<!-- slide: proof -->
# Stepwise Fragment Sync

For $a, b \\geq 0$:

* $(a - b)^2 \\geq 0$
* $(a + b)^2 \\geq 4ab$

<!-- narration:
- Start from two nonnegative real numbers a and b.
- Any real square is nonnegative.
- Adding four a b bounds the squared sum from below.
-->

---

<!-- slide: motion -->
# Continuous Stage Seek

<iframe src="assets/stage.html" style="width:960px;height:360px;border:0"></iframe>

<!-- narration:
- Segment zero moves the point across the first half of the stage.
  duration: 1.2
- Segment one completes the trajectory smoothly at sixty frames per second.
  duration: 1.2
-->
`);

  const narrationCfg = {
    glossary: { KaTeX: 'Kay-tech' },
    tts: { provider: 'http', url: ttsUrl },
  };
  const deckOptions = {
    cwd,
    input: 'slides.md',
    output: 'dist',
    sections: [
      { label: 'Concept', count: 1 },
      { label: 'Sync', count: 2 },
    ],
    plugins: [editing(), drawing(), colorSchemes(), narration(narrationCfg)],
  };

  const synth = await narrate(deckOptions);
  assert.equal(synth.synthesized, 7);
  staticDir = synth.buildResult.output;

  const page = await browser.newPage();
  const pageErrors = [];
  const externalRequests = [];
  page.on('pageerror', err => pageErrors.push(String(err)));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (!u.startsWith(staticBase) && !u.startsWith('blob:') && !u.startsWith('data:')) {
      externalRequests.push(u);
      void req.abort();
    } else {
      void req.continue();
    }
  });

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(staticBase, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);

  // 1. Launcher visible in Deck Mode; pressing W opens Watch Mode without reloading iframes
  await page.waitForSelector('.xarp-watch-launcher');
  await page.evaluate(() => {
    const frame = document.querySelector('iframe');
    frame.__keepIdentity = 'alive';
  });
  await page.keyboard.press('w');
  await page.waitForSelector('body.xarp-watch-active');
  assert.equal(await page.evaluate(() => document.querySelector('iframe').__keepIdentity), 'alive');
  assert.match(await page.evaluate(() => location.search), /watch=1/);

  await page.screenshot({ path: join(outputShots, 'watch-desktop-split.png') });

  // 2. Clicking transcript lines seeks Marp slides and fragments deterministically
  const tl = await page.evaluate(() => window.__xarpNarration.getTimeline());
  assert.equal(tl.slides.length, 3);
  assert.equal(tl.hasAudio, true);

  // Seek to Slide 2, Beat 0 (0 active fragments), then Beat 1 (1 active fragment), then Beat 2 (2 active fragments)
  const s2 = tl.slides[1];
  await page.evaluate(t => window.__xarpNarration.seek(t + 0.05), s2.beats[0].start);
  assert.equal(await page.$$eval('svg.bespoke-marp-active [data-bespoke-marp-fragment="active"]', els => els.length), 0);

  await page.evaluate(t => window.__xarpNarration.seek(t + 0.05), s2.beats[1].start);
  assert.equal(await page.$$eval('svg.bespoke-marp-active [data-bespoke-marp-fragment="active"]', els => els.length), 1);

  await page.evaluate(t => window.__xarpNarration.seek(t + 0.05), s2.beats[2].start);
  assert.equal(await page.$$eval('svg.bespoke-marp-active [data-bespoke-marp-fragment="active"]', els => els.length), 2);
  assert.match(await page.$eval('.xarp-watch-caption-bar', el => el.textContent), /Adding four a b/);

  // 3. Continuous stage __videoCtl seeking on Slide 3
  const s3 = tl.slides[2];
  await page.evaluate(t => window.__xarpNarration.seek(t + 0.45), s3.beats[0].start);
  const stageT0 = await page.evaluate(() => document.querySelector('svg.bespoke-marp-active iframe').contentWindow.__lastStageT);
  assert(stageT0 > 0.4 && stageT0 < 0.55, `Expected interpolated stage t ~ 0.45, got ${stageT0}`);

  await page.evaluate(t => window.__xarpNarration.seek(t + 0.55), s3.beats[1].start);
  const stageT1 = await page.evaluate(() => document.querySelector('svg.bespoke-marp-active iframe').contentWindow.__lastStageT);
  assert(stageT1 > 1.5 && stageT1 < 1.65, `Expected interpolated stage t ~ 1.55, got ${stageT1}`);

  // 4. Real audio playback advances clock, and live color-scheme switch themes both shell & slide
  await page.evaluate(() => window.__xarpNarration.seek(0));
  await page.click('.xarp-watch-controls .xarp-watch-btn.is-primary');
  await page.waitForFunction(() => window.__xarpNarration.getState().playing && window.__xarpNarration.getState().currentTime > 0.25, { timeout: 5000 });

  await page.select('select[aria-label="Color scheme"]', 'ukiyo-e');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const shellBg = await page.$eval('.xarp-watch-shell', el => getComputedStyle(el).backgroundColor);
  assert.equal(shellBg, 'rgb(38, 70, 83)');
  await page.evaluate(() => window.__xarpNarration.pause());
  await page.screenshot({ path: join(outputShots, 'watch-desktop-ukiyo-e.png') });

  // 5. Drawing (`D`) pauses playback and draws over the 16:9 Watch stage
  await page.evaluate(() => window.__xarpNarration.play());
  await page.keyboard.press('d');
  await page.waitForSelector('body.xarp-drawing-active');
  assert.equal(await page.evaluate(() => window.__xarpNarration.getState().playing), false);
  const box = await page.$eval('.xarp-watch-stage-slot', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.5 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 40, { steps: 6 });
  await page.mouse.up();
  await page.waitForSelector('.xarp-drawing-ink > path');
  await page.keyboard.press('d');

  // 6. Narrow mobile portrait layout keeps 16:9 stage above scrollable transcript
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(outputShots, 'watch-mobile.png') });

  // 7. Direct URL ?watch=1&t=... entry
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${staticBase}/?watch=1&t=${s2.beats[1].start.toFixed(2)}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('body.xarp-watch-active');
  const bootState = await page.evaluate(() => window.__xarpNarration.getState());
  assert.equal(bootState.slideId, 'proof');
  assert.equal(bootState.beatIndex, 1);

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  await page.close();

  // 8. Live synthesis endpoint `/__xarp/narrate` inside `xarp dev`
  preview = await dev({ ...deckOptions, port: 0, watch: false });
  ttsRequests.length = 0;
  await writeFile(join(cwd, 'slides.md'), `---
title: Piece-by-Piece Web Cinema
---

<!-- slide: intro -->
# Updated Intro

<!-- beat: Brand new sentence synthesized from the browser dev button. -->

---

<!-- slide: proof -->
# Stepwise Fragment Sync

* $(a - b)^2 \\geq 0$
* $(a + b)^2 \\geq 4ab$

<!-- narration:
- Start from two nonnegative real numbers a and b.
- Any real square is nonnegative.
- Adding four a b bounds the squared sum from below.
-->

---

<!-- slide: motion -->
# Continuous Stage Seek

<iframe src="assets/stage.html" style="width:960px;height:360px;border:0"></iframe>

<!-- narration:
- Segment zero moves the point across the first half of the stage.
  duration: 1.2
- Segment one completes the trajectory smoothly at sixty frames per second.
  duration: 1.2
-->
`);

  const devPage = await browser.newPage();
  await devPage.setViewport({ width: 1280, height: 800 });
  await devPage.goto(`${preview.url}?watch=1`, { waitUntil: 'networkidle0' });
  await devPage.waitForSelector('body.xarp-watch-active');
  // Click "Synthesize slide" in Watch header -> synthesizes ONLY intro's 1 changed beat!
  await devPage.waitForFunction(() => {
    const btns = [...document.querySelectorAll('.xarp-watch-header .xarp-watch-btn')];
    return btns.some(b => b.textContent === 'Synthesize slide' && !b.hidden);
  });
  await devPage.evaluate(() => {
    const btn = [...document.querySelectorAll('.xarp-watch-header .xarp-watch-btn')].find(b => b.textContent === 'Synthesize slide');
    btn.click();
  });
  await devPage.waitForFunction(() => document.querySelector('.xarp-watch-status')?.textContent?.includes('Synthesized 1 clip'));
  assert.equal(ttsRequests.length, 1);
  assert.match(ttsRequests[0], /Brand new sentence/);
  await devPage.close();

  console.log('PASS narration-browser: Watch Mode layout, fragment sync, continuous stage seek, audio clock, live style switch, drawing, mobile layout, and dev synthesis');
} finally {
  await preview?.close();
  await browser.close();
  await new Promise(resolve => staticServer.close(resolve));
  await new Promise(resolve => ttsServer.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
