import { hydrateSvgMarks } from '../../themes/chao-ui/marks.js';
import { contentSections } from '../slide-dom.js';

export function syncSlideMarks(scope = document) {
  const sections = scope === document ? contentSections(document) : [scope];
  for (const section of sections) {
    if (!section) continue;
    for (const svg of section.querySelectorAll('svg')) {
      if (svg.__pfMarkSnapshots || svg.querySelector('[data-pf-mark]')) {
        hydrateSvgMarks(svg, section);
      }
    }
  }
}

if (!window.__xarpMarksHydrator) {
  window.__xarpMarksHydrator = syncSlideMarks;
  syncSlideMarks();
}
