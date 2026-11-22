/* ==========================================================================
   Chao-UI Animated Stage, KaTeX Label Pool & Segmented Beat Timeline (stage.js)
   Eliminates HTML/SVG/KaTeX/Bespoke scaffolding for interactive & Marp stages:
   1. createLabelLayer(overlayEl, opts)  -> pooled immediate-mode HTML + $KaTeX$ labels
   2. createStageTimeline(opts)          -> segmented beat / loop timeline + Marp sync
   3. mountCraftStage(containerEl, spec) -> turnkey 33-style SVG + label + beat stage
   ========================================================================== */

import { clamp, palette } from "./diagrams.js";
import { createSvgMarks, resolveRoleColor } from "./marks.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const SERIF_FONT = '"IBM Plex Serif", "STIX Two Text", "Songti SC", "Hiragino Mincho ProN", Georgia, serif';
const CLASSICAL_FONT = 'Baskerville, "Palatino Linotype", Palatino, "Hoefler Text", Georgia, "Songti SC", serif';
const EDITORIAL_FONT = 'Georgia, "Iowan Old Style", Charter, "Palatino Linotype", "IBM Plex Serif", serif';
const GEOMETRIC_FONT = '"Avenir Next", Futura, "Gill Sans", Optima, "IBM Plex Sans", system-ui, sans-serif';
const DRAFTING_FONT = '"Inconsolata", "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
const MONO_FONT = '"IBM Plex Mono", "Inconsolata", ui-monospace, SFMono-Regular, Menlo, monospace';
const PIXEL_FONT = '"Courier New", Courier, "IBM Plex Mono", ui-monospace, monospace';
const UI_FONT = 'Tahoma, Verdana, "MS Sans Serif", "IBM Plex Sans", system-ui, sans-serif';
const MANGA_FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Arial Black", "IBM Plex Sans", system-ui, sans-serif';

const SCHEME_TYPOGRAPHY = {
  "sumi-e":      { family: SERIF_FONT, scale: 1, spacing: "-0.01em" },
  shuimo:        { family: SERIF_FONT, scale: 1, spacing: "-0.01em" },
  "song-scroll": { family: SERIF_FONT, scale: 1, spacing: "-0.01em" },
  qinglu:        { family: SERIF_FONT, scale: 1, spacing: "-0.01em" },
  washi:         { family: SERIF_FONT, scale: 1, spacing: "-0.01em" },
  edo:           { family: SERIF_FONT, scale: 1, spacing: "-0.01em" },
  "wabi-sabi":   { family: SERIF_FONT, scale: 1, spacing: "-0.01em" },
  urushi:        { family: SERIF_FONT, scale: 1, spacing: "-0.01em" },
  "han-rubbing": { family: CLASSICAL_FONT, scale: 1, spacing: "-0.005em" },
  zellij:        { family: CLASSICAL_FONT, scale: 1, spacing: "-0.005em" },
  isfahan:       { family: CLASSICAL_FONT, scale: 1, spacing: "-0.005em" },
  egypt:         { family: CLASSICAL_FONT, scale: 1, spacing: "-0.005em" },
  mughal:        { family: CLASSICAL_FONT, scale: 1, spacing: "-0.005em" },
  nitrate:       { family: CLASSICAL_FONT, scale: 1, spacing: "-0.005em" },
  yagasuri:      { family: EDITORIAL_FONT, scale: 0.93, spacing: "-0.01em" },
  kimono:        { family: EDITORIAL_FONT, scale: 0.93, spacing: "-0.01em" },
  sahara:        { family: EDITORIAL_FONT, scale: 0.93, spacing: "-0.01em" },
  wayang:        { family: EDITORIAL_FONT, scale: 0.93, spacing: "-0.01em" },
  starry:        { family: EDITORIAL_FONT, scale: 0.93, spacing: "-0.01em" },
  scream:        { family: EDITORIAL_FONT, scale: 0.93, spacing: "-0.01em" },
  shippo:        { family: GEOMETRIC_FONT, scale: 0.975, spacing: "-0.008em" },
  kikko:         { family: GEOMETRIC_FONT, scale: 0.975, spacing: "-0.008em" },
  japandi:       { family: GEOMETRIC_FONT, scale: 0.975, spacing: "-0.008em" },
  yosegi:        { family: GEOMETRIC_FONT, scale: 0.975, spacing: "-0.008em" },
  kumiko:        { family: GEOMETRIC_FONT, scale: 0.975, spacing: "-0.008em" },
  maya:          { family: GEOMETRIC_FONT, scale: 0.975, spacing: "-0.008em" },
  vaporwave:     { family: GEOMETRIC_FONT, scale: 0.975, spacing: "-0.008em" },
  blueprint:     { family: DRAFTING_FONT, scale: 0.96, spacing: "-0.02em" },
  oscilloscope:  { family: MONO_FONT, scale: 0.90, spacing: "-0.04em" },
  "code-art":    { family: MONO_FONT, scale: 0.90, spacing: "-0.04em" },
  "pixel-8bit":  { family: PIXEL_FONT, scale: 0.91, spacing: "-0.045em" },
  win2000:       { family: UI_FONT, scale: 0.955, spacing: "-0.015em" },
  manga:         { family: MANGA_FONT, scale: 0.845, spacing: "-0.02em", forceBold: true },
};

function resolveColorOrRole(G, roleOrColor, mapColor) {
  if (!roleOrColor) return G ? G.P.fg : "#1f1d1a";
  let col = roleOrColor;
  if (G && (
    col === "primary" || col === "caveat" || col === "auxiliary" || col === "baseline" ||
    col === "ink" || col === "muted" || col === "grid" || col === "surface" || col === "paper"
  )) {
    col = resolveRoleColor(G, col);
  }
  return typeof mapColor === "function" ? mapColor(col) : col;
}

function escapeTexRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyTexColorMap(tex, t2c, G, mapColor) {
  if (!t2c || typeof t2c !== "object") return tex;
  const keys = Object.keys(t2c).filter((k) => k.length > 0).sort((a, b) => b.length - a.length);
  if (!keys.length) return tex;
  const colorByKey = new Map();
  const patterns = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    colorByKey.set(k, resolveColorOrRole(G, t2c[k], mapColor));
    const startsAlpha = /^[A-Za-z]/.test(k);
    const endsAlpha = /[A-Za-z]$/.test(k);
    const prefix = startsAlpha ? "(?<![\\\\A-Za-z])" : "";
    const suffix = endsAlpha ? "(?![A-Za-z])" : "";
    patterns.push(`${prefix}${escapeTexRegex(k)}${suffix}`);
  }
  const combined = new RegExp(patterns.join("|"), "g");
  return tex.replace(combined, (matched) => {
    const col = colorByKey.get(matched);
    return col ? `\\textcolor{${col}}{${matched}}` : matched;
  });
}

function renderMathMixedText(el, rawText, katexRef, G = null, mapColor = null, t2c = null) {
  while (el.firstChild) el.removeChild(el.firstChild);
  const doc = el.ownerDocument;
  const s = String(rawText ?? "");
  const kz = katexRef || (typeof globalThis !== "undefined" ? globalThis.katex : null);
  if (!s.includes("$") || !kz || typeof kz.render !== "function") {
    el.textContent = s.replace(/\\\$/g, "$");
    return;
  }
  const macros = G ? {
    "\\pfprimary": `\\textcolor{${resolveColorOrRole(G, "primary", mapColor)}}{#1}`,
    "\\pfcaveat": `\\textcolor{${resolveColorOrRole(G, "caveat", mapColor)}}{#1}`,
    "\\pfaux": `\\textcolor{${resolveColorOrRole(G, "auxiliary", mapColor)}}{#1}`,
    "\\pfmuted": `\\textcolor{${resolveColorOrRole(G, "muted", mapColor)}}{#1}`,
    "\\pfink": `\\textcolor{${resolveColorOrRole(G, "ink", mapColor)}}{#1}`,
  } : undefined;
  const parts = s.split(/(?<!\\)\$/);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const span = doc.createElement("span");
    if (i % 2 === 1) {
      const coloredTex = t2c ? applyTexColorMap(part, t2c, G, mapColor) : part;
      kz.render(coloredTex, span, { throwOnError: false, displayMode: false, ...(macros ? { macros } : {}) });
    } else {
      span.textContent = part.replace(/\\\$/g, "$");
    }
    el.appendChild(span);
  }
}

const ALIGN_X = { left: 0, start: 0, center: 50, middle: 50, right: 100, end: 100 };
const ALIGN_Y = { top: 0, middle: 50, center: 50, bottom: 100 };

/**
 * Pooled HTML + inline `$...$` KaTeX overlay layer.
 * Supports both retained handles (`const h = labels.get(key, text, opts); h.place(x, y, op)`)
 * and zero-setup immediate mode (`labels.place(key, text, x, y, op, opts)`).
 */
export function createLabelLayer(overlayEl, opts = {}) {
  const doc = overlayEl.ownerDocument;
  const pool = new Map();
  let frameId = 0;
  let curG = opts.grammar || null;
  let mapColor = opts.mapColor || null;

  function begin(G = null, customMapColor = undefined) {
    frameId += 1;
    if (G) curG = G;
    if (customMapColor !== undefined) mapColor = customMapColor;
  }

  function get(key, text = "", cfg = {}) {
    let entry = pool.get(key);
    if (!entry) {
      const el = doc.createElement("div");
      el.className = "pf-stage-label" + (cfg.className ? ` ${cfg.className}` : "");
      if (el.style) {
        el.style.position = "absolute";
        el.style.left = "0";
        el.style.top = "0";
        el.style.whiteSpace = cfg.wrap ? "normal" : "nowrap";
        el.style.lineHeight = String(cfg.lineHeight || 1.18);
        el.style.pointerEvents = "none";
        el.style.visibility = "hidden";
        el.style.opacity = "0";
        el.style.willChange = "transform, opacity";
      }
      const hostEl = cfg && cfg.fixedInFrame && opts.fixedOverlayEl ? opts.fixedOverlayEl : overlayEl;
      hostEl.appendChild(el);
      entry = {
        key,
        el,
        fixedInFrame: Boolean(cfg && cfg.fixedInFrame),
        text: null,
        plain: Boolean(cfg.plain),
        t2c: (cfg && cfg.t2c) || null,
        mathColorSig: "",
        font: cfg.font || "sans",
        size: 0,
        weight: 0,
        appliedTypoKey: "",
        ax: ALIGN_X[cfg.align || cfg.anchor || "left"] ?? 0,
        ay: ALIGN_Y[cfg.vAlign || "middle"] ?? 50,
        x: null,
        y: null,
        rot: 0,
        op: -1,
        rawRole: cfg.role || cfg.color || "ink",
        appliedColor: "",
        pillApplied: "",
        used: 0,
        place(x, y, opacity = 1, overrides = null) {
          return placeEntry(entry, x, y, opacity, overrides);
        },
      };
      pool.set(key, entry);
    }
    syncEntryContent(entry, text, cfg);
    return entry;
  }

  function syncEntryContent(entry, text, cfg) {
    const el = entry.el;
    if (cfg && cfg.fixedInFrame !== undefined && opts.fixedOverlayEl && Boolean(cfg.fixedInFrame) !== entry.fixedInFrame) {
      entry.fixedInFrame = Boolean(cfg.fixedInFrame);
      (entry.fixedInFrame ? opts.fixedOverlayEl : overlayEl).appendChild(el);
    }
    const nextPlain = cfg && cfg.plain !== undefined ? Boolean(cfg.plain) : entry.plain;
    const nextT2c = cfg && cfg.t2c !== undefined ? cfg.t2c : entry.t2c;
    const candidateText = text !== undefined && text !== null ? String(text) : entry.text;
    const hasColoredMath = !nextPlain && candidateText && candidateText.includes("$") && (
      nextT2c || candidateText.includes("\\pf")
    );
    const nextMathSig = hasColoredMath
      ? `${curG ? curG.key : ""}|${nextT2c ? JSON.stringify(nextT2c) : ""}`
      : "";
    if (
      text !== undefined && text !== null &&
      (entry.text !== text || entry.plain !== nextPlain || entry.mathColorSig !== nextMathSig)
    ) {
      entry.text = text;
      entry.plain = nextPlain;
      entry.t2c = nextT2c;
      entry.mathColorSig = nextMathSig;
      if (nextPlain) el.textContent = String(text);
      else renderMathMixedText(el, text, opts.katex, curG, mapColor, nextT2c);
    }
    if (!el.style) return;
    const fs = Number((cfg && (cfg.size ?? cfg.fs)) || entry.size || 16);
    const fw = Number((cfg && cfg.weight) || entry.weight || 500);
    const fontKind = (cfg && cfg.font) || entry.font || "sans";
    const schemeName = (curG && curG.scheme) || "default";
    const typo = fontKind === "sans" ? SCHEME_TYPOGRAPHY[schemeName] || null : null;
    const typoKey = `${fontKind}|${fs}|${fw}|${typo ? schemeName : "base"}`;
    if (entry.size !== fs || entry.weight !== fw || entry.font !== fontKind || entry.appliedTypoKey !== typoKey) {
      entry.size = fs;
      entry.weight = fw;
      entry.font = fontKind;
      entry.appliedTypoKey = typoKey;
      if (el.dataset) el.dataset.pfFont = fontKind;
      if (fontKind === "mono") {
        el.style.fontFamily = MONO_FONT;
        el.style.fontVariantNumeric = "tabular-nums";
        el.style.letterSpacing = "";
        el.style.fontSize = `${fs}px`;
        el.style.fontWeight = String(fw);
      } else if (fontKind === "serif") {
        el.style.fontFamily = SERIF_FONT;
        el.style.fontVariantNumeric = "";
        el.style.letterSpacing = "";
        el.style.fontSize = `${fs}px`;
        el.style.fontWeight = String(fw);
      } else if (typo) {
        el.style.fontFamily = typo.family;
        el.style.fontVariantNumeric = "";
        el.style.letterSpacing = typo.spacing || "";
        el.style.fontSize = typo.scale === 1 ? `${fs}px` : `${Math.round(fs * typo.scale * 100) / 100}px`;
        el.style.fontWeight = String(typo.forceBold ? Math.max(700, fw) : fw);
      } else {
        el.style.fontFamily = "";
        el.style.fontVariantNumeric = "";
        el.style.letterSpacing = "";
        el.style.fontSize = `${fs}px`;
        el.style.fontWeight = String(fw);
      }
    }
    if (cfg && (cfg.align || cfg.anchor)) entry.ax = ALIGN_X[cfg.align || cfg.anchor] ?? entry.ax;
    if (cfg && cfg.vAlign) entry.ay = ALIGN_Y[cfg.vAlign] ?? entry.ay;
    if (cfg && (cfg.role || cfg.color)) entry.rawRole = cfg.role || cfg.color;

    const col = resolveColorOrRole(curG, entry.rawRole, mapColor);
    if (entry.appliedColor !== col) {
      entry.appliedColor = col;
      el.style.color = col;
    }
    if (cfg && cfg.pill) {
      const bg = resolveColorOrRole(curG, typeof cfg.pill === "object" ? cfg.pill.fill || "paper" : "paper", mapColor);
      if (entry.pillApplied !== bg) {
        entry.pillApplied = bg;
        el.style.background = bg;
        el.style.padding = "1px 5px";
      }
    }
  }

  function placeEntry(entry, x, y, opacity = 1, overrides = null) {
    const op = clamp(opacity ?? 1, 0, 1);
    if (op < 0.003) return entry;
    if (overrides) syncEntryContent(entry, overrides.text ?? entry.text, overrides);
    else syncEntryContent(entry, entry.text, null);

    entry.used = frameId;
    const rx = Math.round(x * 10) / 10;
    const ry = Math.round(y * 10) / 10;
    const rot = overrides && overrides.rotateDeg ? Math.round(overrides.rotateDeg * 10) / 10 : 0;
    if (entry.el.style && (rx !== entry.x || ry !== entry.y || rot !== entry.rot)) {
      entry.x = rx;
      entry.y = ry;
      entry.rot = rot;
      const rotPart = rot ? ` rotate(${rot}deg)` : "";
      entry.el.style.transform = `translate(${rx}px,${ry}px) translate(-${entry.ax}%,-${entry.ay}%)${rotPart}`;
    }
    const qOp = Math.round(op * 1000) / 1000;
    if (entry.el.style && entry.op !== qOp) {
      if (entry.op <= 0) entry.el.style.visibility = "visible";
      entry.op = qOp;
      entry.el.style.opacity = String(qOp);
    }
    return entry;
  }

  function place(key, text, x, y, opacity = 1, cfg = {}) {
    const entry = get(key, text, cfg);
    return placeEntry(entry, x, y, opacity, cfg);
  }

  function end() {
    for (const entry of pool.values()) {
      if (entry.used !== frameId && entry.op !== 0) {
        entry.op = 0;
        if (entry.el.style) {
          entry.el.style.opacity = "0";
          entry.el.style.visibility = "hidden";
        }
      }
    }
  }

  function refreshColors(G = curG, customMapColor = mapColor) {
    curG = G;
    mapColor = customMapColor;
    for (const entry of pool.values()) {
      syncEntryContent(entry, entry.text, null);
    }
  }

  return { begin, get, place, end, refreshColors, size: () => pool.size };
}

/**
 * Segmented beat & continuous loop controller with URL `?t=&step=&pause=&print=`
 * verification hooks, `@media print` freeze-frame, `window.__videoCtl`, and
 * automatic same-origin Marp / Xarp Bespoke slide + fragment synchronization.
 */
export function createStageTimeline(opts = {}) {
  const segments = Array.isArray(opts.segments) && opts.segments.length
    ? opts.segments.map((s) => ({ from: Number(s.from || 0), to: Number(s.to ?? s.from ?? 0), speed: Number(s.speed || 1) }))
    : [{ from: 0, to: Number(opts.duration ?? opts.cycle ?? 0), speed: 1 }];
  const duration = Number(opts.duration ?? segments[segments.length - 1].to ?? 0);
  const loop = Boolean(opts.loop);
  const printTime = Number(opts.printTime ?? segments[segments.length - 1].to ?? duration);
  const onFrame = opts.onFrame || (() => {});
  const hasWin = typeof window !== "undefined";

  let curSeg = 0;
  let t = segments[0].from;
  let targetT = segments[0].to;
  let speed = segments[0].speed;
  let playing = loop ? duration > 0 : t < targetT;
  let deckPaused = false;
  let rafId = 0;
  let lastNow = 0;

  function emit(dt = 0) {
    onFrame(t, { segment: curSeg, playing: playing && !deckPaused, dt, duration });
  }

  function stopLoop() {
    if (rafId && hasWin) window.cancelAnimationFrame(rafId);
    rafId = 0;
    lastNow = 0;
  }

  function tick(now) {
    rafId = 0;
    if (!playing || deckPaused) return;
    if (!lastNow) lastNow = now;
    const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    t += dt * speed;
    if (loop && duration > 0) {
      t = t % duration;
      emit(dt);
      rafId = window.requestAnimationFrame(tick);
      return;
    }
    if (t >= targetT) {
      t = targetT;
      playing = false;
      lastNow = 0;
      emit(dt);
      return;
    }
    emit(dt);
    rafId = window.requestAnimationFrame(tick);
  }

  function startLoop() {
    if (!hasWin) { emit(0); return; }
    if (!rafId && playing && !deckPaused) {
      lastNow = 0;
      rafId = window.requestAnimationFrame(tick);
    }
  }

  function playSegment(idx) {
    curSeg = clamp(idx | 0, 0, segments.length - 1);
    const seg = segments[curSeg];
    stopLoop();
    t = seg.from;
    targetT = seg.to;
    speed = seg.speed;
    if (t >= targetT && !loop) {
      t = targetT;
      playing = false;
      emit(0);
      return;
    }
    playing = true;
    emit(0);
    startLoop();
  }

  function snapSegment(idx) {
    curSeg = clamp(idx | 0, 0, segments.length - 1);
    const seg = segments[curSeg];
    stopLoop();
    t = seg.to;
    targetT = seg.to;
    playing = false;
    emit(0);
  }

  function seek(timeSec) {
    stopLoop();
    t = clamp(Number(timeSec) || 0, 0, Math.max(duration, printTime));
    targetT = t;
    playing = false;
    emit(0);
  }

  const cleanups = [];
  if (hasWin) {
    const onPrint = () => seek(printTime);
    window.addEventListener("beforeprint", onPrint);
    cleanups.push(() => window.removeEventListener("beforeprint", onPrint));

    const prefersReduced = Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    let hasExplicitUrl = false;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has("print")) { t = printTime; targetT = t; playing = false; hasExplicitUrl = true; }
      if (params.has("step")) {
        curSeg = clamp(parseInt(params.get("step"), 10) || 0, 0, segments.length - 1);
        t = segments[curSeg].to; targetT = t; playing = false; hasExplicitUrl = true;
      }
      if (params.has("t")) {
        const q = parseFloat(params.get("t"));
        if (Number.isFinite(q)) { t = clamp(q, 0, Math.max(duration, printTime)); targetT = t; playing = false; hasExplicitUrl = true; }
      }
      if (params.get("pause") === "1") { playing = false; hasExplicitUrl = true; }
    } catch (_) {}

    if (prefersReduced && !hasExplicitUrl) {
      t = segments[0].to;
      targetT = t;
      playing = false;
    }

    if (opts.exposeGlobal !== false) {
      window.__videoCtl = {
        seek,
        playSegment,
        snapSegment,
        getTime: () => t,
        getDuration: () => duration,
        getSegments: () => segments.slice(),
      };
    }

    if (opts.syncParentDeck !== false) {
      try {
        const frame = window.frameElement;
        const slideSvg = frame && frame.closest && frame.closest("svg[data-marpit-svg]");
        if (slideSvg) {
          const parentDoc = slideSvg.ownerDocument;
          let lastFragCount = -1;
          let wasActive = false;
          let wasWatch = false;
          const syncDeck = () => {
            const isWatch = Boolean(parentDoc.body && parentDoc.body.classList.contains("xarp-watch-controlled"));
            if (isWatch) {
              wasWatch = true;
              deckPaused = true;
              stopLoop();
              return;
            }
            const exitedWatch = wasWatch;
            wasWatch = false;
            const isEdit = Boolean(
              parentDoc.body &&
              (parentDoc.body.classList.contains("talk-edit-active") || parentDoc.body.classList.contains("xarp-edit-active"))
            );
            const isActive = slideSvg.classList.contains("bespoke-marp-active");
            const activeFrags = slideSvg.querySelectorAll('[data-bespoke-marp-fragment="active"]').length;
            const stepIdx = clamp(activeFrags, 0, segments.length - 1);
            deckPaused = !isActive || isEdit;
            if (!isActive) {
              wasActive = false;
              stopLoop();
              return;
            }
            if (!wasActive || exitedWatch || stepIdx !== lastFragCount) {
              wasActive = true;
              const steppedForward = !exitedWatch && lastFragCount >= 0 && stepIdx === lastFragCount + 1;
              lastFragCount = stepIdx;
              if (prefersReduced || isEdit || exitedWatch || (!steppedForward && stepIdx > 0)) snapSegment(stepIdx);
              else playSegment(stepIdx);
            }
          };
          const mo = new MutationObserver(syncDeck);
          mo.observe(slideSvg, { attributes: true, subtree: true, attributeFilter: ["class", "data-bespoke-marp-fragment"] });
          if (parentDoc.body) mo.observe(parentDoc.body, { attributes: true, attributeFilter: ["class"] });
          cleanups.push(() => mo.disconnect());
          if (!hasExplicitUrl) syncDeck();

          const onKey = (ev) => {
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (
              ev.key === "ArrowRight" || ev.key === "ArrowLeft" || ev.key === " " ||
              ev.key === "PageDown" || ev.key === "PageUp" ||
              ev.key === "s" || ev.key === "S" || ev.key === "c" || ev.key === "C" ||
              ev.key === "w" || ev.key === "W" || ev.key === "k" || ev.key === "K" ||
              ev.key === "j" || ev.key === "J" || ev.key === "l" || ev.key === "L" ||
              ev.key === "m" || ev.key === "M" || ev.key === "t" || ev.key === "T" ||
              ev.key === "v" || ev.key === "V" || ev.key === "f" || ev.key === "F" ||
              ev.key === "Escape"
            ) {
              const targetWin = parentDoc.defaultView || parentDoc;
              targetWin.dispatchEvent(new KeyboardEvent("keydown", { key: ev.key, code: ev.code, shiftKey: ev.shiftKey, bubbles: true, cancelable: true }));
            }
          };
          window.addEventListener("keydown", onKey);
          cleanups.push(() => window.removeEventListener("keydown", onKey));
        }
      } catch (_) {}
    }
  }

  emit(0);
  if (playing) startLoop();

  return {
    seek,
    playSegment,
    snapSegment,
    getTime: () => t,
    getDuration: () => duration,
    getSegments: () => segments.slice(),
    destroy() {
      stopLoop();
      for (let i = 0; i < cleanups.length; i++) cleanups[i]();
    },
  };
}

/**
 * Turnkey 33-style SVG + pooled KaTeX label + segmented beat stage.
 * Replaces ~830 lines of per-stage HTML/CSS/SVG/label/Bespoke boilerplate with one call.
 */
export function mountCraftStage(containerEl, spec = {}) {
  const doc = containerEl.ownerDocument;
  const width = Number(spec.width || 1240);
  const height = Number(spec.height || 628);
  const hasWin = typeof window !== "undefined";
  let parentSection = null;
  let parentRoot = null;
  if (hasWin) {
    try {
      const frame = window.frameElement;
      if (frame && frame.closest && frame.closest("svg[data-marpit-svg]")) {
        parentSection = frame.closest("section");
        parentRoot = frame.ownerDocument && frame.ownerDocument.documentElement;
      }
    } catch (_) {}
  }

  let curOverrides = spec.grammarOverrides || (spec.style ? { scheme: spec.style } : null);
  if (!curOverrides && parentRoot && parentRoot.dataset) {
    const inherited = parentRoot.dataset.xarpColorScheme || parentRoot.dataset.pfStyle || "";
    if (inherited && inherited !== "default") curOverrides = { scheme: inherited };
  }
  if (containerEl.dataset) {
    if (curOverrides && curOverrides.scheme && curOverrides.scheme !== "default") {
      containerEl.dataset.pfStyle = curOverrides.scheme;
    } else {
      delete containerEl.dataset.pfStyle;
    }
  }

  if (containerEl.style) {
    containerEl.style.position = containerEl.style.position || "relative";
    containerEl.style.width = `${width}px`;
    containerEl.style.height = `${height}px`;
    containerEl.style.overflow = "hidden";
    containerEl.style.transformOrigin = "center center";
  }

  let svgEl = containerEl.querySelector?.("svg") || null;
  if (!svgEl) {
    svgEl = doc.createElementNS(SVG_NS, "svg");
    svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svgEl.setAttribute("width", String(width));
    svgEl.setAttribute("height", String(height));
    svgEl.setAttribute("aria-hidden", "true");
    if (svgEl.style) {
      svgEl.style.position = "absolute";
      svgEl.style.left = "0";
      svgEl.style.top = "0";
    }
    containerEl.appendChild(svgEl);
  }
  let sceneGroup = svgEl.querySelector?.("[data-pf-scene]") || null;
  if (!sceneGroup) {
    sceneGroup = doc.createElementNS(SVG_NS, "g");
    sceneGroup.setAttribute("data-pf-scene", "1");
    svgEl.appendChild(sceneGroup);
  }

  let labelRoot = containerEl.querySelector?.("[data-pf-labels]") || null;
  if (!labelRoot) {
    labelRoot = doc.createElement("div");
    if (labelRoot.setAttribute) labelRoot.setAttribute("data-pf-labels", "1");
    if (labelRoot.style) {
      labelRoot.style.position = "absolute";
      labelRoot.style.left = "0";
      labelRoot.style.top = "0";
      labelRoot.style.width = `${width}px`;
      labelRoot.style.height = `${height}px`;
      labelRoot.style.pointerEvents = "none";
      labelRoot.style.transformOrigin = "0 0";
    }
    containerEl.appendChild(labelRoot);
  }

  let fixedLabelRoot = containerEl.querySelector?.("[data-pf-fixed-labels]") || null;
  if (!fixedLabelRoot) {
    fixedLabelRoot = doc.createElement("div");
    if (fixedLabelRoot.setAttribute) fixedLabelRoot.setAttribute("data-pf-fixed-labels", "1");
    if (fixedLabelRoot.style) {
      fixedLabelRoot.style.position = "absolute";
      fixedLabelRoot.style.left = "0";
      fixedLabelRoot.style.top = "0";
      fixedLabelRoot.style.width = `${width}px`;
      fixedLabelRoot.style.height = `${height}px`;
      fixedLabelRoot.style.pointerEvents = "none";
    }
    containerEl.appendChild(fixedLabelRoot);
  }

  const marks = createSvgMarks(svgEl, containerEl, curOverrides);
  const labels = createLabelLayer(labelRoot, { katex: spec.katex, fixedOverlayEl: fixedLabelRoot });
  let appliedCamSig = "identity";

  function applyCamera(cam) {
    const cx = Number(cam && cam.x != null ? cam.x : width / 2);
    const cy = Number(cam && cam.y != null ? cam.y : height / 2);
    const zoom = Math.max(0.05, Number(cam && cam.zoom != null ? cam.zoom : 1));
    const isIdentity = Math.abs(zoom - 1) < 1e-4 && Math.abs(cx - width / 2) < 0.05 && Math.abs(cy - height / 2) < 0.05;
    const sig = isIdentity ? "identity" : `${Math.round(cx * 100)}|${Math.round(cy * 100)}|${Math.round(zoom * 10000)}`;
    if (sig === appliedCamSig) return;
    appliedCamSig = sig;
    if (isIdentity) {
      if (sceneGroup.removeAttribute) sceneGroup.removeAttribute("transform");
      if (labelRoot.style) labelRoot.style.transform = "";
    } else {
      const tx = Math.round((width / 2 - cx * zoom) * 100) / 100;
      const ty = Math.round((height / 2 - cy * zoom) * 100) / 100;
      const z = Math.round(zoom * 10000) / 10000;
      if (sceneGroup.setAttribute) sceneGroup.setAttribute("transform", `translate(${tx} ${ty}) scale(${z})`);
      if (labelRoot.style) labelRoot.style.transform = `translate(${tx}px,${ty}px) scale(${z})`;
    }
  }

  function effectiveOverrides() {
    if (parentSection && (!curOverrides || !curOverrides.P)) {
      const activeScheme = (curOverrides && curOverrides.scheme) ||
        (parentRoot && parentRoot.dataset && (parentRoot.dataset.xarpColorScheme || parentRoot.dataset.pfStyle)) ||
        "default";
      if (activeScheme !== "default") {
        return { ...(curOverrides || {}), scheme: activeScheme, P: palette(parentSection) };
      }
    }
    return curOverrides;
  }

  function renderAt(t, state) {
    const effOv = effectiveOverrides();
    const G = marks.frame(sceneGroup, effOv);
    if (containerEl.style && spec.autoBackground !== false) {
      const inStyledDeck = Boolean(parentSection && G.scheme !== "default" && spec.autoBackground !== true);
      containerEl.style.background = inStyledDeck ? "transparent" : G.P.bg;
    }
    let frameCam = typeof spec.camera === "function" ? spec.camera(t) : (spec.camera || null);
    labels.begin(G, effOv && effOv.mapColor);
    spec.draw({
      marks,
      m: marks,
      labels,
      camera(nextCam) { frameCam = nextCam; },
      t,
      dt: state ? state.dt : 0,
      segment: state ? state.segment : 0,
      width,
      height,
      W: width,
      H: height,
      G,
      P: G.P,
      sceneGroup,
    });
    labels.end();
    applyCamera(frameCam);
  }

  const inMarpSlide = Boolean(containerEl.closest && containerEl.closest("svg[data-marpit-svg]"));
  const timeline = createStageTimeline({
    segments: spec.segments,
    duration: spec.duration ?? spec.cycle,
    loop: spec.loop ?? Boolean(spec.cycle && !spec.segments),
    printTime: spec.printTime,
    syncParentDeck: spec.syncParentDeck,
    exposeGlobal: spec.exposeGlobal ?? !inMarpSlide,
    onFrame: renderAt,
  });
  if (containerEl.dataset) containerEl.dataset.pfStage = "1";
  containerEl.__videoCtl = timeline;

  const fit = () => {
    if (!hasWin || !containerEl.style || spec.autoFit === false || (inMarpSlide && spec.autoFit !== true)) return;
    const s = Math.min(window.innerWidth / width, window.innerHeight / height) || 1;
    containerEl.style.transform = Math.abs(s - 1) < 1e-3 ? "" : `scale(${s})`;
  };

  function setStyle(schemeOrOverrides) {
    if (typeof schemeOrOverrides === "string") {
      const next = schemeOrOverrides || "default";
      if (next === "default") {
        if (curOverrides) {
          const rest = { ...curOverrides };
          delete rest.scheme;
          curOverrides = Object.keys(rest).length ? rest : null;
        }
        if (containerEl.dataset) delete containerEl.dataset.pfStyle;
      } else {
        curOverrides = { ...(curOverrides || {}), scheme: next };
        if (containerEl.dataset) containerEl.dataset.pfStyle = next;
      }
    } else {
      curOverrides = schemeOrOverrides;
      if (containerEl.dataset) {
        if (curOverrides && curOverrides.scheme && curOverrides.scheme !== "default") {
          containerEl.dataset.pfStyle = curOverrides.scheme;
        } else {
          delete containerEl.dataset.pfStyle;
        }
      }
    }
    renderAt(timeline.getTime(), null);
  }

  const onTheme = (ev) => {
    const detail = ev && ev.detail;
    const scheme = detail && typeof (detail.scheme ?? detail.selected) === "string"
      ? (detail.scheme ?? detail.selected)
      : null;
    if (scheme !== null) setStyle(scheme);
    else renderAt(timeline.getTime(), null);
  };

  if (hasWin) {
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("chao-theme-change", onTheme);
    window.addEventListener("xarp-color-scheme-change", onTheme);
    if (!inMarpSlide) window.__setXarpColorScheme = setStyle;
  }

  return {
    marks,
    labels,
    timeline,
    setStyle,
    render: () => renderAt(timeline.getTime(), null),
    destroy() {
      timeline.destroy();
      if (containerEl.__videoCtl === timeline) delete containerEl.__videoCtl;
      if (hasWin) {
        window.removeEventListener("resize", fit);
        window.removeEventListener("chao-theme-change", onTheme);
        window.removeEventListener("xarp-color-scheme-change", onTheme);
        if (window.__setXarpColorScheme === setStyle) delete window.__setXarpColorScheme;
      }
    },
  };
}
