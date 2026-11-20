import { COLOR_SCHEMES, isColorScheme } from '../color-schemes.js';

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
if (!options) picker.classList.add('xarp-editor-only');
picker.append('Colors');
const select = document.createElement('select');
select.setAttribute('aria-label', 'Color scheme');
select.title = 'Preview colors in this browser (shortcut: C / Shift+C). Set colorScheme in the Markdown to share a deck default.';
picker.append(select);
document.body.append(picker);

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

function syncSlideFrames(selected) {
  for (const frame of document.querySelectorAll('svg[data-marpit-svg] iframe')) {
    try {
      if (frame.contentDocument?.documentElement) {
        if (selected === 'default') delete frame.contentDocument.documentElement.dataset.xarpColorScheme;
        else frame.contentDocument.documentElement.dataset.xarpColorScheme = selected;
      }
      if (typeof frame.contentWindow?.__setXarpColorScheme === 'function') {
        frame.contentWindow.__setXarpColorScheme(selected);
      }
    } catch { /* Cross-origin embeds keep their own document state. */ }
  }
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
  if (selected === 'default') delete root.dataset.xarpColorScheme;
  else root.dataset.xarpColorScheme = selected;
  select.value = isColorScheme(override) ? override : '';
  syncSlideFrames(selected);
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
  frame.addEventListener('load', () => syncSlideFrames(currentSelected()));
}

select.addEventListener('change', () => {
  override = select.value || null;
  update();
  persistOverride();
});
select.addEventListener('keydown', event => {
  event.stopPropagation();
  if (event.key === 'Escape') select.blur();
});

window.addEventListener('keydown', event => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
  if (event.key !== 'c' && event.key !== 'C') return;
  if (!options && !document.body.classList.contains('xarp-edit-active')) return;
  if (document.body.classList.contains('xarp-drawing-active')) return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable || active.closest?.('[contenteditable="true"]'))) return;
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
