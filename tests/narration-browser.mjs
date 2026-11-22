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
window.__lastStageSeg = -1;
mountCraftStage(document.getElementById('stage'), {
  width: 960,
  height: 360,
  segments: [
    { from: 0, to: 1.0, speed: 1 },
    { from: 1.0, to: 2.0, speed: 1 },
  ],
  draw({ t, segment, marks, labels }) {
    window.__lastStageT = t;
    window.__lastStageSeg = segment;
    const x = 120 + (t / 2.0) * 680;
    marks.dot(x, 180, 16, { role: 'primary' });
    labels.place('readout', \`Stage seg=\${segment} t = \${t.toFixed(2)}s\`, 480, 70, 1, { size: 22, align: 'center', role: 'ink' });
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
  seg: 0
  duration: 1.2
- Segment one stretches smoothly across a two second fitted beat and zooms in.
  step: 0
  seg: 1
  fit: true
  zoom: 1.4 @ 76, 52
  spotlight: 48, 18, 48, 66
  duration: 2.0
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
    plugins: [editing(), drawing(), colorSchemes(), narration()],
    narration: narrationCfg,
  };

  const synth = await narrate(deckOptions);
  assert.equal(synth.synthesized, 7);
  staticDir = synth.buildResult.output;

  // Verify HTTP Range support (standard + suffix + invalid) on staticResponse
  const clipUrlRel = synth.buildResult.narration.slides[0].beats[0].clipUrl;
  const suffixRes = await fetch(`${staticBase}/${clipUrlRel}`, { headers: { Range: 'bytes=-128' } });
  assert.equal(suffixRes.status, 206);
  assert.equal((await suffixRes.arrayBuffer()).byteLength, 128);
  const badRangeRes = await fetch(`${staticBase}/${clipUrlRel}`, { headers: { Range: 'bytes=-' } });
  assert.equal(badRangeRes.status, 416);

  const page = await browser.newPage();
  const pageErrors = [];
  const externalRequests = [];
  const internalRequests = [];
  page.on('pageerror', err => pageErrors.push(String(err)));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (!u.startsWith(staticBase) && !u.startsWith('data:')) {
      externalRequests.push(u);
      void req.abort();
    } else {
      if (u.startsWith(staticBase)) internalRequests.push(u.slice(staticBase.length));
      void req.continue();
    }
  });

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(staticBase, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);

  // 1. Default slide load stays lightweight: no Watch button, no narration.js/narration.css/timeline/audio loaded!
  assert.equal(await page.$('.xarp-watch-launcher'), null, 'Default slide view must not render a Watch button');
  assert.equal(await page.evaluate(() => typeof window.__xarpNarration), 'undefined');
  for (const reqPath of internalRequests) {
    assert(!/\/narration\.js$|\/narration\.css$|\/timeline-|\/clips\/|\.vtt$/.test(reqPath), `Unexpected eager Watch asset request on slide load: ${reqPath}`);
  }
  await page.keyboard.press('w');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(await page.evaluate(() => document.body.classList.contains('xarp-watch-active')), false);

  // Loading Watch Mode on demand (`?watch=1` or `__xarpLoadWatch`) loads bundle without reloading iframes
  await page.goto(`${staticBase}/?watch=1`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('body.xarp-watch-active');
  assert.equal(await page.$('.xarp-watch-launcher'), null, 'Launcher remains absent unless explicitly opted in');
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
  // Seeking updates ?t= in URL so dev reloads keep timestamp
  assert.match(await page.evaluate(() => location.search), /t=/);

  // 3. Continuous stage __videoCtl seeking + explicit `seg: 1` + `fit: true` on Slide 3
  const s3 = tl.slides[2];
  await page.evaluate(t => window.__xarpNarration.seek(t + 0.45), s3.beats[0].start);
  const stage0 = await page.evaluate(() => {
    const w = document.querySelector('svg.bespoke-marp-active iframe').contentWindow;
    return { t: w.__lastStageT, seg: w.__lastStageSeg };
  });
  assert.equal(stage0.seg, 0);
  assert(stage0.t > 0.4 && stage0.t < 0.55, `Expected interpolated stage t ~ 0.45, got ${stage0.t}`);

  // Beat 1 has duration: 2.0, seg: 1 ([1.0..2.0]), fit: true, zoom: 1.4 @ 76, 52, spotlight -> at +1.0s (halfway), stage t ~ 1.50, seg === 1, zoom === 1.4!
  await page.evaluate(t => window.__xarpNarration.seek(t + 1.0), s3.beats[1].start);
  const stage1 = await page.evaluate(() => {
    const w = document.querySelector('svg.bespoke-marp-active iframe').contentWindow;
    const st = window.__xarpNarration.getState();
    const spotOp = parseFloat(document.querySelector('.xarp-watch-spotlight').style.opacity || '0');
    return { t: w.__lastStageT, seg: w.__lastStageSeg, zoom: st.zoom, spotOp };
  });
  assert.equal(stage1.seg, 1);
  assert(stage1.t > 1.45 && stage1.t < 1.55, `Expected fitted stage t ~ 1.50, got ${stage1.t}`);
  assert.equal(stage1.zoom, 1.4);
  assert(stage1.spotOp > 0.9, `Expected spotlight active, got opacity ${stage1.spotOp}`);
  await page.screenshot({ path: join(outputShots, 'watch-desktop-zoom-spotlight.png') });

  // Interactive viewer zoom (+ and 0)
  await page.keyboard.press('=');
  assert(await page.evaluate(() => window.__xarpNarration.getState().userZoom) > 1.2);
  await page.keyboard.press('0');
  assert.equal(await page.evaluate(() => window.__xarpNarration.getState().userZoom), 1);

  // 4. Real audio playback advances clock monotonically without backward jumps, and live color-scheme switch themes shell & slide
  await page.evaluate(() => window.__xarpNarration.seek(0));
  await page.click('.xarp-watch-controls .xarp-watch-btn.is-primary');
  await page.waitForFunction(() => window.__xarpNarration.getState().playing && window.__xarpNarration.getState().currentTime > 0.25, { timeout: 5000 });

  await page.select('select[aria-label="Color scheme"]', 'ukiyo-e');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const shellBg = await page.$eval('.xarp-watch-shell', el => getComputedStyle(el).backgroundColor);
  assert.equal(shellBg, 'rgb(38, 70, 83)');
  await page.evaluate(() => window.__xarpNarration.pause());
  await page.screenshot({ path: join(outputShots, 'watch-desktop-ukiyo-e.png') });

  // 5. Drawing (`D`) pauses playback and draws over the Watch stage
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

  // 6. Narrow mobile portrait layout keeps stage above scrollable transcript, AND Theater toggle hides sidebar on mobile too!
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(outputShots, 'watch-mobile.png') });
  await page.click('.xarp-watch-sidebar-toggle');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.equal(await page.$eval('.xarp-watch-sidebar', el => getComputedStyle(el).display), 'none');
  await page.click('.xarp-watch-sidebar-toggle');

  // 7. Direct URL ?watch=1&t=... entry and clean exit query cleanup
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${staticBase}/?watch=1&t=${s2.beats[1].start.toFixed(2)}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('body.xarp-watch-active');
  const bootState = await page.evaluate(() => window.__xarpNarration.getState());
  assert.equal(bootState.slideId, 'proof');
  assert.equal(bootState.beatIndex, 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => location.search), '?f=1');

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  await page.close();

  // 8. Live Slide Markdown save in Edit Mode updates Watch Mode timeline in place without reloading, plus `/__xarp/narrate` synthesis
  preview = await dev({ ...deckOptions, port: 0, watch: false });
  ttsRequests.length = 0;

  const devPage = await browser.newPage();
  await devPage.setViewport({ width: 1280, height: 800 });
  await devPage.goto(preview.url, { waitUntil: 'networkidle0' });
  await devPage.evaluate(() => { window.__noReloadSentinel = 'intact'; });

  // Open Edit Mode (`E`), open Slide Markdown drawer, edit Slide 1's beat, and Save Source
  await devPage.keyboard.press('e');
  await devPage.waitForSelector('body.xarp-edit-active');
  await devPage.click('#te-source');
  await devPage.waitForFunction(() => document.getElementById('te-textarea').value.includes('Welcome to Watch Mode'));
  await devPage.evaluate(() => {
    const ta = document.getElementById('te-textarea');
    ta.value = '# Updated Intro\n\n<!-- beat: Brand new sentence saved live from Slide Markdown. -->\n';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await devPage.click('#te-save-src');
  await devPage.waitForFunction(() => document.getElementById('te-status')?.classList.contains('is-saved'));
  await devPage.click('#te-done');

  // Load Watch Mode on demand -> timeline already reflects saved beat without reload!
  await devPage.evaluate(() => window.__xarpLoadWatch());
  await devPage.waitForSelector('body.xarp-watch-active');
  assert.equal(await devPage.evaluate(() => window.__noReloadSentinel), 'intact');
  assert.equal(
    await devPage.evaluate(() => window.__xarpNarration.getTimeline().slides[0].beats[0].caption),
    'Brand new sentence saved live from Slide Markdown.',
  );

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
  assert.match(ttsRequests[0], /Brand new sentence saved live from Slide Markdown/);
  await devPage.close();

  console.log('PASS narration-browser: Watch Mode layout, fragment sync, stage seg+fit, audio clock, live style switch, drawing, mobile theater, live editor sync, and dev synthesis');
} finally {
  await preview?.close();
  await browser.close();
  await new Promise(resolve => staticServer.close(resolve));
  await new Promise(resolve => ttsServer.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
