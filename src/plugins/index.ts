import type { NarrationOptions, NarrationViewerOptions, Plugin } from '../types.js';

const asset = (name: string) => new URL(`../browser/${name}`, import.meta.url);

export const NARRATION_BUILD_OPTIONS = Symbol.for('xarp.narration.buildOptions');

export interface EditingOptions {
  textSelectors?: string[];
  boxSelectors?: string[];
}

export function editing(options: EditingOptions = {}): Plugin {
  return {
    name: 'editing',
    styles: [asset('editing.css'), asset('color-schemes.css')],
    scripts: [asset('history.js'), asset('moveable.js'), asset('edit-mapping.js'), asset('editing.js'), asset('color-schemes.js')],
    data: { textSelectors: options.textSelectors ?? [], boxSelectors: options.boxSelectors ?? [] },
  };
}

export interface DrawingOptions {
  /** Remember SVG ink in this browser. Defaults to false. */
  persist?: boolean;
}

export function drawing(options: DrawingOptions = {}): Plugin {
  return { name: 'drawing', styles: [asset('drawing.css')], scripts: [asset('history.js'), asset('drawing.js')], data: { persist: options.persist ?? false } };
}

export interface ColorSchemesOptions {
  /** Remember a viewer's choice for this deck in local browser storage. Defaults to true. */
  persist?: boolean;
}

export function colorSchemes(options: ColorSchemesOptions = {}): Plugin {
  return {
    name: 'color-schemes',
    styles: [asset('color-schemes.css')],
    scripts: [asset('color-schemes.js')],
    data: { persist: options.persist ?? true },
  };
}

export type { NarrationOptions, NarrationViewerOptions };

export function narration(options: NarrationOptions = {}): Plugin {
  const viewerData = {
    captions: options.captions ?? true,
    sidebar: options.sidebar ?? true,
    cues: options.cues ?? false,
    launcher: options.launcher ?? false,
  };
  const plugin: Plugin = {
    name: 'narration',
    scripts: [asset('narration-boot.js')],
    data: viewerData,
  };
  Object.defineProperty(plugin, NARRATION_BUILD_OPTIONS, {
    value: options,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return plugin;
}
