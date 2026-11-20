import type { ColorScheme } from './color-schemes.js';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

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

export interface BuildResult {
  output: string;
  htmlPath: string;
  metadata: EditorMetadata;
}
