import { test, expect } from "vitest";
import { updateSlideInSource } from "../lib/source.js";
import { createEngine } from "../lib/engine.js";

const source = `---\nmarp: true\n---\n\n<!-- slide: alpha -->\n\n# Alpha\n\n---\n\n<!-- slide: beta -->\n\n# Beta\n`;

test("display equations retain their source delimiters and remain distinct from adjacent blocks", () => {
  const markdown = ['First', '$$a^2$$', '$$  b^2  $$', '$$', 'c^2', '$$', 'Last', '', '```', '$$c^2$$', '```'].join('\r\n');
  const edits = ['a', 'b', 'c'].map(name => ({
    tag: 'p', beforeMd: `$$\n${name}^2\n$$`, afterMd: `$$\n${name}^3\n$$`, afterText: `${name} cubed`,
  }));
  const { updatedSource } = updateSlideInSource(markdown, 'slide-1', { edits });
  expect(updatedSource).toBe(markdown.replace('a^2', 'a^3').replace('b^2', 'b^3').replace('c^2', 'c^3'));
});

test("moving a heading keeps following Markdown blocks rendered", () => {
  for (const following of ['- item 1\n- item 2', 'A paragraph with **bold** text.', '```js\nconst x = 1;\n```']) {
    const markdown = `# Heading\n${following}`;
    const updated = updateSlideInSource(markdown, 'slide-1', { edits: [{ tag: 'h1', beforeText: 'Heading', afterText: 'Heading', style: 'transform:translate(1px,0)' }] }).slideBody;
    const expected = createEngine().render(following).html;
    const actual = createEngine().render(updated).html;
    const block = following.startsWith('-') ? '<ul>' : following.startsWith('```') ? '<pre>' : '<p>';
    expect(actual.slice(actual.indexOf(block))).toBe(expected.slice(expected.indexOf(block)));
  }
});

test('heading layout edits preserve CRLF line endings', () => {
  const markdown = '# Heading\r\n- item\r\n';
  const updated = updateSlideInSource(markdown, 'slide-1', { edits: [{ tag: 'h1', beforeText: 'Heading', afterText: 'Heading', style: 'width:300px' }] }).updatedSource;
  expect(updated).toContain('</h1>\r\n\r\n- item');
  expect(updated).not.toMatch(/(?<!\r)\n/);
});

test("list edits preserve tight, loose, nested and duplicate siblings", () => {
  for (const [markdown, occurrence, expected] of [
    ['- first\n- target\n- last', 1, '- first\n- changed\n- last'],
    ['- first\n\n- target\n\n- last', 1, '- first\n\n- changed\n\n- last'],
    ['- parent\n  - target\n  - target\n- last', 2, '- parent\n  - target\n  - changed\n- last'],
    ['1. target\n2. target', 1, '1. target\n2. changed'],
  ] as const) {
    const updated = updateSlideInSource(markdown, 'slide-1', { edits: [{ tag: 'li', tagOccurrence: occurrence, beforeText: 'target', beforeMd: 'target', afterText: 'changed', afterMd: 'changed' }] });
    expect(updated.slideBody).toBe(expected);
  }
});

test("in-place slide edits update text, box styles, and SVG coordinates while preserving comments and math", () => {
  const deck = `---\nmarp: true\n---\n\n<!-- slide: alpha -->\n\n<!-- _class: pf-slide -->\n\n# Alpha\n\n---\n\n<!-- slide: beta -->\n\n<!-- _class: pf-slide example -->\n\n## A useful example heading\n\n<div class="example-panel">\n<p>Original text &amp; details</p>\n<p>Compare "the quantities" under $c / p$</p>\n</div>\n\n<svg viewBox="0 0 800 200">\n  <rect x="20" y="30" width="200" height="80" fill="#fafafa"/>\n  <text x="120" y="75" text-anchor="middle">Source diagram</text>\n</svg>\n\n<!--\nSpeaker note mentioning A useful example heading.\n-->\n`;
  const { updatedSource, slideBody } = updateSlideInSource(deck, "beta", {
    edits: [
      {
        tag: "h2",
        beforeText: "A useful example heading",
        beforeMd: "A useful example heading",
        afterText: "A revised example heading",
        afterMd: "A revised example heading",
        style: "transform: translate(12px, 4px);",
      },
      {
        tag: "div",
        tagOccurrence: 0,
        beforeText: "Original text & details",
        afterText: "Original text & details",
        style: "width: 520px; height: 140px; transform: translate(20px, 10px);",
      },
      {
        beforeText: "Original text & details",
        beforeMd: "Original text & details",
        afterText: "Revised text & details",
        afterMd: "Revised text & details",
      },
      {
        beforeText: 'Compare "the quantities" under $c / p$',
        beforeMd: 'Compare "the quantities" under $c / p$',
        afterText: 'Compare "the quantities" under expected $c / p$',
        afterMd: 'Compare "the quantities" under expected $c / p$',
      },
      {
        tag: "rect",
        tagOccurrence: 0,
        afterText: "",
        svgAttrs: { x: "35", y: "40", width: "240", height: "96" },
      },
      {
        tag: "text",
        tagOccurrence: 0,
        beforeText: "Source diagram",
        afterText: "Source diagram v2",
        svgAttrs: { x: "155", y: "88" },
      },
    ],
  });
  expect(slideBody).toContain('<h2 style="transform: translate(12px, 4px);">A revised example heading</h2>');
  expect(slideBody).toContain('<div class="example-panel" style="width: 520px; height: 140px; transform: translate(20px, 10px);">');
  expect(slideBody).toContain("<p>Revised text &amp; details</p>");
  expect(slideBody).toContain('<p>Compare "the quantities" under expected $c / p$</p>');
  expect(slideBody).toContain('<rect x="35" y="40" width="240" height="96" fill="#fafafa"/>');
  expect(slideBody).toContain('<text x="155" y="88" text-anchor="middle">Source diagram v2</text>');
  expect(slideBody).toContain("Speaker note mentioning A useful example heading.");
  expect(updatedSource).toContain("<!-- slide: alpha -->\n\n<!-- _class: pf-slide -->\n\n# Alpha");
});

test("in-place edits target the chosen element and leave attributes, code, and other headings unchanged", () => {
  const deck = source.replace("# Alpha", '<p>First</p>\n<p title="Target">Target</p>\n\n## First\n\n## Target\n\n```html\n<p>Target</p>\n```');
  const result = updateSlideInSource(deck, "alpha", { edits: [
    { tag: "p", tagOccurrence: 1, beforeText: "Target", afterText: "Changed", style: "width: 200px" },
    { tag: "h2", tagOccurrence: 1, beforeText: "Target", afterText: "Target", style: "width: 300px" },
  ] }).slideBody;
  expect(result).toContain('<p>First</p>\n<p title="Target" style="width: 200px">Changed</p>');
  expect(result).toContain('## First\n\n<h2 style="width: 300px">Target</h2>');
  expect(result).toContain('```html\n<p>Target</p>\n```');
  expect(() => updateSlideInSource(deck, "alpha", { edits: [{ tag: "p", beforeText: "Missing", afterText: "Changed", style: "width:200px" }] })).toThrow("Could not identify");
  expect(() => updateSlideInSource(deck, "alpha", { edits: [{ beforeText: "Target", afterText: "Changed", occurrence: 100 }] })).toThrow("occurrence no longer exists");
});

test("text edits use complete element identity rather than an earlier matching substring", () => {
  const deck = source.replace("# Alpha", '<p>Target is here</p>\n<p>Target</p>');
  const result = updateSlideInSource(deck, "alpha", { edits: [{ tag: "p", tagOccurrence: 1, occurrence: 0, beforeText: "Target", beforeMd: "Target", afterText: "Changed", afterMd: "Changed" }] }).slideBody;
  expect(result).toContain('<p>Target is here</p>\n<p>Changed</p>');
});

test("moving Markdown headings retains emphasis and rejects math conversion", () => {
  const styled = source.replace("# Alpha", "## **Claim**");
  expect(updateSlideInSource(styled, "alpha", { edits: [{ tag: "h2", beforeMd: "**Claim**", beforeText: "Claim", afterText: "Claim", style: "width: 300px" }] }).slideBody)
    .toContain('<h2 style="width: 300px"><strong>Claim</strong></h2>');
  const math = source.replace("# Alpha", "## Claim $x$");
  expect(() => updateSlideInSource(math, "alpha", { edits: [{ tag: "h2", beforeMd: "Claim $x$", beforeText: "Claim x", afterText: "Claim x", style: "width: 300px" }] })).toThrow("preserve their math rendering");
  const paragraph = source.replace("# Alpha", "A Markdown paragraph");
  expect(() => updateSlideInSource(paragraph, "alpha", { edits: [{ tag: "p", beforeText: "A Markdown paragraph", afterText: "A Markdown paragraph", style: "width:300px" }] })).toThrow("cannot be mapped");
  const attributes = source.replace("# Alpha", '<p data-style="original">Alpha</p>');
  expect(updateSlideInSource(attributes, "alpha", { edits: [{ tag: "p", beforeText: "Alpha", afterText: "Alpha", style: "width:300px" }] }).slideBody)
    .toContain('<p data-style="original" style="width:300px">Alpha</p>');
});

test("literal text typed into HTML and SVG text stays escaped in source", () => {
  const deck = source.replace("# Alpha", '<p>Target</p>\n<svg><text x="10" y="20">Label</text></svg>');
  const result = updateSlideInSource(deck, "alpha", { edits: [
    { tag: "p", beforeText: "Target", beforeMd: "Target", beforeHtml: "Target", afterText: "<em>literal</em>", afterMd: "<em>literal</em>", afterHtml: "&lt;em&gt;literal&lt;/em&gt;" },
    { tag: "text", beforeText: "Label", beforeMd: "Label", beforeHtml: "Label", afterText: "<svg>literal</svg>", afterMd: "<svg>literal</svg>", afterHtml: "<svg>literal</svg>" },
  ] }).slideBody;
  expect(result).toContain('<p>&lt;em&gt;literal&lt;/em&gt;</p>');
  expect(result).toContain('<text x="10" y="20">&lt;svg&gt;literal&lt;/svg&gt;</text>');
});
