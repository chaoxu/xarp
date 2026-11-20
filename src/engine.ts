import { Marp } from '@marp-team/marp-core';

type Token = { type: string; level: number; content: string; map: [number, number] | null };
export interface SlideMapping {
  breaks: [number, number][];
  frontmatter?: { end: number; content: string };
  comments: string[];
  colorScheme?: unknown;
}

export const engineOptions = { html: true, math: { lib: 'katex', katexFontPath: '_xarp/theme/vendor/katex/fonts/' } } as const;

/** The CLI and source editor use the same engine and block grammar. */
export function createEngine(options: ConstructorParameters<typeof Marp>[0] = {}) {
  const engine = Object.assign(new Marp({ ...engineOptions, ...options }), {
    xarpMapping: { breaks: [], comments: [] } as SlideMapping,
  });
  engine.customDirectives.global.colorScheme = value => {
    engine.xarpMapping.colorScheme = value;
    return {};
  };
  engine.use((md: any) => {
    md.core.ruler.after('block', 'xarp_slide_mapping', (state: { src: string; tokens: Token[]; inlineMode?: boolean }) => {
      // Header/footer inline parsing re-enters the core chain of this engine.
      if (state.inlineMode) return;
      const frontmatter = state.tokens.find(token => token.type === 'front_matter');
      const lines = state.src.split('\n');
      engine.xarpMapping = {
        breaks: state.tokens.filter(token => token.type === 'hr' && token.level === 0 && token.map)
          .map(token => [...token.map!] as [number, number]),
        frontmatter: frontmatter?.map ? { end: frontmatter.map[1], content: frontmatter.content } : undefined,
        comments: state.tokens.filter(token => token.map).flatMap(token => {
          const raw = lines.slice(token.map![0], token.map![1]).join('\n').trim();
          return raw.startsWith('<!--') && raw.endsWith('-->')
            ? [...raw.matchAll(/<!--([\s\S]*?)-->/g)].map(match => match[1]!) : [];
        }),
      };
    });
  });
  return engine;
}

export default createEngine;
