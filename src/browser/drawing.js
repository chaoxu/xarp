import { createDrauu } from 'drauu';
import { contentSection } from '../slide-dom.js';

(() => {
  if (window.__xarpDrawingInitialized) return;
  window.__xarpDrawingInitialized = true;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const NAV_SEL = "[data-xarp-navigation]";
  const histories = new Map();
  const meta = JSON.parse(document.getElementById("xarp-meta")?.textContent || "{}");
  const preferenceKey = `xarp:remember:${JSON.stringify([location.pathname, meta.deckId ?? meta.sourceFile, meta.viewId])}`;
  let persist = meta.plugins?.drawing?.persist === true;
  try { const preference = localStorage.getItem(preferenceKey); if (preference !== null) persist = preference === "true"; } catch {}
  const storageKey = key => `xarp:ink:${JSON.stringify([location.pathname, meta.deckId ?? meta.sourceFile, meta.viewId, meta.slideKeys?.[key] ?? `${meta.sourceRevision}:${meta.slides?.[key] ?? key}`])}`;
  const message = document.createElement("span");
  message.setAttribute("role", "status");
  function storageError() { message.textContent = "Browser storage unavailable. Export SVG to keep your drawings."; }
  function readInk(key) {
    if (!persist) return "";
    try {
      const value = localStorage.getItem(storageKey(key));
      if (!value) return "";
      // Only our path-only drawing format is restored, never arbitrary SVG markup.
      const parsed = new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}">${value}</svg>`, "image/svg+xml");
      if (parsed.querySelector("parsererror")) throw new Error("Invalid ink");
      const svg = document.createElementNS(SVG_NS, "svg");
      for (const node of parsed.documentElement.children) {
        if (node.localName !== "path" || node.children.length) throw new Error("Invalid ink");
        const path = document.createElementNS(SVG_NS, "path");
        for (const name of ["d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity"]) {
          const value = node.getAttribute(name);
          if (value !== null && (!['fill', 'stroke'].includes(name) || /^(none|#[0-9a-f]{3,8})$/i.test(value))) path.setAttribute(name, value);
        }
        svg.append(path);
      }
      return svg.innerHTML;
    } catch { storageError(); return ""; }
  }
  function saveInk(key) {
    if (!persist) return;
    try {
      const svg = historyFor(key).getState();
      if (svg) localStorage.setItem(storageKey(key), svg);
      else localStorage.removeItem(storageKey(key));
      message.textContent = "";
    } catch { storageError(); }
  }
  const colors = [["Red", "#cf352e"], ["Blue", "#2468c9"], ["Yellow", "#e9ac16"], ["Black", "#111111"], ["White", "#ffffff"]];
  let active = false, current = null, pointer = null, frame = 0;
  let observedSection = null;

  function historyFor(key) {
    if (!histories.has(key)) histories.set(key, window.XarpHistory.create(readInk(key)));
    return histories.get(key);
  }

  const toolbar = document.createElement("div");
  toolbar.id = "xarp-drawing-toolbar";
  toolbar.className = "xarp-drawing-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Slide drawing");

  const swatches = colors.map(([name, value], index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "xarp-drawing-color";
    button.style.setProperty("--drawing-color", value);
    button.setAttribute("aria-label", `${name} pen`);
    button.title = `${name} pen`;
    button.setAttribute("aria-pressed", String(index === 0));
    button.addEventListener("click", () => {
      drauu.brush.color = value;
      swatches.forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    });
    toolbar.append(button);
    return button;
  });

  const makeButton = (label, action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    toolbar.append(button);
    return button;
  };
  function changeHistory(action) {
    finishStroke();
    render();
    if (current) { drauu.load(action(historyFor(current.key))); saveInk(current.key); }
    updateControls();
  }
  const undo = makeButton("Undo", () => changeHistory(history => history.undo()));
  const redo = makeButton("Redo", () => changeHistory(history => history.redo()));
  const clear = makeButton("Clear slide", () => changeHistory(history => history.setState("")));
  makeButton("Export SVG", () => {
    finishStroke(); render();
    if (!current) return;
    const width = current.section.clientWidth, height = current.section.clientHeight;
    const svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${drauu.dump()}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `drawing-${meta.slides?.[current.key] ?? current.key + 1}.svg`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const remember = makeButton("Remember: Off", () => {
    finishStroke();
    persist = !persist;
    try { localStorage.setItem(preferenceKey, String(persist)); } catch { storageError(); }
    remember.textContent = persist ? "Remember: On" : "Remember: Off";
    remember.setAttribute("aria-pressed", String(persist));
    if (persist) {
      for (const key of histories.keys()) saveInk(key);
    } else {
      try { for (let key = 0; key < (meta.slides?.length ?? histories.size); key++) localStorage.removeItem(storageKey(key)); }
      catch { storageError(); }
    }
  });
  remember.textContent = persist ? "Remember: On" : "Remember: Off";
  remember.setAttribute("aria-pressed", String(persist));
  remember.title = "Remember ink on this browser and URL across reloads. This does not sync or change the Markdown.";
  makeButton("Done", () => setActive(false));
  toolbar.append(message);

  const layer = document.createElementNS(SVG_NS, "svg");
  layer.classList.add("xarp-drawing-layer");
  layer.setAttribute("aria-hidden", "true");
  const defs = document.createElementNS(SVG_NS, "defs");
  const clip = document.createElementNS(SVG_NS, "clipPath");
  clip.id = "xarp-drawing-clip";
  const clipRect = document.createElementNS(SVG_NS, "rect");
  clip.append(clipRect);
  defs.append(clip);
  const ink = document.createElementNS(SVG_NS, "svg");
  ink.classList.add("xarp-drawing-ink");
  ink.setAttribute("clip-path", "url(#xarp-drawing-clip)");
  const surface = document.createElementNS(SVG_NS, "rect");
  surface.classList.add("xarp-drawing-surface");
  surface.setAttribute("fill", "transparent");
  layer.append(defs, ink, surface);
  document.body.append(layer, toolbar);

  // Capture the stroke on our overlay, so dragging outside a slide cannot
  // reach Marp's navigation. Drauu owns coordinates and stroke generation.
  surface.addEventListener("pointerdown", event => {
    if (!active || pointer || !event.isPrimary || event.button !== 0) {
      event.stopImmediatePropagation();
      return;
    }
    render();
    pointer = event;
    surface.setPointerCapture(event.pointerId);
  });
  window.addEventListener("pointermove", event => {
    if (pointer?.pointerId !== event.pointerId) return;
    pointer = event;
    // Preserve samples batched by the browser; Drauu handles the dispatched
    // event itself after this capture listener.
    for (const sample of event.getCoalescedEvents?.() ?? []) {
      window.dispatchEvent(new PointerEvent("pointermove", sample));
    }
    pointer = event;
  }, true);
  surface.addEventListener("lostpointercapture", finishStroke);

  const drauu = createDrauu({
    el: ink,
    eventTarget: surface,
    acceptsInputTypes: [],
    brush: { mode: "draw", color: colors[0][1], size: 4 },
  });
  drauu.on("start", updateControls);
  drauu.on("end", () => {
    const ended = pointer;
    pointer = null;
    // Drauu's load/clear reset its native undo. Retain SVG snapshots in the
    // existing per-slide history so navigation and Clear remain undoable.
    const svg = drauu.dump();
    if (current) { historyFor(current.key).setState(svg); saveInk(current.key); }
    drauu.load(svg);
    if (ended && surface.hasPointerCapture(ended.pointerId)) surface.releasePointerCapture(ended.pointerId);
    updateControls();
  });

  function finishStroke() {
    if (!pointer || !drauu.drawing) return;
    const { pointerId, pointerType, clientX, clientY, pressure } = pointer;
    // Complete interrupted gestures through Drauu's normal public event path.
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId, pointerType, clientX, clientY, pressure }));
  }

  function presentationVisible() {
    return !["presenter", "next", "overview"].includes(document.body.dataset.bespokeView)
      && !document.querySelector('.bespoke-marp-overview[data-open="1"]');
  }

  function selectedSlide() {
    const slides = [...document.querySelectorAll("svg[data-marpit-svg]")];
    const selected = slides.findIndex(slide => slide.classList.contains("bespoke-marp-active"));
    const fromHash = Number.parseInt(location.hash.slice(1), 10) - 1;
    const index = selected >= 0 ? selected : Number.isInteger(fromHash) && fromHash >= 0 && fromHash < slides.length ? fromHash : 0;
    const section = slides[index] && contentSection(slides[index]);
    if (!section) return null;
    return { section, key: index };
  }

  function setActive(next) {
    if (next && !presentationVisible()) return;
    finishStroke();
    if (next) window.dispatchEvent(new CustomEvent("xarp-mode-request", { detail: { mode: "draw" } }));
    active = next;
    document.body.classList.toggle("xarp-drawing-active", active);
    render();
  }

  function updateControls() {
    const history = current && historyFor(current.key);
    undo.disabled = !pointer && !history?.canUndo();
    redo.disabled = !!pointer || !history?.canRedo();
    clear.disabled = !pointer && !history?.getState();
  }

  function render() {
    const selected = selectedSlide();
    const visible = !!selected && presentationVisible();
    if (pointer && (!visible || selected.key !== current?.key)) finishStroke();
    drauu.options.acceptsInputTypes = visible && active ? undefined : [];
    layer.toggleAttribute("hidden", !visible);
    toolbar.hidden = !visible || !active;
    if (!visible) return;
    const rect = selected.section.getBoundingClientRect();
    if (!rect.width || !rect.height) { layer.setAttribute("hidden", ""); return; }
    const width = selected.section.clientWidth, height = selected.section.clientHeight;
    const nav = selected.section.querySelector(NAV_SEL)?.getBoundingClientRect();
    const drawableHeight = nav && nav.height > 0 ? Math.max(0, Math.min(height, (nav.top - rect.top) / rect.height * height)) : height;
    const changed = current?.key !== selected.key;
    current = selected;
    Object.assign(layer.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    layer.setAttribute("viewBox", `0 0 ${width} ${height}`);
    surface.setAttribute("width", String(width));
    surface.setAttribute("height", String(drawableHeight));
    clipRect.setAttribute("width", String(width));
    clipRect.setAttribute("height", String(drawableHeight));
    if (observedSection !== selected.section) {
      resizeObserver.disconnect();
      resizeObserver.observe(selected.section);
      observedSection = selected.section;
    }
    if (changed) drauu.load(historyFor(current.key).getState());
    updateControls();
  }

  function scheduleRender() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
  }

  // Touch events must not reach the presentation's swipe handlers or browser
  // history gestures while pointer events are drawing the stroke.
  for (const name of ["click", "dblclick", "contextmenu", "touchstart", "touchmove", "touchend"]) surface.addEventListener(name, event => {
    if (active) { event.preventDefault(); event.stopPropagation(); }
  }, { passive: false });

  window.addEventListener("xarp-mode-request", event => {
    if (event.detail?.mode === "edit") setActive(false);
  });
  window.addEventListener("xarp-preview-update", event => {
    if (active || [...histories.values()].some(history => history.getState())) event.preventDefault();
  });
  window.addEventListener("xarp-before-deck-change", event => {
    finishStroke();
    for (let key = 0; key < (meta.slides?.length ?? histories.size); key++) historyFor(key);
    if ([...histories.values()].some(history => history.getState())) event.preventDefault();
  });
  window.addEventListener("blur", finishStroke);
  window.addEventListener("keydown", event => {
    const target = event.target;
    if (target instanceof Element && (target.closest("input,textarea,select,[contenteditable=true]") || target.isContentEditable)) return;
    if (!presentationVisible()) return;
    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "d") {
      event.preventDefault(); event.stopImmediatePropagation(); setActive(!active);
    } else if (active && event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); setActive(false);
    } else if (active && (event.metaKey || event.ctrlKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault(); event.stopImmediatePropagation();
        changeHistory(history => event.shiftKey ? history.redo() : history.undo());
      } else if (event.ctrlKey && !event.metaKey && !event.shiftKey && key === "y") {
        event.preventDefault(); event.stopImmediatePropagation(); changeHistory(history => history.redo());
      }
    }
  }, true);

  const resizeObserver = new ResizeObserver(scheduleRender);
  new MutationObserver(records => {
    if (active && document.body.classList.contains("xarp-edit-active")) setActive(false);
    if (records.some(record => record.target === document.body
      ? record.attributeName === "data-bespoke-view"
      : record.target.matches('svg[data-marpit-svg],.bespoke-marp-overview'))) scheduleRender();
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class", "data-bespoke-view", "data-open"] });
  window.addEventListener("resize", scheduleRender);
  window.addEventListener("scroll", scheduleRender, { passive: true, capture: true });
  window.addEventListener("hashchange", scheduleRender);
  window.addEventListener("load", scheduleRender);
  render();
})();
