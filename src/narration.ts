import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { slideParser } from './editor/slide-edits.js';
import { isWithin, pathExists } from './files.js';
import { NARRATION_BUILD_OPTIONS } from './plugins/index.js';
import { hash, requireValue } from './source.js';
import type {
  BuildOptions,
  NarrationOptions,
  NarrationTimeline,
  NarrationTimelineBeat,
  NarrationTimelineSection,
  NarrationTimelineSlide,
  NarrationTtsOptions,
  Section,
  SoundCueKind,
} from './types.js';

export type { NarrationTimeline, NarrationTimelineBeat, NarrationTimelineSection, NarrationTimelineSlide };

const run = promisify(execFile);

export interface AuthoredBeat {
  caption: string;
  tts: string;
  explicitTts: boolean;
  pause?: number;
  duration?: number;
  audio?: string;
  cue?: SoundCueKind;
  step?: number;
  seg?: number;
  fit?: boolean;
  zoom?: number;
  focus?: [number, number];
  spotlight?: [number, number, number, number];
  silent: boolean;
}

export interface CachedClipRecord {
  hash: string;
  file: string;
  duration: number;
  caption: string;
  tts: string;
  provider: string;
  voice?: string;
  speed: number;
  updatedAt: string;
  asrTranscript?: string;
  asrErrorRate?: number;
}

export interface NarrationCache {
  version: 1;
  clips: Record<string, CachedClipRecord>;
}

const VALID_CUES = new Set<SoundCueKind>(['chime', 'brush', 'thud', 'none']);

const r3 = (value: number) => Math.round(value * 1000) / 1000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&quot;/gi, '"')
    .replace(/&(apos|#39);/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => {
      const cp = Number(code);
      return Number.isSafeInteger(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const cp = parseInt(hex, 16);
      return Number.isSafeInteger(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : _;
    })
    .replace(/&amp;/gi, '&');
}

/** Single-pass longest-key-first glossary replacement so replacements containing keys never re-expand. */
export function applyGlossary(text: string, glossary?: Record<string, string>): string {
  if (!glossary) return text;
  const entries = Object.entries(glossary)
    .filter(([key]) => key.trim().length > 0)
    .sort((a, b) => b[0].length - a[0].length);
  if (!entries.length) return text;
  const byKey = new Map(entries);
  const patterns = entries.map(([key]) => {
    const startsWord = /^[A-Za-z0-9_]/.test(key);
    const endsWord = /[A-Za-z0-9_]$/.test(key);
    return `${startsWord ? '(?<![A-Za-z0-9_])' : ''}${escapeRegExp(key)}${endsWord ? '(?![A-Za-z0-9_])' : ''}`;
  });
  return text.replace(new RegExp(patterns.join('|'), 'g'), matched => byKey.get(matched) ?? matched);
}

function readableMathForCaption(tex: string): string {
  let out = tex
    .trim()
    .replace(/\\(?:left|right|[bB]igg?|[dD]isplaystyle|[tT]extstyle)\b/g, '')
    .replace(/\\\|/g, '‖');
  for (let i = 0; i < 3; i++) {
    out = out
      .replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
      .replace(/\\(?:text|mathrm|mathbf|mathit|mathbb|mathcal)\s*\{([^{}]*)\}/g, '$1');
  }
  return out
    .replace(/\\(?:geq|ge)\b/g, '≥')
    .replace(/\\(?:leq|le)\b/g, '≤')
    .replace(/\\(?:neq|ne)\b/g, '≠')
    .replace(/\\approx\b/g, '≈')
    .replace(/\\in\b/g, '∈')
    .replace(/\\sum\b/g, '∑')
    .replace(/\\prod\b/g, '∏')
    .replace(/\\int\b/g, '∫')
    .replace(/\\times\b/g, '×')
    .replace(/\\cdot\b/g, '·')
    .replace(/\\(?:to|rightarrow)\b/g, '→')
    .replace(/\\infty\b/g, '∞')
    .replace(/\^2(?![0-9])/g, '²')
    .replace(/\^3(?![0-9])/g, '³')
    .replace(/\\([{}%$&_])/g, '$1')
    .replace(/\\[a-zA-Z]+/g, match => match.slice(1))
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function spokenMath(tex: string): string {
  let out = tex
    .trim()
    .replace(/\\(?:left|right|[bB]igg?|[dD]isplaystyle|[tT]extstyle)\b/g, ' ')
    .replace(/\\\|\s*([^\\|]+?)\s*\\\|/g, ' norm of $1 ')
    .replace(/\\\|/g, ' norm ')
    .replace(/\|\s*([^|]+?)\s*\|/g, ' absolute value of $1 ');
  for (let i = 0; i < 3; i++) {
    out = out
      .replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, ' $1 over $2 ')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, ' square root of $1 ')
      .replace(/\\(?:text|mathrm|mathbf|mathit|mathbb|mathcal)\s*\{([^{}]*)\}/g, ' $1 ');
  }
  return out
    .replace(/\^\{2\}|\^2(?![0-9])/g, ' squared ')
    .replace(/\^\{3\}|\^3(?![0-9])/g, ' cubed ')
    .replace(/\^\{([^{}]+)\}/g, ' to the $1 ')
    .replace(/\^([A-Za-z0-9]+)/g, ' to the $1 ')
    .replace(/_\{([^{}]+)\}/g, ' sub $1 ')
    .replace(/_([A-Za-z0-9]+)/g, ' sub $1 ')
    .replace(/\\sum\b|∑/g, ' sum ')
    .replace(/\\prod\b|∏/g, ' product ')
    .replace(/\\int\b|∫/g, ' integral ')
    .replace(/\\in\b|∈/g, ' in ')
    .replace(/\\(?:geq|ge)\b|≥/g, ' greater than or equal to ')
    .replace(/\\(?:leq|le)\b|≤/g, ' less than or equal to ')
    .replace(/\\(?:neq|ne)\b|≠/g, ' not equal to ')
    .replace(/\\approx\b|≈/g, ' approximately ')
    .replace(/\\times\b|×/g, ' times ')
    .replace(/\\cdot\b|·/g, ' times ')
    .replace(/\\(?:to|rightarrow)\b|→/g, ' to ')
    .replace(/\\infty\b|∞/g, ' infinity ')
    .replace(/>=/g, ' greater than or equal to ')
    .replace(/<=/g, ' less than or equal to ')
    .replace(/>/g, ' greater than ')
    .replace(/</g, ' less than ')
    .replace(/=/g, ' equals ')
    .replace(/\+/g, ' plus ')
    .replace(/-/g, ' minus ')
    .replace(/\\[a-zA-Z]+/g, match => ` ${match.slice(1)} `)
    .replace(/[{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanCaptionText(raw: string): string {
  return decodeHtmlEntities(
    raw
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => readableMathForCaption(tex))
      .replace(/(?<!\\)\$([^$\n]+?)\$/g, (_, tex: string) => readableMathForCaption(tex))
      .replace(/\\\$/g, '$')
      .replace(/<\/?[a-z][a-z0-9-]*\b[^>]*>/gi, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[\s([{"'])\*(\S(?:[^*\n]*?\S)?)\*(?=$|[\s.,;:!?)\]}"'])/g, '$1$2'),
  ).replace(/\s+/g, ' ').trim();
}

export function normalizeSpeechText(raw: string, glossary?: Record<string, string>, expandMath = true): string {
  let out = raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<\/?[a-z][a-z0-9-]*\b[^>]*>/gi, ' ');
  if (expandMath) {
    // Protect glossary tokens inside math before spokenMath expands TeX operators.
    const preGlossary = glossary
      ? Object.fromEntries(Object.entries(glossary).filter(([k]) => /[^A-Za-z0-9_\s]/.test(k)))
      : undefined;
    if (preGlossary && Object.keys(preGlossary).length > 0) {
      out = applyGlossary(out, preGlossary);
    }
    out = out
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => ` ${spokenMath(tex)} `)
      .replace(/(?<!\\)\$([^$\n]+?)\$/g, (_, tex: string) => ` ${spokenMath(tex)} `)
      .replace(/≥/g, ' greater than or equal to ')
      .replace(/≤/g, ' less than or equal to ')
      .replace(/≠/g, ' not equal to ')
      .replace(/²/g, ' squared ')
      .replace(/³/g, ' cubed ');
  }
  out = decodeHtmlEntities(
    out
      .replace(/\\\$/g, '$')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[\s([{"'])\*(\S(?:[^*\n]*?\S)?)\*(?=$|[\s.,;:!?)\]}"'])/g, '$1$2'),
  );
  out = applyGlossary(out, glossary);
  return out.replace(/\s+/g, ' ').trim();
}

export function estimateSpeechDuration(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 1.8;
  const cjk = (trimmed.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const latinWords = trimmed
    .replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return r3(Math.max(1.2, latinWords / 2.55 + cjk / 3.8));
}

interface RawBeatFields {
  captionLines: string[];
  ttsLines: string[];
  pause?: number;
  duration?: number;
  audio?: string;
  cue?: SoundCueKind;
  step?: number;
  seg?: number;
  fit?: boolean;
  zoom?: number;
  focus?: [number, number];
  spotlight?: [number, number, number, number];
  silent?: boolean;
}

function parseNumberField(name: string, raw: string, min: number): number {
  const value = Number(raw.trim());
  requireValue(Number.isFinite(value) && value >= min, `Invalid narration ${name}: ${raw}`);
  return value;
}

function parseNonNegInt(name: string, raw: string): number {
  const value = Number(raw.trim());
  requireValue(Number.isSafeInteger(value) && value >= 0, `Invalid narration ${name}: ${raw}`);
  return value;
}

function parseCueField(raw: string): SoundCueKind {
  const value = raw.trim().toLowerCase() as SoundCueKind;
  requireValue(VALID_CUES.has(value), `Unknown narration cue: ${raw}. Choose chime, brush, thud, or none.`);
  return value;
}

function validateAudioField(raw: string): string {
  const value = raw.trim().replace(/^['"]|['"]$/g, '');
  requireValue(value.length > 0 && !value.startsWith('/') && !/^[A-Za-z]:/.test(value), `Narration audio path must be project-relative: ${raw}`);
  requireValue(!value.split(/[\\/]/).some(part => part === '..'), `Narration audio path must stay inside the project: ${raw}`);
  return value.split('\\').join('/');
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parsePointPair(name: string, raw: string): [number, number] {
  const parts = raw.split(/[\s,]+/).filter(Boolean).map(s => Number(s.replace(/%$/, '')));
  requireValue(parts.length === 2 && parts.every(n => Number.isFinite(n) && n >= 0 && n <= 100), `Invalid narration ${name} (expected "x, y" in 0..100): ${raw}`);
  return [r3(parts[0]!), r3(parts[1]!)];
}

function parseSpotlightRect(raw: string): [number, number, number, number] {
  const parts = raw.split(/[\s,]+/).filter(Boolean).map(s => Number(s.replace(/%$/, '')));
  requireValue(
    parts.length === 4
      && parts.every(n => Number.isFinite(n) && n >= 0 && n <= 100)
      && parts[2]! > 0 && parts[3]! > 0,
    `Invalid narration spotlight (expected "x, y, w, h" in 0..100): ${raw}`,
  );
  return [r3(parts[0]!), r3(parts[1]!), r3(parts[2]!), r3(parts[3]!)];
}

// Case-sensitive lowercase metadata keys so capitalized prose (`Duration: ...`, `Audio: ...`) stays prose.
const META_KEY_NAMES = 'text|caption|tts|say|speak|pause|duration|hold|audio|cue|step|fragment|seg|segment|fit|zoom|camera|focus|pan|spotlight|silent';
const META_KEY_RE = new RegExp(`^(${META_KEY_NAMES})\\s*:\\s*(.*)$`);
const INLINE_KEY_AHEAD_RE = new RegExp(`^(${META_KEY_NAMES})\\s*:`);

/**
 * Split inline ` | key: value` metadata segments ONLY outside `$...$` / `$$...$$`, quotes, and `\|` escapes,
 * and ONLY when the pipe is followed by a recognized lowercase metadata key.
 */
function splitInlineMetadataSegments(line: string): string[] {
  const segments: string[] = [];
  let start = 0;
  let inMath = false;
  let mathDouble = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '\\') {
      i++;
      continue;
    }
    if (!inMath && (ch === '"' || ch === "'")) {
      if (quote === ch) quote = null;
      else if (!quote && (i === 0 || /\s/.test(line[i - 1]!))) quote = ch;
      continue;
    }
    if (!quote && ch === '$') {
      const isDouble = line[i + 1] === '$';
      if (!inMath) {
        inMath = true;
        mathDouble = isDouble;
        if (isDouble) i++;
      } else if (mathDouble && isDouble) {
        inMath = false;
        mathDouble = false;
        i++;
      } else if (!mathDouble && !isDouble) {
        inMath = false;
      }
      continue;
    }
    if (!inMath && !quote && ch === '|' && i > 0 && /\s/.test(line[i - 1]!)) {
      const after = line.slice(i + 1).trimStart();
      if (INLINE_KEY_AHEAD_RE.test(after)) {
        segments.push(line.slice(start, i).trim());
        start = line.indexOf(after, i + 1);
        i = start - 1;
      }
    }
  }
  segments.push(line.slice(start).trim());
  return segments.filter(Boolean);
}

function applyProperty(fields: RawBeatFields, key: string, rawValue: string): 'caption' | 'tts' | null {
  const v = unquote(rawValue);
  if (key === 'text' || key === 'caption') {
    if (v) fields.captionLines.push(v);
    return 'caption';
  }
  if (key === 'tts' || key === 'say' || key === 'speak') {
    if (v) fields.ttsLines.push(v);
    return 'tts';
  }
  if (key === 'pause') {
    fields.pause = parseNumberField('pause', v, 0);
    return null;
  }
  if (key === 'duration' || key === 'hold') {
    fields.duration = parseNumberField('duration', v, 0.1);
    return null;
  }
  if (key === 'audio') {
    fields.audio = validateAudioField(v);
    return null;
  }
  if (key === 'cue') {
    fields.cue = parseCueField(v);
    return null;
  }
  if (key === 'step' || key === 'fragment') {
    fields.step = parseNonNegInt('step', v);
    return null;
  }
  if (key === 'seg' || key === 'segment') {
    fields.seg = parseNonNegInt('segment', v);
    return null;
  }
  if (key === 'fit') {
    fields.fit = !v || /^(?:true|yes|1)$/i.test(v);
    return null;
  }
  if (key === 'zoom' || key === 'camera') {
    if (!v || /^(?:reset|none|1)$/i.test(v)) {
      fields.zoom = 1;
      fields.focus = [50, 50];
      return null;
    }
    const atParts = v.split('@');
    const zVal = parseNumberField('zoom', atParts[0]!, 1);
    requireValue(zVal <= 4, `Narration zoom must be <= 4: ${v}`);
    fields.zoom = r3(zVal);
    if (atParts[1] !== undefined && atParts[1].trim().length > 0) {
      fields.focus = parsePointPair('focus', atParts[1]);
    }
    return null;
  }
  if (key === 'focus' || key === 'pan') {
    fields.focus = parsePointPair(key, v);
    return null;
  }
  if (key === 'spotlight') {
    fields.spotlight = parseSpotlightRect(v);
    return null;
  }
  if (key === 'silent') {
    if (!v || /^(?:true|yes|1)$/i.test(v)) {
      fields.silent = true;
    } else if (/^(?:false|no|0)$/i.test(v)) {
      fields.silent = false;
    } else {
      fields.silent = true;
      fields.duration = parseNumberField('silent duration', v, 0.1);
    }
    return null;
  }
  return null;
}

function finalizeBeat(fields: RawBeatFields, glossary?: Record<string, string>): AuthoredBeat | null {
  const rawCaption = fields.captionLines.join(' ').trim();
  const silentMatch = !fields.ttsLines.length && !fields.audio ? rawCaption.match(/^silent(?:\s+([0-9]*\.?[0-9]+))?$/i) : null;
  if (silentMatch) {
    fields.silent = true;
    if (silentMatch[1]) fields.duration = parseNumberField('silent duration', silentMatch[1], 0.1);
    fields.captionLines = [];
  }
  const caption = cleanCaptionText(fields.captionLines.join(' '));
  const explicitTts = fields.ttsLines.length > 0;
  const rawTts = explicitTts ? fields.ttsLines.join(' ').trim() : fields.captionLines.join(' ').trim();
  const silent = Boolean(fields.silent || (!caption && !rawTts && !fields.audio));
  if (silent && fields.duration === undefined && fields.pause === undefined && !fields.silent) return null;
  const tts = silent ? '' : normalizeSpeechText(rawTts, glossary, !explicitTts);
  return {
    caption,
    tts,
    explicitTts,
    silent,
    ...(fields.pause !== undefined ? { pause: fields.pause } : {}),
    ...(fields.duration !== undefined ? { duration: fields.duration } : {}),
    ...(fields.audio !== undefined ? { audio: fields.audio } : {}),
    ...(fields.cue !== undefined ? { cue: fields.cue } : {}),
    ...(fields.step !== undefined ? { step: fields.step } : {}),
    ...(fields.seg !== undefined ? { seg: fields.seg } : {}),
    ...(fields.fit !== undefined ? { fit: fields.fit } : {}),
    ...(fields.zoom !== undefined ? { zoom: fields.zoom } : {}),
    ...(fields.focus !== undefined ? { focus: fields.focus } : {}),
    ...(fields.spotlight !== undefined ? { spotlight: fields.spotlight } : {}),
  };
}

function ingestBeatLine(fields: RawBeatFields, rawLine: string, activeField: 'caption' | 'tts'): 'caption' | 'tts' {
  let nextActive = activeField;
  const segments = splitInlineMetadataSegments(rawLine.trim());
  for (const seg of segments) {
    const prop = seg.match(META_KEY_RE);
    if (prop) {
      const switched = applyProperty(fields, prop[1]!, prop[2]!);
      if (switched) nextActive = switched;
    } else if (nextActive === 'tts') {
      fields.ttsLines.push(seg);
    } else {
      fields.captionLines.push(seg);
    }
  }
  return nextActive;
}

function parseSingleBeatBlock(content: string, glossary?: Record<string, string>): AuthoredBeat | null {
  const fields: RawBeatFields = { captionLines: [], ttsLines: [] };
  let activeField: 'caption' | 'tts' = 'caption';
  for (const rawLine of content.split('\n')) {
    if (!rawLine.trim()) continue;
    activeField = ingestBeatLine(fields, rawLine, activeField);
  }
  return finalizeBeat(fields, glossary);
}

function parseNarrationBlock(content: string, glossary?: Record<string, string>): AuthoredBeat[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  const silentOnly = trimmed.match(/^(?:silent|none)(?:\s*:?\s*([0-9]*\.?[0-9]+))?$/i);
  if (silentOnly) {
    return [{
      caption: '',
      tts: '',
      explicitTts: false,
      silent: true,
      ...(silentOnly[1] ? { duration: parseNumberField('silent duration', silentOnly[1], 0.1) } : {}),
    }];
  }
  const lines = content.split('\n');
  const hasBullets = lines.some(line => /^\s*-\s+/.test(line));
  if (!hasBullets) {
    const single = parseSingleBeatBlock(content, glossary);
    return single ? [single] : [];
  }
  const beats: AuthoredBeat[] = [];
  let current: RawBeatFields | null = null;
  let activeField: 'caption' | 'tts' = 'caption';
  const flush = () => {
    if (!current) return;
    const beat = finalizeBeat(current, glossary);
    if (beat) beats.push(beat);
    current = null;
  };
  for (const rawLine of lines) {
    const bullet = rawLine.match(/^\s*-\s+(.*)$/);
    if (bullet) {
      flush();
      current = { captionLines: [], ttsLines: [] };
      activeField = 'caption';
      if (bullet[1]!.trim()) activeField = ingestBeatLine(current, bullet[1]!, activeField);
      continue;
    }
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (!current) current = { captionLines: [], ttsLines: [] };
    activeField = ingestBeatLine(current, line, activeField);
  }
  flush();
  return beats;
}

/** Extract ordered narration beats from `<!-- beat: ... -->` and `<!-- narration: ... -->` comments outside code fences. */
export function parseSlideNarration(slideBody: string, glossary?: Record<string, string>): AuthoredBeat[] {
  const lineOffsets = [0];
  for (let i = 0; i < slideBody.length; i++) if (slideBody[i] === '\n') lineOffsets.push(i + 1);
  const codeRanges = slideParser.parse(slideBody, {})
    .filter(token => ['fence', 'code_block'].includes(token.type) && token.map)
    .map(token => [lineOffsets[token.map![0]]!, lineOffsets[token.map![1]] ?? slideBody.length] as const);
  const inCode = (offset: number) => codeRanges.some(([start, end]) => offset >= start && offset < end);

  const beats: AuthoredBeat[] = [];
  for (const match of slideBody.matchAll(/<!--([\s\S]*?)-->/g)) {
    const offset = match.index ?? 0;
    if (inCode(offset)) continue;
    const inner = match[1]!.trim();
    const beatMatch = inner.match(/^beat\s*:\s*([\s\S]*)$/i);
    if (beatMatch) {
      const beat = parseSingleBeatBlock(beatMatch[1]!, glossary);
      if (beat) beats.push(beat);
      continue;
    }
    const narrationMatch = inner.match(/^narration\s*:\s*([\s\S]*)$/i);
    if (narrationMatch) {
      beats.push(...parseNarrationBlock(narrationMatch[1]!, glossary));
    }
  }
  return beats;
}

/** Runtime transport resolution for `xarp narrate` (never used in `computeClipHash`). */
export function resolveTtsRuntime(tts?: NarrationTtsOptions) {
  const provider = tts?.provider ?? (tts?.command?.length ? 'command' : (tts?.url || process.env.XARP_TTS_URL) ? 'http' : 'say');
  const url = tts?.url ?? process.env.XARP_TTS_URL ?? '';
  const voice = tts?.voice ?? process.env.XARP_TTS_VOICE ?? '';
  const model = tts?.model ?? process.env.XARP_TTS_MODEL ?? '';
  const speed = tts?.speed ?? 1;
  const promptSuffix = (provider === 'http' || provider === 'command') ? (tts?.promptSuffix ?? '') : '';
  const body = tts?.body ?? null;
  return { provider, url, voice, model, speed, promptSuffix, body };
}

/**
 * Deterministic, environment-independent clip hash so `xarp build` / `xarp dev` in any shell or CI
 * always resolves clips previously synthesized by `xarp narrate`.
 */
export function computeClipHash(ttsText: string, tts?: NarrationTtsOptions): string {
  return hash(JSON.stringify({
    v: 2,
    voice: tts?.voice ?? 'default',
    model: tts?.model ?? '',
    speed: tts?.speed ?? 1,
    format: tts?.format ?? 'auto',
    normalize: tts?.normalize !== false,
    trimFillerTail: tts?.trimFillerTail === true,
    promptSuffix: tts?.promptSuffix ?? '',
    command: tts?.command ?? null,
    body: tts?.body ?? null,
    text: ttsText,
  })).slice(0, 24);
}

/** Parse RIFF/WAVE header duration in seconds without external processes (including streaming size=0 WAVs). */
export function parseWavDuration(buf: Buffer): number | undefined {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return undefined;
  let byteRate = 0;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const payload = offset + 8;
    if (id === 'fmt ' && size >= 16 && payload + 16 <= buf.length) {
      byteRate = buf.readUInt32LE(payload + 8);
    } else if (id === 'data') {
      const remaining = Math.max(0, buf.length - payload);
      dataBytes = size === 0 || size === 0xffffffff ? remaining : Math.min(size, remaining);
      if (byteRate > 0) break;
    }
    if (size === 0 && id === 'data') break;
    offset = payload + size + (size % 2);
  }
  return byteRate > 0 && dataBytes > 0 ? dataBytes / byteRate : undefined;
}

function findMp4Atom(buf: Buffer, start: number, end: number, target: string): { payload: number; end: number } | undefined {
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    let header = 8;
    let atomEnd: number;
    if (size32 === 1) {
      if (offset + 16 > end) return undefined;
      header = 16;
      const bigSize = buf.readBigUInt64BE(offset + 8);
      if (bigSize > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
      atomEnd = offset + Number(bigSize);
    } else if (size32 === 0) {
      atomEnd = end;
    } else {
      if (size32 < 8) return undefined;
      atomEnd = offset + size32;
    }
    if (atomEnd > end || atomEnd <= offset) return undefined;
    if (type === target) return { payload: offset + header, end: atomEnd };
    offset = atomEnd;
  }
  return undefined;
}

/** Parse ISO BMFF (`m4a`/`mp4`) `moov -> mvhd` duration in seconds; fragmented streams fall through to `ffprobe`. */
export function parseMp4Duration(buf: Buffer): number | undefined {
  const moov = findMp4Atom(buf, 0, buf.length, 'moov');
  if (!moov) return undefined;
  const mvhd = findMp4Atom(buf, moov.payload, moov.end, 'mvhd');
  if (!mvhd || mvhd.payload + 20 > mvhd.end) return undefined;
  const version = buf[mvhd.payload];
  if (version === 0) {
    const timescale = buf.readUInt32BE(mvhd.payload + 12);
    const duration = buf.readUInt32BE(mvhd.payload + 16);
    return timescale > 0 && duration > 0 ? duration / timescale : undefined;
  }
  if (version === 1 && mvhd.payload + 32 <= mvhd.end) {
    const timescale = buf.readUInt32BE(mvhd.payload + 20);
    const duration = Number(buf.readBigUInt64BE(mvhd.payload + 24));
    return timescale > 0 && duration > 0 ? duration / timescale : undefined;
  }
  return undefined;
}

export async function probeAudioDuration(filePath: string): Promise<number> {
  const buf = await readFile(filePath);
  const ext = extname(filePath).toLowerCase();
  if (ext === '.wav') {
    const dur = parseWavDuration(buf);
    if (dur !== undefined && dur > 0) return r3(dur);
  }
  if (ext === '.m4a' || ext === '.mp4') {
    const dur = parseMp4Duration(buf);
    if (dur !== undefined && dur > 0) return r3(dur);
  }
  const fastFallback = parseWavDuration(buf) ?? parseMp4Duration(buf);
  if (fastFallback !== undefined && fastFallback > 0) return r3(fastFallback);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', filePath]);
  const parsed = Number(stdout.trim());
  requireValue(Number.isFinite(parsed) && parsed > 0, `Could not determine audio duration for ${filePath}`);
  return r3(parsed);
}

/**
 * Trim leading/trailing silence (and optional opt-in filler-tail bursts) on PCM or IEEE-float WAV buffers.
 */
export function trimWavSilence(buf: Buffer, options: { thresholdDb?: number; trimFillerTail?: boolean } = {}): Buffer {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return buf;
  let audioFormat = 0, channels = 0, sampleRate = 0, blockAlign = 0, bitsPerSample = 0;
  let fmtChunk: Buffer | null = null;
  let dataStart = -1, dataLen = 0;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const payload = offset + 8;
    if (id === 'fmt ' && size >= 16 && payload + size <= buf.length) {
      audioFormat = buf.readUInt16LE(payload);
      channels = buf.readUInt16LE(payload + 2);
      sampleRate = buf.readUInt32LE(payload + 4);
      blockAlign = buf.readUInt16LE(payload + 12);
      bitsPerSample = buf.readUInt16LE(payload + 14);
      fmtChunk = buf.subarray(offset, payload + size + (size % 2));
    } else if (id === 'data' && payload <= buf.length) {
      dataStart = payload;
      const remaining = Math.max(0, buf.length - payload);
      dataLen = size === 0 || size === 0xffffffff ? remaining : Math.min(size, remaining);
      break;
    }
    offset = payload + size + (size % 2);
  }
  if (!fmtChunk || dataStart < 0 || channels < 1 || sampleRate < 1000 || blockAlign < 1) return buf;
  const isPcm = audioFormat === 1 && (bitsPerSample === 16 || bitsPerSample === 24 || bitsPerSample === 32);
  const isFloat = audioFormat === 3 && bitsPerSample === 32;
  if (!isPcm && !isFloat) return buf;

  const totalFrames = Math.floor(dataLen / blockAlign);
  if (totalFrames < sampleRate * 0.2) return buf;
  const bytesPerSample = bitsPerSample / 8;

  const sampleAt = (frame: number, ch: number): number => {
    const p = dataStart + frame * blockAlign + ch * bytesPerSample;
    if (isFloat) return buf.readFloatLE(p);
    if (bitsPerSample === 16) return buf.readInt16LE(p) / 32768;
    if (bitsPerSample === 24) {
      const v = buf.readUInt8(p) | (buf.readUInt8(p + 1) << 8) | (buf.readInt8(p + 2) << 16);
      return v / 8388608;
    }
    return buf.readInt32LE(p) / 2147483648;
  };

  const winFrames = Math.max(1, Math.floor(sampleRate * 0.01)); // 10 ms windows
  const numWins = Math.floor(totalFrames / winFrames);
  if (numWins < 10) return buf;

  const threshold = Math.pow(10, (options.thresholdDb ?? -42) / 20);
  const voiced = new Uint8Array(numWins);
  for (let w = 0; w < numWins; w++) {
    let sumSq = 0;
    const f0 = w * winFrames;
    for (let f = 0; f < winFrames; f++) {
      let mono = 0;
      for (let c = 0; c < channels; c++) mono += sampleAt(f0 + f, c);
      mono /= channels;
      sumSq += mono * mono;
    }
    if (Math.sqrt(sumSq / winFrames) >= threshold) voiced[w] = 1;
  }

  let firstVoiced = -1, lastVoiced = -1;
  for (let w = 0; w < numWins; w++) {
    if (voiced[w]) {
      if (firstVoiced < 0) firstVoiced = w;
      lastVoiced = w;
    }
  }
  if (firstVoiced < 0) return buf;

  if (options.trimFillerTail === true && numWins >= 120) {
    let endW = lastVoiced;
    while (endW > Math.floor(numWins * 0.6)) {
      let burstStart = endW;
      while (burstStart > 0 && voiced[burstStart - 1]) burstStart--;
      const burstWins = endW - burstStart + 1;
      let silenceStart = burstStart;
      while (silenceStart > 0 && !voiced[silenceStart - 1]) silenceStart--;
      const gapWins = burstStart - silenceStart;
      if (gapWins >= 28 && burstWins <= 110 && silenceStart > firstVoiced + 20) {
        endW = silenceStart - 1;
        while (endW > firstVoiced && !voiced[endW]) endW--;
      } else {
        break;
      }
    }
    lastVoiced = endW;
  }

  const startFrame = Math.max(0, (firstVoiced - 3) * winFrames);
  const endFrame = Math.min(totalFrames, (lastVoiced + 8) * winFrames);
  if (endFrame <= startFrame) return buf;

  const sliceBytes = (endFrame - startFrame) * blockAlign;
  const pad = sliceBytes % 2;
  const out = Buffer.allocUnsafe(12 + fmtChunk.length + 8 + sliceBytes + pad);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(out.length - 8, 4);
  out.write('WAVE', 8, 'ascii');
  fmtChunk.copy(out, 12);
  const dataHeaderOffset = 12 + fmtChunk.length;
  out.write('data', dataHeaderOffset, 'ascii');
  out.writeUInt32LE(sliceBytes, dataHeaderOffset + 4);
  buf.copy(out, dataHeaderOffset + 8, dataStart + startFrame * blockAlign, dataStart + endFrame * blockAlign);
  if (pad) out[out.length - 1] = 0;
  return out;
}

function tokenizeForAsr(text: string): string[] {
  const lower = text.normalize('NFKC').toLowerCase();
  const tokens: string[] = [];
  for (const match of lower.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+/gu)) {
    tokens.push(match[0]);
  }
  return tokens;
}

/** Normalized multilingual token/character edit rate `[0..1+]` for ASR verification. */
export function computeAsrErrorRate(expectedText: string, actualTranscript: string): number {
  const expected = tokenizeForAsr(expectedText);
  const actual = tokenizeForAsr(actualTranscript);
  if (expected.length === 0) return actual.length === 0 ? 0 : 1;
  const prev = new Uint32Array(actual.length + 1);
  const curr = new Uint32Array(actual.length + 1);
  for (let j = 0; j <= actual.length; j++) prev[j] = j;
  for (let i = 1; i <= expected.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= actual.length; j++) {
      const cost = expected[i - 1] === actual[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev.set(curr);
  }
  return r3(prev[actual.length]! / expected.length);
}

export interface SlideNarrationInput {
  id: string;
  body: string;
  title: string;
  fragmentCount: number;
}

export interface CustomAudioAssetInfo {
  duration: number;
  contentHash: string;
}

export interface BuildTimelineInput {
  viewId: string;
  deckTitle: string;
  slides: SlideNarrationInput[];
  sections?: Section[];
  options?: NarrationOptions;
  cache?: NarrationCache;
  customAudio?: Map<string, CustomAudioAssetInfo>;
  vttUrl: string;
}

export function validateNarrationOptions(opts: NarrationOptions) {
  if (opts.defaultSlideDuration !== undefined) {
    requireValue(Number.isFinite(opts.defaultSlideDuration) && opts.defaultSlideDuration >= 0.1, 'narration.defaultSlideDuration must be >= 0.1');
  }
  if (opts.beatPause !== undefined) {
    requireValue(Number.isFinite(opts.beatPause) && opts.beatPause >= 0, 'narration.beatPause must be >= 0');
  }
  if (opts.slideLeadIn !== undefined) {
    requireValue(Number.isFinite(opts.slideLeadIn) && opts.slideLeadIn >= 0, 'narration.slideLeadIn must be >= 0');
  }
  if (opts.tts?.speed !== undefined) {
    requireValue(Number.isFinite(opts.tts.speed) && opts.tts.speed > 0, 'narration.tts.speed must be > 0');
  }
  if (opts.tts?.verify?.maxErrorRate !== undefined) {
    requireValue(Number.isFinite(opts.tts.verify.maxErrorRate) && opts.tts.verify.maxErrorRate >= 0 && opts.tts.verify.maxErrorRate <= 1, 'narration.tts.verify.maxErrorRate must be in [0, 1]');
  }
}

export function buildNarrationTimeline(input: BuildTimelineInput): {
  timeline: NarrationTimeline;
  referencedClips: Map<string, string>;
  referencedCustomAudio: Map<string, string>;
} {
  const opts = input.options ?? {};
  validateNarrationOptions(opts);
  const defaultSlideDur = opts.defaultSlideDuration ?? 2.4;
  const defaultPause = opts.beatPause ?? 0.32;
  const slideLeadIn = opts.slideLeadIn ?? 0.14;
  const glossary = opts.glossary;

  const sectionForSlide: { index: number; label: string }[] = [];
  if (input.sections?.length) {
    for (const [secIdx, sec] of input.sections.entries()) {
      for (let k = 0; k < sec.count; k++) sectionForSlide.push({ index: secIdx, label: sec.label });
    }
  }

  const referencedClips = new Map<string, string>();
  const referencedCustomAudio = new Map<string, string>();
  const timelineSlides: NarrationTimelineSlide[] = [];

  let cursor = 0;
  let globalBeatIndex = 0;
  let spokenBeatCount = 0;
  let synthesizedCount = 0;

  for (const [slideIndex, slide] of input.slides.entries()) {
    const authored = parseSlideNarration(slide.body, glossary);
    let effectiveBeats: AuthoredBeat[];
    if (authored.length > 0) {
      effectiveBeats = authored;
    } else if (slide.fragmentCount > 0) {
      const stepHold = Math.max(1.2, r3(defaultSlideDur * 0.75));
      effectiveBeats = Array.from({ length: slide.fragmentCount + 1 }, (_, step) => ({
        caption: '',
        tts: '',
        explicitTts: false,
        silent: true,
        duration: stepHold,
        step,
      }));
    } else {
      effectiveBeats = [{
        caption: '',
        tts: '',
        explicitTts: false,
        silent: true,
        duration: defaultSlideDur,
        step: 0,
      }];
    }

    const slideStart = r3(cursor);
    const slideBeats: NarrationTimelineBeat[] = [];

    for (const [beatIndex, beat] of effectiveBeats.entries()) {
      const beatStart = r3(cursor);
      const isSilentBeat = beat.silent && !beat.audio;
      const leadIn = beatIndex === 0 && !isSilentBeat ? slideLeadIn : 0;
      const pause = beat.pause ?? (isSilentBeat ? 0 : defaultPause);
      const step = beat.step ?? beatIndex;

      let clipHash: string | undefined;
      let clipUrl: string | undefined;
      let clipDuration = 0;
      let synthesized = false;

      if (beat.audio) {
        const customInfo = input.customAudio?.get(beat.audio);
        if (customInfo && customInfo.duration > 0) {
          const ext = extname(beat.audio).toLowerCase() || '.m4a';
          const customKey = `custom-${customInfo.contentHash.slice(0, 20)}${ext}`;
          clipUrl = `_xarp/narration/clips/${customKey}`;
          referencedCustomAudio.set(beat.audio, clipUrl);
          clipDuration = r3(customInfo.duration);
          synthesized = true;
        } else {
          clipDuration = beat.duration ?? estimateSpeechDuration(beat.caption || beat.tts);
        }
        spokenBeatCount++;
        if (synthesized) synthesizedCount++;
      } else if (!isSilentBeat && beat.tts) {
        spokenBeatCount++;
        clipHash = computeClipHash(beat.tts, opts.tts);
        const cached = input.cache?.clips[clipHash];
        if (cached && cached.duration > 0) {
          clipDuration = r3(cached.duration);
          const ext = extname(cached.file).toLowerCase() || '.m4a';
          clipUrl = `_xarp/narration/clips/${clipHash}${ext}`;
          referencedClips.set(clipHash, cached.file);
          synthesized = true;
          synthesizedCount++;
        } else {
          clipDuration = beat.duration ?? estimateSpeechDuration(beat.tts);
        }
      }

      const minDur = beat.duration ?? 0;
      const silentDur = beat.duration ?? (beat.pause !== undefined && beat.pause > 0 ? beat.pause : defaultSlideDur);
      const totalDur = isSilentBeat
        ? r3(Math.max(0.1, silentDur))
        : r3(Math.max(minDur, leadIn + clipDuration + pause));
      const beatEnd = r3(beatStart + totalDur);
      cursor = beatEnd;

      slideBeats.push({
        index: beatIndex,
        globalIndex: globalBeatIndex++,
        slideIndex,
        step,
        ...(beat.seg !== undefined ? { seg: beat.seg } : {}),
        ...(beat.fit !== undefined ? { fit: beat.fit } : {}),
        ...(beat.zoom !== undefined ? { zoom: beat.zoom } : {}),
        ...(beat.focus !== undefined ? { focus: beat.focus } : {}),
        ...(beat.spotlight !== undefined ? { spotlight: beat.spotlight } : {}),
        caption: beat.caption,
        tts: beat.tts,
        silent: isSilentBeat,
        synthesized,
        start: beatStart,
        end: beatEnd,
        duration: totalDur,
        clipStart: r3(beatStart + leadIn),
        clipDuration,
        pause: r3(pause),
        ...(clipHash ? { clipHash } : {}),
        ...(clipUrl ? { clipUrl } : {}),
        ...(beat.cue && beat.cue !== 'none' ? { cue: beat.cue } : {}),
      });
    }

    const secInfo = sectionForSlide[slideIndex];
    const slideEnd = r3(cursor);
    timelineSlides.push({
      index: slideIndex,
      number: slideIndex + 1,
      id: slide.id,
      title: slide.title || `Slide ${slideIndex + 1}`,
      ...(secInfo ? { section: secInfo.label, sectionIndex: secInfo.index } : {}),
      fragmentCount: slide.fragmentCount,
      start: slideStart,
      end: slideEnd,
      duration: r3(slideEnd - slideStart),
      beats: slideBeats,
    });
  }

  const timelineSections: NarrationTimelineSection[] = [];
  if (input.sections?.length) {
    let startIdx = 0;
    for (const [secIdx, sec] of input.sections.entries()) {
      const slice = timelineSlides.slice(startIdx, startIdx + sec.count);
      if (slice.length > 0) {
        timelineSections.push({
          index: secIdx,
          label: sec.label,
          start: slice[0]!.start,
          end: slice.at(-1)!.end,
          slideNumbers: slice.map(item => item.number),
        });
      }
      startIdx += sec.count;
    }
  }

  const timeline: NarrationTimeline = {
    version: 1,
    viewId: input.viewId,
    title: input.deckTitle || 'Presentation',
    duration: r3(cursor),
    beatCount: globalBeatIndex,
    spokenBeatCount,
    synthesizedCount,
    hasAudio: synthesizedCount > 0,
    vttUrl: input.vttUrl,
    sections: timelineSections,
    slides: timelineSlides,
  };

  return { timeline, referencedClips, referencedCustomAudio };
}

function formatVttTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = (totalMs % 60000) / 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`;
}

function escapeVttText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatWebVtt(timeline: NarrationTimeline): string {
  const captionedBeats = timeline.slides.flatMap(slide => slide.beats.filter(beat => beat.caption.length > 0));
  const blocks = captionedBeats.map((beat, idx) => {
    const nextStart = idx + 1 < captionedBeats.length ? captionedBeats[idx + 1]!.start - 0.02 : timeline.duration;
    const end = Math.max(beat.start + 0.1, Math.min(beat.end, nextStart));
    return `${idx + 1}\n${formatVttTimestamp(beat.start)} --> ${formatVttTimestamp(end)}\n${escapeVttText(beat.caption)}\n`;
  });
  return `WEBVTT\n\n${blocks.join('\n')}`;
}

export function extractNarrationOptions(options: BuildOptions): NarrationOptions {
  const plugin = options.plugins?.find(item => item.name === 'narration') as (Record<symbol, unknown> | undefined);
  const fromPlugin = (plugin?.[NARRATION_BUILD_OPTIONS] as NarrationOptions | undefined) ?? {};
  const merged: NarrationOptions = { ...fromPlugin, ...(options.narration ?? {}) };
  validateNarrationOptions(merged);
  return merged;
}

export async function resolveNarrationDir(cwd: string, output: string, dirOption?: string): Promise<string> {
  const rel = (dirOption ?? 'narration').trim();
  requireValue(rel.length > 0 && !rel.startsWith('.') && !rel.split(/[\\/]/).some(p => p === '..' || p.startsWith('.')), 'Narration cache directory must be a non-hidden project-relative path');
  let dir = resolve(cwd, rel);
  requireValue(dir !== cwd && isWithin(cwd, dir), 'Narration directory must stay inside the project');
  requireValue(!isWithin(dir, output) && !isWithin(output, dir), 'Narration directory must not overlap the output directory');
  if (await pathExists(dir)) {
    const canonicalDir = await realpath(dir);
    requireValue(canonicalDir !== cwd && isWithin(cwd, canonicalDir), 'Narration directory symlink is outside the project');
    requireValue(!isWithin(canonicalDir, output) && !isWithin(output, canonicalDir), 'Narration directory must not overlap the output directory');
    return canonicalDir;
  }
  let ancestor = dirname(dir);
  while (!await pathExists(ancestor)) ancestor = dirname(ancestor);
  const canonicalAncestor = await realpath(ancestor);
  requireValue(isWithin(cwd, canonicalAncestor), 'Narration directory symlink is outside the project');
  dir = resolve(canonicalAncestor, relative(ancestor, dir));
  requireValue(dir !== cwd && isWithin(cwd, dir) && !isWithin(dir, output) && !isWithin(output, dir), 'Narration directory must stay inside the project');
  return dir;
}

export async function loadNarrationCache(cacheDir: string): Promise<NarrationCache> {
  const indexPath = join(cacheDir, 'cache.json');
  if (!await pathExists(indexPath)) return { version: 1, clips: Object.create(null) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(indexPath, 'utf8'));
  } catch {
    return { version: 1, clips: Object.create(null) };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { version: 1, clips: Object.create(null) };
  const rawClips = (parsed as { clips?: unknown }).clips;
  if (!rawClips || typeof rawClips !== 'object' || Array.isArray(rawClips)) return { version: 1, clips: Object.create(null) };
  const clips: Record<string, CachedClipRecord> = Object.create(null);
  const realCache = await realpath(cacheDir);
  for (const [key, entry] of Object.entries(rawClips as Record<string, unknown>)) {
    if (!/^[a-f0-9]{12,64}$/.test(key) || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rec = entry as Partial<CachedClipRecord>;
    if (typeof rec.file !== 'string' || rec.file.split(/[\\/]/).some(p => p === '..' || p.startsWith('.'))) continue;
    const rawFull = resolve(realCache, rec.file);
    if (!await pathExists(rawFull)) continue;
    try {
      const full = await realpath(rawFull);
      if (!isWithin(realCache, full)) continue;
      const info = await stat(full);
      if (!info.isFile() || info.size === 0) continue;
      const duration = typeof rec.duration === 'number' && Number.isFinite(rec.duration) && rec.duration > 0
        ? rec.duration
        : await probeAudioDuration(full);
      clips[key] = {
        hash: key,
        file: rec.file.split('\\').join('/'),
        duration,
        caption: typeof rec.caption === 'string' ? rec.caption : '',
        tts: typeof rec.tts === 'string' ? rec.tts : '',
        provider: typeof rec.provider === 'string' ? rec.provider : 'unknown',
        ...(typeof rec.voice === 'string' && rec.voice ? { voice: rec.voice } : {}),
        speed: typeof rec.speed === 'number' && Number.isFinite(rec.speed) ? rec.speed : 1,
        updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : new Date(0).toISOString(),
        ...(typeof rec.asrTranscript === 'string' ? { asrTranscript: rec.asrTranscript } : {}),
        ...(typeof rec.asrErrorRate === 'number' ? { asrErrorRate: rec.asrErrorRate } : {}),
      };
    } catch {
      continue;
    }
  }
  return { version: 1, clips };
}
