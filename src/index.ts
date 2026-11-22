export { build } from './build.js';
export { dev } from './editor/server.js';
export { narrate } from './narrate.js';
export {
  applyGlossary,
  buildNarrationTimeline,
  cleanCaptionText,
  computeAsrErrorRate,
  computeClipHash,
  estimateSpeechDuration,
  formatWebVtt,
  normalizeSpeechText,
  parseMp4Duration,
  parseSlideNarration,
  parseWavDuration,
  probeAudioDuration,
  trimWavSilence,
} from './narration.js';
export { parseSource, selectSlides, updateSlideInSource } from './source.js';
export { COLOR_SCHEMES, isColorScheme } from './color-schemes.js';
export type {
  BuildOptions,
  BuildResult,
  EditorMetadata,
  JsonValue,
  NarrationOptions,
  NarrationTtsOptions,
  NarrationVerifyOptions,
  Plugin,
  Section,
  SoundCueKind,
} from './types.js';
export type { NarrateOptions, NarrateProgressEvent, NarrateResult } from './narrate.js';
export type {
  AuthoredBeat,
  CachedClipRecord,
  NarrationCache,
  NarrationTimeline,
  NarrationTimelineBeat,
  NarrationTimelineSection,
  NarrationTimelineSlide,
} from './narration.js';
export type { ColorScheme } from './color-schemes.js';
