import { hydrateSvgMarks } from '../../themes/chao-ui/marks.js';
import { contentSections } from '../slide-dom.js';

const pendingSections = new Set();
let idleHandle = 0;
let idleIsRic = false;
let observerInstalled = false;

function hydrateSection(section) {
  if (!section) return;
  for (const svg of section.querySelectorAll('svg')) {
    if (svg.__pfMarkSnapshots || svg.querySelector('[data-pf-mark]')) {
      hydrateSvgMarks(svg, section);
    }
  }
}

function cancelMarkIdle() {
  if (!idleHandle) return;
  if (idleIsRic && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle);
  else clearTimeout(idleHandle);
  idleHandle = 0;
}

function scheduleMarkIdle() {
  if (idleHandle || pendingSections.size === 0) return;
  const step = (deadline) => {
    idleHandle = 0;
    let count = 0;
    for (const section of pendingSections) {
      pendingSections.delete(section);
      if (section.isConnected) hydrateSection(section);
      count++;
      if (count >= 2 && (!deadline || deadline.timeRemaining() < 4)) break;
    }
    if (pendingSections.size > 0) scheduleMarkIdle();
  };
  if (typeof requestIdleCallback === 'function') {
    idleIsRic = true;
    idleHandle = requestIdleCallback(step, { timeout: 180 });
  } else {
    idleIsRic = false;
    idleHandle = setTimeout(step, 16);
  }
}

function installActiveSlideObserver() {
  if (observerInstalled || typeof MutationObserver === 'undefined') return;
  const slides = document.querySelectorAll('svg[data-marpit-svg]');
  if (!slides.length) return;
  observerInstalled = true;
  const obs = new MutationObserver((records) => {
    for (const rec of records) {
      const slide = rec.target;
      if (!slide.classList?.contains('bespoke-marp-active')) continue;
      for (const section of slide.querySelectorAll('section')) {
        if (pendingSections.delete(section)) hydrateSection(section);
      }
    }
  });
  for (const slide of slides) obs.observe(slide, { attributes: true, attributeFilter: ['class'] });
}

export function syncSlideMarks(scope = document) {
  if (scope !== document) {
    pendingSections.delete(scope);
    hydrateSection(scope);
    return;
  }
  cancelMarkIdle();
  pendingSections.clear();
  installActiveSlideObserver();
  const hasActive = Boolean(document.querySelector('svg.bespoke-marp-active'));
  for (const section of contentSections(document)) {
    if (!section) continue;
    let hasMarks = false;
    for (const svg of section.querySelectorAll('svg')) {
      if (svg.__pfMarkSnapshots || svg.querySelector('[data-pf-mark]')) { hasMarks = true; break; }
    }
    if (!hasMarks) continue;
    if (!hasActive || section.closest('svg.bespoke-marp-active')) hydrateSection(section);
    else pendingSections.add(section);
  }
  scheduleMarkIdle();
}

if (!window.__xarpMarksHydrator) {
  window.__xarpMarksHydrator = syncSlideMarks;
  syncSlideMarks();
}
