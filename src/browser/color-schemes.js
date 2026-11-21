import { COLOR_SCHEMES, isColorScheme } from '../color-schemes.js';
import { syncSlideMarks } from './marks.js';

const meta = JSON.parse(document.getElementById('xarp-meta').textContent);
const options = meta.plugins['color-schemes'];
const root = document.documentElement;
let authored = root.dataset.xarpColorScheme ?? 'default';
const storageKey = 'xarp:palette:' + JSON.stringify([location.pathname, meta.deckId ?? meta.sourceFile, meta.viewId]);
const persist = options?.persist !== false;

let urlOverride = null;
try {
  const params = new URLSearchParams(location.search);
  const candidate = params.get('colorScheme') || params.get('style');
  if (isColorScheme(candidate)) urlOverride = candidate;
} catch { /* Query parsing is optional. */ }

let override = urlOverride;
if (!override && persist) {
  try { override = localStorage.getItem(storageKey); } catch { /* Storage is optional, including for local files. */ }
}

const picker = document.createElement('label');
picker.className = 'xarp-color-scheme-picker';
if (options?.open) picker.classList.add('is-open');
picker.append('Style');
const select = document.createElement('select');
select.setAttribute('aria-label', 'Color scheme');
select.title = 'Switch visual style (shortcut: S to open/close, C / Shift+C to cycle). Set colorScheme in the Markdown to share a deck default.';
picker.append(select);
document.body.append(picker);

function closePicker() {
  picker.classList.remove('is-open');
  if (document.activeElement === select) select.blur();
}

function togglePicker() {
  if (picker.classList.contains('is-open')) {
    closePicker();
  } else {
    picker.classList.add('is-open');
    try { select.focus({ preventScroll: true }); } catch { select.focus(); }
  }
}

const toast = document.createElement('div');
toast.className = 'xarp-color-scheme-toast';
toast.setAttribute('aria-live', 'polite');
document.body.append(toast);
let toastTimer = 0;

function showToast(scheme) {
  const entry = COLOR_SCHEMES.find(item => item.name === scheme);
  toast.textContent = `Colors: ${entry ? entry.label : scheme}`;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1500);
}

const pendingFrames = new Set();
let frameIdleHandle = 0;
let frameIdleIsRic = false;
let frameObserverInstalled = false;

function applyFrameScheme(frame, selected) {
  delete frame.__xarpPendingScheme;
  pendingFrames.delete(frame);
  try {
    if (frame.contentDocument?.documentElement) {
      if (selected === 'default') {
        delete frame.contentDocument.documentElement.dataset.xarpColorScheme;
        delete frame.contentDocument.documentElement.dataset.pfStyle;
      } else {
        frame.contentDocument.documentElement.dataset.xarpColorScheme = selected;
        frame.contentDocument.documentElement.dataset.pfStyle = selected;
      }
    }
    if (typeof frame.contentWindow?.__setXarpColorScheme === 'function') {
      frame.contentWindow.__setXarpColorScheme(selected);
    }
    if (typeof frame.contentWindow?.__setHrsStyle === 'function') {
      frame.contentWindow.__setHrsStyle(selected);
    }
    frame.contentWindow?.dispatchEvent(new CustomEvent('chao-theme-change', { detail: { scheme: selected } }));
  } catch { /* Cross-origin embeds keep their own document state. */ }
}

function cancelFrameIdle() {
  if (!frameIdleHandle) return;
  if (frameIdleIsRic && typeof cancelIdleCallback === 'function') cancelIdleCallback(frameIdleHandle);
  else clearTimeout(frameIdleHandle);
  frameIdleHandle = 0;
}

function scheduleFrameIdle() {
  if (frameIdleHandle || pendingFrames.size === 0) return;
  const step = (deadline) => {
    frameIdleHandle = 0;
    let count = 0;
    for (const frame of pendingFrames) {
      const pending = frame.__xarpPendingScheme;
      pendingFrames.delete(frame);
      if (pending !== undefined && frame.isConnected) applyFrameScheme(frame, pending);
      count++;
      if (count >= 2 && (!deadline || deadline.timeRemaining() < 4)) break;
    }
    if (pendingFrames.size > 0) scheduleFrameIdle();
  };
  if (typeof requestIdleCallback === 'function') {
    frameIdleIsRic = true;
    frameIdleHandle = requestIdleCallback(step, { timeout: 220 });
  } else {
    frameIdleIsRic = false;
    frameIdleHandle = setTimeout(step, 16);
  }
}

function installFrameSlideObserver() {
  if (frameObserverInstalled || typeof MutationObserver === 'undefined') return;
  const slides = document.querySelectorAll('svg[data-marpit-svg]');
  if (!slides.length) return;
  frameObserverInstalled = true;
  const obs = new MutationObserver((records) => {
    for (const rec of records) {
      const slide = rec.target;
      if (!slide.classList?.contains('bespoke-marp-active')) continue;
      for (const frame of slide.querySelectorAll('iframe')) {
        if (frame.__xarpPendingScheme !== undefined) applyFrameScheme(frame, frame.__xarpPendingScheme);
      }
    }
  });
  for (const slide of slides) obs.observe(slide, { attributes: true, attributeFilter: ['class'] });
}

function syncSlideFrames(selected) {
  cancelFrameIdle();
  pendingFrames.clear();
  installFrameSlideObserver();
  const hasActive = Boolean(document.querySelector('svg.bespoke-marp-active'));
  for (const frame of document.querySelectorAll('svg[data-marpit-svg] iframe')) {
    if (!hasActive || frame.closest('svg.bespoke-marp-active')) {
      applyFrameScheme(frame, selected);
    } else {
      frame.__xarpPendingScheme = selected;
      pendingFrames.add(frame);
    }
  }
  scheduleFrameIdle();
}

function currentSelected() {
  return isColorScheme(override) ? override : authored;
}

function persistOverride() {
  if (!persist) return;
  try {
    if (override) localStorage.setItem(storageKey, override);
    else localStorage.removeItem(storageKey);
  } catch { /* The selection still applies in this tab. */ }
}

function update() {
  const selected = currentSelected();
  if (selected === 'default') {
    delete root.dataset.xarpColorScheme;
    delete root.dataset.pfStyle;
  } else {
    root.dataset.xarpColorScheme = selected;
    root.dataset.pfStyle = selected;
  }
  select.value = isColorScheme(override) ? override : '';
  syncSlideMarks();
  syncSlideFrames(selected);
  window.dispatchEvent(new CustomEvent('chao-theme-change', { detail: { scheme: selected } }));
  window.dispatchEvent(new CustomEvent('xarp-color-scheme-change', {
    detail: { scheme: selected, authored, override: isColorScheme(override) ? override : null },
  }));
}

function setDefault(scheme) {
  authored = scheme;
  const label = COLOR_SCHEMES.find(palette => palette.name === scheme).label;
  const defaultOption = new Option(scheme === 'default' ? 'Deck default' : `Deck default · ${label}`, '');
  select.replaceChildren(defaultOption);
  const groups = new Map();
  for (const { label: optionLabel, name, group } of COLOR_SCHEMES) {
    if (!group) {
      select.add(new Option(optionLabel, name));
    } else {
      let og = groups.get(group);
      if (!og) {
        og = document.createElement('optgroup');
        og.label = group;
        groups.set(group, og);
        select.appendChild(og);
      }
      og.appendChild(new Option(optionLabel, name));
    }
  }
  update();
}
setDefault(authored);

for (const frame of document.querySelectorAll('svg[data-marpit-svg] iframe')) {
  frame.addEventListener('load', () => {
    const sel = currentSelected();
    const hasActive = Boolean(document.querySelector('svg.bespoke-marp-active'));
    if (!hasActive || frame.closest('svg.bespoke-marp-active')) {
      applyFrameScheme(frame, sel);
    } else {
      frame.__xarpPendingScheme = sel;
      pendingFrames.add(frame);
      scheduleFrameIdle();
    }
  });
}

select.addEventListener('change', () => {
  override = select.value || null;
  update();
  persistOverride();
});
select.addEventListener('keydown', event => {
  event.stopPropagation();
  if (event.key === 'Escape' || event.key === 'Enter' || event.key === 's' || event.key === 'S') {
    event.preventDefault();
    closePicker();
  }
});

document.addEventListener('pointerdown', event => {
  if (picker.classList.contains('is-open') && event.target && !picker.contains(event.target)) {
    closePicker();
  }
});

window.addEventListener('keydown', event => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
  if (document.body.classList.contains('xarp-drawing-active')) return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable || active.closest?.('[contenteditable="true"]'))) return;
  if (event.key === 's' || event.key === 'S') {
    event.preventDefault();
    togglePicker();
    return;
  }
  if (event.key === 'Escape' && picker.classList.contains('is-open')) {
    event.preventDefault();
    closePicker();
    return;
  }
  if (event.key !== 'c' && event.key !== 'C') return;
  event.preventDefault();
  const activeScheme = currentSelected();
  const idx = COLOR_SCHEMES.findIndex(item => item.name === activeScheme);
  const step = event.shiftKey ? -1 : 1;
  const next = COLOR_SCHEMES[(idx + step + COLOR_SCHEMES.length) % COLOR_SCHEMES.length].name;
  override = next === authored ? null : next;
  update();
  persistOverride();
  showToast(next);
});

if (persist) window.addEventListener('storage', event => {
  if (event.key === storageKey || event.key === null) {
    override = event.newValue;
    update();
  }
});
window.addEventListener('xarp-color-scheme-default', event => {
  if (isColorScheme(event.detail) && event.detail !== authored) setDefault(event.detail);
});
window.addEventListener('xarp-slide-patched', event => {
  syncSlideMarks(event.detail?.section || document);
});
