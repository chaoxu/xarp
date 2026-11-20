import { createHash } from 'node:crypto';
import * as yaml from 'js-yaml';
import { createEngine } from './engine.js';
import { isColorScheme, type ColorScheme } from './color-schemes.js';
import { applyVisualEdits, type SlideTextEdit } from './editor/slide-edits.js';

export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export interface Slide {
  id: string;
  explicitId: boolean;
  body: string;
  start: number;
  end: number;
  marker: string;
}

export interface SourceDocument {
  source: string;
  revision: string;
  frontmatter: Record<string, unknown>;
  prefix: string;
  slides: Slide[];
  theme?: string;
  colorScheme?: ColorScheme;
  editingError?: string;
}

export function parseSource(source: string): SourceDocument {
  const engine = createEngine();
  engine.markdown.parse(source, {});
  const mapping = engine.xarpMapping;
  const offsets = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') offsets.push(i + 1);
  const at = (line: number) => offsets[line] ?? source.length;
  const frontmatterEnd = mapping.frontmatter ? at(mapping.frontmatter.end) : 0;
  const frontmatterText = source.slice(0, frontmatterEnd).replace(/^---[^\n]*\n/, '').replace(/(?:^|\n)(?:---|\.\.\.)[^\n]*(?:\n)?$/, '');
  const frontmatter = (frontmatterText ? yaml.load(frontmatterText) : {}) ?? {};
  requireValue(typeof frontmatter === 'object' && !Array.isArray(frontmatter), 'Front matter must be a YAML mapping');
  let theme = typeof (frontmatter as Record<string, unknown>).theme === 'string' ? (frontmatter as Record<string, string>).theme : undefined;
  const colorScheme = mapping.colorScheme;
  for (const comment of mapping.comments) {
    try {
      const directives = yaml.load(comment) as Record<string, unknown> | undefined;
      if (typeof directives?.theme === 'string') theme = directives.theme;
    } catch { /* Speaker notes need not be YAML. */ }
  }
  requireValue(colorScheme === undefined || isColorScheme(colorScheme), `Unknown color scheme: ${String(colorScheme)}`);
  let prefix = source.slice(0, frontmatterEnd);
  const starts = [frontmatterEnd, ...mapping.breaks.map(([, end]) => at(end))];
  const ends = [...mapping.breaks.map(([start]) => at(start)), source.length];
  const explicitIds = new Set<string>();
  const slides = starts.map((originalStart, index): Slide => {
    let start = originalStart;
    if (index === 0) {
      const preamble = source.slice(start, ends[index]).match(/^((?:\s*<!--(?!\s*slide:)[\s\S]*?-->)*\s*)(?=<!--\s*slide:)/)?.[1];
      if (preamble) { prefix += preamble; start += preamble.length; }
    }
    const chunk = source.slice(start, ends[index]);
    const marker = chunk.match(/^\s*(<!--\s*slide:\s*([a-zA-Z0-9][a-zA-Z0-9_-]*)\s*-->)/);
    const id = marker?.[2] ?? `slide-${index + 1}`;
    if (marker) {
      requireValue(!explicitIds.has(id), `Duplicate slide ID: ${id}`);
      explicitIds.add(id);
    }
    return { id, explicitId: !!marker, marker: marker?.[1] ?? '', body: chunk.slice(marker?.[0].length ?? 0).trim(), start, end: ends[index]! };
  });
  // Generated IDs must not alias an explicitly named slide elsewhere.
  for (const [index, slide] of slides.entries()) {
    if (!slide.explicitId && explicitIds.has(slide.id)) slide.id = `@slide-${index + 1}`;
  }
  const editingError = /(?:^|[\n<])\s*(?:!--\s*)?headingDivider\s*:/i.test(source)
    ? 'Source editing does not support headingDivider. Use thematic breaks between slides.' : undefined;
  return { source, revision: hash(source), frontmatter: frontmatter as Record<string, unknown>, prefix, slides, theme, colorScheme, editingError };
}

export function selectSlides(document: SourceDocument, ids?: readonly string[]): Slide[] {
  if (!ids) return document.slides;
  requireValue(ids.length > 0, 'Select at least one slide');
  const byId = new Map(document.slides.filter(slide => slide.explicitId).map(slide => [slide.id, slide]));
  const seen = new Set<string>();
  return ids.map(id => {
    requireValue(!seen.has(id), `Duplicate selected slide ID: ${id}`);
    seen.add(id);
    const slide = byId.get(id);
    requireValue(slide, `Unknown selected slide ID: ${id}. Named selection requires a slide marker.`);
    return slide;
  });
}

export function selectedMarkdown(document: SourceDocument, ids?: readonly string[]): string {
  if (!ids) return document.source;
  requireValue(!document.editingError, document.editingError ?? 'Unsupported slide mapping');
  return `${document.prefix}\n${selectSlides(document, ids).map(slide => `${slide.marker}\n${slide.body}`).join('\n\n---\n\n')}\n`;
}

export function updateSlideInSource(source: string, slideId: string, update: { markdown?: string; edits?: SlideTextEdit[] }) {
  const document = parseSource(source);
  requireValue(!document.editingError, document.editingError ?? 'Unsupported slide mapping');
  const slide = document.slides.find(item => item.id === slideId);
  requireValue(slide, `Unknown slide ID: ${slideId}`);
  requireValue((typeof update.markdown === 'string') !== (update.edits !== undefined), 'Supply either Markdown or visual edits');
  let body: string;
  if (update.markdown !== undefined) {
    body = update.markdown.trim();
    const marker = body.match(/^<!--\s*slide:\s*([^\s]+)\s*-->/);
    if (marker) {
      requireValue(slide.explicitId && marker[1] === slide.id, 'The slide ID cannot be changed while editing');
      body = body.slice(marker[0].length).trim();
    }
  } else {
    requireValue(Array.isArray(update.edits) && update.edits.length > 0, 'Supply at least one visual edit');
    body = applyVisualEdits(slide.body, update.edits, slideId);
  }
  const original = source.slice(slide.start, slide.end);
  const leading = original.match(/^\s*/)?.[0] ?? '';
  const trailing = original.match(/\s*$/)?.[0] ?? '';
  const replacement = `${leading}${slide.marker ? `${slide.marker}\n\n` : ''}${body}${trailing}`;
  const updatedSource = source.slice(0, slide.start) + replacement + source.slice(slide.end);
  const revised = parseSource(updatedSource);
  requireValue(!revised.editingError, revised.editingError ?? 'Unsupported slide mapping');
  requireValue(revised.slides.length === document.slides.length, 'A slide edit cannot add or remove slide boundaries');
  requireValue(revised.slides.every((item, index) => item.explicitId === document.slides[index]!.explicitId && (!item.explicitId || item.id === document.slides[index]!.id)), 'A slide edit cannot change slide IDs');
  const index = document.slides.indexOf(slide);
  return { updatedSource, slideBody: revised.slides[index]!.body };
}
