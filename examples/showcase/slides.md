---
marp: true
theme: xarp-showcase
class: pf-slide
lang: en
title: Xarp, a hands-on demo
description: Try Markdown slides, visual editing, drawing, and browser plugins.
---

<!-- slide: welcome -->
<!-- _class: pf-slide cover -->

# Xarp

<p class="intro">Markdown slides with visual editing and drawing.</p>

<p class="hint"><kbd>←</kbd> <kbd>→</kbd> to explore. <kbd>E</kbd> to edit. <kbd>D</kbd> to draw.<br>The section bar jumps between topics.</p>

<!-- This is a self-guided product demo, so short operating hints are part of the content. Every example is synthetic. In a live walkthrough, begin with the arrow keys and point to the section navigation. Source saving requires the local dev preview. Static copies offer visual changes and Copy Edits. -->

---

<!-- slide: markdown -->

# Start with Markdown

<div class="split">
<div>
<p class="label">Source</p>
<pre><code># A useful idea&#10;&#10;Keep the source readable.&#10;&#10;- A question&#10;- An example&#10;- A conclusion</code></pre>
</div>
<div class="rendered">
<h2>A useful idea</h2>
<p>Keep the source readable.</p>
<ul><li>A question</li><li>An example</li><li>A conclusion</li></ul>
</div>
</div>

<p class="hint">Headings, lists, emphasis, links, and tables use Marp Markdown.</p>

<!-- The left column is a source specimen, and the right is its corresponding HTML content. The rest of this deck is authored in Marp Markdown with HTML where a layout or an editable object benefits from it. -->

---

<!-- slide: mathematics -->

# Mathematics with KaTeX

<div class="math-layout">
<div>

$$
\begin{aligned}
\max_{x,y\geq 0}\quad & x+y\\
\text{subject to}\quad & 2x+y\leq 6,\\
& x+2y\leq 6.
\end{aligned}
$$

</div>
<svg class="figure" viewBox="0 0 520 380" role="img" aria-label="Feasible polygon with vertices at (0,0), (3,0), (2,2), and (0,3). The maximum of x plus y occurs at (2,2).">
<path d="M70 315H455M70 315V35" fill="none" stroke="currentColor" stroke-width="2"/>
<path d="M70 315L325 315L240 145L70 60Z" fill="#f1f5f9" stroke="#62748e" stroke-width="2"/>
<path d="M155 60L325 230" fill="none" stroke="#008138" stroke-width="3"/>
<circle cx="240" cy="145" r="8" fill="#008138"/>
<g font-size="24"><text x="450" y="347">x</text><text x="36" y="42">y</text><text x="48" y="346">0</text><text x="315" y="346">3</text><text x="38" y="68">3</text><text x="258" y="136">(2, 2)</text></g>
</svg>
</div>

<p class="hint">Aligned equations and vector figures stay crisp when enlarged.</p>

<!-- The shaded feasible region is exact. Adding the constraints gives 3x + 3y <= 12, hence x + y <= 4. The point (2,2) is feasible and attains 4. The displayed alignment is retained to make the objective and constraints legible. The figure is authored SVG, not a measurement or benchmark. -->

---

<!-- slide: languages -->

# Type across languages

<div class="language-row"><span class="label">English</span><p class="sample">Write what you mean.</p></div>
<div class="language-row"><span class="label pf-zh-sc" lang="zh-CN">简体中文</span><p class="sample pf-zh-sc" lang="zh-CN">把想法画出来。</p></div>
<div class="language-row"><span class="label pf-zh-tc" lang="zh-TW">繁體中文</span><p class="sample pf-zh-tc" lang="zh-TW">把想法畫出來。</p></div>

<p class="hint">The bundled theme carries fonts for Latin text, Simplified Chinese, and Traditional Chinese.</p>

<!-- The Chinese passages carry exact regional language tags. Both use the corresponding IBM Plex Sans regional family. These are typography specimens rather than exact translations of the English sentence. No external font service is required for this deck. -->

---

<!-- slide: code -->

# Build from JavaScript

```js
import { build } from '@chaoxu/xarp';
import { editing, drawing } from '@chaoxu/xarp/plugins';

await build({
  input: 'slides.md',
  plugins: [editing(), drawing()],
});
```

<p class="hint">The CLI uses the same library. Code blocks keep syntax highlighting and monospace alignment.</p>

<!-- This is executable API usage in a project with Xarp installed. Library paths resolve from cwd, which defaults to the current working directory. The code sample supplies its input explicitly. A config file is optional. -->

---

<!-- slide: background -->
<!-- _class: pf-slide background -->

<!-- _backgroundImage: url("assets/network.svg") -->
<!-- _backgroundPosition: right center -->
<!-- _backgroundSize: 45% 100% -->

# Use an image background

<p id="demo-background-text" data-xarp-edit="text">The background is an SVG asset. The words remain editable slide content.</p>

<p class="hint">Press <kbd>E</kbd>, then double-click the sentence above.</p>

<!-- The Marp background directive keeps the graph behind a full-width content layer, so the section bar and editing surface remain usable. The graph is an original illustration of a route, with no performance or data claim. -->

---

<!-- slide: edit -->
<!-- _class: pf-slide chapter -->

# Edit

Change the words and the layout.

<!-- The following slides are exercises. In a local preview, Save Slide writes supported changes to the configured Markdown source. On a static copy, visual edits remain in the tab and Copy Edits can preserve the edit payload. -->

---

<!-- slide: edit-text -->

# Change this sentence

<p class="editable-line" id="demo-edit-text" data-xarp-edit="text">Replace this sentence with your idea.</p>

<p class="exercise">Press <kbd>E</kbd>, then double-click the sentence. Try Undo and Redo.</p>

<p class="hint">In local preview, save an edit and try Undo again. Save again to write the undone state.</p>

<!-- Use the raw HTML sentence as the primary editing target. Undo and Redo change the current slide's browser state. Saving does not erase its history, and undoing a saved edit does not write the source until another save. Static copies have no source-writing service. -->

---

<!-- slide: layout -->

# Move the pieces

<div class="stage">
<div class="piece piece-a" id="demo-piece-a" data-xarp-edit="box"><h2>A heading</h2><p>Put the subject where it belongs.</p></div>
<div class="piece piece-b" id="demo-piece-b" data-xarp-edit="box"><h2>A supporting detail</h2><p>Keep the detail readable.</p></div>
<div class="piece piece-c" id="demo-piece-c" data-xarp-edit="box"><h2>A figure</h2><svg viewBox="0 0 230 90" role="img" aria-label="Three connected vertices"><path d="M20 70L115 20L210 70" fill="none" stroke="currentColor" stroke-width="3"/><g fill="currentColor"><circle cx="20" cy="70" r="7"/><circle cx="115" cy="20" r="7"/><circle cx="210" cy="70" r="7"/></g></svg></div>
</div>

<p class="hint"><kbd>E</kbd>, then drag a box to move it or a handle to resize it. Arrow keys nudge it. Try Reset Box or Undo.</p>

<!-- These are raw HTML boxes, which Xarp can map back to the source. Clicking a box's background selects it. Double-clicking text edits the text instead. Shift plus an arrow makes a larger nudge. Reset Box clears supported position and size overrides, and Undo restores the prior state. -->

---

<!-- slide: svg -->

# Edit the diagram's labels

<svg class="diagram figure" viewBox="0 0 980 310" role="img" aria-label="A diagram connecting a question to an example and then a result">
<path d="M150 155H475M505 155H830" fill="none" stroke="#cad5e2" stroke-width="4"/>
<g fill="white" stroke="#0f172b" stroke-width="3"><circle cx="150" cy="155" r="58"/><circle cx="490" cy="155" r="58"/><circle cx="830" cy="155" r="58"/></g>
<g font-size="26" text-anchor="middle"><text id="demo-svg-label" x="150" y="163">Question</text><text x="490" y="163">Example</text><text x="830" y="163">Result</text></g>
</svg>

<p class="hint"><kbd>E</kbd>, then double-click “Question”. Rename it and press Enter. Undo restores the label.</p>

<!-- The labels are native SVG text elements, and Xarp uses its SVG text input when they are edited. Shape and label movement are also supported. Edges in this authored diagram are static and do not reroute automatically. -->

---

<!-- slide: source -->

# Edit the Markdown too

| Material | Source | Rendering |
| --- | --- | --- |
| A claim | Markdown | Text |
| An equation | LaTeX | KaTeX |
| A diagram | SVG | Vectors |

<p class="hint">Local preview: <kbd>E</kbd> → Slide Markdown. Change a table cell, then Save Source.</p>

<!-- Markdown table cells deliberately use Slide Markdown. Visual editing of their text cannot be mapped safely in this release. Local preview serves the source for the current slide. A static export does not supply source loading or source saving. The browser keeps pending changes on other slides when this one is saved. -->

---

<!-- slide: draw -->
<!-- _class: pf-slide chapter -->

# Draw

Put the explanation on the slide.

<!-- Drawing is an optional plugin, separate from editing. Pressing D opens the drawing toolbar and switches out of Edit Mode. Ink is stored per slide in the current browser page session. -->

---

<!-- slide: draw-route -->

# Sketch a route from A to F

<svg class="route figure" viewBox="0 0 1040 340" role="img" aria-label="Graph with vertices A through F and several possible routes from A to F">
<g fill="none" stroke="#cad5e2" stroke-width="4"><path d="M90 170L340 60L690 60L950 170M90 170L340 280L690 280L950 170M340 60L340 280M690 60L690 280M340 60L690 280M340 280L690 60"/></g>
<g fill="white" stroke="#0f172b" stroke-width="3"><circle cx="90" cy="170" r="32"/><circle cx="340" cy="60" r="32"/><circle cx="690" cy="60" r="32"/><circle cx="340" cy="280" r="32"/><circle cx="690" cy="280" r="32"/><circle cx="950" cy="170" r="32"/></g>
<g font-size="28" text-anchor="middle"><text x="90" y="179">A</text><text x="340" y="69">B</text><text x="690" y="69">C</text><text x="340" y="289">D</text><text x="690" y="289">E</text><text x="950" y="179">F</text></g>
</svg>

<p class="hint"><kbd>D</kbd> opens the pen. Try a color, Undo, Redo, and Clear slide.</p>

<!-- This is an unweighted graph, and any drawn route through its edges from A to F satisfies the exercise. Pointer input accepts a mouse, pen, or touch, though physical tablet behavior requires device testing. Clear slide affects only this slide's ink and can be undone. -->

---

<!-- slide: whiteboard -->
<!-- _class: pf-slide whiteboard -->

# Room for a sketch

<p class="hint">Draw here, then revisit the previous slide. Ink stays with its slide until you reload.</p>

<!-- The blank space is intentional. It is an ordinary slide with the drawing plugin, not a separate whiteboard feature. Ink persists across navigation within this page, and reloading clears it. -->

---

<!-- slide: present -->
<!-- _class: pf-slide chapter -->

# Present

Control the pace and keep notes nearby.

<!-- Xarp retains Marp's navigation, fragment, fullscreen, and presenter-view behavior. The bottom section bar comes from Xarp's sections configuration. -->

---

<!-- slide: fragments -->
<!-- _class: pf-slide proof -->

# Reveal a proof

For $a,b\geq 0$:

* $(a-b)^2\geq 0$
* $(a+b)^2\geq 4ab$
* $\dfrac{a+b}{2}\geq\sqrt{ab}$

<p class="hint">Advance with <kbd>→</kbd>. Marp reveals each step.</p>

<!-- The asterisk bullets are Marp fragments. Each step is valid for the stated nonnegative variables. Expanding the first line and adding 4ab proves the second. Taking square roots and dividing by 2 gives the third. Navigate backward to reverse the reveals. -->

---

<!-- slide: presenter -->

# Present with notes

<div class="keyboard-pair">
<div><kbd>P</kbd><h2>Presenter view</h2><p>Current slide, next slide, and speaker notes.</p></div>
<div><kbd>F</kbd><h2>Fullscreen</h2><p>Use the whole screen.</p></div>
</div>

<p class="hint">The section bar stays available for jumps. <kbd>E</kbd> and <kbd>D</kbd> reopen the editing and drawing tools.</p>

<!-- PRESENTER NOTE: You found the notes. They are authored as Markdown comments and stay out of the audience slide. Close this presenter window when finished. A browser may require permission for the popup or fullscreen request. The source comments also preserve the demo's technical qualifications without crowding the slide. -->

---

<!-- slide: portable -->

# Take the whole folder

<div class="split">
<pre class="file-tree"><code>dist/
  index.html
  assets/
  _xarp/
    theme/
    plugins/</code></pre>
<div><p class="bundle-copy">The HTML, fonts, scripts, and figures travel together.</p><p>Serve the folder to share this deck.</p></div>
</div>

<p class="hint">Shared HTML supports visual edits and Copy Edits. Run the local preview to save Markdown.</p>

<!-- This deck uses only bundled runtime assets, local figures, and a local plugin. Its source links are external and require a network connection when followed. Sharing the entire built directory preserves font, image, and plugin paths. This is portable HTML, not a single self-contained HTML file. Drawing lasts for the page session in both delivery modes. -->

---

<!-- slide: extend -->
<!-- _class: pf-slide chapter -->

# Extend

Add browser behavior with a plugin.

<!-- The following curve is a small example plugin authored for this demo. It is not a built-in Xarp plotting feature. The package handles plugin scripts and data, while ordinary browser code implements the interaction. -->

---

<!-- slide: curve -->

# Change the curve

<div class="curve-demo" data-curve-demo>
<svg class="figure" viewBox="0 0 620 350" role="img" aria-label="Graph of y equals a times x squared for x from minus 2 to 2. The coefficient is controlled by the adjacent slider.">
<g fill="none" stroke="#e2e8f0" stroke-width="1"><path d="M110 40H570M110 105H570M110 170H570M110 235H570M110 40V300M225 40V300M455 40V300M570 40V300"/></g>
<path d="M85 300H590M340 315V20" fill="none" stroke="#62748e" stroke-width="2"/>
<path data-curve-path d="M110 170Q340 430 570 170" fill="none" stroke="#2563eb" stroke-width="4"/>
<g font-size="21" text-anchor="middle"><text x="110" y="332">−2</text><text x="225" y="332">−1</text><text x="340" y="332">0</text><text x="455" y="332">1</text><text x="570" y="332">2</text></g>
<g font-size="21"><text x="78" y="47">4</text><text x="78" y="112">3</text><text x="78" y="177">2</text><text x="78" y="242">1</text><text x="595" y="307">x</text><text x="351" y="26">y</text></g>
</svg>
<div class="curve-controls">

$y=ax^2$

<label for="curve-coefficient">Coefficient <var>a</var></label><output for="curve-coefficient" aria-live="polite">0.50</output><input id="curve-coefficient" data-curve-input type="range" min="0.25" max="1" step="0.25" value="0.5"/></div>
</div>

<p class="hint">Move the slider. This example plugin calculates the curve in your browser.</p>

<!-- The custom plugin reads its initial coefficient from Xarp's plugin data and listens for native input events. It has no animation loop, timer, or remote service. The SVG contains the a = 0.5 curve as a static fallback. The slider also accepts keyboard arrows. This interactive state is a demo control, separate from Markdown edits and ink history. -->

---

<!-- slide: plugin-source -->

# Plugins are files and data

```js
export function curveDemo() {
  return {
    name: 'curve-demo',
    scripts: [new URL('./curve-demo.js', import.meta.url)],
    data: { coefficient: 0.5 },
  };
}
```

<p class="hint">Add <code>curveDemo()</code> to <code>plugins</code>. Xarp copies the script into the output.</p>

<!-- This is the actual plugins/curve.mjs implementation. Plugins can also supply local CSS files through styles. Assets are deduplicated by their file URL, and plugin data appears under the plugin name in the xarp-meta JSON. The demo theme imports chao-ui and adds only project layout rules. -->

---

<!-- slide: start -->

# Make a deck of your own

Use this demo's source, or start from the basic example.

<pre class="start-command"><code>npm ci
npm run dev</code></pre>

<div class="links"><a href="https://github.com/chaoxu/xarp/tree/main/examples/showcase">Demo source and setup</a><a href="https://github.com/chaoxu/xarp/tree/main/examples/basic">Basic example</a></div>

<p class="hint"><code>npm run dev:quick</code> opens the short tour, selected from this same Markdown file.</p>

<!-- Run these commands from examples/showcase after obtaining the source, with Node.js 24 or 26 installed. npm run build generates the full deck and the short tour. xarp.quick.config.mjs selects explicit slide IDs, so its content is not a second authored copy. The basic example is suitable for starting an independent deck. -->
