import { COLOR_SCHEMES, isColorScheme } from '../color-schemes.js';

const meta = JSON.parse(document.getElementById('xarp-meta').textContent);
const options = meta.plugins['color-schemes'];
const root = document.documentElement;
let authored = root.dataset.xarpColorScheme ?? 'default';
const storageKey = 'xarp:palette:' + JSON.stringify([location.pathname, meta.deckId ?? meta.sourceFile, meta.viewId]);
const persist = options?.persist !== false;
let override = null;
if (persist) {
  try { override = localStorage.getItem(storageKey); } catch { /* Storage is optional, including for local files. */ }
}

const picker = document.createElement('label');
picker.className = 'xarp-color-scheme-picker';
if (!options) picker.classList.add('xarp-editor-only');
picker.append('Colors');
const select = document.createElement('select');
select.setAttribute('aria-label', 'Color scheme');
select.title = 'Preview colors in this browser. Set colorScheme in the Markdown to share a deck default.';
picker.append(select);
document.body.append(picker);

function update() {
  const selected = isColorScheme(override) ? override : authored;
  if (selected === 'default') delete root.dataset.xarpColorScheme;
  else root.dataset.xarpColorScheme = selected;
  select.value = isColorScheme(override) ? override : '';
}

function setDefault(scheme) {
  authored = scheme;
  const label = COLOR_SCHEMES.find(palette => palette.name === scheme).label;
  const defaultOption = new Option(scheme === 'default' ? 'Deck default' : `Deck default · ${label}`, '');
  select.replaceChildren(defaultOption);
  for (const { label, name } of COLOR_SCHEMES) select.add(new Option(label, name));
  update();
}
setDefault(authored);

select.addEventListener('change', () => {
  override = select.value || null;
  update();
  if (persist) {
    try {
      if (override) localStorage.setItem(storageKey, override);
      else localStorage.removeItem(storageKey);
    } catch { /* The selection still applies in this tab. */ }
  }
});
select.addEventListener('keydown', event => {
  event.stopPropagation();
  if (event.key === 'Escape') select.blur();
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
