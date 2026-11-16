import type { Plugin } from '../types.js';

const asset = (name: string) => new URL(`../browser/${name}`, import.meta.url);

export interface EditingOptions {
  textSelectors?: string[];
  boxSelectors?: string[];
}

export function editing(options: EditingOptions = {}): Plugin {
  return {
    name: 'editing',
    styles: [asset('editing.css')],
    scripts: [asset('history.js'), asset('moveable.js'), asset('edit-mapping.js'), asset('editing.js')],
    data: { textSelectors: options.textSelectors ?? [], boxSelectors: options.boxSelectors ?? [] },
  };
}

export function drawing(): Plugin {
  return { name: 'drawing', styles: [asset('drawing.css')], scripts: [asset('history.js'), asset('drawing.js')] };
}
