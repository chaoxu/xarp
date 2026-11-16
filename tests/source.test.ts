import { expect, test } from 'vitest';
import { parseSource, selectedMarkdown, selectSlides, updateSlideInSource } from '../lib/source.js';

test('ordinary Markdown needs neither front matter, IDs nor local classes', () => {
  const source = '# First\n\nText\n\n---\n\n# Second\n';
  const parsed = parseSource(source);
  expect(parsed.frontmatter).toEqual({});
  expect(parsed.slides.map(slide => slide.id)).toEqual(['slide-1', 'slide-2']);
  expect(updateSlideInSource(source, 'slide-2', { markdown: '# Revised' }).updatedSource).toBe('# First\n\nText\n\n---\n\n# Revised\n');
  expect(selectedMarkdown(parsed)).toBe(source);
});

test('the renderer supplies boundaries around math instead of CommonMark setext headings', () => {
  const combined = '$$x$$\n---\n# middle\n\n$$\n\n---\n\n$$';
  const parsed = parseSource(combined);
  expect(parsed.slides.map(slide => slide.body)).toEqual(['$$x$$', '# middle\n\n$$\n\n---\n\n$$']);
  const edited = updateSlideInSource(combined, 'slide-2', { markdown: '# Revised\n\n$$\n\n---\n\n$$' });
  expect(edited.updatedSource).toBe('$$x$$\n---\n# Revised\n\n$$\n\n---\n\n$$');
});

test('separators in code, raw HTML and math do not create editable slides', () => {
  for (const block of ['```text\n---\n```', '<div>\n---\n</div>', '$$\n\n---\n\n$$']) {
    const source = `---\nmarp: true\n---\n\n${block}\n\n---\n\n# Last`;
    expect(parseSource(source).slides.map(slide => slide.body)).toEqual([block, '# Last']);
  }
});

test('CRLF and leading authoring comments survive source saves', () => {
  const source = '---\r\nmarp: true\r\n---\r\n\r\n<!-- Author note -->\r\n\r\n<!-- slide: first -->\r\n\r\n# First\r\n\r\n---\r\n\r\n<!-- slide: last -->\r\n# Last\r\n';
  const parsed = parseSource(source);
  expect(parsed.frontmatter.marp).toBe(true);
  expect(parsed.slides.map(slide => slide.id)).toEqual(['first', 'last']);
  const result = updateSlideInSource(source, 'last', { markdown: '# Changed' });
  expect(result.updatedSource.slice(0, source.indexOf('<!-- slide: last -->'))).toBe(source.slice(0, source.indexOf('<!-- slide: last -->')));
  expect(result.updatedSource).toContain('<!-- Author note -->\r\n');
  expect(parseSource(result.updatedSource).slides[1].body).toBe('# Changed');
});

test('selection uses explicit IDs and preserves order without changing the source', () => {
  const source = '---\ntitle: Example\n---\n\n<!-- slide: alpha -->\n# Alpha\n\n---\n\n<!-- slide: beta -->\n# Beta\n';
  const document = parseSource(source);
  expect(selectSlides(document, ['beta', 'alpha']).map(slide => slide.id)).toEqual(['beta', 'alpha']);
  expect(selectedMarkdown(document, ['beta', 'alpha']).indexOf('# Beta')).toBeLessThan(selectedMarkdown(document, ['beta', 'alpha']).indexOf('# Alpha'));
  expect(() => selectSlides(document, ['missing'])).toThrow('missing');
  expect(() => selectSlides(document, ['alpha', 'alpha'])).toThrow('alpha');
  expect(() => selectSlides(parseSource('# Plain'), ['slide-1'])).toThrow('marker');
  expect(() => parseSource(source.replace('slide: beta', 'slide: alpha'))).toThrow('Duplicate slide ID: alpha');
  expect(document.source).toBe(source);
});

test('generated IDs do not alias explicit IDs and remain stable after edits', () => {
  const source = '# Plain\n\n---\n\n<!-- slide: slide-1 -->\n# Explicit';
  const document = parseSource(source);
  expect(document.slides[0].id).not.toBe(document.slides[1].id);
  const updated = updateSlideInSource(source, document.slides[0].id, { markdown: '# Changed' });
  expect(parseSource(updated.updatedSource).slides.map(slide => slide.id)).toEqual(document.slides.map(slide => slide.id));
});

test('heading dividers in front matter or comments disable source editing', () => {
  for (const source of ['---\nheadingDivider: 1\n---\n# A\n\n# B', '# A\n\n<!-- headingDivider: 1 -->\n\n# B']) {
    expect(parseSource(source).editingError).toContain('headingDivider');
    expect(() => updateSlideInSource(source, 'slide-1', { markdown: '# Changed' })).toThrow('headingDivider');
  }
});

test('single-slide updates reject new boundaries, marker changes and mixed payloads', () => {
  const source = '<!-- slide: example -->\n# First';
  expect(() => updateSlideInSource(source, 'example', { markdown: '# A\n\n---\n\n# B' })).toThrow('boundaries');
  expect(() => updateSlideInSource(source, 'example', { markdown: '<!-- slide: different -->\n# Changed' })).toThrow('ID');
  expect(() => updateSlideInSource(source, 'example', { markdown: '# Changed', edits: [] })).toThrow('either');
});

test('theme directives are detected without interpreting comments inside fenced code', () => {
  expect(parseSource('---\ntheme: gaia\n---\n# A').theme).toBe('gaia');
  expect(parseSource('<!-- theme: uncover -->\n\n# A').theme).toBe('uncover');
  expect(parseSource('```html\n<!-- theme: gaia -->\n```').theme).toBeUndefined();
});

test('header and footer inline parsing preserves deck boundaries and source edits', () => {
  for (const directive of ['header', 'footer']) {
    for (const prefix of [`---\n${directive}: '**Label**'\n---\n\n`, `<!-- ${directive}: **Label** -->\n\n`]) {
      const source = `${prefix}# First\n\n---\n\n# Second\n`;
      const parsed = parseSource(source);
      expect(parsed.slides).toHaveLength(2);
      expect(parsed.editingError).toBeUndefined();
      const updated = updateSlideInSource(source, 'slide-2', { markdown: '# Updated' });
      expect(parseSource(updated.updatedSource).slides).toHaveLength(2);
      expect(updated.updatedSource).toContain(prefix);
      expect(updated.updatedSource).toContain('# Updated');
    }
  }
});
