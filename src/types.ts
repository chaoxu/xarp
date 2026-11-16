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
  slides?: string[];
  sections?: Section[];
  assets?: string[];
  plugins?: Plugin[];
}

export interface EditorMetadata {
  viewId: string;
  sourceFile: string;
  sourceRevision: string;
  buildRevision: string;
  slides: string[];
  editable: boolean;
  editingError?: string;
}

export interface BuildResult {
  output: string;
  htmlPath: string;
  metadata: EditorMetadata;
}
