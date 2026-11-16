// Exercise real builds and the local save API in a disposable project.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { build } from "../lib/index.js";
import { editing, drawing } from "../lib/plugins/index.js";
import { createEditorApi, nodeRequest, sendResponse, staticResponse } from "../lib/editor/server.js";

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, "output/browser");
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "xarp-editor-"));
const directory = temporary;
const original = `---
marp: true
---

<!-- slide: alpha -->

<!-- _class: fixture -->

# Alpha

<p id="editable" data-xarp-edit="text" style="position:absolute;left:80px;top:170px;width:500px;height:60px">Original <strong>bold</strong> text</p>

<svg width="500" height="140" style="position:absolute;left:80px;top:330px"><rect id="shape" x="20" y="10" width="150" height="60" fill="#ddd"></rect><text id="svg-label" x="30" y="50">Label</text></svg>

Formula $x^2$ stays.

<!-- preserve this note -->

---

<!-- slide: beta -->

<!-- _class: fixture -->

# Beta

<p id="second" data-xarp-edit="text">Second slide text</p>
`;
await writeFile(join(directory, "slides.md"), original);

await writeFile(join(directory, 'fixture.css'), `/* @theme xarp-test */
@import 'default';
section { position:relative; display:block; background:white; color:#111; font:28px sans-serif; padding:70px; box-sizing:border-box; }
h1 { font-size:44px; }
p:has(.katex) { position:absolute; left:80px; top:500px; }
`);
const config = { cwd: directory, input: 'slides.md', theme: 'fixture.css', plugins: [editing(), drawing()] };
let result = await build(config);
const viewId = result.metadata.viewId;
let rejectSave = false, saveCount = 0, statusDelay = 0, pendingPublication = false;
const api = await createEditorApi({ config, result: () => result, rebuild: async () => result = await build(config) });
const handler = async (request: Request) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/__xarp/')) {
    if (pendingPublication && url.pathname === '/__xarp/status') return Response.json({editorApi:true,mode:'hosted',publicationPending:true,viewId,sourceFile:'slides.md',sourceRevision:'pending-source',buildRevision:'pending-build'});
    if (pendingPublication && url.pathname === '/__xarp/retry') {
      await new Promise(resolve => setTimeout(resolve,600));
      return Response.json({editorApi:true,mode:'hosted',ok:false,published:false,error:'Fixture retry refused'},{status:503});
    }
    if (url.pathname === '/__xarp/status' && statusDelay) await new Promise(resolve => setTimeout(resolve,statusDelay));
    if (url.pathname === '/__xarp/save') {
      saveCount++;
      if (rejectSave) return Response.json({editorApi:true,mode:'local',ok:false,saved:false,error:'Fixture save refused',viewId,sourceFile:'slides.md',slideId:'alpha'},{status:409});
    }
    return await api(request) ?? new Response('Not found',{status:404});
  }
  return staticResponse(request,result.output);
};
const server = createServer(async (request,response) => {
  try { await sendResponse(await handler(await nodeRequest(request)),response); }
  catch (error) { response.writeHead(500); response.end(String(error)); }
});
await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
const address=server.address();
assert(address && typeof address !== 'string');
const port=address.port;
const browser = await puppeteer.launch({ executablePath: process.env.XARP_TEST_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: process.env.HEADLESS !== "0", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"], dumpio: process.env.CI === 'true' });
const page = await browser.newPage();
const errors: string[] = [], checks: string[] = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("dialog", dialog => void dialog.accept());
await page.setViewport({ width: 1280, height: 720 });
const text = (selector: string) => page.$eval(selector, element => element.textContent);
const disabled = (id: string) => page.$eval(id, element => (element as HTMLButtonElement).disabled);
const editText = async (selector: string, value: string) => {
  await page.locator(selector).click({ count: 2 });
  await page.waitForFunction(sel => document.querySelector(sel)?.getAttribute("contenteditable") === "true", {}, selector);
  await page.$eval(selector, element => { const selection = window.getSelection()!; const range = document.createRange(); range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range); });
  await page.keyboard.type(value);
  await page.keyboard.press("Escape");
};
const undo = async () => { await page.click("#te-undo"); };
const redo = async () => { await page.click("#te-redo"); };
const save = async () => {
  await page.click("#te-save");
  await page.waitForFunction(() => document.getElementById("te-status")?.textContent?.startsWith("Saved "), { timeout: 30000 });
};
try {
  await page.goto(`http://127.0.0.1:${port}/?edit=1`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.getElementById("te-save")?.textContent === "Save Slide");
  await page.waitForSelector("#te-undo");
  assert.equal(await disabled("#te-undo"), true);
  const mathSelector = '.bespoke-marp-active section p:has(.katex)';
  await page.waitForSelector(mathSelector);
  const mathHTML = await page.$eval(mathSelector, element => element.innerHTML);
  await page.click(mathSelector, { count: 2 });
  await page.keyboard.press("Escape");
  assert.equal(await page.$eval(mathSelector, element => element.innerHTML), mathHTML);
  assert.equal(await disabled("#te-undo"), true);
  assert.equal(await disabled("#te-save"), true);
  checks.push("Entering and leaving math text preserves KaTeX and creates no undo entry");
  const mathParagraph = '.bespoke-marp-active section > p:last-of-type';
  await page.click(mathParagraph, { count: 2 });
  await page.$eval(mathParagraph, element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.type(" Added text");
  await new Promise(resolve => setTimeout(resolve, 800));
  await page.keyboard.press("Escape");
  await undo();
  await page.keyboard.press("Escape");
  assert.equal(await page.$$eval(`${mathParagraph} .katex`, elements => elements.length), 1);
  await redo();
  await page.keyboard.press("Escape");
  assert.equal(await page.$$eval(`${mathParagraph} .katex`, elements => elements.length), 1);
  assert.equal(await page.$$eval(`${mathParagraph} .xarp-edit-math-token`, elements => elements.length), 0);
  await undo();
  await page.keyboard.press("Escape");
  assert.equal(await disabled("#te-save"), true);
  checks.push("Timed text snapshots retain rendered formulas through Undo and Redo");
  const initialHTML = await page.$eval("#editable", element => element.innerHTML);
  await editText("#editable", "Changed text");
  assert.equal(await text("#editable"), "Changed text");
  await undo();
  assert.equal(await page.$eval("#editable", element => element.innerHTML), initialHTML);
  assert.equal(await disabled("#te-save"), true);
  await redo();
  assert.equal(await text("#editable"), "Changed text");
  checks.push("Text edit undo restores rich markup and clean state; redo restores edit");

  await save();
  assert.match(await readFile(join(directory, "slides.md"), "utf8"), /Changed text/);
  const requestsAfterSave = saveCount;
  await page.click('#editable',{count:2});await page.keyboard.press('Escape');
  await page.click('#shape',{offset:{x:130,y:45}});
  await undo();
  assert.equal(await text("#editable"), "Original bold text");
  assert.equal(saveCount, requestsAfterSave, "Undo must not write source");
  assert.equal(await disabled("#te-save"), false);
  await save();
  assert.match(await readFile(join(directory, "slides.md"), "utf8"), /Original <strong>bold<\/strong> text/);
  assert.match(await readFile(join(directory, "slides.md"), "utf8"), /preserve this note/);
  await redo();
  assert.equal(await text("#editable"), "Changed text");
  await save();
  checks.push("Save preserves history; no-op edits add no step; undo and redo remain local until saved again");

  await editText("#editable", "Failed save draft");
  rejectSave = true;
  await page.click("#te-save");
  await page.waitForFunction(() => document.getElementById("te-status")?.textContent?.includes("Fixture save refused"));
  await undo();
  assert.equal(await text("#editable"), "Changed text");
  await redo();
  assert.equal(await text("#editable"), "Failed save draft");
  rejectSave = false;
  await undo();
  await editText("#editable", "New branch");
  assert.equal(await disabled("#te-redo"), true);
  checks.push("Failed saves preserve history; editing after Undo clears Redo");

  await page.evaluate(() => { location.hash = "2"; });
  await page.waitForSelector("svg.bespoke-marp-active #second");
  assert.equal(await disabled("#te-undo"), true);
  await editText("#second", "Second changed");
  await page.evaluate(() => { location.hash = "1"; });
  await page.waitForSelector("svg.bespoke-marp-active #editable");
  assert.equal(await text("#editable"), "New branch");
  await undo();
  assert.equal(await text("#editable"), "Changed text");
  assert.equal(await text("#second"), "Second changed");
  checks.push("Slide histories are independent and retained across navigation");

  await page.click("#shape", { offset: { x: 130, y: 45 } });
  const beforeX = await page.$eval("#shape", element => element.getAttribute("x"));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const afterX = await page.$eval("#shape", element => element.getAttribute("x"));
  assert.notEqual(afterX, beforeX);
  await undo();
  assert.equal(await page.$eval("#shape", element => element.getAttribute("x")), beforeX);
  await redo();
  assert.equal(await page.$eval("#shape", element => element.getAttribute("x")), afterX);
  await page.click("#shape", { offset: { x: 130, y: 45 } });
  await page.click("#te-reset");
  assert.equal(await page.$eval("#shape", element => element.getAttribute("x")), beforeX);
  await undo();
  assert.equal(await page.$eval("#shape", element => element.getAttribute("x")), afterX);
  await undo();
  checks.push("Grouped nudges and Reset Box are reversible");

  const dragPoint = await page.$eval("#shape", element => { const r=element.getBoundingClientRect(); return { x:r.right-10,y:r.bottom-10 }; });
  await page.mouse.move(dragPoint.x,dragPoint.y); await page.mouse.down();
  await page.mouse.move(dragPoint.x+45,dragPoint.y+20,{steps:8}); await page.mouse.up();
  const draggedX = await page.$eval("#shape", element => element.getAttribute("x"));
  assert.notEqual(draggedX,beforeX);
  await undo();
  assert.equal(await page.$eval("#shape", element => element.getAttribute("x")),beforeX);
  await redo();
  assert.equal(await page.$eval("#shape", element => element.getAttribute("x")),draggedX);
  await undo();
  await page.click("#shape", { offset: { x: 130, y: 45 } });
  await page.waitForSelector('.moveable-se', {visible:true});
  await page.waitForFunction(()=>{const handle=document.querySelector('.moveable-se')?.getBoundingClientRect(),shape=document.getElementById('shape')?.getBoundingClientRect();return handle&&shape&&Math.abs(handle.left+handle.width/2-shape.right)<4&&Math.abs(handle.top+handle.height/2-shape.bottom)<4;});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => { const handle=document.querySelector('.moveable-se'); if (!handle) return false; const r=handle.getBoundingClientRect(); return handle.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)); });
  const oldWidth=await page.$eval('#shape',el=>el.getAttribute('width'));
  const handle=await page.$eval('.moveable-se',el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
  await page.mouse.move(handle.x,handle.y);await page.mouse.down();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  // Give the control a rendered frame for each pointer sample, as a physical
  // drag does. Virtual macOS displays can coalesce an entire CDP burst.
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(handle.x + 40 * step / 8, handle.y + 25 * step / 8);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.mouse.up();
  await page.waitForFunction(width => document.getElementById('shape')?.getAttribute('width') !== width, {}, oldWidth);
  const resizedWidth=await page.$eval('#shape',el=>el.getAttribute('width'));
  assert.notEqual(resizedWidth,oldWidth);
  await undo();assert.equal(await page.$eval('#shape',el=>el.getAttribute('width')),oldWidth);
  await redo();assert.equal(await page.$eval('#shape',el=>el.getAttribute('width')),resizedWidth);
  await undo();
  checks.push('Pointer drag and resize each form one reversible gesture');

  await page.click('#svg-label',{count:2});
  await page.waitForSelector('.xarp-editor-svg-input');
  await page.keyboard.type('New label');await page.keyboard.press('Enter');
  assert.equal(await text('#svg-label'),'New label');
  await page.keyboard.down('Control');await page.keyboard.press('z');await page.keyboard.up('Control');
  assert.equal(await text('#svg-label'),'Label');
  await page.keyboard.down('Control');await page.keyboard.down('Shift');await page.keyboard.press('z');await page.keyboard.up('Shift');await page.keyboard.up('Control');
  assert.equal(await text('#svg-label'),'New label');
  await undo();
  checks.push('SVG text uses the same history and keyboard shortcuts');

  await page.click("#te-source");
  await page.waitForFunction(() => !(document.getElementById("te-textarea") as HTMLTextAreaElement)?.readOnly && !!(document.getElementById("te-textarea") as HTMLTextAreaElement)?.value);
  const markdown = await page.$eval("#te-textarea", element => (element as HTMLTextAreaElement).value);
  await page.focus("#te-textarea");
  await page.$eval("#te-textarea", element => (element as HTMLTextAreaElement).select());
  await page.keyboard.type(markdown.replace("Changed text", "Markdown changed"));
  await page.click("#te-undo");
  assert.equal(await page.$eval("#te-textarea", element => (element as HTMLTextAreaElement).value), markdown);
  assert.equal(await page.$eval("#te-textarea", element => (element as HTMLTextAreaElement).readOnly), false);
  await page.click("#te-redo");
  assert.match(await page.$eval("#te-textarea", element => (element as HTMLTextAreaElement).value), /Markdown changed/);
  checks.push("Markdown typing has Undo and Redo");
  await undo();
  await page.focus("#te-textarea");
  await page.$eval("#te-textarea", element => (element as HTMLTextAreaElement).select());
  await page.keyboard.type(markdown.replace("Changed text", "Markdown branch"));
  assert.equal(await disabled("#te-redo"), true);
  await undo();
  assert.equal(await page.$eval("#te-textarea", element => (element as HTMLTextAreaElement).value), markdown);
  await redo();
  assert.match(await page.$eval("#te-textarea", element => (element as HTMLTextAreaElement).value), /Markdown branch/);
  checks.push("Toolbar Undo keeps Markdown editable and a new edit replaces Redo");

  await page.screenshot({ path: join(output, "editor-1280.png") });
  await page.setViewport({ width: 800, height: 720 });
  await page.screenshot({ path: join(output, "editor-800.png") });
  for (const id of ["te-undo", "te-redo", "te-save", "te-done"]) {
    assert.equal(await page.$eval(`#${id}`, element => { const rect = element.getBoundingClientRect(); const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2); return rect.left >= 0 && rect.right <= innerWidth && !!hit && (hit === element || element.contains(hit)); }), true, `${id} must be accessible at 800px`);
  }
  assert.equal(await page.$(".xarp-drawing-toggle"), null, "Draw button stays hidden while presenting or editing");
  assert.equal(await page.$(".xarp-editor-pill"), null, "Edit button stays hidden while presenting or editing");
  await page.setViewport({width:1280,height:720});
  await page.click('#te-source');
  await page.click('#te-done');
  assert.equal(await page.evaluate(() => document.body.classList.contains("xarp-edit-active")), false);
  assert.equal(await page.$eval("#xarp-drawing-toolbar", element => (element as HTMLElement).hidden), true);
  await page.keyboard.press("d");
  assert.equal(await page.evaluate(() => document.body.classList.contains("xarp-drawing-active")), true);
  assert.equal(await page.$eval("#xarp-drawing-toolbar", element => (element as HTMLElement).hidden), false);
  await page.keyboard.press("e");
  assert.equal(await page.evaluate(() => document.body.classList.contains("xarp-drawing-active")), false);
  assert.equal(await page.evaluate(() => document.body.classList.contains("xarp-edit-active")), true);
  checks.push("Presentation hides Draw and Edit buttons while D and E shortcuts toggle modes");
  await save();
  await editText('#editable','Reconnect draft');
  rejectSave=true;
  await page.click('#te-save');
  await page.waitForFunction(()=>document.getElementById('te-status')?.textContent?.includes('Fixture save refused'));
  rejectSave=false;statusDelay=600;
  const probing=page.waitForRequest(request=>request.url().includes('/__xarp/status'));
  await page.click('#te-save');await probing;
  assert.equal(await disabled('#te-save'),true);
  assert.equal(await disabled('#te-undo'),true);
  await page.click('#editable',{count:2});
  assert.equal(await page.$eval('#editable',el=>el.getAttribute('contenteditable')),null);
  await page.waitForFunction(()=>document.getElementById('te-status')?.textContent?.startsWith('Saved '));
  statusDelay=0;
  assert.match(await readFile(join(directory,'slides.md'),'utf8'),/Reconnect draft/);
  checks.push('Editing and Undo stay locked while a save reconnects');

  const external=(await readFile(join(directory,'slides.md'),'utf8')).replace('# Beta','# Beta external');
  await writeFile(join(directory,'slides.md'),external);
  await editText('#editable','Local draft after external change');
  await page.click('#te-save');
  await page.waitForFunction(()=>document.getElementById('te-status')?.classList.contains('is-error'));
  assert.equal(await readFile(join(directory,'slides.md'),'utf8'),external);
  assert.equal(await text('#editable'),'Local draft after external change');
  await undo();assert.equal(await text('#editable'),'Reconnect draft');
  await redo();assert.equal(await text('#editable'),'Local draft after external change');
  checks.push('External source changes remain protected and rejected local drafts retain Undo/Redo');
  pendingPublication=true;
  const retryRequest=page.waitForRequest(request=>request.url().includes('/__xarp/retry'));
  await page.click('#te-save');await retryRequest;
  assert.equal(await disabled('#te-save'),true);
  assert.equal(await disabled('#te-undo'),true);
  await page.click('#editable',{count:2});
  assert.equal(await page.$eval('#editable',el=>el.getAttribute('contenteditable')),null);
  await page.waitForFunction(()=>document.getElementById('te-status')?.textContent?.includes('Fixture retry refused'));
  assert.equal(await disabled('#te-save'),false);
  assert.equal(await readFile(join(directory,'slides.md'),'utf8'),external);
  checks.push('A publication retry discovered during Save keeps editing locked until the retry finishes');
  assert.deepEqual(errors, []);
  await writeFile(join(output, "browser-receipt.json"), JSON.stringify({ checks, pageErrors: errors }, null, 2) + "\n");
  console.log(JSON.stringify({ checks: checks.length, passed: checks, pageErrors: errors }));
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  console.error(JSON.stringify({ status: await text("#te-status").catch(() => null), pageErrors: errors, state:await page.evaluate(()=>({active:document.activeElement?.outerHTML?.slice(0,300),editables:[...document.querySelectorAll('[contenteditable]')].map(el=>el.outerHTML.slice(0,200)),coords:document.getElementById('te-coords')?.textContent})).catch(()=>null) }));
  throw error;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(temporary, { recursive: true, force: true });
}
