(() => {
  if (window.__xarpDrawingInitialized) return;
  window.__xarpDrawingInitialized = true;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const NAV_SEL = "[data-xarp-navigation]";
  const histories = new Map();
  const finishedPaths = new WeakMap();
  const colors = [["Red", "#cf352e"], ["Blue", "#2468c9"], ["Yellow", "#e9ac16"], ["Black", "#111111"], ["White", "#ffffff"]];
  let active = false, color = colors[0][1], current = null, pending = null, frame = 0, strokeFrame = 0;
  let observedSection = null;

  function historyFor(key) {
    if (!histories.has(key)) histories.set(key, window.XarpHistory.create([]));
    return histories.get(key);
  }

  const toolbar = document.createElement("div");
  toolbar.id = "xarp-drawing-toolbar";
  toolbar.className = "xarp-drawing-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Slide drawing");

  const swatches = colors.map(([name, value]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "xarp-drawing-color";
    button.style.setProperty("--drawing-color", value);
    button.setAttribute("aria-label", `${name} pen`);
    button.title = `${name} pen`;
    button.setAttribute("aria-pressed", String(value === color));
    button.addEventListener("click", () => {
      color = value;
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
  const undo = makeButton("Undo", () => {
    finishStroke();
    if (current) historyFor(current.key).undo();
    render();
  });
  const redo = makeButton("Redo", () => {
    finishStroke();
    if (current) historyFor(current.key).redo();
    render();
  });
  const clear = makeButton("Clear slide", () => {
    finishStroke();
    if (current) historyFor(current.key).setState([]);
    render();
  });
  makeButton("Done", () => setActive(false));

  const layer = document.createElementNS(SVG_NS, "svg");
  layer.classList.add("xarp-drawing-layer");
  layer.setAttribute("aria-hidden", "true");
  const defs = document.createElementNS(SVG_NS, "defs");
  const clip = document.createElementNS(SVG_NS, "clipPath");
  clip.id = "xarp-drawing-clip";
  const clipRect = document.createElementNS(SVG_NS, "rect");
  clip.append(clipRect);
  defs.append(clip);
  const ink = document.createElementNS(SVG_NS, "g");
  ink.setAttribute("clip-path", "url(#xarp-drawing-clip)");
  const surface = document.createElementNS(SVG_NS, "rect");
  surface.classList.add("xarp-drawing-surface");
  surface.setAttribute("fill", "transparent");
  layer.append(defs, ink, surface);
  document.body.append(layer, toolbar);

  function presentationVisible() {
    return !["presenter", "next", "overview"].includes(document.body.dataset.bespokeView)
      && !document.querySelector('.bespoke-marp-overview[data-open="1"]');
  }

  function selectedSlide() {
    const slides = [...document.querySelectorAll("svg[data-marpit-svg]")];
    const selected = slides.findIndex(slide => slide.classList.contains("bespoke-marp-active"));
    const fromHash = Number.parseInt(location.hash.slice(1), 10) - 1;
    const index = selected >= 0 ? selected : Number.isInteger(fromHash) && fromHash >= 0 && fromHash < slides.length ? fromHash : 0;
    const section = slides[index]?.querySelector(":scope > foreignObject > section");
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

  function pathData(points) {
    const width = current.width, height = current.height;
    const coords = points.map(point => `${(point.x * width).toFixed(2)} ${(point.y * height).toFixed(2)}`);
    if (coords.length === 1) coords.push(`${(points[0].x * width + 0.01).toFixed(2)} ${(points[0].y * height).toFixed(2)}`);
    return `M ${coords.join(" L ")}`;
  }

  function paintPendingStroke() {
    if (!pending?.path) return;
    const { points } = pending.stroke;
    if (pending.width !== current.width || pending.height !== current.height) {
      pending.width = current.width;
      pending.height = current.height;
      pending.formatted = 0;
      pending.data = "";
    }
    for (; pending.formatted < points.length; pending.formatted++) {
      const point = points[pending.formatted];
      const coordinate = `${(point.x * current.width).toFixed(2)} ${(point.y * current.height).toFixed(2)}`;
      pending.data += `${pending.formatted === 0 ? "M " : " L "}${coordinate}`;
    }
    const dot = points.length === 1 ? ` L ${(points[0].x * current.width + 0.01).toFixed(2)} ${(points[0].y * current.height).toFixed(2)}` : "";
    pending.path.setAttribute("d", pending.data + dot);
  }

  function scheduleStrokePaint() {
    if (!strokeFrame) strokeFrame = requestAnimationFrame(() => {
      strokeFrame = 0;
      paintPendingStroke();
    });
  }

  function createStrokePath(stroke) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", stroke.color);
    path.setAttribute("stroke-width", "4");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    return path;
  }

  function finishedPath(stroke) {
    let cached = finishedPaths.get(stroke);
    if (!cached) {
      cached = { path: createStrokePath(stroke) };
      finishedPaths.set(stroke, cached);
    }
    if (cached.width !== current.width || cached.height !== current.height) {
      cached.path.setAttribute("d", pathData(stroke.points));
      cached.width = current.width;
      cached.height = current.height;
    }
    return cached.path;
  }

  function paint() {
    if (!current) return;
    const history = historyFor(current.key);
    const paths = history.getState().map(finishedPath);
    if (pending?.key === current.key) {
      pending.path ??= createStrokePath(pending.stroke);
      paintPendingStroke();
      paths.push(pending.path);
    }
    let next = ink.firstChild;
    for (const path of paths) {
      if (path === next) next = next.nextSibling;
      else ink.insertBefore(path, next);
    }
    while (next) {
      const obsolete = next;
      next = next.nextSibling;
      obsolete.remove();
    }
    undo.disabled = !pending && !history.canUndo();
    redo.disabled = !!pending || !history.canRedo();
    clear.disabled = paths.length === 0;
  }

  function render() {
    const selected = selectedSlide();
    if (pending && selected?.key !== pending.key) finishStroke();
    const visible = !!selected && presentationVisible();
    layer.toggleAttribute("hidden", !visible);
    toolbar.hidden = !visible || !active;
    if (!visible) return;
    const rect = selected.section.getBoundingClientRect();
    if (!rect.width || !rect.height) { layer.setAttribute("hidden", ""); return; }
    const width = selected.section.clientWidth, height = selected.section.clientHeight;
    const nav = selected.section.querySelector(NAV_SEL)?.getBoundingClientRect();
    const drawableHeight = nav && nav.height > 0 ? Math.max(0, Math.min(height, (nav.top - rect.top) / rect.height * height)) : height;
    current = { ...selected, width, height, drawableHeight };
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
    paint();
  }

  function scheduleRender() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
  }

  function point(event, rect) {
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(current.drawableHeight / current.height, (event.clientY - rect.top) / rect.height)),
    };
  }

  function finishStroke() {
    if (!pending) return;
    if (strokeFrame) cancelAnimationFrame(strokeFrame);
    strokeFrame = 0;
    paintPendingStroke();
    const { pointerId, key, stroke, path, width, height } = pending;
    pending = null;
    const history = historyFor(key);
    const completed = structuredClone(stroke);
    history.update(strokes => { strokes.push(completed); });
    finishedPaths.set(history.getState().at(-1), { path, width, height });
    if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
    scheduleRender();
  }

  surface.addEventListener("pointerdown", event => {
    if (!active || pending || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    render();
    if (!current) return;
    const stroke = { color, points: [point(event, layer.getBoundingClientRect())] };
    pending = { pointerId: event.pointerId, key: current.key, stroke };
    surface.setPointerCapture(event.pointerId);
    paint();
  });
  surface.addEventListener("pointermove", event => {
    if (!pending || event.pointerId !== pending.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const coalesced = event.getCoalescedEvents?.() || [];
    const rect = layer.getBoundingClientRect();
    for (const sample of coalesced.length ? coalesced : [event]) {
      pending.stroke.points.push(point(sample, rect));
    }
    scheduleStrokePaint();
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    surface.addEventListener(name, event => {
      if (!pending || event.pointerId !== pending.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      finishStroke();
    });
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
    if (active || [...histories.values()].some(history => history.getState().length)) event.preventDefault();
  });
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
        (event.shiftKey ? redo : undo).click();
      } else if (event.ctrlKey && !event.metaKey && !event.shiftKey && key === "y") {
        event.preventDefault(); event.stopImmediatePropagation(); redo.click();
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
