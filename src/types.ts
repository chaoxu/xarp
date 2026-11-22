import type { ColorScheme } from './color-schemes.js';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type SoundCueKind = 'chime' | 'brush' | 'thud' | 'none';

export interface NarrationVerifyOptions {
  /** HTTP ASR endpoint (multipart file -> JSON `{ text }`) or read from `XARP_ASR_URL`. */
  url?: string;
  /** Local command receiving `XARP_ASR_AUDIO` in env and printing transcribed text to stdout. */
  command?: string[];
  /** Maximum normalized token/character edit-distance rate `[0..1]` before retrying. Defaults to `0.35`. */
  maxErrorRate?: number;
  /** Extra synthesis retries when stochastic TTS fails ASR verification. Defaults to `2`. */
  retries?: number;
}

export interface NarrationTtsOptions {
  /** Synthesis backend: `'http'` (POST JSON -> audio), `'openai'` (`/v1/audio/speech`), `'say'` (macOS), or `'command'`. */
  provider?: 'http' | 'openai' | 'say' | 'command';
  /** Endpoint URL, or read from `XARP_TTS_URL`. */
  url?: string;
  /** Voice identifier, or read from `XARP_TTS_VOICE`. */
  voice?: string;
  /** Model identifier for OpenAI-compatible endpoints, or read from `XARP_TTS_MODEL`. */
  model?: string;
  /** Speech rate multiplier. Defaults to `1.0`. */
  speed?: number;
  /** Extra JSON fields merged into `'http'` provider requests (e.g. `{ nfe_step: 32 }`). */
  body?: Record<string, JsonValue>;
  /** Optional suffix appended to TTS prompt to prevent neural TTS tail clipping (e.g. `' 。。。'`). */
  promptSuffix?: string;
  /** Command argv for `provider: 'command'` (receives `XARP_TTS_TEXT` and `XARP_TTS_OUT` env vars). */
  command?: string[];
  /** Cached clip container format (`'m4a'` when `ffmpeg` is available, otherwise `'wav'`). */
  format?: 'm4a' | 'wav';
  /** Trim silence and normalize loudness (`-16 LUFS` when `ffmpeg` is installed). Defaults to `true`. */
  normalize?: boolean;
  /** Trim isolated short filler bursts after a long trailing pause (e.g. from neural TTS prompt suffixes). Defaults to `false`. */
  trimFillerTail?: boolean;
  /** Optional ASR round-trip check for synthesized clips. */
  verify?: NarrationVerifyOptions;
}

export interface NarrationViewerOptions {
  /** Show subtitles by default in Watch Mode. Defaults to `true`. */
  captions?: boolean;
  /** Show Chapters and Transcript sidebar by default in Watch Mode. Defaults to `true`. */
  sidebar?: boolean;
  /** Play subtle Web Audio transition cues by default in Watch Mode. Defaults to `false`. */
  cues?: boolean;
}

export interface NarrationOptions extends NarrationViewerOptions {
  /** Project-relative directory storing content-addressed per-beat clips. Defaults to `'narration'`. */
  dir?: string;
  /** Hold duration in seconds for silent slides or un-narrated fragment steps. Defaults to `2.4`. */
  defaultSlideDuration?: number;
  /** Pause after each spoken beat in seconds. Defaults to `0.32`. */
  beatPause?: number;
  /** Lead-in before the first beat of each slide in seconds. Defaults to `0.14`. */
  slideLeadIn?: number;
  /** Pronunciation lexicon applied to spoken text (supports Unicode and bilingual CJK). */
  glossary?: Record<string, string>;
  /** Synthesis configuration used by `xarp narrate` and deterministic clip hashing. */
  tts?: NarrationTtsOptions;
}

export interface Plugin {
  name: string;
  styles?: URL[];
  scripts?: URL[];
  data?: JsonValue;
}

export interface Section {
  label: string;
  count: number;
}

export interface BuildOptions {
  input: string;
  /** Resolve project paths relative to this directory. Defaults to the current directory. */
  cwd?: string;
  output?: string;
  /** A registered theme name or a project-relative CSS file. */
  theme?: string;
  /** A bundled semantic color scheme. Independent of the Marp theme. */
  colorScheme?: ColorScheme;
  slides?: string[];
  sections?: Section[];
  assets?: string[];
  plugins?: Plugin[];
  /** Build and synthesis configuration for narrated decks (kept out of browser metadata). */
  narration?: NarrationOptions;
}

export interface EditorMetadata {
  /** Opaque project identity for browser-local state. */
  deckId?: string;
  viewId: string;
  sourceFile: string;
  sourceRevision: string;
  buildRevision: string;
  slides: string[];
  /** Explicit IDs survive structural edits; generated keys are revision-scoped. */
  slideKeys?: string[];
  editable: boolean;
  editingError?: string;
}

export interface NarrationTimelineBeat {
  index: number;
  globalIndex: number;
  slideIndex: number;
  step: number;
  seg?: number;
  fit?: boolean;
  caption: string;
  tts: string;
  silent: boolean;
  synthesized: boolean;
  start: number;
  end: number;
  duration: number;
  clipStart: number;
  clipDuration: number;
  pause: number;
  clipHash?: string;
  clipUrl?: string;
  cue?: SoundCueKind;
}

export interface NarrationTimelineSlide {
  index: number;
  number: number;
  id: string;
  title: string;
  section?: string;
  sectionIndex?: number;
  fragmentCount: number;
  start: number;
  end: number;
  duration: number;
  beats: NarrationTimelineBeat[];
}

export interface NarrationTimelineSection {
  index: number;
  label: string;
  start: number;
  end: number;
  slideNumbers: number[];
}

export interface NarrationTimeline {
  version: 1;
  viewId: string;
  title: string;
  duration: number;
  beatCount: number;
  spokenBeatCount: number;
  synthesizedCount: number;
  hasAudio: boolean;
  vttUrl: string;
  sections: NarrationTimelineSection[];
  slides: NarrationTimelineSlide[];
}

export interface BuildResult {
  output: string;
  htmlPath: string;
  metadata: EditorMetadata;
  narration?: NarrationTimeline;
}
