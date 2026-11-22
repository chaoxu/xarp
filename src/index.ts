export { build } from './build.js';
export { dev } from './editor/server.js';
export { narrate } from './narrate.js';
export {
  buildNarrationTimeline,
  formatWebVtt,
  parseSlideNarration,
} from './narration.js';
export { parseSource, selectSlides, updateSlideInSource } from './source.js';
export { COLOR_SCHEMES, isColorScheme } from './color-schemes.js';
export type {
  BuildOptions,
  BuildResult,
  EditorMetadata,
  JsonValue,
  NarrationOptions,
  NarrationTimeline,
  NarrationTimelineBeat,
  NarrationTimelineSection,
  NarrationTimelineSlide,
  NarrationTtsOptions,
  NarrationVerifyOptions,
  NarrationViewerOptions,
  Plugin,
  Section,
  SoundCueKind,
} from './types.js';
export type { NarrateOptions, NarrateProgressEvent, NarrateResult } from './narrate.js';
export type {
  AuthoredBeat,
  CachedClipRecord,
  NarrationCache,
} from './narration.js';
export type { ColorScheme } from './color-schemes.js';
