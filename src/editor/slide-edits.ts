import MarkdownIt from "markdown-it";

export const slideParser = new MarkdownIt("commonmark", { html: true });
const parser = slideParser;

export type SlideTextEdit = {
  tag?: string;
  tagOccurrence?: number;
  beforeText?: string;
  beforeMd?: string;
  beforeHtml?: string;
  afterText: string;
  afterMd?: string;
  afterHtml?: string;
  occurrence?: number;
  svgAttrs?: Record<string, string>;
  style?: string;
};

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function buildEditPattern(candidate: string): RegExp {
  const tokens = candidate.trim().split(/(\s+)/);
  const pattern = tokens.map(token => {
    if (/^\s+$/.test(token)) return "\\s+";
    let out = "";
    for (let i = 0; i < token.length; i++) {
      if (token.startsWith("&amp;", i)) { out += "(?:&amp;|&)"; i += 4; continue; }
      const ch = token[i]!;
      if (ch === "&") out += "(?:&amp;|&)";
      else if ("'’‘".includes(ch)) out += "['’‘]";
      else if ('"“”'.includes(ch)) out += '["“”]';
      else if (ch === "—") out += "(?:---|—)";
      else if (ch === "–") out += "(?:--|–)";
      else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return out;
  }).join("");
  return new RegExp(pattern, "g");
}

function updateOpeningTagAttrs(openingTag: string, attrs: Record<string, string>): string {
  let out = openingTag;
  for (const [k, v] of Object.entries(attrs)) {
    requireValue(/^(?:style|x|y|width|height|cx|cy|transform)$/.test(k), `Unsupported editable attribute: ${k}`);
    const escaped = v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const attrRe = new RegExp(`\\s+${k}\\s*=\\s*(?:"[^"]*"|'[^']*')`, "i");
    if (attrRe.test(out)) {
      out = v === "" ? out.replace(attrRe, "") : out.replace(attrRe, ` ${k}="${escaped}"`);
    } else if (v !== "") {
      out = out.replace(/(\s*\/?)>$/, ` ${k}="${escaped}"$1>`);
    }
  }
  return out;
}

function editableSegments(source: string): string[] {
  const lineOffsets = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineOffsets.push(i + 1);
  const excluded = parser.parse(source, {})
    .filter(token => ["fence", "code_block"].includes(token.type) && token.map)
    .map(token => [lineOffsets[token.map![0]]!, lineOffsets[token.map![1]] ?? source.length]);
  for (const match of source.matchAll(/<!--[\s\S]*?-->/g)) excluded.push([match.index!, match.index! + match[0].length]);
  const merged: number[][] = [];
  for (const range of excluded.sort((a, b) => a[0]! - b[0]!)) {
    const last = merged.at(-1);
    if (last && range[0]! <= last[1]!) last[1] = Math.max(last[1]!, range[1]!);
    else merged.push(range);
  }
  const segments: string[] = [];
  let end = 0;
  for (const [start, next] of merged) {
    segments.push(source.slice(end, start), source.slice(start, next));
    end = next!;
  }
  segments.push(source.slice(end));
  return segments;
}

const htmlTag = /<\/?[a-z][a-z0-9-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
const plainHtml = (value: string) => value.replace(htmlTag, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const sameText = (candidate: string, text: string) => new RegExp(`^(?:${buildEditPattern(candidate).source})$`).test(text.trim());

function textEditScope(segments: string[], edit: SlideTextEdit): { segIndex: number; start: number; end: number; html: boolean } | undefined {
  if (!edit.tag) return undefined;
  requireValue(/^[a-z][a-z0-9]*$/.test(edit.tag), "Invalid editable element tag");
  const candidates: { segIndex: number; start: number; end: number; content: string; html: boolean }[] = [];
  for (let s = 0; s < segments.length; s += 2) {
    const seg = segments[s]!;
    const tagRe = new RegExp(`<(/?)${edit.tag}\\b(?:[^"'<>]|"[^"]*"|'[^']*')*>`, "gi");
    const stack: number[] = [];
    for (const match of seg.matchAll(tagRe)) {
      if (!match[1]) stack.push(match.index! + match[0].length);
      else {
        const start = stack.pop();
        if (start !== undefined) candidates.push({ segIndex: s, start, end: match.index!, content: seg.slice(start, match.index), html: true });
      }
    }
    const offsets = [0];
    for (let i = 0; i < seg.length; i++) if (seg[i] === "\n") offsets.push(i + 1);
    const tokens = parser.parse(seg, {});
    tokens.forEach((token, i) => {
      if (token.tag !== edit.tag || token.nesting !== 1 || token.hidden) return;
      // Markdown list items wrap their inline text in a paragraph token, even
      // when tight-list rendering hides the paragraph's HTML tags.
      const inline = token.tag === 'li' && tokens[i + 1]?.type === 'paragraph_open' ? tokens[i + 2] : tokens[i + 1];
      if (inline?.type !== 'inline' || !inline.map) return;
      candidates.push({ segIndex: s, start: offsets[inline.map[0]]!, end: offsets[inline.map[1]] ?? seg.length, content: inline.content, html: false });
    });
  }
  candidates.sort((a, b) => a.segIndex - b.segIndex || a.start - b.start);
  const matching = candidates.filter(candidate =>
    [edit.beforeMd, edit.beforeHtml].some(value => value && sameText(value, candidate.content)) ||
    edit.beforeText && sameText(edit.beforeText, plainHtml(candidate.content)));
  const indexed = candidates[edit.tagOccurrence ?? 0];
  const chosen = matching.length === 1 ? matching[0] : indexed && matching.includes(indexed) ? indexed : undefined;
  requireValue(chosen, "Could not identify the edited text element. Use Slide Markdown");
  return chosen;
}

function applyBoxAttrsToSegments(segments: string[], edit: SlideTextEdit): boolean {
  const attrs: Record<string, string> = {
    ...(edit.svgAttrs ?? {}),
    ...(edit.style !== undefined ? { style: edit.style } : {}),
  };
  if (!edit.tag || Object.keys(attrs).length === 0) return false;
  const tag = edit.tag.toLowerCase();
  requireValue(/^[a-z][a-z0-9]*$/.test(tag), "Invalid editable element tag");
  const tagRe = new RegExp(`<(/?)${tag}\\b(?:[^"'<>]|"[^"]*"|'[^']*')*>`, "gi");
  const matches: { segIndex: number; start: number; end: number; raw: string; content?: string }[] = [];
  for (let s = 0; s < segments.length; s += 2) {
    const seg = segments[s]!;
    tagRe.lastIndex = 0;
    const stack: typeof matches = [];
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(seg)) !== null) {
      if (m[1]) {
        const opening = stack.pop();
        if (opening) opening.content = seg.slice(opening.end, m.index);
      } else {
        const opening = { segIndex: s, start: m.index, end: m.index + m[0].length, raw: m[0], content: undefined as string | undefined };
        matches.push(opening);
        if (/\/>$/.test(m[0]) || ["img", "hr", "br", "input"].includes(tag)) opening.content = "";
        else stack.push(opening);
      }
    }
  }
  if (matches.length > 0) {
    const needle = edit.beforeText?.trim();
    const candidates = needle ? matches.filter(m => m.content !== undefined &&
      (buildEditPattern(needle).test(plainHtml(m.content)) || [edit.beforeMd, edit.beforeHtml].some(value => value && sameText(value, m.content!)))) : matches;
    const indexed = matches[edit.tagOccurrence ?? 0];
    const chosen = candidates.length === 1 ? candidates[0] : indexed && candidates.includes(indexed) ? indexed : undefined;
    requireValue(chosen, "Could not identify the edited element. Use Slide Markdown");
    const seg = segments[chosen.segIndex]!;
    const updatedTag = updateOpeningTagAttrs(chosen.raw, attrs);
    segments[chosen.segIndex] = seg.slice(0, chosen.start) + updatedTag + seg.slice(chosen.end);
    return true;
  }
  if (/^h[1-4]$/.test(tag) && edit.style) {
    const level = Number(tag[1]);
    const hRe = new RegExp(`^#{${level}}\\s+(.+)$`, "gm");
    const headings: { segIndex: number; match: RegExpMatchArray }[] = [];
    for (let s = 0; s < segments.length; s += 2) {
      for (const match of segments[s]!.matchAll(hRe)) headings.push({ segIndex: s, match });
    }
    const candidates = headings.filter(item => [edit.beforeMd, edit.beforeText].some(value => value && sameText(value, item.match[1]!)));
    const indexed = headings[edit.tagOccurrence ?? 0];
    const chosen = candidates.length === 1 ? candidates[0] : indexed && candidates.includes(indexed) ? indexed : undefined;
    requireValue(chosen, "Could not identify the edited heading. Use Slide Markdown");
    const seg = segments[chosen.segIndex]!;
    requireValue(!/\$|\\\(|\\\[/.test(chosen.match[1]!), "Move math headings through Slide Markdown to preserve their math rendering");
    const opening = updateOpeningTagAttrs(`<${tag}>`, { style: edit.style });
    const suffix = seg.slice(chosen.match.index! + chosen.match[0].length);
    // An HTML block needs a blank line before following Markdown resumes.
    const newline = seg.includes('\r\n') ? '\r\n' : '\n';
    const separator = suffix && !suffix.startsWith(newline + newline) ? newline : '';
    segments[chosen.segIndex] = seg.slice(0, chosen.match.index!) + `${opening}${parser.renderInline(chosen.match[1]!)}</${tag}>` + separator + suffix;
    return true;
  }
  return false;
}

function applyTextEditToSlide(slideText: string, edit: SlideTextEdit, slideId: string): string {
  const segments = editableSegments(slideText);
  const boxApplied = applyBoxAttrsToSegments(segments, edit);
  requireValue(boxApplied || edit.style === undefined && !Object.keys(edit.svgAttrs ?? {}).length,
    "This element's layout cannot be mapped to its source. Use Slide Markdown");
  const textChanged =
    (edit.beforeText !== undefined && edit.afterText !== edit.beforeText) ||
    (edit.beforeMd !== undefined && edit.afterMd !== undefined && edit.afterMd !== edit.beforeMd) ||
    (edit.beforeHtml !== undefined && edit.afterHtml !== undefined && edit.afterHtml !== edit.beforeHtml);
  if (!textChanged && boxApplied) return segments.join("");
  const scope = textEditScope(segments, edit);

  const escapedText = edit.afterText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pairs: [string | undefined, string][] = scope?.html ? [
    [edit.beforeHtml, edit.tag === "text" ? escapedText : edit.afterHtml ?? escapedText],
    [edit.beforeMd, edit.tag === "text" ? escapedText : edit.afterHtml ?? escapedText],
    [edit.beforeText, escapedText],
  ] : [
    [edit.beforeMd, edit.afterMd ?? edit.afterText],
    [edit.beforeHtml, edit.afterHtml ?? edit.afterText],
    [edit.beforeText, edit.afterText],
  ];
  const seen = new Set<string>();
  for (const [rawBefore, rawAfter] of pairs) {
    const before = rawBefore?.trim();
    if (!before || seen.has(before)) continue;
    seen.add(before);
    const regex = buildEditPattern(before);
    const matches: { segIndex: number; start: number; end: number; matched: string }[] = [];
    for (let s = 0; s < segments.length; s += 2) {
      const seg = segments[s]!;
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(seg)) !== null) {
        const end = m.index + m[0].length;
        const cutsTag = [...seg.matchAll(htmlTag)].some(tag =>
          m!.index > tag.index! && m!.index < tag.index! + tag[0].length || end > tag.index! && end < tag.index! + tag[0].length);
        if (!cutsTag && (!scope || s === scope.segIndex && m.index >= scope.start && end <= scope.end))
          matches.push({ segIndex: s, start: m.index, end, matched: m[0] });
        if (m[0].length === 0) regex.lastIndex++;
      }
    }
    if (matches.length > 0) {
      const targetIdx = scope ? 0 : edit.occurrence ?? 0;
      requireValue(Number.isInteger(targetIdx) && targetIdx >= 0 && targetIdx < matches.length, "Edited text occurrence no longer exists. Use Slide Markdown");
      const chosen = matches[targetIdx]!;
      let replacement = rawAfter.trim();
      if (chosen.matched.includes("&amp;") && !replacement.includes("&amp;")) {
        replacement = replacement.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;");
      }
      const seg = segments[chosen.segIndex]!;
      segments[chosen.segIndex] = seg.slice(0, chosen.start) + replacement + seg.slice(chosen.end);
      return segments.join("");
    }
  }
  throw new Error(`Could not locate text to update in ${slideId}: ${edit.beforeText ?? edit.beforeMd ?? ""}`);
}

export function applyVisualEdits(markdown: string, edits: readonly SlideTextEdit[], slideId: string): string {
  return edits.reduce((current, edit) => applyTextEditToSlide(current, edit, slideId), markdown);
}
