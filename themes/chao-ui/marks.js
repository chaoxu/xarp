/* ==========================================================================
   Chao-UI Semantic Mark & Material Kit (marks.js)
   Zero-vendor-dependency semantic drawing & animation kit bridging chao-ui's
   roles + CSS tokens (--pf-vis-*, --pf-mark-*) across 33 craft grammars.

   Works identically across:
   1. Programmatic & 60fps animated <svg> stages  -> createSvgMarks / mountMarkedSvg
   2. Declarative inline <svg> figures            -> hydrateSvgMarks(svg, host)
   3. HTML5 <canvas> analytical figures           -> createCanvasMarks / mountMarkedDiagram
   ========================================================================== */

import {
  bump,
  clamp,
  clipHalfspace,
  createOctantScale,
  createPlotScale,
  ease,
  ellipseMatrixPoints,
  ellipsoidCutUpdate,
  feasiblePolygon,
  gpPosterior1D,
  knots,
  layoutTree,
  lerp,
  lineInBox,
  linearEnvelope,
  mixColor,
  mixRgb,
  mountDiagram,
  niceTicks,
  normBallPoints,
  palette,
  paretoFrontier,
  parseRgb,
  regularPolygonPoints,
  rgba,
  seg,
  spring,
  stagger,
} from "./diagrams.js";
import { createLabelLayer, createStageTimeline, mountCraftStage } from "./stage.js";

export {
  bump,
  clamp,
  clipHalfspace,
  createLabelLayer,
  createOctantScale,
  createPlotScale,
  createStageTimeline,
  ease,
  ellipseMatrixPoints,
  ellipsoidCutUpdate,
  feasiblePolygon,
  gpPosterior1D,
  knots,
  layoutTree,
  lerp,
  lineInBox,
  linearEnvelope,
  mixColor,
  mixRgb,
  mountCraftStage,
  niceTicks,
  normBallPoints,
  palette,
  paretoFrontier,
  parseRgb,
  regularPolygonPoints,
  rgba,
  seg,
  spring,
  stagger,
};

const SVG_NS = "http://www.w3.org/2000/svg";
const f1 = (n) => Math.round(n * 10) / 10;
const f2 = (n) => Math.round(n * 100) / 100;
const hypot2 = (dx, dy) => Math.sqrt(dx * dx + dy * dy);

/**
 * Canonical Material Grammar parameter bundles keyed by visual profile name.
 * CSS custom properties (--pf-mark-*) override any field when set to a non-'auto' value.
 */
export const STYLE_GRAMMARS = {
  default:        { node: "circle",  fill: "tint",       stroke: "crisp",  arrow: "triangle", panel: "hairline",  roughness: 0,    gap: 7,   multiply: false, scanAngle: -42 },
  swiss:          { node: "circle",  fill: "tint",       stroke: "crisp",  arrow: "triangle", panel: "hairline",  roughness: 0,    gap: 7,   multiply: false, scanAngle: -42 },
  // I. Core · Ink & Print
  "sumi-e":       { node: "dab",     fill: "wash",       stroke: "brush",  arrow: "flick",    panel: "scroll",    roughness: 0.28, gap: 7.5, multiply: true,  scanAngle: -38 },
  shuimo:         { node: "dab",     fill: "wash",       stroke: "brush",  arrow: "flick",    panel: "scroll",    roughness: 0.22, gap: 8.2, multiply: true,  scanAngle: -34 },
  manga:          { node: "nib",     fill: "screentone", stroke: "gpen",   arrow: "barb",     panel: "comic",     roughness: 0.14, gap: 5.5, multiply: false, scanAngle: -35 },
  "han-rubbing":  { node: "chisel",  fill: "stipple",    stroke: "chisel", arrow: "chisel",   panel: "stone",     roughness: 0.58, gap: 8,   multiply: false, scanAngle: -40 },
  "song-scroll":  { node: "dab",     fill: "wash",       stroke: "gpen",   arrow: "flick",    panel: "cartouche", roughness: 0.14, gap: 7.2, multiply: true,  scanAngle: -42 },
  qinglu:         { node: "shippo",  fill: "wash",       stroke: "brush",  arrow: "flick",    panel: "cartouche", roughness: 0.18, gap: 6.8, multiply: false, scanAngle: -45 },
  // II. Japanese Wagara & Craft
  washi:          { node: "dab",     fill: "wash",       stroke: "gpen",   arrow: "flick",    panel: "scroll",    roughness: 0.18, gap: 7.5, multiply: true,  scanAngle: -40 },
  shippo:         { node: "shippo",  fill: "weave",      stroke: "crisp",  arrow: "barb",     panel: "inlay",     roughness: 0,    gap: 7.5, multiply: true,  scanAngle: -45 },
  kikko:          { node: "diamond", fill: "weave",      stroke: "crisp",  arrow: "barb",     panel: "inlay",     roughness: 0,    gap: 7.6, multiply: true,  scanAngle: -60 },
  yagasuri:       { node: "diamond", fill: "weave",      stroke: "crisp",  arrow: "vee",      panel: "inlay",     roughness: 0,    gap: 6.4, multiply: true,  scanAngle: -52 },
  edo:            { node: "nib",     fill: "hachure",    stroke: "gpen",   arrow: "barb",     panel: "inlay",     roughness: 0.22, gap: 7,   multiply: true,  scanAngle: -42 },
  hanami:         { node: "shippo",  fill: "wash",       stroke: "crisp",  arrow: "flick",    panel: "scroll",    roughness: 0.10, gap: 7.5, multiply: true,  scanAngle: -60 },
  "wabi-sabi":    { node: "dab",     fill: "stipple",    stroke: "brush",  arrow: "flick",    panel: "stone",     roughness: 0.42, gap: 8.5, multiply: true,  scanAngle: -32 },
  "ukiyo-e":      { node: "nib",     fill: "wash",       stroke: "gpen",   arrow: "barb",     panel: "inlay",     roughness: 0.24, gap: 6.8, multiply: true,  scanAngle: -40 },
  urushi:         { node: "shippo",  fill: "stipple",    stroke: "gpen",   arrow: "flick",    panel: "cartouche", roughness: 0.15, gap: 7.4, multiply: false, scanAngle: -45 },
  // III. Wood Mosaic, Kumiko & Mosque Tilework
  yosegi:         { node: "diamond", fill: "weave",      stroke: "crisp",  arrow: "vee",      panel: "inlay",     roughness: 0,    gap: 6.6, multiply: true,  scanAngle: -45 },
  kumiko:         { node: "star8",   fill: "weave",      stroke: "crisp",  arrow: "vee",      panel: "inlay",     roughness: 0,    gap: 7.2, multiply: true,  scanAngle: -60 },
  zellij:         { node: "star8",   fill: "weave",      stroke: "crisp",  arrow: "barb",     panel: "cartouche", roughness: 0,    gap: 6.8, multiply: true,  scanAngle: -45 },
  isfahan:        { node: "star8",   fill: "weave",      stroke: "gpen",   arrow: "barb",     panel: "cartouche", roughness: 0.10, gap: 7.2, multiply: false, scanAngle: -60 },
  // IV. Pelican 6000 · Art History
  sahara:         { node: "chisel",  fill: "stipple",    stroke: "chisel", arrow: "chisel",   panel: "stone",     roughness: 0.65, gap: 8.2, multiply: true,  scanAngle: -34 },
  egypt:          { node: "diamond", fill: "hachure",    stroke: "gpen",   arrow: "barb",     panel: "inlay",     roughness: 0.20, gap: 7.2, multiply: true,  scanAngle: -45 },
  maya:           { node: "chisel",  fill: "hachure",    stroke: "chisel", arrow: "chisel",   panel: "stone",     roughness: 0.48, gap: 7.0, multiply: true,  scanAngle: -40 },
  mughal:         { node: "star8",   fill: "weave",      stroke: "gpen",   arrow: "barb",     panel: "cartouche", roughness: 0.12, gap: 7,   multiply: true,  scanAngle: -45 },
  wayang:         { node: "diamond", fill: "stipple",    stroke: "gpen",   arrow: "barb",     panel: "inlay",     roughness: 0.24, gap: 7.5, multiply: false, scanAngle: -42 },
  starry:         { node: "dab",     fill: "stipple",    stroke: "brush",  arrow: "flick",    panel: "inlay",     roughness: 0.50, gap: 6.2, multiply: false, scanAngle: -28 },
  scream:         { node: "dab",     fill: "hachure",    stroke: "brush",  arrow: "flick",    panel: "stone",     roughness: 0.56, gap: 6.6, multiply: false, scanAngle: -22 },
  nitrate:        { node: "circle",  fill: "hachure",    stroke: "gpen",   arrow: "triangle", panel: "inlay",     roughness: 0.28, gap: 6.5, multiply: false, scanAngle: -45 },
  // V. Pelican 6000 · Analog & Digital
  blueprint:      { node: "reticle", fill: "hachure",    stroke: "crisp",  arrow: "vee",      panel: "graticule", roughness: 0,    gap: 6.5, multiply: false, scanAngle: -45 },
  oscilloscope:   { node: "reticle", fill: "scanline",   stroke: "crisp",  arrow: "vee",      panel: "graticule", roughness: 0,    gap: 5.5, multiply: false, scanAngle: 90  },
  "pixel-8bit":   { node: "pixel",   fill: "dither",     stroke: "pixel",  arrow: "pixel",    panel: "pixel",     roughness: 0,    gap: 6,   multiply: false, scanAngle: 0   },
  win2000:        { node: "pixel",   fill: "dither",     stroke: "crisp",  arrow: "pixel",    panel: "bevel",     roughness: 0,    gap: 6,   multiply: false, scanAngle: 0   },
  vaporwave:      { node: "diamond", fill: "scanline",   stroke: "crisp",  arrow: "vee",      panel: "graticule", roughness: 0,    gap: 5.8, multiply: false, scanAngle: 0   },
  "code-art":     { node: "diamond", fill: "weave",      stroke: "crisp",  arrow: "vee",      panel: "graticule", roughness: 0,    gap: 6.2, multiply: false, scanAngle: -30 },
};

function hashSeed(n) {
  let x = (Number(n) || 1) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = (x ^ (x >>> 16)) & 0x7fffffff;
  return x || 1;
}

/**
 * Stateless 32-bit FNV-1a hash folded into a positive 31-bit seed (1..0x7fffffff).
 * Anchors procedural seeds to invariant shape geometry so conditional reveals
 * never shift downstream seeds mid-animation.
 */
export function fnv1aSeed(str) {
  const s = String(str);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return hashSeed(h);
}

function seededRand(seed) {
  let s = hashSeed(seed);
  return () => {
    s = (Math.imul(s, 48271) % 2147483647) & 0x7fffffff;
    return (s - 1) / 2147483646;
  };
}

const ROLE_CODES = {
  "": 0, primary: 1, caveat: 2, auxiliary: 3, baseline: 4,
  ink: 5, muted: 6, grid: 7, surface: 8, paper: 9,
};

function roleCode(role) {
  if (!role) return 0;
  const hit = ROLE_CODES[role];
  return hit !== undefined ? hit : fnv1aSeed(role);
}

function anchorSeed2(tagHash, a, b, role) {
  let h = tagHash | 0;
  h = Math.imul(h ^ (Math.round(a) | 0), 0x01000193);
  h = Math.imul(h ^ (Math.round(b) | 0), 0x01000193);
  h = Math.imul(h ^ (roleCode(role) | 0), 0x01000193);
  return hashSeed(h);
}

function anchorSeed3(tagHash, a, b, c, extra = 0) {
  let h = tagHash | 0;
  h = Math.imul(h ^ (Math.round(a) | 0), 0x01000193);
  h = Math.imul(h ^ (Math.round(b) | 0), 0x01000193);
  h = Math.imul(h ^ (Math.round(c) | 0), 0x01000193);
  h = Math.imul(h ^ (extra | 0), 0x01000193);
  return hashSeed(h);
}

function anchorSeed4(tagHash, a, b, c, d) {
  let h = tagHash | 0;
  h = Math.imul(h ^ (Math.round(a) | 0), 0x01000193);
  h = Math.imul(h ^ (Math.round(b) | 0), 0x01000193);
  h = Math.imul(h ^ (Math.round(c) | 0), 0x01000193);
  h = Math.imul(h ^ (Math.round(d) | 0), 0x01000193);
  return hashSeed(h);
}

const GRAMMAR_ID_MAP = new Map();
let nextGrammarId = 1;

function getGrammarId(key) {
  let id = GRAMMAR_ID_MAP.get(key);
  if (id === undefined) {
    if (GRAMMAR_ID_MAP.size >= 1024) GRAMMAR_ID_MAP.clear();
    id = nextGrammarId++;
    GRAMMAR_ID_MAP.set(key, id);
  }
  return id;
}

function cleanToken(v) {
  return String(v || "").trim().replace(/^["']|["']$/g, "").toLowerCase();
}

function readDatasetScheme(el) {
  if (!el || !el.dataset) return "";
  return (
    el.dataset.pfStyle ||
    el.dataset.hrsStyle ||
    el.dataset.colorScheme ||
    el.dataset.xarpColorScheme ||
    ""
  );
}

const FALLBACK_PALETTE = {
  bg: "#ffffff", fg: "#1e1c1a", muted: "#76716a", grid: "#e7e4de", surface: "#f8fafc",
  slate: "#4f7d96", terracotta: "#c85a40", ochre: "#c68d28", stone: "#cbc6be",
  slateRgb: [79, 125, 150], terraRgb: [200, 90, 64], ochreRgb: [198, 141, 40],
  stoneRgb: [203, 198, 190], fgRgb: [30, 28, 26],
};

/**
 * Read live semantic mark grammar & palette from host element CSS tokens,
 * falling back to data-pf-style / data-hrs-style / data-color-scheme / data-xarp-color-scheme or overrides.
 */
export function markGrammar(el = null, overrides = null) {
  const target = el || (typeof document !== "undefined" ? document.documentElement : null);
  const ovP = overrides && overrides.P;
  const hasFullOvPalette = Boolean(
    ovP && ovP.bg && ovP.fg && ovP.muted && ovP.grid && ovP.surface && ovP.slate && ovP.terracotta && ovP.ochre && ovP.stone
  );
  const baseP = hasFullOvPalette
    ? FALLBACK_PALETTE
    : target && typeof getComputedStyle === "function"
      ? palette(target)
      : FALLBACK_PALETTE;
  const P = ovP ? { ...baseP, ...ovP } : baseP;

  let scheme = cleanToken(overrides && overrides.scheme);
  if (!scheme && target) {
    const ancestor = typeof target.closest === "function"
      ? target.closest("[data-pf-style],[data-hrs-style],[data-color-scheme],[data-xarp-color-scheme]")
      : null;
    const rootEl = typeof document !== "undefined" ? document.documentElement : null;
    scheme = cleanToken(readDatasetScheme(target) || readDatasetScheme(ancestor) || readDatasetScheme(rootEl));
  }
  const base = STYLE_GRAMMARS[scheme] || STYLE_GRAMMARS.default;

  const needCss = !(
    overrides &&
    overrides.node != null &&
    overrides.fill != null &&
    overrides.stroke != null &&
    overrides.arrow != null &&
    overrides.panel != null &&
    overrides.roughness != null &&
    overrides.gap != null
  );
  const cs = needCss && target && typeof getComputedStyle === "function" ? getComputedStyle(target) : null;
  const cssTok = (prop) => {
    if (!cs) return "";
    const t = cleanToken(cs.getPropertyValue(prop));
    return t === "auto" || t === "initial" || t === "unset" ? "" : t;
  };
  const cssNum = (prop) => {
    if (!cs) return NaN;
    const raw = cleanToken(cs.getPropertyValue(prop));
    if (!raw || raw === "auto" || raw === "initial" || raw === "unset") return NaN;
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  };

  const node = (overrides && overrides.node) || cssTok("--pf-mark-node") || base.node;
  const fill = (overrides && overrides.fill) || cssTok("--pf-mark-fill") || base.fill;
  const stroke = (overrides && overrides.stroke) || cssTok("--pf-mark-stroke") || base.stroke;
  const arrow = (overrides && overrides.arrow) || cssTok("--pf-mark-arrow") || base.arrow;
  const panel = (overrides && overrides.panel) || cssTok("--pf-mark-panel") || base.panel;

  const cssR = cssNum("--pf-mark-roughness");
  const roughness = clamp(
    overrides && overrides.roughness != null
      ? Number(overrides.roughness)
      : Number.isFinite(cssR)
        ? cssR
        : base.roughness,
    0,
    2
  );
  const cssG = cssNum("--pf-mark-gap");
  const gap = clamp(
    overrides && overrides.gap != null
      ? Number(overrides.gap)
      : Number.isFinite(cssG)
        ? cssG
        : base.gap,
    3.5,
    24
  );
  const cssA = cssNum("--pf-mark-scan-angle");
  const scanAngle = overrides && overrides.scanAngle != null
    ? Number(overrides.scanAngle)
    : Number.isFinite(cssA)
      ? cssA
      : base.scanAngle;

  const bgRgb = parseRgb(P.bg, [255, 255, 255]);
  const fgRgb = P.fgRgb || parseRgb(P.fg, [30, 28, 26]);
  const slateRgb = P.slateRgb || parseRgb(P.slate, [79, 125, 150]);
  const terraRgb = P.terraRgb || parseRgb(P.terracotta, [200, 90, 64]);
  const isDark = (bgRgb[0] * 0.299 + bgRgb[1] * 0.587 + bgRgb[2] * 0.114) < 115;
  const multiply = overrides && overrides.multiply != null ? Boolean(overrides.multiply) : Boolean(base.multiply && !isDark);
  const effScheme = scheme || "default";
  const key = `${effScheme}|${node}|${fill}|${stroke}|${arrow}|${panel}|${roughness}|${gap}|${scanAngle}|${multiply ? 1 : 0}|${isDark ? 1 : 0}|${P.bg}|${P.fg}|${P.slate}|${P.terracotta}|${P.ochre}|${P.stone}|${P.surface}|${P.grid}|${P.muted}`;

  return {
    id: getGrammarId(key),
    scheme: effScheme,
    isSwiss:
      node === "circle" &&
      fill === "tint" &&
      stroke === "crisp" &&
      arrow === "triangle" &&
      panel === "hairline" &&
      roughness === 0,
    isDark,
    node,
    fill,
    stroke,
    arrow,
    panel,
    roughness,
    gap,
    multiply,
    scanAngle,
    P,
    bgRgb,
    fgRgb,
    slateRgb,
    terraRgb,
    key,
  };
}

export function resolveRoleColor(G, role = "primary") {
  const P = G.P;
  switch (role) {
    case "primary":   return P.slate;
    case "caveat":    return P.terracotta;
    case "auxiliary": return P.ochre;
    case "baseline":  return P.stone;
    case "ink":       return P.fg;
    case "muted":     return P.muted;
    case "grid":      return P.grid;
    case "surface":   return P.surface;
    case "paper":     return P.bg;
    default:          return P.slate;
  }
}

function luminance(col, fb = 128) {
  if (!col || col === "none" || col.charCodeAt(0) === 117 /* 'u' */) return fb;
  const rgb = parseRgb(col, [fb, fb, fb]);
  return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
}

function colorDistSqRgb(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

/**
 * Convert a perfect-freehand polygon outline into a smooth quadratic SVG path.
 */
export function strokeOutlineToSvgPath(points, closed = true) {
  const len = points.length;
  if (len < 3) return "";
  let d = `M ${f1(points[0][0])} ${f1(points[0][1])} Q ${f1(points[1][0])} ${f1(points[1][1])} ${f1((points[1][0] + points[2][0]) * 0.5)} ${f1((points[1][1] + points[2][1]) * 0.5)}`;
  for (let i = 2; i < len - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    d += ` T ${f1((p0[0] + p1[0]) * 0.5)} ${f1((p0[1] + p1[1]) * 0.5)}`;
  }
  if (closed) {
    const last = points[len - 1];
    const first = points[0];
    d += ` T ${f1((last[0] + first[0]) * 0.5)} ${f1((last[1] + first[1]) * 0.5)} Z`;
  }
  return d;
}

let SCRATCH_SEGS = new Float64Array(64);

function slicePolyline(pts, progress) {
  const p = clamp(progress ?? 1, 0, 1);
  const nSeg = pts.length - 1;
  if (p >= 0.999 || nSeg < 1) return pts;
  if (p <= 0.001) return [];
  if (nSeg > SCRATCH_SEGS.length) SCRATCH_SEGS = new Float64Array(nSeg * 2);
  let total = 0;
  for (let i = 0; i < nSeg; i++) {
    const L = hypot2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    SCRATCH_SEGS[i] = L;
    total += L;
  }
  if (total < 1e-6) return [pts[0]];
  let budget = total * p;
  const out = [pts[0]];
  for (let i = 0; i < nSeg; i++) {
    const segL = SCRATCH_SEGS[i];
    if (budget >= segL) {
      out.push(pts[i + 1]);
      budget -= segL;
    } else {
      if (budget > 1e-4 && segL > 1e-6) {
        const u = budget / segL;
        out.push([lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u)]);
      }
      break;
    }
  }
  return out;
}

function trimPolylineEnd(pts, setback) {
  if (!pts || pts.length < 2 || !(setback > 0)) return pts;
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += hypot2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  if (total <= setback * 1.35) return pts;
  let rem = setback;
  const copy = pts.slice();
  while (copy.length >= 2 && rem > 1e-4) {
    const n = copy.length;
    const p0 = copy[n - 2];
    const p1 = copy[n - 1];
    const segLen = hypot2(p1[0] - p0[0], p1[1] - p0[1]);
    if (segLen <= rem + 1e-6 && n > 2) {
      rem -= segLen;
      copy.pop();
    } else if (segLen > 1e-6) {
      const u = clamp(1 - rem / segLen, 0.05, 1);
      copy[n - 1] = [lerp(p0[0], p1[0], u), lerp(p0[1], p1[1], u)];
      break;
    } else {
      copy.pop();
    }
  }
  return copy;
}

function sampleSvgArc(x1, y1, rxIn, ryIn, phiDeg, largeArc, sweep, x2, y2, samples = 14) {
  if (Math.hypot(x2 - x1, y2 - y1) < 1e-6) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx < 1e-6 || ry < 1e-6) return [[x2, y2]];
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
  }
  const num = Math.max(0, rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p);
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const sign = Boolean(largeArc) === Boolean(sweep) ? -1 : 1;
  const coef = den > 1e-9 ? sign * Math.sqrt(num / den) : 0;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

  const vecAngle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const ang = Math.acos(clamp(len > 1e-9 ? dot / len : 1, -1, 1));
    return ux * vy - uy * vx < 0 ? -ang : ang;
  };
  const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vecAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= Math.PI * 2;
  if (sweep && dTheta < 0) dTheta += Math.PI * 2;

  const steps = Math.max(4, Math.ceil((Math.abs(dTheta) / (Math.PI / 2)) * Math.max(4, Math.round(samples / 2))));
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const th = theta1 + (dTheta * i) / steps;
    const px = cosP * rx * Math.cos(th) - sinP * ry * Math.sin(th) + cx;
    const py = sinP * rx * Math.cos(th) + cosP * ry * Math.sin(th) + cy;
    out.push([px, py]);
  }
  return out;
}

const SUBPATH_CACHE = new Map();
const SVG_CMD_NEED = {
  M: 2, m: 2, L: 2, l: 2, H: 1, h: 1, V: 1, v: 1,
  C: 6, c: 6, S: 4, s: 4, Q: 4, q: 4, T: 2, t: 2,
  A: 7, a: 7, Z: 0, z: 0,
};
const SVG_NUM_ARGS = new Float64Array(8);
const SVG_SCAN_POS = { i: 0 };

function skipSvgSep(raw, len, idx) {
  while (idx < len) {
    const c = raw.charCodeAt(idx);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 44) idx++;
    else break;
  }
  return idx;
}

function scanSvgNum(raw, len) {
  let i = skipSvgSep(raw, len, SVG_SCAN_POS.i);
  if (i >= len) { SVG_SCAN_POS.i = i; return NaN; }
  const start = i;
  let c = raw.charCodeAt(i);
  if (c === 43 || c === 45) i++;
  let hasDigits = false;
  while (i < len) {
    c = raw.charCodeAt(i);
    if (c >= 48 && c <= 57) { hasDigits = true; i++; }
    else break;
  }
  if (i < len && raw.charCodeAt(i) === 46) {
    i++;
    while (i < len) {
      c = raw.charCodeAt(i);
      if (c >= 48 && c <= 57) { hasDigits = true; i++; }
      else break;
    }
  }
  if (!hasDigits) { SVG_SCAN_POS.i = start; return NaN; }
  if (i < len) {
    c = raw.charCodeAt(i);
    if (c === 101 || c === 69) {
      let j = i + 1;
      if (j < len && (raw.charCodeAt(j) === 43 || raw.charCodeAt(j) === 45)) j++;
      let expDigits = false;
      while (j < len && raw.charCodeAt(j) >= 48 && raw.charCodeAt(j) <= 57) { expDigits = true; j++; }
      if (expDigits) i = j;
    }
  }
  SVG_SCAN_POS.i = i;
  return Number(raw.slice(start, i));
}

/**
 * Sample all subpaths of an SVG path `d` into an array of polylines.
 * Supports absolute & relative M, L, H, V, C, S, Q, T, A, Z commands and packed decimals.
 */
export function sampleSvgSubpaths(d, samplesPerCurve = 12) {
  const raw = String(d || "");
  const len = raw.length;
  if (len < 3) return null;
  const cacheable = len <= 420;
  const cKey = cacheable ? `${samplesPerCurve}|${raw}` : "";
  if (cacheable) {
    const hit = SUBPATH_CACHE.get(cKey);
    if (hit !== undefined) return hit;
  }

  const subpaths = [];
  let cur = null;
  let cmd = "";
  let prevCmd = "";
  let cx = 0, cy = 0;
  let sx = 0, sy = 0;
  let lastCx = 0, lastCy = 0;
  SVG_SCAN_POS.i = 0;

  while (true) {
    const i = skipSvgSep(raw, len, SVG_SCAN_POS.i);
    if (i >= len) break;
    const cc = raw.charCodeAt(i);
    if ((cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122)) {
      const ch = raw[i];
      if (!(ch in SVG_CMD_NEED)) return null;
      cmd = ch;
      SVG_SCAN_POS.i = i + 1;
      if (cmd === "Z" || cmd === "z") {
        if (cur && cur.length) {
          if (hypot2(cx - sx, cy - sy) > 1e-5) cur.push([sx, sy]);
          cx = sx;
          cy = sy;
        }
        prevCmd = cmd;
        continue;
      }
    } else {
      SVG_SCAN_POS.i = i;
    }
    const need = SVG_CMD_NEED[cmd];
    if (need == null) return null;
    for (let k = 0; k < need; k++) {
      const v = scanSvgNum(raw, len);
      if (!Number.isFinite(v)) return null;
      SVG_NUM_ARGS[k] = v;
    }
    const a = SVG_NUM_ARGS;
    const rel = cmd.charCodeAt(0) >= 97;
    const upper = rel ? cmd.toUpperCase() : cmd;

    if (upper === "M") {
      cx = rel ? cx + a[0] : a[0];
      cy = rel ? cy + a[1] : a[1];
      sx = cx;
      sy = cy;
      cur = [[cx, cy]];
      subpaths.push(cur);
      cmd = rel ? "l" : "L";
    } else {
      if (!cur) {
        cur = [[cx, cy]];
        subpaths.push(cur);
      }
      if (upper === "L") {
        cx = rel ? cx + a[0] : a[0];
        cy = rel ? cy + a[1] : a[1];
        cur.push([cx, cy]);
      } else if (upper === "H") {
        cx = rel ? cx + a[0] : a[0];
        cur.push([cx, cy]);
      } else if (upper === "V") {
        cy = rel ? cy + a[0] : a[0];
        cur.push([cx, cy]);
      } else if (upper === "Q" || upper === "T") {
        let x1, y1, x2, y2;
        if (upper === "Q") {
          x1 = rel ? cx + a[0] : a[0];
          y1 = rel ? cy + a[1] : a[1];
          x2 = rel ? cx + a[2] : a[2];
          y2 = rel ? cy + a[3] : a[3];
        } else {
          const prevQ = prevCmd === "Q" || prevCmd === "q" || prevCmd === "T" || prevCmd === "t";
          x1 = prevQ ? 2 * cx - lastCx : cx;
          y1 = prevQ ? 2 * cy - lastCy : cy;
          x2 = rel ? cx + a[0] : a[0];
          y2 = rel ? cy + a[1] : a[1];
        }
        for (let s = 1; s <= samplesPerCurve; s++) {
          const t = s / samplesPerCurve;
          const mt = 1 - t;
          cur.push([mt * mt * cx + 2 * mt * t * x1 + t * t * x2, mt * mt * cy + 2 * mt * t * y1 + t * t * y2]);
        }
        lastCx = x1; lastCy = y1;
        cx = x2; cy = y2;
      } else if (upper === "C" || upper === "S") {
        let x1, y1, x2, y2, x3, y3;
        if (upper === "C") {
          x1 = rel ? cx + a[0] : a[0];
          y1 = rel ? cy + a[1] : a[1];
          x2 = rel ? cx + a[2] : a[2];
          y2 = rel ? cy + a[3] : a[3];
          x3 = rel ? cx + a[4] : a[4];
          y3 = rel ? cy + a[5] : a[5];
        } else {
          const prevC = prevCmd === "C" || prevCmd === "c" || prevCmd === "S" || prevCmd === "s";
          x1 = prevC ? 2 * cx - lastCx : cx;
          y1 = prevC ? 2 * cy - lastCy : cy;
          x2 = rel ? cx + a[0] : a[0];
          y2 = rel ? cy + a[1] : a[1];
          x3 = rel ? cx + a[2] : a[2];
          y3 = rel ? cy + a[3] : a[3];
        }
        for (let s = 1; s <= samplesPerCurve; s++) {
          const t = s / samplesPerCurve;
          const mt = 1 - t;
          cur.push([
            mt * mt * mt * cx + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
            mt * mt * mt * cy + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
          ]);
        }
        lastCx = x2; lastCy = y2;
        cx = x3; cy = y3;
      } else if (upper === "A") {
        const x2 = rel ? cx + a[5] : a[5];
        const y2 = rel ? cy + a[6] : a[6];
        const arcPts = sampleSvgArc(cx, cy, a[0], a[1], a[2], a[3] !== 0, a[4] !== 0, x2, y2, samplesPerCurve);
        for (let k = 0; k < arcPts.length; k++) cur.push(arcPts[k]);
        cx = x2; cy = y2;
      }
    }
    prevCmd = upper;
  }
  const valid = [];
  for (let i = 0; i < subpaths.length; i++) {
    if (subpaths[i].length >= 2) valid.push(subpaths[i]);
  }
  const res = valid.length ? valid : null;
  if (cacheable) {
    if (SUBPATH_CACHE.size >= 512) SUBPATH_CACHE.clear();
    SUBPATH_CACHE.set(cKey, res);
  }
  return res;
}

/**
 * Sample a single-subpath SVG `d` string into a polyline.
 * Returns null if `d` is empty, malformed, or contains multiple subpaths.
 */
export function sampleSimpleSvgPath(d, samplesPerCurve = 12) {
  const subs = sampleSvgSubpaths(d, samplesPerCurve);
  return subs && subs.length === 1 ? subs[0] : null;
}

const ANCHOR_SEED_CACHE = new Map();

function polylineAnchorSeed(prefixHash, ptsOrPath, explicitSeed) {
  if (explicitSeed != null) return explicitSeed;
  if (Array.isArray(ptsOrPath)) {
    if (ptsOrPath.length === 0) return hashSeed(prefixHash);
    const x0 = ptsOrPath[0][0], y0 = ptsOrPath[0][1];
    let angQ = 0;
    for (let i = 1; i < ptsOrPath.length; i++) {
      const dx = ptsOrPath[i][0] - x0;
      const dy = ptsOrPath[i][1] - y0;
      if (dx * dx + dy * dy > 0.25) {
        angQ = Math.round(Math.atan2(dy, dx) * 32);
        break;
      }
    }
    return anchorSeed4(prefixHash, x0, y0, angQ, 1);
  }
  const isStr = typeof ptsOrPath === "string" && ptsOrPath.length <= 420;
  const cKey = isStr ? `${prefixHash}|${ptsOrPath}` : "";
  if (isStr) {
    const hit = ANCHOR_SEED_CACHE.get(cKey);
    if (hit !== undefined) return hit;
  }
  const subs = typeof ptsOrPath === "string" ? sampleSvgSubpaths(ptsOrPath, 4) : null;
  const pts = subs && subs[0];
  let out;
  if (!pts || pts.length === 0) {
    out = fnv1aSeed(`${prefixHash}:${String(ptsOrPath || "")}`);
  } else {
    const x0 = pts[0][0], y0 = pts[0][1];
    let angQ = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - x0;
      const dy = pts[i][1] - y0;
      if (dx * dx + dy * dy > 0.25) {
        angQ = Math.round(Math.atan2(dy, dx) * 32);
        break;
      }
    }
    out = anchorSeed4(prefixHash, x0, y0, angQ, subs.length);
  }
  if (isStr) {
    if (ANCHOR_SEED_CACHE.size >= 512) ANCHOR_SEED_CACHE.clear();
    ANCHOR_SEED_CACHE.set(cKey, out);
  }
  return out;
}

function serializePointsKey(ptsOrPath) {
  if (typeof ptsOrPath === "string") return ptsOrPath;
  if (!Array.isArray(ptsOrPath)) return "";
  let s = "";
  for (let i = 0; i < ptsOrPath.length; i++) {
    const p = ptsOrPath[i];
    if (i > 0) s += ";";
    s += `${f2(p[0])},${f2(p[1])}`;
  }
  return s;
}

function polygonBounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0], y = pts[i][1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

function regularStarData(cx, cy, outerR, innerR, points, rotRad = 0) {
  const total = points * 2;
  const closedPts = new Float32Array(total * 2);
  let d = "";
  const step = Math.PI / points;
  for (let i = 0; i < total; i++) {
    const r = (i & 1) === 0 ? outerR : innerR;
    const a = rotRad + i * step;
    const px = f2(cx + Math.cos(a) * r);
    const py = f2(cy + Math.sin(a) * r);
    closedPts[i * 2] = px;
    closedPts[i * 2 + 1] = py;
    d += i === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`;
  }
  d += " Z";
  return { d, closedPts };
}

function shippoFloretData(cx, cy, r, lobes = 4) {
  const qsegs = new Float32Array(lobes * 6);
  let d = "";
  const valleyR = lobes === 4 ? r * 0.62 : r * 0.86;
  const peakR = lobes === 4 ? r * 1.28 : r * 1.08;
  const step = (2 * Math.PI) / lobes;
  for (let i = 0; i < lobes; i++) {
    const a0 = i * step - Math.PI / 4;
    const a1 = a0 + step;
    const am = a0 + step * 0.5;
    const x0 = f2(cx + Math.cos(a0) * valleyR);
    const y0 = f2(cy + Math.sin(a0) * valleyR);
    const xm = f2(cx + Math.cos(am) * peakR);
    const ym = f2(cy + Math.sin(am) * peakR);
    const x1 = f2(cx + Math.cos(a1) * valleyR);
    const y1 = f2(cy + Math.sin(a1) * valleyR);
    const base = i * 6;
    qsegs[base] = x0; qsegs[base + 1] = y0;
    qsegs[base + 2] = xm; qsegs[base + 3] = ym;
    qsegs[base + 4] = x1; qsegs[base + 5] = y1;
    if (i === 0) d = `M ${x0} ${y0}`;
    d += ` Q ${xm} ${ym} ${x1} ${y1}`;
  }
  d += " Z";
  return { d, qloop: qsegs };
}

function chiseledNodeData(cx, cy, r, seed) {
  const rand = seededRand(seed);
  const facets = r >= 18 ? 14 : 10;
  const rot = rand() * Math.PI * 2;
  const closedPts = new Float32Array(facets * 2);
  let d = "";
  const step = (2 * Math.PI) / facets;
  for (let i = 0; i < facets; i++) {
    const a = rot + i * step + (rand() - 0.5) * 0.14;
    const rf = r * (0.94 + (rand() - 0.5) * 0.16);
    const px = f2(cx + Math.cos(a) * rf);
    const py = f2(cy + Math.sin(a) * rf);
    closedPts[i * 2] = px;
    closedPts[i * 2 + 1] = py;
    d += i === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`;
  }
  d += " Z";
  return { d, closedPts };
}

function flatOutlineToSvgPath(flat) {
  const nPts = flat.length >> 1;
  if (nPts < 3) return "";
  let d = `M ${f1(flat[0])} ${f1(flat[1])} Q ${f1(flat[2])} ${f1(flat[3])} ${f1((flat[2] + flat[4]) * 0.5)} ${f1((flat[3] + flat[5]) * 0.5)}`;
  for (let i = 4; i < flat.length - 2; i += 2) {
    d += ` T ${f1((flat[i] + flat[i + 2]) * 0.5)} ${f1((flat[i + 1] + flat[i + 3]) * 0.5)}`;
  }
  const lastIdx = flat.length - 2;
  d += ` T ${f1((flat[lastIdx] + flat[0]) * 0.5)} ${f1((flat[lastIdx + 1] + flat[1]) * 0.5)} Z`;
  return d;
}

function ensoRingData(cx, cy, r, sw, ang) {
  const N = 14;
  const maxHalfW = Math.max(0.95, (sw || 1.8) * 0.68);
  const totalPts = (N + 1) * 2;
  const flat = new Float32Array(totalPts * 2);
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const a = ang + u * Math.PI * 1.94;
    const ca = Math.cos(a), sa = Math.sin(a);
    const rr = r * (1 + 0.022 * Math.sin(u * Math.PI * 3));
    const hw = maxHalfW * (0.22 + 0.88 * Math.sin(Math.pow(u, 0.82) * Math.PI));
    const li = i * 2;
    const ri = (totalPts - 1 - i) * 2;
    flat[li] = cx + ca * (rr + hw);
    flat[li + 1] = cy + sa * (rr + hw);
    const inR = Math.max(0.5, rr - hw);
    flat[ri] = cx + ca * inR;
    flat[ri + 1] = cy + sa * inR;
  }
  return { d: flatOutlineToSvgPath(flat), smoothPoly: flat };
}

function taperedSegmentData(x0, y0, x1, y1, sw, isBrush, seed) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = hypot2(dx, dy);
  if (len < 0.5) return null;
  const tx = dx / len, ty = dy / len;
  const nx = -ty, ny = tx;
  const maxHw = sw * (isBrush ? 0.68 : 0.56);
  const phase = (seed % 97) * 0.064;
  const S = 6;
  const totalPts = (S + 1) * 2;
  const flat = new Float32Array(totalPts * 2);
  for (let i = 0; i <= S; i++) {
    const u = i / S;
    const px = x0 + dx * u;
    const py = y0 + dy * u;
    const env = isBrush
      ? 0.24 + 0.78 * Math.sin(Math.pow(u, 0.82) * Math.PI) + 0.07 * Math.sin(u * 6 + phase)
      : 0.34 + 0.62 * Math.sin(u * Math.PI) + 0.04 * Math.cos(u * 5 + phase);
    const hw = maxHw * clamp(env, 0.16, 1.05);
    const li = i * 2;
    const ri = (totalPts - 1 - i) * 2;
    flat[li] = px + nx * hw;
    flat[li + 1] = py + ny * hw;
    flat[ri] = px - nx * hw;
    flat[ri + 1] = py - ny * hw;
  }
  return { d: flatOutlineToSvgPath(flat), smoothPoly: flat };
}

let SPINE_X = new Float64Array(128);
let SPINE_Y = new Float64Array(128);
let SPINE_S = new Float64Array(128);

function pushSpinePt(idx, x, y) {
  if (idx >= SPINE_X.length) {
    const n2 = SPINE_X.length * 2;
    const gx = new Float64Array(n2); gx.set(SPINE_X); SPINE_X = gx;
    const gy = new Float64Array(n2); gy.set(SPINE_Y); SPINE_Y = gy;
    SPINE_S = new Float64Array(n2);
  }
  SPINE_X[idx] = x;
  SPINE_Y[idx] = y;
  return idx + 1;
}

function taperedPolylineData(pts, sw, isBrush, seed) {
  const n = pts.length;
  if (n < 2) return null;
  if (n === 2) return taperedSegmentData(pts[0][0], pts[0][1], pts[1][0], pts[1][1], sw, isBrush, seed);

  let cnt = pushSpinePt(0, pts[0][0], pts[0][1]);
  let prevX = pts[0][0], prevY = pts[0][1];
  const emitSpanTo = (tx, ty) => {
    const segD = hypot2(tx - prevX, ty - prevY);
    if (segD < 0.25) return;
    if (segD > 42) {
      cnt = pushSpinePt(cnt, (prevX + tx) * 0.5, (prevY + ty) * 0.5);
    }
    cnt = pushSpinePt(cnt, tx, ty);
    prevX = tx;
    prevY = ty;
  };

  for (let k = 1; k < n - 1; k++) {
    const pkx = pts[k][0], pky = pts[k][1];
    const dx0 = pkx - prevX, dy0 = pky - prevY;
    const L0 = hypot2(dx0, dy0);
    const dx1 = pts[k + 1][0] - pkx, dy1 = pts[k + 1][1] - pky;
    const L1 = hypot2(dx1, dy1);
    if (L0 < 0.3 || L1 < 0.3) continue;
    const tx0 = dx0 / L0, ty0 = dy0 / L0;
    const tx1 = dx1 / L1, ty1 = dy1 / L1;
    const cosTurn = tx0 * tx1 + ty0 * ty1;
    if (cosTurn < 0.88 && L0 > 2.5 && L1 > 2.5) {
      const rc = Math.min(8, 0.32 * Math.min(L0, L1));
      const ax = pkx - tx0 * rc, ay = pky - ty0 * rc;
      const bx = pkx + tx1 * rc, by = pky + ty1 * rc;
      emitSpanTo(ax, ay);
      cnt = pushSpinePt(cnt, 0.25 * ax + 0.5 * pkx + 0.25 * bx, 0.25 * ay + 0.5 * pky + 0.25 * by);
      cnt = pushSpinePt(cnt, bx, by);
      prevX = bx;
      prevY = by;
    } else {
      emitSpanTo(pkx, pky);
    }
  }
  emitSpanTo(pts[n - 1][0], pts[n - 1][1]);
  if (cnt < 2) return null;

  SPINE_S[0] = 0;
  for (let i = 1; i < cnt; i++) {
    SPINE_S[i] = SPINE_S[i - 1] + hypot2(SPINE_X[i] - SPINE_X[i - 1], SPINE_Y[i] - SPINE_Y[i - 1]);
  }
  const sTot = SPINE_S[cnt - 1];
  if (sTot < 0.5) return null;

  const totalPts = cnt * 2;
  const flat = new Float32Array(totalPts * 2);
  const maxHw = sw * (isBrush ? 0.68 : 0.56);
  const phase = (seed % 97) * 0.064;

  for (let i = 0; i < cnt; i++) {
    let tx, ty;
    if (i === 0) {
      const dx = SPINE_X[1] - SPINE_X[0], dy = SPINE_Y[1] - SPINE_Y[0];
      const L = hypot2(dx, dy) || 1;
      tx = dx / L; ty = dy / L;
    } else if (i === cnt - 1) {
      const dx = SPINE_X[cnt - 1] - SPINE_X[cnt - 2], dy = SPINE_Y[cnt - 1] - SPINE_Y[cnt - 2];
      const L = hypot2(dx, dy) || 1;
      tx = dx / L; ty = dy / L;
    } else {
      const dx0 = SPINE_X[i] - SPINE_X[i - 1], dy0 = SPINE_Y[i] - SPINE_Y[i - 1];
      const L0 = hypot2(dx0, dy0) || 1;
      const dx1 = SPINE_X[i + 1] - SPINE_X[i], dy1 = SPINE_Y[i + 1] - SPINE_Y[i];
      const L1 = hypot2(dx1, dy1) || 1;
      const sx = dx0 / L0 + dx1 / L1, sy = dy0 / L0 + dy1 / L1;
      const sL = hypot2(sx, sy);
      if (sL > 1e-4) { tx = sx / sL; ty = sy / sL; }
      else { tx = dx0 / L0; ty = dy0 / L0; }
    }
    const nx = -ty, ny = tx;
    const u = SPINE_S[i] / sTot;
    const env = isBrush
      ? 0.24 + 0.78 * Math.sin(Math.pow(u, 0.82) * Math.PI) + 0.07 * Math.sin(u * 9 + phase)
      : 0.34 + 0.62 * Math.sin(u * Math.PI) + 0.04 * Math.cos(u * 7 + phase);
    const hw = maxHw * clamp(env, 0.16, 1.05);
    const px = SPINE_X[i], py = SPINE_Y[i];
    const li = i * 2;
    const ri = (totalPts - 1 - i) * 2;
    flat[li] = px + nx * hw;
    flat[li + 1] = py + ny * hw;
    flat[ri] = px - nx * hw;
    flat[ri + 1] = py - ny * hw;
  }
  return { d: flatOutlineToSvgPath(flat), smoothPoly: flat };
}

function chiseledPolylineData(pts, roughness, seed, closed = false) {
  const rand = seededRand(seed);
  const coords = [];
  let d = "";
  const rgh = clamp(roughness, 0.28, 0.72);
  const nSeg = pts.length - 1;
  for (let i = 0; i < nSeg; i++) {
    const x0 = pts[i][0], y0 = pts[i][1];
    const x1 = pts[i + 1][0], y1 = pts[i + 1][1];
    const segLen = hypot2(x1 - x0, y1 - y0);
    const steps = segLen > 32 ? Math.min(5, Math.ceil(segLen / 34)) : 1;
    const amp = Math.min(rgh * 1.35, segLen * 0.055);
    for (let s = 0; s < steps; s++) {
      if (i > 0 && s === 0) continue;
      const u = s / steps;
      const jx = (s === 0 && i === 0) ? 0 : (rand() - 0.5) * amp * 2;
      const jy = (s === 0 && i === 0) ? 0 : (rand() - 0.5) * amp * 2;
      const px = f1(lerp(x0, x1, u) + jx);
      const py = f1(lerp(y0, y1, u) + jy);
      coords.push(px, py);
      d += coords.length === 2 ? `M ${px} ${py}` : ` L ${px} ${py}`;
    }
  }
  const last = pts[nSeg];
  if (!closed) {
    const lx = f1(last[0]), ly = f1(last[1]);
    coords.push(lx, ly);
    d += ` L ${lx} ${ly}`;
    return { d, nums: new Float64Array(coords) };
  }
  d += " Z";
  return { d, closedPts: new Float32Array(coords) };
}

let HACH_U = new Float64Array(64);
let HACH_V = new Float64Array(64);
let HACH_X = new Float64Array(64);
let HACH_OUT = new Float32Array(512);

function pushHach4(idx, a, b, c, d) {
  if (idx + 4 > HACH_OUT.length) {
    const grown = new Float32Array(HACH_OUT.length * 2);
    grown.set(HACH_OUT);
    HACH_OUT = grown;
  }
  HACH_OUT[idx] = a; HACH_OUT[idx + 1] = b; HACH_OUT[idx + 2] = c; HACH_OUT[idx + 3] = d;
  return idx + 4;
}

function pushHach6(idx, a, b, c, d, e, f) {
  if (idx + 6 > HACH_OUT.length) {
    const grown = new Float32Array(HACH_OUT.length * 2);
    grown.set(HACH_OUT);
    HACH_OUT = grown;
  }
  HACH_OUT[idx] = a; HACH_OUT[idx + 1] = b; HACH_OUT[idx + 2] = c;
  HACH_OUT[idx + 3] = d; HACH_OUT[idx + 4] = e; HACH_OUT[idx + 5] = f;
  return idx + 6;
}

function buildHachureData(points, angleDeg, gap, roughness, seed, crossHatch = false) {
  const n = points.length;
  if (n < 3) return null;
  if (n > HACH_U.length) {
    HACH_U = new Float64Array(n * 2);
    HACH_V = new Float64Array(n * 2);
  }
  const isRough = roughness > 0.001;
  const stepGap = Math.max(3.8, gap);
  let outLen = 0;
  let d = "";
  let s = hashSeed(seed);
  const nextRand = () => {
    s = (Math.imul(s, 48271) % 2147483647) & 0x7fffffff;
    return (s - 1) / 2147483646;
  };

  const passCount = crossHatch ? 2 : 1;
  for (let pass = 0; pass < passCount; pass++) {
    const rad = (((angleDeg + pass * 90) + 90) * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    let minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < n; i++) {
      const px = points[i][0], py = points[i][1];
      const u = px * cosR - py * sinR;
      const v = px * sinR + py * cosR;
      HACH_U[i] = u;
      HACH_V[i] = v;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    if (maxV - minV < 1.2) continue;
    const phase = (((seed + pass * 7) & 15) / 16) * stepGap;
    let vStart = Math.floor((minV - phase) / stepGap) * stepGap + phase;
    while (vStart <= minV + 0.25) vStart += stepGap;
    if (vStart >= maxV - 0.25) {
      if (maxV - minV >= 3) vStart = (minV + maxV) * 0.5;
      else continue;
    }
    for (let v = vStart; v < maxV - 0.15; v += stepGap) {
      let cnt = 0;
      for (let i = 0; i < n; i++) {
        const j = i + 1 === n ? 0 : i + 1;
        const vi = HACH_V[i], vj = HACH_V[j];
        if ((vi <= v && vj > v) || (vj <= v && vi > v)) {
          if (cnt >= HACH_X.length) {
            const grown = new Float64Array(HACH_X.length * 2);
            grown.set(HACH_X);
            HACH_X = grown;
          }
          HACH_X[cnt++] = HACH_U[i] + ((v - vi) / (vj - vi)) * (HACH_U[j] - HACH_U[i]);
        }
      }
      if (cnt < 2) continue;
      if (cnt === 2) {
        if (HACH_X[0] > HACH_X[1]) { const t = HACH_X[0]; HACH_X[0] = HACH_X[1]; HACH_X[1] = t; }
      } else {
        for (let a = 1; a < cnt; a++) {
          const kv = HACH_X[a];
          let b = a - 1;
          while (b >= 0 && HACH_X[b] > kv) { HACH_X[b + 1] = HACH_X[b]; b--; }
          HACH_X[b + 1] = kv;
        }
      }
      for (let k = 0; k + 1 < cnt; k += 2) {
        const u0 = HACH_X[k], u1 = HACH_X[k + 1];
        const segLen = u1 - u0;
        if (segLen < 0.8) continue;
        const x0 = u0 * cosR + v * sinR;
        const y0 = -u0 * sinR + v * cosR;
        const x1 = u1 * cosR + v * sinR;
        const y1 = -u1 * sinR + v * cosR;
        if (!isRough) {
          const rx0 = f1(x0), ry0 = f1(y0), rx1 = f1(x1), ry1 = f1(y1);
          d += d ? ` M ${rx0} ${ry0} L ${rx1} ${ry1}` : `M ${rx0} ${ry0} L ${rx1} ${ry1}`;
          outLen = pushHach4(outLen, rx0, ry0, rx1, ry1);
        } else {
          const amp = Math.min(roughness * 1.45, segLen * 0.12);
          const jx0 = f1(x0 + (nextRand() - 0.5) * amp);
          const jy0 = f1(y0 + (nextRand() - 0.5) * amp);
          const jx1 = f1(x1 + (nextRand() - 0.5) * amp);
          const jy1 = f1(y1 + (nextRand() - 0.5) * amp);
          const bow = (nextRand() - 0.5) * amp * 1.8;
          const mx = f1((jx0 + jx1) * 0.5 + bow * sinR);
          const my = f1((jy0 + jy1) * 0.5 + bow * cosR);
          d += d ? ` M ${jx0} ${jy0} Q ${mx} ${my} ${jx1} ${jy1}` : `M ${jx0} ${jy0} Q ${mx} ${my} ${jx1} ${jy1}`;
          outLen = pushHach6(outLen, jx0, jy0, mx, my, jx1, jy1);
        }
      }
    }
  }
  if (!d) return null;
  const arr = HACH_OUT.slice(0, outLen);
  return isRough ? { d, qsegs: arr } : { d, segs: arr };
}

// ============================================================================
// Pure Semantic Primitive Geometry Builders
// ============================================================================

/**
 * 1. Semantic Node / Vertex / Dot (`dot`)
 */
export function buildDotSpec(cx, cy, r, G, opts = {}) {
  if (!(r > 0)) return [];
  const op = clamp(opts.opacity ?? 1, 0, 1);
  if (op < 0.002) return [];
  const roleCol = resolveRoleColor(G, opts.role || "primary");
  const fill = opts.fill !== undefined ? opts.fill : (opts.hollow ? G.P.bg : roleCol);
  const stroke = opts.stroke !== undefined ? opts.stroke : (opts.hollow ? roleCol : "none");
  const sw = Number(opts.strokeWidth ?? (stroke !== "none" ? 1.6 : 0));
  const isPaperFill = fill !== "none" && (fill === G.P.bg || colorDistSqRgb(parseRgb(fill, [128, 128, 128]), G.bgRgb) < 784);
  const isHollow = Boolean(opts.hollow || fill === "none" || isPaperFill);
  const keepOpenInterior = Boolean(opts.labelInside || r >= 24);

  if (r <= 3.1 || G.node === "circle") {
    const a = { cx: f2(cx), cy: f2(cy), r: f2(r), fill };
    if (stroke && stroke !== "none" && sw > 0) {
      a.stroke = stroke;
      a["stroke-width"] = f2(sw);
    }
    if (op < 0.999) a.opacity = op.toFixed(3);
    return [{ tag: "circle", attrs: a }];
  }

  const out = [];
  const addCommon = (attrs, fCol = fill, sCol = stroke, sWidth = sw) => {
    attrs.fill = fCol;
    if (sCol && sCol !== "none" && sWidth > 0) {
      attrs.stroke = sCol;
      attrs["stroke-width"] = f2(sWidth);
    }
    if (op < 0.999) attrs.opacity = op.toFixed(3);
    return attrs;
  };

  if (G.node === "dab") {
    const seed = hashSeed(opts.seed ?? 1);
    const rand = seededRand(seed);
    const ang = -0.48 + (rand() - 0.5) * 0.36;
    const hasExplicitRim = Boolean(stroke && stroke !== "none" && sw > 0);
    if (!isHollow && !hasExplicitRim && r < 22) {
      const c = Math.cos(ang), s = Math.sin(ang);
      const rx = (lx, ly) => f2(cx + lx * c - ly * s);
      const ry = (lx, ly) => f2(cy + lx * s + ly * c);
      const tip = keepOpenInterior || r >= 11 ? 1.08 : 1.22;
      const belly = keepOpenInterior || r >= 11 ? 1.02 : 0.96;
      const heel = keepOpenInterior || r >= 11 ? 1.00 : 0.90;
      const d = `M ${rx(-r * heel, 0)} ${ry(-r * heel, 0)} C ${rx(-r * heel, -r * belly * 0.95)} ${ry(-r * heel, -r * belly * 0.95)}, ${rx(r * 0.25, -r * belly * 1.04)} ${ry(r * 0.25, -r * belly * 1.04)}, ${rx(r * tip, -r * 0.06)} ${ry(r * tip, -r * 0.06)} Q ${rx(r * (tip + 0.08), r * 0.04)} ${ry(r * (tip + 0.08), r * 0.04)} ${rx(r * (tip - 0.08), r * 0.16)} ${ry(r * (tip - 0.08), r * 0.16)} C ${rx(r * 0.22, r * belly * 1.02)} ${ry(r * 0.22, r * belly * 1.02)}, ${rx(-r * heel, r * belly * 0.92)} ${ry(-r * heel, r * belly * 0.92)}, ${rx(-r * heel, 0)} ${ry(-r * heel, 0)} Z`;
      const N = 12;
      const closedPts = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) {
        const th = (i * 2 * Math.PI) / N;
        const ct = Math.cos(th), st = Math.sin(th);
        const lx = ct >= 0 ? ct * r * tip : ct * r * heel;
        const ly = st * r * belly * (ct > 0.3 ? 0.78 : 0.96);
        closedPts[i * 2] = cx + lx * c - ly * s;
        closedPts[i * 2 + 1] = cy + lx * s + ly * c;
      }
      out.push({ tag: "path", attrs: addCommon({ d }, fill, stroke, sw), closedPts });
      return out;
    }
    if (fill && fill !== "none") {
      out.push({ tag: "circle", attrs: addCommon({ cx: f2(cx), cy: f2(cy), r: f2(r * 0.95) }, fill, "none", 0) });
    }
    const ringCol = hasExplicitRim ? stroke : fill;
    const ed = ensoRingData(cx, cy, r, sw, ang);
    if (ed.d) out.push({ tag: "path", attrs: addCommon({ d: ed.d }, ringCol, "none", 0), smoothPoly: ed.smoothPoly });
    return out;
  }

  if (G.node === "nib") {
    const swBoost = sw > 0 ? sw * 1.28 : 0;
    if (!isHollow && G.scheme === "manga" && r >= 4.5 && r < 22) {
      out.push({ tag: "circle", attrs: addCommon({ cx: f2(cx), cy: f2(cy), r: f2(r + 1.5) }, G.P.bg, "none", 0) });
    }
    out.push({ tag: "circle", attrs: addCommon({ cx: f2(cx), cy: f2(cy), r: f2(r) }, fill, stroke, swBoost) });
    return out;
  }

  if (G.node === "chisel") {
    const seed = hashSeed(opts.seed ?? 1);
    const cd = chiseledNodeData(cx, cy, r * 1.05, seed);
    out.push({ tag: "path", attrs: addCommon({ d: cd.d }, fill, stroke, sw > 0 ? sw * 1.12 : 0), closedPts: cd.closedPts });
    return out;
  }

  if (G.node === "star8") {
    const sd = keepOpenInterior
      ? regularStarData(cx, cy, r * 1.05, r * 0.90, r >= 24 ? 16 : 8, Math.PI / 16)
      : regularStarData(cx, cy, r * 1.18, r * 0.66, 8, -Math.PI / 8);
    out.push({ tag: "path", attrs: addCommon({ d: sd.d }, fill, stroke, sw), closedPts: sd.closedPts });
    return out;
  }

  if (G.node === "diamond") {
    if (keepOpenInterior) {
      const sd = regularStarData(cx, cy, r * 1.04, r * 1.04, 4, Math.PI / 8);
      out.push({ tag: "path", attrs: addCommon({ d: sd.d }, fill, stroke, sw), closedPts: sd.closedPts });
    } else {
      const rr = r * 1.18;
      const x0 = f2(cx), y0 = f2(cy - rr), x1 = f2(cx + rr), y1 = f2(cy), y2 = f2(cy + rr), x3 = f2(cx - rr);
      const d = `M ${x0} ${y0} L ${x1} ${y1} L ${x0} ${y2} L ${x3} ${y1} Z`;
      out.push({ tag: "path", attrs: addCommon({ d }, fill, stroke, sw), closedPts: new Float32Array([x0, y0, x1, y1, x0, y2, x3, y1]) });
    }
    return out;
  }

  if (G.node === "shippo") {
    const fd = shippoFloretData(cx, cy, r, keepOpenInterior ? 8 : 4);
    out.push({ tag: "path", attrs: addCommon({ d: fd.d }, fill, stroke, sw), qloop: fd.qloop });
    return out;
  }

  if (G.node === "reticle") {
    const tickCol = stroke && stroke !== "none" ? stroke : fill;
    if (keepOpenInterior) {
      out.push({ tag: "circle", attrs: addCommon({ cx: f2(cx), cy: f2(cy), r: f2(r) }, fill, stroke, sw) });
      const tIn = r >= 24 ? r * 0.84 : r * 0.98;
      const tOut = r >= 24 ? r * 1.0 : r + 3.0;
      const xc = f2(cx), yc = f2(cy);
      const segs = new Float32Array([xc, f2(cy - tOut), xc, f2(cy - tIn), xc, f2(cy + tIn), xc, f2(cy + tOut), f2(cx - tOut), yc, f2(cx - tIn), yc, f2(cx + tIn), yc, f2(cx + tOut), yc]);
      const td = `M ${segs[0]} ${segs[1]} L ${segs[2]} ${segs[3]} M ${segs[4]} ${segs[5]} L ${segs[6]} ${segs[7]} M ${segs[8]} ${segs[9]} L ${segs[10]} ${segs[11]} M ${segs[12]} ${segs[13]} L ${segs[14]} ${segs[15]}`;
      out.push({ tag: "path", attrs: addCommon({ d: td }, "none", tickCol, 1.35), segs });
    } else {
      out.push({ tag: "circle", attrs: addCommon({ cx: f2(cx), cy: f2(cy), r: f2(r * 0.78) }, fill, stroke, sw) });
      const arm = Math.max(r * 1.48, r + 3.2);
      const gapR = r * 0.42;
      const xc = f2(cx), yc = f2(cy);
      const segs = new Float32Array([f2(cx - arm), yc, f2(cx - gapR), yc, f2(cx + gapR), yc, f2(cx + arm), yc, xc, f2(cy - arm), xc, f2(cy - gapR), xc, f2(cy + gapR), xc, f2(cy + arm)]);
      const td = `M ${segs[0]} ${segs[1]} L ${segs[2]} ${segs[3]} M ${segs[4]} ${segs[5]} L ${segs[6]} ${segs[7]} M ${segs[8]} ${segs[9]} L ${segs[10]} ${segs[11]} M ${segs[12]} ${segs[13]} L ${segs[14]} ${segs[15]}`;
      out.push({ tag: "path", attrs: addCommon({ d: td }, "none", tickCol, 1.25), segs });
    }
    return out;
  }

  if (G.node === "pixel") {
    const snap = (v) => Math.round(v / 2) * 2;
    if (keepOpenInterior) {
      const c = r * 0.38;
      const x0 = snap(cx - r), x1 = snap(cx + r), y0 = snap(cy - r), y1 = snap(cy + r), k = Math.max(2, snap(c));
      const d = `M ${x0 + k} ${y0} H ${x1 - k} L ${x1} ${y0 + k} V ${y1 - k} L ${x1 - k} ${y1} H ${x0 + k} L ${x0} ${y1 - k} V ${y0 + k} Z`;
      const closedPts = new Float32Array([x0 + k, y0, x1 - k, y0, x1, y0 + k, x1, y1 - k, x1 - k, y1, x0 + k, y1, x0, y1 - k, x0, y0 + k]);
      out.push({ tag: "path", attrs: addCommon({ d, "shape-rendering": "crispEdges" }, fill, stroke, sw > 0 ? Math.max(sw, 2) : 0), closedPts });
    } else {
      const side = Math.max(4, Math.round(r * 1.85));
      out.push({
        tag: "rect",
        attrs: addCommon(
          { x: Math.round(cx - side / 2), y: Math.round(cy - side / 2), width: side, height: side, "shape-rendering": "crispEdges" },
          fill,
          stroke,
          sw > 0 ? Math.max(1.5, Math.round(sw)) : 0
        ),
      });
    }
    return out;
  }

  return [{ tag: "circle", attrs: addCommon({ cx: f2(cx), cy: f2(cy), r: f2(r) }) }];
}

/**
 * 2. Semantic Ring / Expanding Ripple (`ring`)
 */
export function buildRingSpec(cx, cy, r, G, opts = {}) {
  if (!(r > 0)) return [];
  const op = clamp(opts.opacity ?? 1, 0, 1);
  if (op < 0.002) return [];
  const stroke = opts.stroke || resolveRoleColor(G, opts.role || "primary");
  const sw = Number(opts.strokeWidth ?? 1.8);
  const dashed = opts.dash || "";
  const base = { fill: "none", stroke, "stroke-width": f2(sw) };
  if (dashed) base["stroke-dasharray"] = dashed;
  if (op < 0.999) base.opacity = op.toFixed(3);

  if (!dashed && G.node === "dab" && r >= 6) {
    const seed = hashSeed(opts.seed ?? 7);
    const rand = seededRand(seed);
    const ed = ensoRingData(cx, cy, r, sw * 0.92, -0.4 + (rand() - 0.5) * 0.4);
    if (ed.d) {
      const pa = { d: ed.d, fill: stroke };
      if (op < 0.999) pa.opacity = op.toFixed(3);
      return [{ tag: "path", attrs: pa, smoothPoly: ed.smoothPoly }];
    }
  }
  if (G.node === "star8" && r >= 6) {
    const sd = regularStarData(cx, cy, r * 1.06, r * 0.90, 8, -Math.PI / 8);
    return [{ tag: "path", attrs: { ...base, d: sd.d }, closedPts: sd.closedPts }];
  }
  if (G.node === "shippo" && r >= 6) {
    const fd = shippoFloretData(cx, cy, r, r >= 22 ? 8 : 4);
    return [{ tag: "path", attrs: { ...base, d: fd.d }, qloop: fd.qloop }];
  }
  if (!dashed && G.node === "reticle" && r >= 7) {
    const q = f2((2 * Math.PI * r) / 4);
    const arcLen = f2(q * 0.76);
    const gapLen = f2(q * 0.24);
    const tOut = r + 2.6;
    const xc = f2(cx), yc = f2(cy);
    const segs = new Float32Array([xc, f2(cy - tOut), xc, f2(cy - r), xc, f2(cy + r), xc, f2(cy + tOut), f2(cx - tOut), yc, f2(cx - r), yc, f2(cx + r), yc, f2(cx + tOut), yc]);
    const td = `M ${segs[0]} ${segs[1]} L ${segs[2]} ${segs[3]} M ${segs[4]} ${segs[5]} L ${segs[6]} ${segs[7]} M ${segs[8]} ${segs[9]} L ${segs[10]} ${segs[11]} M ${segs[12]} ${segs[13]} L ${segs[14]} ${segs[15]}`;
    const tickAttrs = { d: td, fill: "none", stroke, "stroke-width": f2(Math.max(1.1, sw * 0.75)) };
    if (op < 0.999) tickAttrs.opacity = op.toFixed(3);
    return [
      { tag: "circle", attrs: { ...base, cx: xc, cy: yc, r: f2(r), "stroke-dasharray": `${arcLen} ${gapLen}`, "stroke-dashoffset": f2(-gapLen * 0.5) } },
      { tag: "path", attrs: tickAttrs, segs },
    ];
  }
  if (G.node === "diamond") {
    const rr = r * 1.1;
    const x0 = f2(cx), y0 = f2(cy - rr), x1 = f2(cx + rr), y1 = f2(cy), y2 = f2(cy + rr), x3 = f2(cx - rr);
    const d = `M ${x0} ${y0} L ${x1} ${y1} L ${x0} ${y2} L ${x3} ${y1} Z`;
    return [{ tag: "path", attrs: { ...base, d }, closedPts: new Float32Array([x0, y0, x1, y1, x0, y2, x3, y1]) }];
  }
  if (G.node === "pixel") {
    const s = Math.round(r * 2);
    return [{ tag: "rect", attrs: { ...base, x: Math.round(cx - r), y: Math.round(cy - r), width: s, height: s, "shape-rendering": "crispEdges" } }];
  }
  if (G.node === "chisel") {
    const seed = hashSeed(opts.seed ?? 7);
    const cd = chiseledNodeData(cx, cy, r, seed);
    return [{ tag: "path", attrs: { ...base, d: cd.d }, closedPts: cd.closedPts }];
  }
  return [{ tag: "circle", attrs: { ...base, cx: f2(cx), cy: f2(cy), r: f2(r) } }];
}

/**
 * 3. Semantic Arrowhead (`arrowHead`)
 */
export function buildArrowHeadSpec(x, y, angle, G, opts = {}) {
  const op = clamp(opts.opacity ?? 1, 0, 1);
  if (op < 0.002) return [];
  const col = opts.fill || opts.stroke || resolveRoleColor(G, opts.role || "primary");
  const s = Number(opts.size ?? 8.5);
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  const px = (back, side) => f2(x - c * back - n * side);
  const py = (back, side) => f2(y - n * back + c * side);

  const wrap = (attrs, extra) => {
    if (op < 0.999) attrs.opacity = op.toFixed(3);
    return [extra ? { tag: "path", attrs, ...extra } : { tag: "path", attrs }];
  };

  if (G.arrow === "flick") {
    const tx = f2(x + c * 0.6), ty = f2(y + n * 0.6);
    const c1x = px(s * 0.45, s * 0.58), c1y = py(s * 0.45, s * 0.58);
    const p1x = px(s * 1.18, s * 0.66), p1y = py(s * 1.18, s * 0.66);
    const p2x = px(s * 0.66, s * 0.06), p2y = py(s * 0.66, s * 0.06);
    const p3x = px(s * 0.92, -s * 0.46), p3y = py(s * 0.92, -s * 0.46);
    const c2x = px(s * 0.38, -s * 0.36), c2y = py(s * 0.38, -s * 0.36);
    const d = `M ${tx} ${ty} Q ${c1x} ${c1y} ${p1x} ${p1y} L ${p2x} ${p2y} L ${p3x} ${p3y} Q ${c2x} ${c2y} ${tx} ${ty} Z`;
    const mx1 = (tx + 2 * c1x + p1x) * 0.25, my1 = (ty + 2 * c1y + p1y) * 0.25;
    const mx2 = (p3x + 2 * c2x + tx) * 0.25, my2 = (p3y + 2 * c2y + ty) * 0.25;
    return wrap({ d, fill: col }, { closedPts: new Float32Array([tx, ty, mx1, my1, p1x, p1y, p2x, p2y, p3x, p3y, mx2, my2]) });
  }
  if (G.arrow === "barb") {
    const x0 = f2(x + c * 0.8), y0 = f2(y + n * 0.8);
    const x1 = px(s * 1.12, s * 0.62), y1 = py(s * 1.12, s * 0.62);
    const x2 = px(s * 0.64, 0), y2 = py(s * 0.64, 0);
    const x3 = px(s * 1.12, -s * 0.62), y3 = py(s * 1.12, -s * 0.62);
    const d = `M ${x0} ${y0} L ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3} Z`;
    return wrap({ d, fill: col }, { closedPts: new Float32Array([x0, y0, x1, y1, x2, y2, x3, y3]) });
  }
  if (G.arrow === "vee") {
    const tx = f2(x), ty = f2(y);
    const b0x = px(s * 0.88, 0), b0y = py(s * 0.88, 0);
    const w1x = px(s * 0.96, s * 0.56), w1y = py(s * 0.96, s * 0.56);
    const w2x = px(s * 0.96, -s * 0.56), w2y = py(s * 0.96, -s * 0.56);
    const d = `M ${b0x} ${b0y} L ${tx} ${ty} M ${w1x} ${w1y} L ${tx} ${ty} L ${w2x} ${w2y}`;
    return wrap(
      { d, fill: "none", stroke: col, "stroke-width": f2(Math.max(1.75, s * 0.22)), "stroke-linecap": "round", "stroke-linejoin": "round" },
      { segs: new Float32Array([b0x, b0y, tx, ty, w1x, w1y, tx, ty, tx, ty, w2x, w2y]) }
    );
  }
  if (G.arrow === "chisel") {
    const x0 = f2(x), y0 = f2(y);
    const x1 = px(s * 0.95, s * 0.68), y1 = py(s * 0.95, s * 0.68);
    const x2 = px(s * 1.12, s * 0.28), y2 = py(s * 1.12, s * 0.28);
    const x3 = px(s * 1.12, -s * 0.28), y3 = py(s * 1.12, -s * 0.28);
    const x4 = px(s * 0.95, -s * 0.68), y4 = py(s * 0.95, -s * 0.68);
    const d = `M ${x0} ${y0} L ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3} L ${x4} ${y4} Z`;
    return wrap({ d, fill: col }, { closedPts: new Float32Array([x0, y0, x1, y1, x2, y2, x3, y3, x4, y4]) });
  }
  if (G.arrow === "pixel") {
    const u = Math.max(2, Math.round(s / 3.4));
    const bx = Math.round(x), by = Math.round(y);
    const x1 = px(u * 3, u * 2), y1 = py(u * 3, u * 2);
    const x2 = px(u * 3, -u * 2), y2 = py(u * 3, -u * 2);
    const d = `M ${bx} ${by} L ${x1} ${y1} L ${x2} ${y2} Z`;
    return wrap({ d, fill: col, "shape-rendering": "crispEdges" }, { closedPts: new Float32Array([bx, by, x1, y1, x2, y2]) });
  }

  const w = s * 0.56;
  const x0 = f2(x), y0 = f2(y), x1 = px(s, w), y1 = py(s, w), x2 = px(s, -w), y2 = py(s, -w);
  const d = `M ${x0} ${y0} L ${x1} ${y1} L ${x2} ${y2} Z`;
  return wrap({ d, fill: col }, { closedPts: new Float32Array([x0, y0, x1, y1, x2, y2]) });
}

function prepareArrowGeometry(pointsOrPath, G, opts) {
  const progress = clamp(opts.progress ?? 1, 0, 1);
  if (progress < 0.002) return { shaftInput: null, head: null };
  const headSize = opts.headSize ?? Math.max(7.5, (opts.strokeWidth ?? 2) * 3.8);
  const rawPts = typeof pointsOrPath === "string" ? sampleSimpleSvgPath(pointsOrPath) : pointsOrPath;
  if (!rawPts || rawPts.length < 2) {
    return { shaftInput: pointsOrPath, shaftProgress: progress, head: null };
  }
  const visPts = slicePolyline(rawPts, progress);
  if (!visPts || visPts.length < 2) return { shaftInput: null, head: null };

  const lastPt = visPts[visPts.length - 1];
  const tipX = lastPt[0], tipY = lastPt[1];
  let refX = visPts[0][0], refY = visPts[0][1];
  for (let i = visPts.length - 2; i >= 0; i--) {
    const dx = tipX - visPts[i][0], dy = tipY - visPts[i][1];
    if (dx * dx + dy * dy > 1e-6) {
      refX = visPts[i][0];
      refY = visPts[i][1];
      break;
    }
  }
  const segDist = hypot2(tipX - refX, tipY - refY);
  if (segDist <= 1e-3) return { shaftInput: visPts, shaftProgress: 1, head: null };

  const setback = G.arrow === "vee" ? headSize * 0.35 : headSize * 0.58;
  const trimmedPts = trimPolylineEnd(visPts, setback);
  return {
    shaftInput: trimmedPts,
    shaftProgress: 1,
    head: {
      x: tipX,
      y: tipY,
      angle: Math.atan2(tipY - refY, tipX - refX),
      size: headSize,
    },
  };
}

/**
 * 4. Semantic Panel / Card / Token Cell (`panel`)
 * Keeps interiors calm & high-contrast behind labels while expressing each
 * profile's architectural joinery, scroll mounting, cartouche, bevel, or frame.
 */
export function buildPanelSpec(x, y, w, h, G, opts = {}) {
  if (!(w > 0 && h > 0)) return [];
  const op = clamp(opts.opacity ?? 1, 0, 1);
  if (op < 0.002) return [];
  const fillP = clamp(opts.fillOpacity ?? 1, 0, 1);
  const progress = clamp(opts.progress ?? 1, 0, 1);
  const fill = opts.fill !== undefined ? opts.fill : G.P.surface;
  const stroke = opts.stroke !== undefined ? opts.stroke : G.P.grid;
  const sw = Number(opts.strokeWidth ?? (stroke !== "none" ? 1.5 : 0));
  const dashed = opts.dash || "";
  const isCell = Boolean(opts.isCell || (w <= 56 && h <= 56 && Math.abs(w - h) < 1.2));
  const out = [];

  const hasFill = Boolean(fill && fill !== "none" && fillP > 0.002);
  const hasStroke = Boolean(stroke && stroke !== "none" && sw > 0 && progress > 0.002);
  const isSolidAccent = hasFill && !G.isDark && luminance(fill) < 140;

  const mkFillRect = (rx, ry, rw, rh, extra = null, alphaMult = 1) => {
    const fa = extra ? { x: rx, y: ry, width: rw, height: rh, fill, ...extra } : { x: rx, y: ry, width: rw, height: rh, fill };
    if (fillP < 0.999) fa["fill-opacity"] = fillP.toFixed(3);
    const effOp = op * alphaMult;
    if (effOp < 0.999) fa.opacity = effOp.toFixed(3);
    return { tag: "rect", attrs: fa };
  };

  if (G.panel === "comic") {
    if (hasFill && hasStroke && !dashed && progress > 0.85 && (w >= 80 || isSolidAccent)) {
      const off = isCell ? 2 : 3.2;
      out.push({
        tag: "rect",
        attrs: { x: f2(x + off), y: f2(y + off), width: f2(w), height: f2(h), fill: G.P.fg, opacity: (op * 0.88).toFixed(3) },
      });
    }
    if (hasFill) out.push(mkFillRect(f2(x), f2(y), f2(w), f2(h)));
    if (hasStroke) {
      const sa = { x: f2(x), y: f2(y), width: f2(w), height: f2(h), fill: "none", stroke, "stroke-width": f2(sw * 1.32) };
      if (dashed) sa["stroke-dasharray"] = dashed;
      else if (progress < 0.999) {
        sa.pathLength = "1"; sa["stroke-dasharray"] = "1 1"; sa["stroke-dashoffset"] = (1 - progress).toFixed(4);
      }
      if (op < 0.999) sa.opacity = op.toFixed(3);
      out.push({ tag: "rect", attrs: sa });
    }
    return out;
  }

  if (G.panel === "bevel") {
    if (hasFill) out.push(mkFillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h), { "shape-rendering": "crispEdges" }));
    if (hasStroke) {
      if (dashed) {
        const sa = { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), fill: "none", stroke, "stroke-width": "1", "stroke-dasharray": dashed, "shape-rendering": "crispEdges" };
        if (op < 0.999) sa.opacity = op.toFixed(3);
        out.push({ tag: "rect", attrs: sa });
      } else {
        const baseRgb = parseRgb(hasFill ? fill : G.P.surface, G.isDark ? [26, 32, 44] : [224, 224, 224]);
        const hiCol = G.isDark ? rgba(mixRgb(baseRgb, [255, 255, 255], 0.34), 1) : "#ffffff";
        const loCol = G.isDark ? rgba(mixRgb(baseRgb, [0, 0, 0], 0.68), 1) : "#404040";
        const x0 = Math.round(x) + 0.5, y0 = Math.round(y) + 0.5, x1 = Math.round(x + w) - 0.5, y1 = Math.round(y + h) - 0.5;
        const p1 = { d: `M ${x0} ${y1} V ${y0} H ${x1}`, fill: "none", stroke: hiCol, "stroke-width": "1.4", "shape-rendering": "crispEdges" };
        const p2 = { d: `M ${x0} ${y1} H ${x1} V ${y0}`, fill: "none", stroke: loCol, "stroke-width": "1.5", "shape-rendering": "crispEdges" };
        if (op < 0.999) { p1.opacity = op.toFixed(3); p2.opacity = op.toFixed(3); }
        out.push(
          { tag: "path", attrs: p1, nums: new Float64Array([x0, y1, x0, y0, x1, y0]) },
          { tag: "path", attrs: p2, nums: new Float64Array([x0, y1, x1, y1, x1, y0]) }
        );
        if (w >= 28 && h >= 22) {
          const ix0 = f2(x0 + 1.2), iy0 = f2(y0 + 1.2), ix1 = f2(x1 - 1.2), iy1 = f2(y1 - 1.2);
          out.push({
            tag: "path",
            attrs: { d: `M ${ix0} ${iy1} H ${ix1} V ${iy0}`, fill: "none", stroke, "stroke-width": "1", opacity: (op * 0.85).toFixed(3), "shape-rendering": "crispEdges" },
            nums: new Float64Array([ix0, iy1, ix1, iy1, ix1, iy0]),
          });
        }
      }
    }
    return out;
  }

  if (G.panel === "pixel") {
    const rx = Math.round(x), ry = Math.round(y), rw = Math.round(w), rh = Math.round(h);
    if (hasFill && hasStroke && !dashed && w >= 40 && h >= 28) {
      const shCol = G.isDark ? rgba(parseRgb(stroke, [88, 166, 255]), 1) : "#05070d";
      const shOp = G.isDark ? op * 0.28 : op * 0.65;
      out.push({ tag: "rect", attrs: { x: rx + 3, y: ry + 3, width: rw, height: rh, fill: shCol, opacity: shOp.toFixed(3), "shape-rendering": "crispEdges" } });
    }
    if (hasFill) out.push(mkFillRect(rx, ry, rw, rh, { "shape-rendering": "crispEdges" }));
    if (hasStroke) {
      const sa = { x: rx, y: ry, width: rw, height: rh, fill: "none", stroke, "stroke-width": Math.max(2, Math.round(sw)), "shape-rendering": "crispEdges" };
      if (dashed) sa["stroke-dasharray"] = dashed;
      if (op < 0.999) sa.opacity = op.toFixed(3);
      out.push({ tag: "rect", attrs: sa });
    }
    return out;
  }

  if (G.panel === "scroll" && !isCell && !dashed && w >= 72 && h >= 36) {
    if (hasFill) {
      const extra = G.multiply && !isSolidAccent ? { style: "mix-blend-mode:multiply" } : null;
      out.push(mkFillRect(f2(x), f2(y), f2(w), f2(h), extra, 0.85));
    }
    if (hasStroke) {
      const ext = Math.min(5, w * 0.02);
      const wVis = w * progress;
      const topA = { x1: f2(x - ext), y1: f2(y), x2: f2(x + wVis + ext), y2: f2(y), stroke, "stroke-width": f2(sw * 1.12) };
      const botA = { x1: f2(x - ext), y1: f2(y + h), x2: f2(x + wVis + ext), y2: f2(y + h), stroke, "stroke-width": f2(sw * 1.12) };
      if (op < 0.999) { topA.opacity = op.toFixed(3); botA.opacity = op.toFixed(3); }
      out.push({ tag: "line", attrs: topA }, { tag: "line", attrs: botA });
      out.push({ tag: "line", attrs: { x1: f2(x), y1: f2(y), x2: f2(x), y2: f2(y + h * progress), stroke, "stroke-width": f2(sw * 0.65), opacity: (op * 0.52).toFixed(3) } });
      out.push({ tag: "line", attrs: { x1: f2(x + w), y1: f2(y), x2: f2(x + w), y2: f2(y + h * progress), stroke, "stroke-width": f2(sw * 0.65), opacity: (op * 0.52).toFixed(3) } });
    }
    return out;
  }

  if ((G.panel === "cartouche" || G.panel === "inlay") && !isCell && !dashed && w >= 76 && h >= 36) {
    if (hasFill) {
      const extra = G.multiply && !isSolidAccent ? { style: "mix-blend-mode:multiply" } : null;
      out.push(mkFillRect(f2(x), f2(y), f2(w), f2(h), extra));
    }
    if (hasStroke) {
      const sa = { x: f2(x), y: f2(y), width: f2(w), height: f2(h), fill: "none", stroke, "stroke-width": f2(sw) };
      if (progress < 0.999) { sa.pathLength = "1"; sa["stroke-dasharray"] = "1 1"; sa["stroke-dashoffset"] = (1 - progress).toFixed(4); }
      if (op < 0.999) sa.opacity = op.toFixed(3);
      out.push({ tag: "rect", attrs: sa });
      if (progress > 0.7) {
        const ins = 3.5;
        const innerSw = f2(Math.max(0.75, sw * 0.45));
        if (G.panel === "cartouche") {
          const k = f2(Math.min(7.5, w * 0.05, h * 0.14));
          const x0 = f2(x + ins), y0 = f2(y + ins), x1 = f2(x + w - ins), y1 = f2(y + h - ins);
          const x0k = f2(x0 + k), x1k = f2(x1 - k), y0k = f2(y0 + k), y1k = f2(y1 - k);
          const cd = `M ${x0k} ${y0} H ${x1k} V ${y0k} H ${x1} V ${y1k} H ${x1k} V ${y1} H ${x0k} V ${y1k} H ${x0} V ${y0k} H ${x0k} Z`;
          const closedPts = new Float32Array([x0k, y0, x1k, y0, x1k, y0k, x1, y0k, x1, y1k, x1k, y1k, x1k, y1, x0k, y1, x0k, y1k, x0, y1k, x0, y0k, x0k, y0k]);
          out.push({
            tag: "path",
            attrs: { d: cd, fill: "none", stroke, "stroke-width": innerSw, opacity: (op * 0.58).toFixed(3) },
            closedPts,
          });
        } else {
          const x0 = f2(x + ins), y0 = f2(y + ins), x1 = f2(x + w - ins), y1 = f2(y + h - ins);
          const ox0 = f2(x), oy0 = f2(y), ox1 = f2(x + w), oy1 = f2(y + h);
          const md = `M ${ox0} ${oy0} L ${x0} ${y0} M ${ox1} ${oy0} L ${x1} ${y0} M ${ox0} ${oy1} L ${x0} ${y1} M ${ox1} ${oy1} L ${x1} ${y1}`;
          out.push({
            tag: "rect",
            attrs: { x: x0, y: y0, width: f2(w - ins * 2), height: f2(h - ins * 2), fill: "none", stroke, "stroke-width": innerSw, opacity: (op * 0.55).toFixed(3) },
          });
          out.push({
            tag: "path",
            attrs: { d: md, fill: "none", stroke, "stroke-width": innerSw, opacity: (op * 0.45).toFixed(3) },
            segs: new Float32Array([ox0, oy0, x0, y0, ox1, oy0, x1, y0, ox0, oy1, x0, y1, ox1, oy1, x1, y1]),
          });
        }
      }
    }
    return out;
  }

  if (G.panel === "graticule" && !isCell && !dashed && w >= 64 && h >= 32) {
    if (hasFill) out.push(mkFillRect(f2(x), f2(y), f2(w), f2(h)));
    if (hasStroke) {
      out.push({ tag: "rect", attrs: { x: f2(x), y: f2(y), width: f2(w), height: f2(h), fill: "none", stroke, "stroke-width": f2(sw * 0.65), opacity: (op * 0.42).toFixed(3) } });
      const b = Math.min(10, w * 0.12, h * 0.24);
      const x0 = f2(x), y0 = f2(y), x1 = f2(x + w), y1 = f2(y + h);
      const x0b = f2(x + b), x1b = f2(x + w - b), y0b = f2(y + b), y1b = f2(y + h - b);
      const d = `M ${x0} ${y0b} V ${y0} H ${x0b} M ${x1b} ${y0} H ${x1} V ${y0b} M ${x0} ${y1b} V ${y1} H ${x0b} M ${x1b} ${y1} H ${x1} V ${y1b}`;
      const ca = { d, fill: "none", stroke, "stroke-width": f2(sw * 1.25) };
      if (op < 0.999) ca.opacity = op.toFixed(3);
      const segs = new Float32Array([
        x0, y0b, x0, y0, x0, y0, x0b, y0,
        x1b, y0, x1, y0, x1, y0, x1, y0b,
        x0, y1b, x0, y1, x0, y1, x0b, y1,
        x1b, y1, x1, y1, x1, y1, x1, y1b,
      ]);
      out.push({ tag: "path", attrs: ca, segs });
    }
    return out;
  }

  if (G.panel === "stone" && !dashed && w >= 12 && h >= 12) {
    if (hasFill) out.push(mkFillRect(f2(x), f2(y), f2(w), f2(h)));
    if (hasStroke) {
      const seed = hashSeed(opts.seed ?? 11);
      const rectPts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
      const cd = chiseledPolylineData(rectPts, G.roughness, seed, true);
      const pa = { d: cd.d, fill: "none", stroke, "stroke-width": f2(sw) };
      if (progress < 0.999) {
        pa.pathLength = "1";
        pa["stroke-dasharray"] = "1 1";
        pa["stroke-dashoffset"] = (1 - progress).toFixed(4);
      }
      if (op < 0.999) pa.opacity = op.toFixed(3);
      out.push({ tag: "path", attrs: pa, closedPts: cd.closedPts });
    }
    return out;
  }

  // Default hairline / scroll cell / dashed panel
  if (hasFill) {
    const extra = G.multiply && !isSolidAccent && colorDistSqRgb(parseRgb(fill, [128, 128, 128]), G.bgRgb) > 64 ? { style: "mix-blend-mode:multiply" } : null;
    out.push(mkFillRect(f2(x), f2(y), f2(w), f2(h), extra));
  }
  if (hasStroke) {
    const sa = { x: f2(x), y: f2(y), width: f2(w), height: f2(h), fill: "none", stroke, "stroke-width": f2(sw) };
    if (dashed) sa["stroke-dasharray"] = dashed;
    else if (progress < 0.999) {
      sa.pathLength = "1"; sa["stroke-dasharray"] = "1 1"; sa["stroke-dashoffset"] = (1 - progress).toFixed(4);
    }
    if (op < 0.999) sa.opacity = op.toFixed(3);
    out.push({ tag: "rect", attrs: sa });
  }
  return out;
}

/**
 * 5. Semantic Shaded Region / Polygon / Bar (`region`)
 * Materializes fills according to --pf-mark-fill using analytical scanline hachures,
 * directional yunran washes, manga screentones, CRT scanlines, stipples, and 8-bit dithers.
 */
export function buildRegionSpec(points, G, opts = {}) {
  if (!Array.isArray(points) || points.length < 3) return [];
  const bounds = polygonBounds(points);
  if (bounds.w < 1.2 || bounds.h < 1.2) return [];

  const op = clamp(opts.opacity ?? 1, 0, 1);
  if (op < 0.002) return [];
  const fillP = clamp(opts.fillOpacity ?? 1, 0, 1);
  const seed = hashSeed(opts.seed ?? 29);
  const role = opts.role || "primary";
  const fill = opts.fill !== undefined ? opts.fill : resolveRoleColor(G, role);
  const stroke = opts.stroke !== undefined ? opts.stroke : "none";
  const sw = Number(opts.strokeWidth ?? (stroke !== "none" ? 1.5 : 0));
  const dashed = opts.dash || "";

  let ptsAttr = "";
  const polyNums = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    const px = f2(points[i][0]), py = f2(points[i][1]);
    polyNums[i * 2] = px;
    polyNums[i * 2 + 1] = py;
    ptsAttr += i === 0 ? `${px},${py}` : ` ${px},${py}`;
  }
  const out = [];

  if (!fill || fill === "none" || fill.charCodeAt(0) === 117 /* 'u' */) {
    const a = { points: ptsAttr, fill: fill || "none" };
    if (stroke && stroke !== "none" && sw > 0) { a.stroke = stroke; a["stroke-width"] = f2(sw); }
    if (dashed) a["stroke-dasharray"] = dashed;
    if (op * fillP < 0.999) a.opacity = (op * fillP).toFixed(3);
    out.push({ tag: "polygon", attrs: a, nums: polyNums });
    return out;
  }

  const fillRgb = parseRgb(fill, [128, 128, 128]);
  const distBgSq = colorDistSqRgb(fillRgb, G.bgRgb);
  const distFgSq = colorDistSqRgb(fillRgb, G.fgRgb);
  const fillLum = fillRgb[0] * 0.299 + fillRgb[1] * 0.587 + fillRgb[2] * 0.114;
  const isNearInk = (role === "ink" && distFgSq < 2025) || (!G.isDark && fillLum < 48 && distFgSq < 2025);
  const weight = opts.weight || (isNearInk ? "solid" : distBgSq > 18225 ? "strong" : distBgSq > 2704 ? "medium" : "subtle");
  const isReddish = (fillRgb[0] - Math.max(fillRgb[1], fillRgb[2])) > 22;
  const isCaveat = role === "caveat" || (role !== "primary" && role !== "ink" && isReddish && colorDistSqRgb(fillRgb, G.terraRgb) < colorDistSqRgb(fillRgb, G.slateRgb));
  const inkLineCol = isCaveat
    ? G.P.terracotta
    : weight === "subtle"
      ? G.P.muted
      : distBgSq > 9025
        ? fill
        : G.P.slate;

  // Fill Mode A: Crisp flat analytical tint (Swiss default)
  if (G.fill === "tint") {
    const a = { points: ptsAttr, fill };
    if (op * fillP < 0.999) a.opacity = (op * fillP).toFixed(3);
    out.push({ tag: "polygon", attrs: a, nums: polyNums });
  }
  // Fill Mode B: Directional Yunran (晕染) / Bokashi ink & mineral wash
  else if (G.fill === "wash") {
    if (weight === "solid") {
      out.push({ tag: "polygon", attrs: { points: ptsAttr, fill, opacity: (op * fillP * 0.92).toFixed(3) }, nums: polyNums });
    } else {
      const washInk = isCaveat ? G.P.terracotta : weight === "subtle" ? G.P.muted : (distBgSq > 15625 ? fill : G.P.slate);
      const darkScale = G.isDark ? 0.62 : 1.0;
      const isHorizBar = bounds.w > bounds.h * 2.1 && points.length <= 6;
      const hiA = (weight === "strong" ? 0.72 : weight === "medium" ? 0.40 : 0.22) * darkScale;
      const midA = (weight === "strong" ? 0.42 : weight === "medium" ? 0.22 : 0.12) * darkScale;
      const loA = (weight === "strong" ? 0.18 : 0.06) * darkScale;
      const stops = isHorizBar ? [loA * 1.15, midA, hiA] : [hiA, midA, loA];
      const effOp = weight === "strong" ? op * fillP : op * clamp(fillP * 1.35, 0, 1);
      const a = {
        points: ptsAttr,
        fill: washInk,
        opacity: effOp.toFixed(3),
      };
      if (G.multiply) a.style = "mix-blend-mode:multiply";
      out.push({ tag: "polygon", attrs: a, nums: polyNums, wash: { color: washInk, dir: isHorizBar ? "h" : "v", stops, bounds } });
    }
  }
  // Fill Mode C: Manga 45-deg halftone screentone + slash hachure on caveats
  else if (G.fill === "screentone") {
    if (weight === "solid") {
      const sa = { points: ptsAttr, fill: G.P.fg };
      if (op * fillP < 0.999) sa.opacity = (op * fillP).toFixed(3);
      out.push({ tag: "polygon", attrs: sa, nums: polyNums });
    } else if (isCaveat) {
      const ba = { points: ptsAttr, fill: G.P.bg };
      if (op * fillP < 0.999) ba.opacity = (op * fillP).toFixed(3);
      out.push({ tag: "polygon", attrs: ba, nums: polyNums });
      const hd = buildHachureData(points, 36, 5.5, 0.12, seed, false);
      if (hd) {
        out.push({
          tag: "path",
          attrs: { d: hd.d, fill: "none", stroke: G.P.terracotta, "stroke-width": "1.15", opacity: (op * clamp(fillP * 1.25, 0, 1) * 0.85).toFixed(3) },
          segs: hd.segs,
          qsegs: hd.qsegs,
        });
      }
    } else {
      const density = weight === "strong" ? 34 : weight === "medium" ? 22 : 12;
      const pa = { points: ptsAttr, fill };
      const pOp = op * clamp(fillP * 1.35, 0, 1);
      if (pOp < 0.999) pa.opacity = pOp.toFixed(3);
      out.push({
        tag: "polygon",
        attrs: pa,
        nums: polyNums,
        pattern: { kind: "screentone", density, fg: G.P.fg, bg: G.P.bg },
      });
    }
  }
  // Fill Mode D: Pixel Bayer Dither (pixel-8bit, win2000) across strong/medium/subtle
  else if (G.fill === "dither") {
    if (weight === "solid") {
      const sa = { points: ptsAttr, fill, "shape-rendering": "crispEdges" };
      if (op * fillP < 0.999) sa.opacity = (op * fillP).toFixed(3);
      out.push({ tag: "polygon", attrs: sa, nums: polyNums });
    } else {
      const density = weight === "strong" ? 50 : weight === "medium" ? 25 : 12;
      const fgCol = isCaveat ? G.P.terracotta : distBgSq > 7225 ? fill : G.P.slate;
      const pa = { points: ptsAttr, fill, "shape-rendering": "crispEdges" };
      const pOp = op * clamp(fillP * (weight === "strong" ? 1.0 : 1.25), 0, 1);
      if (pOp < 0.999) pa.opacity = pOp.toFixed(3);
      out.push({
        tag: "polygon",
        attrs: pa,
        nums: polyNums,
        pattern: { kind: "dither", density, fg: fgCol, bg: G.P.bg },
      });
    }
  }
  // Fill Mode E: Analytical Scanline Procedural Fills — hachure, weave, stipple, scanline
  else {
    let baseTintAlpha =
      G.fill === "scanline" ? (weight === "solid" ? 0.34 : 0.14)
      : G.fill === "weave"  ? (weight === "solid" ? 0.78 : 0.56)
      : G.fill === "stipple" ? (weight === "solid" ? 0.72 : 0.48)
      : (weight === "solid" ? 0.76 : 0.44);
    if (G.isDark && weight !== "solid" && G.fill !== "scanline") {
      baseTintAlpha *= 0.46;
    }

    const baseAttrs = { points: ptsAttr, fill, opacity: (op * fillP * baseTintAlpha).toFixed(3) };
    if (G.multiply && weight !== "solid") baseAttrs.style = "mix-blend-mode:multiply";
    out.push({ tag: "polygon", attrs: baseAttrs, nums: polyNums });

    const area = bounds.w * bounds.h;
    if (area >= 48 && bounds.w >= 4 && bounds.h >= 4) {
      let crossHatch = false;
      let angle = isCaveat ? -G.scanAngle : G.scanAngle;
      let gap = G.gap;
      let rgh = G.roughness;
      let fw = 0.95;
      let lineAlpha = 0.44;
      let lineCol = weight === "solid" ? G.P.bg : inkLineCol;
      let extraDash = "";

      if (G.fill === "weave") {
        crossHatch = weight === "strong" && area < 95000;
        rgh = 0;
        gap = weight === "subtle" ? G.gap * 1.45 : G.gap * 1.08;
        fw = 0.82;
        lineAlpha = weight === "subtle" ? 0.24 : 0.36;
      } else if (G.fill === "stipple") {
        rgh = Math.max(0.38, G.roughness);
        gap = G.gap * 1.05;
        fw = 1.35;
        lineAlpha = weight === "subtle" ? 0.30 : 0.50;
        extraDash = "2.4 5.6";
      } else if (G.fill === "scanline") {
        angle = isCaveat && G.scanAngle === 90 ? 62 : G.scanAngle;
        rgh = 0;
        gap = weight === "strong" || weight === "solid" ? 4.2 : G.gap;
        fw = weight === "solid" ? 1.35 : 0.92;
        lineCol = weight === "solid" ? fill : inkLineCol;
        lineAlpha = weight === "solid" ? 0.85 : weight === "strong" ? 0.62 : 0.42;
      } else {
        gap = weight === "strong" ? G.gap * 0.85 : weight === "subtle" ? G.gap * 1.35 : G.gap;
        fw = weight === "strong" ? 1.1 : 0.9;
        lineAlpha = weight === "subtle" ? 0.26 : 0.46;
      }
      if (G.isDark && weight !== "solid") {
        lineAlpha = Math.min(0.84, lineAlpha * 1.25);
      }

      const hd = buildHachureData(points, angle, gap, rgh, seed, crossHatch);
      if (hd) {
        const pa = {
          d: hd.d,
          fill: "none",
          stroke: lineCol,
          "stroke-width": f2(fw),
          opacity: (op * fillP * lineAlpha).toFixed(3),
        };
        if (extraDash) {
          pa["stroke-dasharray"] = extraDash;
          pa["stroke-linecap"] = "round";
        }
        out.push({ tag: "path", attrs: pa, segs: hd.segs, qsegs: hd.qsegs });
      }
    }
  }

  if (stroke && stroke !== "none" && sw > 0) {
    const closedPts = points.concat([points[0]]);
    out.push(...buildCurveSpec(closedPts, G, { stroke, strokeWidth: sw, dash: dashed, opacity: op, seed: seed + 3 }));
  }

  return out;
}

/**
 * 6. Semantic Curve / Trajectory / Connector / Segment (`curve`)
 */
export function buildCurveSpec(pointsOrPath, G, opts = {}) {
  const op = clamp(opts.opacity ?? 1, 0, 1);
  if (op < 0.002) return [];
  const stroke = opts.stroke || resolveRoleColor(G, opts.role || "ink");
  if (stroke === "none") return [];
  const sw = Number(opts.strokeWidth ?? 1.8);
  if (!(sw > 0)) return [];
  const dashed = opts.dash && opts.dash !== "none" ? String(opts.dash) : "";
  const progress = clamp(opts.progress ?? 1, 0, 1);
  if (progress < 0.002) return [];
  const seed = hashSeed(opts.seed ?? 43);

  const isStringPath = typeof pointsOrPath === "string";
  const subpaths = isStringPath && !dashed ? sampleSvgSubpaths(pointsOrPath) : null;

  if (subpaths && subpaths.length > 1) {
    let total = 0;
    const lengths = new Float64Array(subpaths.length);
    for (let s = 0; s < subpaths.length; s++) {
      const sp = subpaths[s];
      let L = 0;
      for (let i = 0; i < sp.length - 1; i++) L += hypot2(sp[i + 1][0] - sp[i][0], sp[i + 1][1] - sp[i][1]);
      lengths[s] = L;
      total += L;
    }
    if (total < 0.5) return [];
    let budget = total * progress;
    const out = [];
    for (let i = 0; i < subpaths.length; i++) {
      if (budget <= 1e-4) break;
      const subL = lengths[i];
      const subP = subL > 1e-6 ? clamp(budget / subL, 0, 1) : 1;
      budget -= subL;
      out.push(...buildCurveSpec(subpaths[i], G, { ...opts, progress: subP, seed: seed + i * 31 }));
    }
    return out;
  }

  const rawPts = isStringPath ? (subpaths ? subpaths[0] : sampleSimpleSvgPath(pointsOrPath)) : pointsOrPath;

  if (dashed || (!rawPts && isStringPath)) {
    const attrs = { fill: "none", stroke, "stroke-width": f2(sw) };
    if (dashed) attrs["stroke-dasharray"] = dashed;
    else if (progress < 0.999) {
      attrs.pathLength = "1"; attrs["stroke-dasharray"] = "1 1"; attrs["stroke-dashoffset"] = (1 - progress).toFixed(4);
    }
    if (opts.lineCap) attrs["stroke-linecap"] = opts.lineCap;
    if (opts.lineJoin) attrs["stroke-linejoin"] = opts.lineJoin;
    if (G.stroke === "pixel") attrs["shape-rendering"] = "crispEdges";
    if (op < 0.999) attrs.opacity = op.toFixed(3);
    if (isStringPath) {
      let sNums = null;
      if (rawPts && rawPts.length >= 2) {
        sNums = new Float64Array(rawPts.length * 2);
        for (let i = 0; i < rawPts.length; i++) {
          sNums[i * 2] = rawPts[i][0];
          sNums[i * 2 + 1] = rawPts[i][1];
        }
      }
      return [sNums ? { tag: "path", attrs: { d: pointsOrPath, ...attrs }, nums: sNums } : { tag: "path", attrs: { d: pointsOrPath, ...attrs } }];
    }
    if (!rawPts || rawPts.length < 2) return [];
    if (rawPts.length === 2) {
      return [{ tag: "line", attrs: { x1: f2(rawPts[0][0]), y1: f2(rawPts[0][1]), x2: f2(rawPts[1][0]), y2: f2(rawPts[1][1]), ...attrs } }];
    }
    const nums = new Float64Array(rawPts.length * 2);
    let pStr = "";
    for (let i = 0; i < rawPts.length; i++) {
      const px = f2(rawPts[i][0]), py = f2(rawPts[i][1]);
      nums[i * 2] = px; nums[i * 2 + 1] = py;
      pStr += i === 0 ? `${px},${py}` : ` ${px},${py}`;
    }
    return [{ tag: "polyline", attrs: { points: pStr, ...attrs }, nums }];
  }

  const pts = slicePolyline(rawPts, progress);
  if (!pts || pts.length < 2) return [];

  let totalLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    totalLen += hypot2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  if (totalLen < 0.5) return [];

  const minBrushLen = opts.forceBrush ? 8 : 26;
  if ((G.stroke === "brush" || G.stroke === "gpen") && totalLen >= minBrushLen && sw >= 1.35) {
    const isBrush = G.stroke === "brush";
    const td = taperedPolylineData(pts, sw, isBrush, seed);
    if (td && td.d) {
      const pa = { d: td.d, fill: stroke };
      if (op < 0.999) pa.opacity = op.toFixed(3);
      return [{ tag: "path", attrs: pa, smoothPoly: td.smoothPoly }];
    }
  }

  if (G.stroke === "chisel" && totalLen >= 24) {
    const cd = chiseledPolylineData(pts, G.roughness, seed, false);
    const pa = { d: cd.d, fill: "none", stroke, "stroke-width": f2(sw * 1.06) };
    if (op < 0.999) pa.opacity = op.toFixed(3);
    return [{ tag: "path", attrs: pa, nums: cd.nums }];
  }

  if (G.stroke === "pixel") {
    const q = (v) => Math.round(v);
    if (pts.length === 2) {
      const a = { x1: q(pts[0][0]), y1: q(pts[0][1]), x2: q(pts[1][0]), y2: q(pts[1][1]), stroke, "stroke-width": Math.max(1.5, Math.round(sw)), "stroke-linecap": "square", "shape-rendering": "crispEdges" };
      if (op < 0.999) a.opacity = op.toFixed(3);
      return [{ tag: "line", attrs: a }];
    }
    const nums = new Float64Array(pts.length * 2);
    let pStr = "";
    for (let i = 0; i < pts.length; i++) {
      const px = q(pts[i][0]), py = q(pts[i][1]);
      nums[i * 2] = px; nums[i * 2 + 1] = py;
      pStr += i === 0 ? `${px},${py}` : ` ${px},${py}`;
    }
    const a = { points: pStr, fill: "none", stroke, "stroke-width": Math.max(1.5, Math.round(sw)), "stroke-linecap": "square", "stroke-linejoin": "miter", "shape-rendering": "crispEdges" };
    if (op < 0.999) a.opacity = op.toFixed(3);
    return [{ tag: "polyline", attrs: a, nums }];
  }

  if (isStringPath && progress >= 0.999) {
    const a = { d: pointsOrPath, fill: "none", stroke, "stroke-width": f2(sw) };
    if (opts.lineCap) a["stroke-linecap"] = opts.lineCap;
    if (opts.lineJoin) a["stroke-linejoin"] = opts.lineJoin;
    if (op < 0.999) a.opacity = op.toFixed(3);
    const sNums = new Float64Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) {
      sNums[i * 2] = pts[i][0];
      sNums[i * 2 + 1] = pts[i][1];
    }
    return [{ tag: "path", attrs: a, nums: sNums }];
  }
  if (pts.length === 2) {
    const a = { x1: f2(pts[0][0]), y1: f2(pts[0][1]), x2: f2(pts[1][0]), y2: f2(pts[1][1]), stroke, "stroke-width": f2(sw) };
    if (opts.lineCap) a["stroke-linecap"] = opts.lineCap;
    if (op < 0.999) a.opacity = op.toFixed(3);
    return [{ tag: "line", attrs: a }];
  }
  const nums = new Float64Array(pts.length * 2);
  let pStr = "";
  for (let i = 0; i < pts.length; i++) {
    const px = f2(pts[i][0]), py = f2(pts[i][1]);
    nums[i * 2] = px; nums[i * 2 + 1] = py;
    pStr += i === 0 ? `${px},${py}` : ` ${px},${py}`;
  }
  const a = { points: pStr, fill: "none", stroke, "stroke-width": f2(sw) };
  if (opts.lineCap) a["stroke-linecap"] = opts.lineCap;
  if (opts.lineJoin) a["stroke-linejoin"] = opts.lineJoin;
  if (op < 0.999) a.opacity = op.toFixed(3);
  return [{ tag: "polyline", attrs: a, nums }];
}

/**
 * 7. Semantic Coordinate Axis (`axis`)
 * Combines shaft, style-matched terminal arrowhead, and optional perpendicular ticks.
 */
export function buildAxisSpec(x1, y1, x2, y2, G, opts = {}) {
  const op = clamp(opts.opacity ?? 1, 0, 1);
  if (op < 0.002) return [];
  const role = opts.role || "ink";
  const stroke = opts.stroke || resolveRoleColor(G, role);
  const sw = Number(opts.strokeWidth ?? 1.8);
  const seed = hashSeed(opts.seed ?? anchorSeed4(0x61786973, x1, y1, x2, y2));
  const out = [];

  const withArrow = opts.arrow !== false;
  if (withArrow) {
    const prep = prepareArrowGeometry([[x1, y1], [x2, y2]], G, { ...opts, stroke, strokeWidth: sw });
    if (prep.shaftInput) {
      out.push(...buildCurveSpec(prep.shaftInput, G, { ...opts, role, stroke, strokeWidth: sw, progress: prep.shaftProgress, seed }));
    }
    if (prep.head) {
      out.push(...buildArrowHeadSpec(prep.head.x, prep.head.y, prep.head.angle, G, { role, fill: stroke, size: prep.head.size, opacity: op }));
    }
  } else {
    out.push(...buildCurveSpec([[x1, y1], [x2, y2]], G, { ...opts, role, stroke, strokeWidth: sw, seed }));
  }

  const ticks = opts.ticks;
  if (ticks) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = hypot2(dx, dy);
    if (len > 1) {
      const nx = -dy / len, ny = dx / len;
      const tSize = Number(opts.tickSize ?? 4.5);
      const uList = Array.isArray(ticks)
        ? ticks
        : (() => {
            const cnt = Math.max(1, Math.min(32, Math.floor(Number(ticks))));
            const arr = [];
            for (let i = 1; i <= cnt; i++) arr.push(i / (cnt + 1));
            return arr;
          })();
      for (const u of uList) {
        if (!(u >= 0 && u <= 1)) continue;
        const tx = lerp(x1, x2, u), ty = lerp(y1, y2, u);
        const ta = {
          x1: f2(tx - nx * tSize * 0.5),
          y1: f2(ty - ny * tSize * 0.5),
          x2: f2(tx + nx * tSize * 0.5),
          y2: f2(ty + ny * tSize * 0.5),
          stroke,
          "stroke-width": f2(Math.max(1.1, sw * 0.72)),
        };
        if (op < 0.999) ta.opacity = op.toFixed(3);
        out.push({ tag: "line", attrs: ta });
      }
    }
  }
  return out;
}

// ============================================================================
// High-Level Diagram & Animation Builders (Braces, Connectors, Annotations, Morphs, Plots)
// ============================================================================

const MORPH_ARRAY_CACHE = new WeakMap();
const MORPH_STR_CACHE = new Map();

function resampleUniformPolyline(ptsOrPath, samples) {
  const isArr = Array.isArray(ptsOrPath);
  if (isArr) {
    const byS = MORPH_ARRAY_CACHE.get(ptsOrPath);
    if (byS && byS.n === samples) return byS.pts;
  } else if (typeof ptsOrPath === "string" && ptsOrPath.length <= 420) {
    const k = `${samples}|${ptsOrPath}`;
    const hit = MORPH_STR_CACHE.get(k);
    if (hit !== undefined) return hit;
  }
  const raw = isArr ? ptsOrPath : sampleSimpleSvgPath(ptsOrPath) || (sampleSvgSubpaths(ptsOrPath)?.[0] ?? null);
  if (!raw || raw.length === 0) return [];
  if (raw.length === 1) {
    const single = new Array(samples);
    for (let i = 0; i < samples; i++) single[i] = [raw[0][0], raw[0][1]];
    return single;
  }
  const cum = new Float64Array(raw.length);
  for (let i = 1; i < raw.length; i++) {
    cum[i] = cum[i - 1] + hypot2(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
  }
  const total = cum[raw.length - 1];
  const out = new Array(samples);
  if (total < 1e-6) {
    for (let i = 0; i < samples; i++) out[i] = [raw[0][0], raw[0][1]];
  } else {
    let segIdx = 0;
    for (let s = 0; s < samples; s++) {
      const targetD = (s / (samples - 1)) * total;
      while (segIdx < raw.length - 2 && cum[segIdx + 1] < targetD) segIdx++;
      const d0 = cum[segIdx], d1 = cum[segIdx + 1];
      const u = d1 > d0 + 1e-9 ? clamp((targetD - d0) / (d1 - d0), 0, 1) : 0;
      out[s] = [lerp(raw[segIdx][0], raw[segIdx + 1][0], u), lerp(raw[segIdx][1], raw[segIdx + 1][1], u)];
    }
  }
  if (isArr) {
    MORPH_ARRAY_CACHE.set(ptsOrPath, { n: samples, pts: out });
  } else if (typeof ptsOrPath === "string" && ptsOrPath.length <= 420) {
    if (MORPH_STR_CACHE.size >= 256) MORPH_STR_CACHE.clear();
    MORPH_STR_CACHE.set(`${samples}|${ptsOrPath}`, out);
  }
  return out;
}

/** Smoothly morph between any two polylines or SVG path strings across `u` in `[0, 1]`. */
export function morphPoints(ptsA, ptsB, u, samples = 32) {
  const n = Math.max(4, Math.min(256, samples | 0));
  const a = resampleUniformPolyline(ptsA, n);
  const b = resampleUniformPolyline(ptsB, n);
  if (!a.length || !b.length) return a.length ? a : b;
  const t = clamp(u, 0, 1);
  if (t <= 0) return a;
  if (t >= 1) return b;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = [lerp(a[i][0], b[i][0], t), lerp(a[i][1], b[i][1], t)];
  }
  return out;
}

/** Exact cusp tip `[x, y]` of an oriented curly brace from `(x1, y1)` to `(x2, y2)`. */
export function braceTip(x1, y1, x2, y2, depth = 10, flip = false) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = hypot2(dx, dy) || 1;
  const d = Number(depth) * (flip ? -1 : 1);
  return [(x1 + x2) * 0.5 - (dy / L) * d, (y1 + y2) * 0.5 + (dx / L) * d];
}

export function buildBraceSpec(x1, y1, x2, y2, G, opts = {}) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = hypot2(dx, dy);
  if (L < 2) return [];
  const tx = dx / L, ty = dy / L;
  const d = Number(opts.depth ?? 10) * (opts.flip ? -1 : 1);
  const nx = -ty * d, ny = tx * d;
  const k = Math.min(Math.abs(d) * 0.9, L * 0.18);
  const mx = (x1 + x2) * 0.5, my = (y1 + y2) * 0.5;
  const sx = nx * 0.52, sy = ny * 0.52;
  const p = (px, py) => `${f2(px)} ${f2(py)}`;
  const dPath =
    `M ${p(x1, y1)} Q ${p(x1 + sx, y1 + sy)} ${p(x1 + tx * k + sx, y1 + ty * k + sy)} ` +
    `L ${p(mx - tx * k + sx, my - ty * k + sy)} Q ${p(mx + sx, my + sy)} ${p(mx + nx, my + ny)} ` +
    `M ${p(mx + nx, my + ny)} Q ${p(mx + sx, my + sy)} ${p(mx + tx * k + sx, my + ty * k + sy)} ` +
    `L ${p(x2 - tx * k + sx, y2 - ty * k + sy)} Q ${p(x2 + sx, y2 + sy)} ${p(x2, y2)}`;
  return buildCurveSpec(dPath, G, { ...opts, stroke: opts.stroke || resolveRoleColor(G, opts.role || "muted"), strokeWidth: opts.strokeWidth ?? 1.7, forceBrush: true });
}

export function buildBracketSpec(x1, y1, x2, y2, G, opts = {}) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = hypot2(dx, dy);
  if (L < 1) return [];
  const tk = Number(opts.tick ?? 5) * (opts.flip ? -1 : 1);
  const nx = (-dy / L) * tk, ny = (dx / L) * tk;
  const pts = [[x1 + nx, y1 + ny], [x1, y1], [x2, y2], [x2 + nx, y2 + ny]];
  return buildCurveSpec(pts, G, { ...opts, stroke: opts.stroke || resolveRoleColor(G, opts.role || "muted"), strokeWidth: opts.strokeWidth ?? 1.6 });
}

function normBox(boxOrPt) {
  if (Array.isArray(boxOrPt)) {
    if (boxOrPt.length >= 4) return { x: boxOrPt[0], y: boxOrPt[1], w: boxOrPt[2], h: boxOrPt[3], cx: boxOrPt[0] + boxOrPt[2] * 0.5, cy: boxOrPt[1] + boxOrPt[3] * 0.5, isPt: false };
    return { x: boxOrPt[0], y: boxOrPt[1], w: 0, h: 0, cx: boxOrPt[0], cy: boxOrPt[1], isPt: true };
  }
  const x = Number(boxOrPt.x || 0), y = Number(boxOrPt.y || 0), w = Number(boxOrPt.w ?? boxOrPt.width ?? 0), h = Number(boxOrPt.h ?? boxOrPt.height ?? 0);
  return { x, y, w, h, cx: x + w * 0.5, cy: y + h * 0.5, isPt: w === 0 && h === 0 };
}

/** Cardinal & center ports `{ top, right, bottom, left, center }` for `{ x, y, w, h }` with optional `pad`. */
export function boxPorts(box, pad = 0) {
  const b = normBox(box);
  return {
    top: [b.cx, b.y - pad],
    right: [b.x + b.w + pad, b.cy],
    bottom: [b.cx, b.y + b.h + pad],
    left: [b.x - pad, b.cy],
    center: [b.cx, b.cy],
  };
}

function rayBoxExit(b, dirX, dirY, pad) {
  if (b.isPt) return [b.cx, b.cy];
  const hw = b.w * 0.5 + pad, hh = b.h * 0.5 + pad;
  const tx = Math.abs(dirX) > 1e-6 ? hw / Math.abs(dirX) : Infinity;
  const ty = Math.abs(dirY) > 1e-6 ? hh / Math.abs(dirY) : Infinity;
  const t = Math.min(tx, ty);
  return Number.isFinite(t) ? [b.cx + dirX * t, b.cy + dirY * t] : [b.cx, b.cy];
}

/** Compute clean boundary-clipped connector geometry (polyline or SVG quadratic arc) between boxes or points. */
export function routeConnector(from, to, opts = {}) {
  const pad = Number(opts.pad ?? 5);
  const A = normBox(from), B = normBox(to);
  const dx = B.cx - A.cx, dy = B.cy - A.cy;
  const route = opts.route || "auto";
  const fp = boxPorts(A, pad), tp = boxPorts(B, pad);

  if (route === "arc") {
    const L = hypot2(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const p0 = opts.fromSide ? fp[opts.fromSide] : rayBoxExit(A, ux, uy, pad);
    const p1 = opts.toSide ? tp[opts.toSide] : rayBoxExit(B, -ux, -uy, pad);
    const bend = Number(opts.curve ?? 0.2) * hypot2(p1[0] - p0[0], p1[1] - p0[1]);
    const qx = (p0[0] + p1[0]) * 0.5 - uy * bend;
    const qy = (p0[1] + p1[1]) * 0.5 + ux * bend;
    return `M ${f2(p0[0])} ${f2(p0[1])} Q ${f2(qx)} ${f2(qy)} ${f2(p1[0])} ${f2(p1[1])}`;
  }

  if (route === "hv") {
    const p0 = opts.fromSide ? fp[opts.fromSide] : (dx >= 0 ? fp.right : fp.left);
    const p1 = opts.toSide ? tp[opts.toSide] : (dy >= 0 ? tp.top : tp.bottom);
    return [p0, [p1[0], p0[1]], p1];
  }
  if (route === "vh") {
    const p0 = opts.fromSide ? fp[opts.fromSide] : (dy >= 0 ? fp.bottom : fp.top);
    const p1 = opts.toSide ? tp[opts.toSide] : (dx >= 0 ? tp.left : tp.right);
    return [p0, [p0[0], p1[1]], p1];
  }
  const useZ = route === "z" || (route === "auto" && Math.abs(dx) > 8 && Math.abs(dy) > 8 && !A.isPt && !B.isPt);
  if (useZ) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      const p0 = opts.fromSide ? fp[opts.fromSide] : (dx >= 0 ? fp.right : fp.left);
      const p1 = opts.toSide ? tp[opts.toSide] : (dx >= 0 ? tp.left : tp.right);
      const mx = (p0[0] + p1[0]) * 0.5;
      return [p0, [mx, p0[1]], [mx, p1[1]], p1];
    }
    const p0 = opts.fromSide ? fp[opts.fromSide] : (dy >= 0 ? fp.bottom : fp.top);
    const p1 = opts.toSide ? tp[opts.toSide] : (dy >= 0 ? tp.top : tp.bottom);
    const my = (p0[1] + p1[1]) * 0.5;
    return [p0, [p0[0], my], [p1[0], my], p1];
  }

  const L = hypot2(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const p0 = opts.fromSide ? fp[opts.fromSide] : rayBoxExit(A, ux, uy, pad);
  const p1 = opts.toSide ? tp[opts.toSide] : rayBoxExit(B, -ux, -uy, pad);
  return [p0, p1];
}

export function buildAnnotateSpec(box, G, opts = {}) {
  const op = clamp(opts.opacity ?? 1, 0, 1);
  if (op < 0.002) return [];
  const progress = clamp(opts.progress ?? 1, 0, 1);
  if (progress < 0.002) return [];
  const b = normBox(box);
  const type = opts.type || "underline";
  const pad = Number(opts.pad ?? 4);
  const seed = hashSeed(opts.seed ?? anchorSeed4(0x616e6e, b.x, b.y, b.w, b.h));
  const role = opts.role || (type === "highlight" ? "auxiliary" : "caveat");

  if (type === "highlight") {
    const wVis = b.w * progress;
    if (wVis < 1) return [];
    const pts = [[b.x - 2, b.y], [b.x + wVis + 2, b.y], [b.x + wVis + 2, b.y + b.h], [b.x - 2, b.y + b.h]];
    return buildRegionSpec(pts, G, { ...opts, role, weight: opts.weight || "medium", stroke: "none", fillOpacity: opts.fillOpacity ?? 0.55, seed });
  }
  if (type === "underline") {
    const yLine = b.y + b.h + pad;
    return buildCurveSpec([[b.x, yLine], [b.x + b.w, yLine]], G, { ...opts, role, strokeWidth: opts.strokeWidth ?? 2.2, progress, forceBrush: true, seed });
  }
  if (type === "strike") {
    return buildCurveSpec([[b.x - pad * 0.5, b.y + b.h * 0.52], [b.x + b.w + pad * 0.5, b.y + b.h * 0.48]], G, { ...opts, role, strokeWidth: opts.strokeWidth ?? 2.1, progress, forceBrush: true, seed });
  }
  if (type === "cross") {
    const out = [];
    const p1 = clamp(progress * 2, 0, 1);
    const p2 = clamp(progress * 2 - 1, 0, 1);
    const sw = opts.strokeWidth ?? 2.1;
    if (p1 > 0.01) out.push(...buildCurveSpec([[b.x - pad * 0.5, b.y - pad * 0.5], [b.x + b.w + pad * 0.5, b.y + b.h + pad * 0.5]], G, { ...opts, role, strokeWidth: sw, progress: p1, forceBrush: true, seed }));
    if (p2 > 0.01) out.push(...buildCurveSpec([[b.x + b.w + pad * 0.5, b.y - pad * 0.5], [b.x - pad * 0.5, b.y + b.h + pad * 0.5]], G, { ...opts, role, strokeWidth: sw, progress: p2, forceBrush: true, seed: seed + 19 }));
    return out;
  }
  if (type === "circle") {
    const rx = b.w * 0.54 + pad, ry = b.h * 0.58 + pad;
    if (Math.abs(rx - ry) < 3 && progress >= 0.999) {
      return buildRingSpec(b.cx, b.cy, (rx + ry) * 0.5, G, { ...opts, role, strokeWidth: opts.strokeWidth ?? 2, seed });
    }
    const N = 20;
    const pts = new Array(N + 1);
    const ang0 = -0.35;
    for (let i = 0; i <= N; i++) {
      const a = ang0 + (i / N) * Math.PI * 2.04;
      pts[i] = [b.cx + Math.cos(a) * rx, b.cy + Math.sin(a) * ry];
    }
    return buildCurveSpec(pts, G, { ...opts, role, strokeWidth: opts.strokeWidth ?? 2, progress, forceBrush: true, seed });
  }
  // Default "box" / "enclose"
  return buildPanelSpec(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, G, {
    ...opts,
    role,
    fill: "none",
    stroke: opts.stroke || resolveRoleColor(G, role),
    strokeWidth: opts.strokeWidth ?? 2,
    progress,
    seed,
  });
}

function buildGridSpec(scale, G, opts = {}) {
  const op = clamp(opts.opacity ?? 1, 0, 1);
  if (op < 0.002 || !scale) return [];
  const [rx0, rx1] = scale.rangeX;
  const [ry0, ry1] = scale.rangeY;
  const gridStroke = opts.gridStroke || G.P.grid;
  const out = [];
  const gOp = (op * 0.65).toFixed(3);
  const xSpan = (rx1 - rx0) || 1;
  const ySpan = (ry1 - ry0) || 1;

  let uX = null;
  if (Array.isArray(opts.xTicks)) {
    uX = opts.xTicks.map((v) => clamp((scale.x(v) - rx0) / xSpan, 0, 1));
    for (let i = 0; i < opts.xTicks.length; i++) {
      const px = f2(scale.x(opts.xTicks[i]));
      out.push({ tag: "line", attrs: { x1: px, y1: f2(ry0), x2: px, y2: f2(ry1), stroke: gridStroke, "stroke-width": "1", opacity: gOp } });
    }
  } else {
    const nx = Math.max(0, Math.min(24, Math.floor(Number(opts.ticksX ?? 4))));
    for (let i = 1; i <= nx; i++) {
      const px = f2(lerp(rx0, rx1, i / (nx + 1)));
      out.push({ tag: "line", attrs: { x1: px, y1: f2(ry0), x2: px, y2: f2(ry1), stroke: gridStroke, "stroke-width": "1", opacity: gOp } });
    }
    uX = nx || undefined;
  }

  let uY = null;
  if (Array.isArray(opts.yTicks)) {
    uY = opts.yTicks.map((v) => clamp((scale.y(v) - ry0) / ySpan, 0, 1));
    for (let j = 0; j < opts.yTicks.length; j++) {
      const py = f2(scale.y(opts.yTicks[j]));
      out.push({ tag: "line", attrs: { x1: f2(rx0), y1: py, x2: f2(rx1), y2: py, stroke: gridStroke, "stroke-width": "1", opacity: gOp } });
    }
  } else {
    const ny = Math.max(0, Math.min(24, Math.floor(Number(opts.ticksY ?? 4))));
    for (let j = 1; j <= ny; j++) {
      const py = f2(lerp(ry0, ry1, j / (ny + 1)));
      out.push({ tag: "line", attrs: { x1: f2(rx0), y1: py, x2: f2(rx1), y2: py, stroke: gridStroke, "stroke-width": "1", opacity: gOp } });
    }
    uY = ny || undefined;
  }

  if (opts.axes !== false) {
    out.push(...buildAxisSpec(rx0, ry0, rx1, ry0, G, { role: opts.role || "ink", stroke: opts.stroke, strokeWidth: opts.strokeWidth ?? 1.7, ticks: uX, opacity: op }));
    out.push(...buildAxisSpec(rx0, ry0, rx0, ry1, G, { role: opts.role || "ink", stroke: opts.stroke, strokeWidth: opts.strokeWidth ?? 1.7, ticks: uY, opacity: op }));
  }
  return out;
}

function sampleFunctionPoints(fn, domain, opts) {
  const x0 = domain[0], x1 = domain[1];
  const samples = Math.max(4, Math.min(256, Math.floor(Number(opts.samples ?? 48))));
  const sc = opts.scale || null;
  const pts = new Array(samples + 1);
  for (let i = 0; i <= samples; i++) {
    const vx = lerp(x0, x1, i / samples);
    const vy = fn(vx);
    pts[i] = sc ? sc.pt(vx, vy) : [vx, vy];
  }
  return pts;
}

/**
 * Arc-length parameterized 2D trajectory `{ points, length, at(u), slice(u0, u1) }`
 * from either `[[x, y], ...]` or an SVG path `d` string.
 */
export function samplePath(pointsOrSvgD, samplesPerCurve = 16) {
  const raw = Array.isArray(pointsOrSvgD)
    ? pointsOrSvgD
    : sampleSimpleSvgPath(pointsOrSvgD, samplesPerCurve) || (sampleSvgSubpaths(pointsOrSvgD, samplesPerCurve)?.[0] ?? []);
  const n = raw.length;
  if (n === 0) {
    return { points: [], length: 0, at: () => ({ x: 0, y: 0, angle: 0 }), slice: () => [] };
  }
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + hypot2(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
  }
  const total = cum[n - 1];

  function at(u) {
    if (n === 1 || total < 1e-9) return { x: raw[0][0], y: raw[0][1], angle: 0 };
    const targetD = clamp(u, 0, 1) * total;
    let lo = 0, hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= targetD) lo = mid;
      else hi = mid - 1;
    }
    const d0 = cum[lo], d1 = cum[lo + 1];
    const f = d1 > d0 + 1e-9 ? clamp((targetD - d0) / (d1 - d0), 0, 1) : 0;
    const x = lerp(raw[lo][0], raw[lo + 1][0], f);
    const y = lerp(raw[lo][1], raw[lo + 1][1], f);
    const angle = Math.atan2(raw[lo + 1][1] - raw[lo][1], raw[lo + 1][0] - raw[lo][0]);
    return { x, y, angle };
  }

  function slice(u0, u1) {
    const a = clamp(Math.min(u0, u1), 0, 1);
    const b = clamp(Math.max(u0, u1), 0, 1);
    if (b - a < 1e-6 || n < 2) {
      const p = at(a);
      return [[p.x, p.y]];
    }
    const pStart = at(a);
    const pEnd = at(b);
    const dStart = a * total, dEnd = b * total;
    const out = [[pStart.x, pStart.y]];
    for (let i = 1; i < n - 1; i++) {
      if (cum[i] > dStart + 1e-6 && cum[i] < dEnd - 1e-6) out.push(raw[i]);
    }
    out.push([pEnd.x, pEnd.y]);
    return out;
  }

  return { points: raw, length: total, at, slice };
}

/** Compute trapezoid stage bounds `[{ cx, cy, leftX, rightX, topW, botW, y0, y1 }]` for `marks.funnel`. */
export function computeFunnelLayout(x, y, w, h, stages = [], opts = {}) {
  const n = stages.length;
  if (!n) return [];
  const gap = Number(opts.gap ?? 4);
  const bandH = Math.max(2, (h - gap * (n - 1)) / n);
  const cx = x + w * 0.5;
  return stages.map((st, i) => {
    const topRatio = clamp(st.topWidthRatio ?? st.widthRatio ?? 1 - (i / n) * 0.65, 0.04, 1);
    const nextRatio = i + 1 < n ? (stages[i + 1].topWidthRatio ?? stages[i + 1].widthRatio ?? topRatio) : topRatio;
    const botRatio = clamp(st.bottomWidthRatio ?? nextRatio, 0.04, 1);
    const y0 = y + i * (bandH + gap);
    const y1 = y0 + bandH;
    const topW = w * topRatio, botW = w * botRatio;
    return {
      cx,
      cy: (y0 + y1) * 0.5,
      y0,
      y1,
      topW,
      botW,
      leftX: cx - Math.max(topW, botW) * 0.5,
      rightX: cx + Math.max(topW, botW) * 0.5,
    };
  });
}

function buildArrowSpecsInline(ptsOrPath, G, opts, seed) {
  const prep = prepareArrowGeometry(ptsOrPath, G, opts);
  const out = [];
  if (prep.shaftInput) {
    out.push(...buildCurveSpec(prep.shaftInput, G, { ...opts, opacity: 1, progress: prep.shaftProgress, seed }));
  }
  if (prep.head) {
    out.push(...buildArrowHeadSpec(prep.head.x, prep.head.y, prep.head.angle, G, {
      role: opts.role,
      fill: opts.stroke,
      size: prep.head.size,
      opacity: 1,
    }));
  }
  return out;
}

export function buildGlyphSpec(kind, cx, cy, G, opts = {}) {
  const size = Number(opts.size ?? 10);
  const r = size * 0.5;
  const col = opts.stroke || opts.fill || resolveRoleColor(G, opts.role || (kind === "cross" || kind === "warn" ? "caveat" : "primary"));
  const sw = Number(opts.strokeWidth ?? Math.max(1.6, size * 0.17));
  const seed = hashSeed(opts.seed ?? anchorSeed3(0x676c79, cx, cy, size));
  const out = [];

  if (opts.badge === "circle") {
    out.push(...buildDotSpec(cx, cy, r * 1.45, G, { fill: G.P.surface, stroke: col, strokeWidth: Math.max(1.2, sw * 0.72), labelInside: true, seed }));
  }
  if (kind === "check") {
    out.push(...buildCurveSpec([[cx - r * 0.78, cy + r * 0.04], [cx - r * 0.16, cy + r * 0.68], [cx + r * 0.86, cy - r * 0.66]], G, { stroke: col, strokeWidth: sw, lineCap: "round", lineJoin: "round", seed }));
  } else if (kind === "cross") {
    out.push(...buildCurveSpec([[cx - r * 0.72, cy - r * 0.72], [cx + r * 0.72, cy + r * 0.72]], G, { stroke: col, strokeWidth: sw, lineCap: "round", seed }));
    out.push(...buildCurveSpec([[cx + r * 0.72, cy - r * 0.72], [cx - r * 0.72, cy + r * 0.72]], G, { stroke: col, strokeWidth: sw, lineCap: "round", seed: seed + 7 }));
  } else if (kind === "diamond") {
    const rr = r * 1.1;
    const pts = [[cx, cy - rr], [cx + rr, cy], [cx, cy + rr], [cx - rr, cy]];
    out.push(...buildRegionSpec(pts, G, { fill: opts.fill || G.P.surface, stroke: col, strokeWidth: sw * 0.85, weight: "subtle", seed }));
  } else if (kind === "warn") {
    const pts = [[cx, cy - r * 1.12], [cx + r * 1.08, cy + r * 0.92], [cx - r * 1.08, cy + r * 0.92]];
    out.push(...buildRegionSpec(pts, G, { fill: G.P.surface, stroke: col, strokeWidth: sw * 0.82, weight: "subtle", seed }));
    out.push(...buildCurveSpec([[cx, cy - r * 0.36], [cx, cy + r * 0.28]], G, { stroke: col, strokeWidth: sw, lineCap: "round", seed: seed + 3 }));
    out.push(...buildDotSpec(cx, cy + r * 0.62, Math.max(1.2, sw * 0.55), G, { fill: col, stroke: "none", seed: seed + 5 }));
  } else if (kind === "lock") {
    const bw = r * 1.5, bh = r * 1.2;
    const sr = bw * 0.32;
    const sy = cy - bh * 0.62;
    const shacklePts = [[cx - sr, cy - bh * 0.12]];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI + (Math.PI * i) / 8;
      shacklePts.push([cx + Math.cos(a) * sr, sy + Math.sin(a) * sr]);
    }
    shacklePts.push([cx + sr, cy - bh * 0.12]);
    out.push(...buildCurveSpec(shacklePts, G, { stroke: col, strokeWidth: sw * 0.95, seed }));
    out.push(...buildPanelSpec(cx - bw * 0.5, cy - bh * 0.14, bw, bh, G, { fill: col, stroke: col, strokeWidth: 1, isCell: true, seed: seed + 2 }));
    out.push(...buildDotSpec(cx, cy + bh * 0.38, Math.max(1.3, r * 0.18), G, { fill: G.P.bg, stroke: "none", seed: seed + 4 }));
  } else if (kind === "clock") {
    const ang = Number(opts.angle ?? -0.55);
    out.push(...buildRingSpec(cx, cy, r, G, { stroke: col, strokeWidth: sw * 0.85, seed }));
    out.push(...buildCurveSpec([[cx, cy - r * 0.56], [cx, cy], [cx + Math.cos(ang) * r * 0.68, cy + Math.sin(ang) * r * 0.68]], G, { stroke: col, strokeWidth: sw * 0.85, lineCap: "round", lineJoin: "round", seed: seed + 3 }));
  } else if (kind === "retry") {
    const rot = Number(opts.angle ?? 0);
    const a0 = rot - 2.35, a1 = rot + 1.55;
    const N = 12;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const a = lerp(a0, a1, i / N);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    out.push(...buildArrowSpecsInline(pts, G, { stroke: col, strokeWidth: sw * 0.9, headSize: Math.max(5.5, r * 0.95) }, seed));
  } else if (kind === "lens") {
    const lr = r * 0.68;
    const lx = cx - r * 0.18, ly = cy - r * 0.18;
    out.push(...buildRingSpec(lx, ly, lr, G, { stroke: col, strokeWidth: sw * 0.9, seed }));
    out.push(...buildCurveSpec([[lx + lr * 0.71, ly + lr * 0.71], [cx + r * 0.88, cy + r * 0.88]], G, { stroke: col, strokeWidth: sw * 1.15, lineCap: "round", seed: seed + 5 }));
  }
  return out;
}

export function buildPlaqueSpec(x, y, w, h, G, opts = {}) {
  const seed = hashSeed(opts.seed ?? anchorSeed4(0x706c71, x, y, w, h));
  const accentCol = opts.accent || resolveRoleColor(G, opts.accentRole || opts.role || "primary");
  const barThick = Number(opts.accentWidth ?? 4.5);
  const side = opts.accentSide || "left";
  const out = [...buildPanelSpec(x, y, w, h, G, {
    fill: opts.fill || G.P.surface,
    stroke: opts.stroke || G.P.grid,
    strokeWidth: opts.strokeWidth ?? 1.4,
    progress: opts.progress,
    fillOpacity: opts.fillOpacity,
    seed,
  })];
  if (side === "top") {
    out.push(...buildRegionSpec([[x, y], [x + w, y], [x + w, y + barThick], [x, y + barThick]], G, { fill: accentCol, weight: "solid", stroke: "none", seed: seed + 1 }));
  } else {
    out.push(...buildRegionSpec([[x, y], [x + barThick, y], [x + barThick, y + h], [x, y + h]], G, { fill: accentCol, weight: "solid", stroke: "none", seed: seed + 1 }));
  }
  return out;
}

export function buildDocCardSpec(x, y, w, h, G, opts = {}) {
  const seed = hashSeed(opts.seed ?? anchorSeed4(0x646f63, x, y, w, h));
  const stroke = opts.stroke || resolveRoleColor(G, opts.role || "muted");
  const fill = opts.fill || G.P.paper || G.P.bg;
  const stack = Math.max(0, Math.min(4, Math.floor(Number(opts.stackDepth ?? 0))));
  const out = [];
  for (let s = stack; s >= 1; s--) {
    const off = s * 4.5;
    out.push(...buildPanelSpec(x + off, y + off, w, h, G, { fill: G.P.surface, stroke: G.P.grid, strokeWidth: 1.2, seed: seed + s * 11 }));
  }
  const fold = opts.foldedCorner ? Math.min(14, w * 0.16, h * 0.18) : 0;
  if (fold > 0) {
    const body = [[x, y], [x + w - fold, y], [x + w, y + fold], [x + w, y + h], [x, y + h]];
    out.push(...buildRegionSpec(body, G, { fill, stroke, strokeWidth: opts.strokeWidth ?? 1.5, weight: "solid", fillOpacity: 1, seed }));
    out.push(...buildCurveSpec([[x + w - fold, y], [x + w - fold, y + fold], [x + w, y + fold]], G, { stroke, strokeWidth: 1.2, seed: seed + 3 }));
  } else {
    out.push(...buildPanelSpec(x, y, w, h, G, { fill, stroke, strokeWidth: opts.strokeWidth ?? 1.5, seed }));
  }
  const padX = Math.min(12, w * 0.12);
  let startY = y + Math.min(18, h * 0.22);
  if (opts.headerRule !== false && h >= 44) {
    const ry = opts.headerRuleY != null ? y + Number(opts.headerRuleY) : y + Math.min(26, h * 0.28);
    out.push(...buildCurveSpec([[x + padX * 0.7, ry], [x + w - padX * 0.7, ry]], G, { stroke: G.P.grid, strokeWidth: 1.1, seed: seed + 5 }));
    startY = ry + 10;
  }
  const ruled = opts.ruledLines;
  const widths = Array.isArray(ruled)
    ? ruled
    : typeof ruled === "number" && ruled > 0
      ? Array.from({ length: ruled }, (_, i) => (i === ruled - 1 ? 0.62 : i % 2 === 0 ? 0.88 : 0.76))
      : [];
  if (widths.length) {
    const availH = Math.max(8, y + h - 10 - startY);
    const stepY = widths.length > 1 ? Math.min(12, availH / (widths.length - 1)) : 0;
    const maxLineW = Math.max(4, w - padX * 2);
    for (let i = 0; i < widths.length; i++) {
      const ly = startY + i * stepY;
      const frac = widths[i] <= 1 ? widths[i] : widths[i] / maxLineW;
      out.push(...buildCurveSpec([[x + padX, ly], [x + padX + maxLineW * clamp(frac, 0.1, 1), ly]], G, { stroke: G.P.grid, strokeWidth: 1.3, seed: seed + 20 + i }));
    }
  }
  return out;
}

function resolveGraphNodePort(nd, dirX, dirY, pad) {
  if (nd.shape === "box" || (nd.w && nd.h)) {
    const w = Number(nd.w || 64), h = Number(nd.h || 32);
    return rayBoxExit({ x: nd.x - w * 0.5, y: nd.y - h * 0.5, w, h, cx: nd.x, cy: nd.y, isPt: false }, dirX, dirY, pad);
  }
  const r = Number(nd.r ?? 8) + pad;
  return [nd.x + dirX * r, nd.y + dirY * r];
}

export function buildGraphSpec(graph, G, opts = {}) {
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const highlights = graph.highlights || [];
  const byId = new Map();
  for (let i = 0; i < nodes.length; i++) byId.set(String(nodes[i].id), nodes[i]);
  const out = [];
  const baseSeed = hashSeed(opts.seed ?? 701);

  for (let h = 0; h < highlights.length; h++) {
    const hl = highlights[h];
    const hNodes = (hl.nodes || []).map((id) => byId.get(String(id))).filter(Boolean);
    if (hNodes.length < 2) continue;
    const role = hl.role || "primary";
    const col = hl.stroke || resolveRoleColor(G, role);
    const hOp = clamp(hl.opacity ?? 1, 0, 1);
    if (hl.fill && hNodes.length >= 3) {
      out.push(...buildRegionSpec(hNodes.map((n) => [n.x, n.y]), G, { role, weight: "subtle", stroke: "none", opacity: hOp * 0.55, seed: baseSeed + h * 17 }));
    }
    if (hl.kind === "clique") {
      for (let i = 0; i < hNodes.length; i++) {
        for (let j = i + 1; j < hNodes.length; j++) {
          out.push(...buildCurveSpec([[hNodes[i].x, hNodes[i].y], [hNodes[j].x, hNodes[j].y]], G, { stroke: col, strokeWidth: hl.strokeWidth ?? 2.1, opacity: hOp, seed: baseSeed + i * 31 + j }));
        }
      }
    } else {
      const pts = hNodes.map((n) => [n.x, n.y]);
      if (hl.kind === "cycle" && pts.length >= 3) pts.push(pts[0]);
      out.push(...buildCurveSpec(pts, G, { stroke: col, strokeWidth: hl.strokeWidth ?? 2.2, opacity: hOp, progress: hl.progress ?? 1, seed: baseSeed + h * 23 }));
    }
  }

  for (let eIdx = 0; eIdx < edges.length; eIdx++) {
    const e = edges[eIdx];
    const u = byId.get(String(e.from)), v = byId.get(String(e.to));
    if (!u || !v) continue;
    const eOp = clamp(e.opacity ?? 1, 0, 1);
    if (eOp < 0.002) continue;
    const dx = v.x - u.x, dy = v.y - u.y;
    const L = hypot2(dx, dy);
    if (L < 1) continue;
    const ux = dx / L, uy = dy / L;
    const pad = Number(e.pad ?? 2.5);
    const bend = Number(e.bend ?? 0);
    const eCol = e.stroke || resolveRoleColor(G, e.role || "muted");
    const eSw = Number(e.width ?? e.strokeWidth ?? 1.75);
    const eDash = e.dashed ? (typeof e.dashed === "string" ? e.dashed : "5 4") : (e.dash || "");
    const eProg = clamp(e.progress ?? 1, 0, 1);
    const eSeed = baseSeed + 100 + eIdx * 13;

    let geom;
    if (Math.abs(bend) > 1e-3) {
      const nx = -uy, ny = ux;
      const p0 = resolveGraphNodePort(u, clamp(ux + nx * bend, -1, 1), clamp(uy + ny * bend, -1, 1), pad);
      const p1 = resolveGraphNodePort(v, clamp(-ux + nx * bend, -1, 1), clamp(-uy + ny * bend, -1, 1), pad);
      const midX = (p0[0] + p1[0]) * 0.5 + nx * bend * L * 0.5;
      const midY = (p0[1] + p1[1]) * 0.5 + ny * bend * L * 0.5;
      geom = `M ${f2(p0[0])} ${f2(p0[1])} Q ${f2(midX)} ${f2(midY)} ${f2(p1[0])} ${f2(p1[1])}`;
    } else {
      const p0 = resolveGraphNodePort(u, ux, uy, pad);
      const p1 = resolveGraphNodePort(v, -ux, -uy, pad);
      geom = [p0, p1];
    }
    const eOpts = { role: e.role || "muted", stroke: eCol, strokeWidth: eSw, dash: eDash, progress: eProg, opacity: eOp };
    if (e.directed !== false && graph.directed !== false && e.directed !== 0) {
      const arSpecs = buildArrowSpecsInline(geom, G, eOpts, eSeed);
      for (let k = 0; k < arSpecs.length; k++) {
        if (eOp < 0.999) arSpecs[k].attrs.opacity = (Number(arSpecs[k].attrs.opacity ?? 1) * eOp).toFixed(3);
        out.push(arSpecs[k]);
      }
    } else {
      out.push(...buildCurveSpec(geom, G, { ...eOpts, seed: eSeed }));
    }
  }

  for (let nIdx = 0; nIdx < nodes.length; nIdx++) {
    const nd = nodes[nIdx];
    const nOp = clamp(nd.opacity ?? 1, 0, 1);
    if (nOp < 0.002) continue;
    const role = nd.role || (nd.status === "fail" ? "caveat" : nd.status === "ok" || nd.status === "goal" ? "primary" : "surface");
    const strokeCol = nd.stroke || (role === "surface" ? G.P.fg : resolveRoleColor(G, role));
    const fillCol = nd.fill || (role === "surface" ? G.P.surface : nd.hollow ? G.P.bg : resolveRoleColor(G, role));
    const nSeed = baseSeed + 500 + nIdx * 19;
    if (nd.shape === "box" || (nd.w && nd.h)) {
      const w = Number(nd.w || 64), h = Number(nd.h || 32);
      out.push(...buildPanelSpec(nd.x - w * 0.5, nd.y - h * 0.5, w, h, G, { role, fill: fillCol, stroke: strokeCol, strokeWidth: nd.strokeWidth ?? 1.7, opacity: nOp, seed: nSeed }));
    } else {
      const r = Number(nd.r ?? 8);
      out.push(...buildDotSpec(nd.x, nd.y, r, G, { role, fill: fillCol, stroke: strokeCol, strokeWidth: nd.strokeWidth ?? 1.6, hollow: nd.hollow, labelInside: Boolean(nd.labelInside || nd.status || r >= 12), opacity: nOp, seed: nSeed }));
    }
    if (nd.status === "ok" || nd.status === "fail" || nd.status === "warn" || nd.status === "lock") {
      const gKind = nd.status === "ok" ? "check" : nd.status === "fail" ? "cross" : nd.status;
      const gSpecs = buildGlyphSpec(gKind, nd.x, nd.y, G, { size: (nd.r ?? 9) * 1.15, stroke: nd.status === "fail" ? G.P.terracotta : G.P.slate, seed: nSeed + 3 });
      for (let k = 0; k < gSpecs.length; k++) {
        if (nOp < 0.999) gSpecs[k].attrs.opacity = (Number(gSpecs[k].attrs.opacity ?? 1) * nOp).toFixed(3);
        out.push(gSpecs[k]);
      }
    }
  }
  return out;
}

export function buildTapeSpec(x, y, cells = [], G, opts = {}) {
  const cw = Number(opts.cellW ?? opts.size ?? 28);
  const ch = Number(opts.cellH ?? opts.size ?? cw);
  const gap = Number(opts.gap ?? 4);
  const step = cw + gap;
  const seed = hashSeed(opts.seed ?? anchorSeed3(0x746170, x, y, cells.length));
  const out = [];

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] || {};
    const st = c.state || "empty";
    const cx = x + i * step;
    const cy = y + (st === "dropped" ? Number(opts.dropOffset ?? 10) : 0);
    const cOp = st === "dropped" || st === "pruned" ? 0.5 : 1;
    const role = c.role || (st === "dropped" || st === "pruned" ? "caveat" : st === "active" || st === "filled" ? "primary" : "surface");
    const fill = c.fill || (st === "active" ? resolveRoleColor(G, "primary") : st === "filled" ? G.P.surface : G.P.bg);
    const stroke = c.stroke || (role === "surface" ? G.P.muted : resolveRoleColor(G, role));
    if (Math.abs(cw - ch) < 0.5) {
      out.push(...buildPanelSpec(cx, cy, cw, ch, G, { isCell: true, role, fill, stroke, strokeWidth: st === "active" ? 2.1 : 1.5, opacity: cOp, seed: seed + i * 7 }));
    } else {
      out.push(...buildPanelSpec(cx, cy, cw, ch, G, { role, fill, stroke, strokeWidth: st === "active" ? 2.1 : 1.5, opacity: cOp, seed: seed + i * 7 }));
    }
    if (st === "pruned") {
      out.push(...buildGlyphSpec("cross", cx + cw * 0.5, cy + ch * 0.5, G, { size: Math.min(cw, ch) * 0.55, role: "caveat", seed: seed + i * 7 + 3 }));
    }
  }

  if (Array.isArray(opts.window) && opts.window.length >= 2) {
    const [w0, w1] = opts.window;
    const wx = x + w0 * step - 3.5;
    const ww = Math.max(cw, (w1 - w0 + 1) * step - gap) + 7;
    out.push(...buildPanelSpec(wx, y - 3.5, ww, ch + 7, G, { fill: "none", stroke: G.P.fg, strokeWidth: 2.3, seed: seed + 401 }));
  }

  if (opts.head && Number.isFinite(opts.head.index)) {
    const hx = x + opts.head.index * step + cw * 0.5;
    const hLen = Number(opts.head.length ?? 22);
    const fromAbove = opts.head.side !== "bottom";
    const y0 = fromAbove ? y - hLen - 4 : y + ch + hLen + 4;
    const y1 = fromAbove ? y - 3 : y + ch + 3;
    out.push(...buildArrowSpecsInline([[hx, y0], [hx, y1]], G, { role: opts.head.role || "primary", strokeWidth: 2 }, seed + 503));
  }
  return out;
}

export function buildMatrixSpec(x, y, grid = [], G, opts = {}) {
  const rows = grid.length;
  if (!rows) return [];
  const cols = grid[0].length;
  const cw = Number(opts.cellW ?? 26);
  const ch = Number(opts.cellH ?? cw);
  const gapX = Number(opts.gapX ?? opts.gap ?? 5);
  const gapY = Number(opts.gapY ?? opts.gap ?? 5);
  const activeSet = opts.activeRows ? new Set(opts.activeRows) : null;
  const prunedSet = opts.prunedRows ? new Set(opts.prunedRows) : null;
  const shape = opts.shape || "cell";
  const seed = hashSeed(opts.seed ?? anchorSeed4(0x6d7478, x, y, rows, cols));
  const out = [];

  for (let r = 0; r < rows; r++) {
    const rowPruned = prunedSet && prunedSet.has(r);
    const rowActive = activeSet && activeSet.has(r);
    if (rowActive) {
      const rw = cols * (cw + gapX) - gapX + 6;
      out.push(...buildPanelSpec(x - 3, y + r * (ch + gapY) - 2.5, rw, ch + 5, G, { fill: "none", stroke: G.P.slate, strokeWidth: 1.8, seed: seed + r * 3 }));
    }
    for (let c = 0; c < cols; c++) {
      const val = grid[r][c];
      if (val === undefined) continue;
      const cx = x + c * (cw + gapX);
      const cy = y + r * (ch + gapY);
      const isFail = val === "fail" || rowPruned;
      const isHit = val === 1 || val === true || val === "ok";
      const role = isFail ? "caveat" : isHit ? "primary" : "surface";
      const op = rowPruned ? 0.45 : val === null ? 0.35 : 1;

      if (shape === "dot") {
        const rad = Math.min(cw, ch) * 0.36;
        out.push(...buildDotSpec(cx + cw * 0.5, cy + ch * 0.5, rad, G, { role, hollow: !isHit && !isFail, opacity: op, seed: seed + r * 37 + c }));
      } else {
        const fill = isHit ? G.P.slate : G.P.surface;
        const stroke = isFail ? G.P.terracotta : isHit ? G.P.slate : G.P.grid;
        out.push(...buildPanelSpec(cx, cy, cw, ch, G, { isCell: Math.abs(cw - ch) < 1, role, fill, stroke, strokeWidth: 1.35, opacity: op, seed: seed + r * 37 + c }));
        if (val === "fail") {
          out.push(...buildGlyphSpec("cross", cx + cw * 0.5, cy + ch * 0.5, G, { size: Math.min(cw, ch) * 0.52, role: "caveat", seed: seed + r * 37 + c + 1 }));
        } else if (val === "ok") {
          out.push(...buildGlyphSpec("check", cx + cw * 0.5, cy + ch * 0.5, G, { size: Math.min(cw, ch) * 0.52, role: "paper", stroke: G.P.bg, seed: seed + r * 37 + c + 2 }));
        }
      }
    }
  }
  if (opts.sweepProgress != null && opts.sweepProgress > 0.01 && opts.sweepProgress < 0.99) {
    const sx = x + clamp(opts.sweepProgress, 0, 1) * (cols * (cw + gapX) - gapX);
    const totalH = rows * (ch + gapY) - gapY;
    out.push(...buildCurveSpec([[sx, y - 5], [sx, y + totalH + 5]], G, { role: "primary", strokeWidth: 2.3, seed: seed + 999 }));
  }
  return out;
}

export function buildLanesSpec(x, y, w, h, rows = [], G, opts = {}) {
  const n = rows.length;
  if (!n) return [];
  const dom = opts.domain || [0, 1];
  const d0 = dom[0], dSpan = (dom[1] - d0) || 1;
  const gap = Number(opts.laneGap ?? 8);
  const laneH = Math.max(4, (h - gap * (n - 1)) / n);
  const seed = hashSeed(opts.seed ?? anchorSeed4(0x6c6e73, x, y, w, h));
  const out = [];

  for (let r = 0; r < n; r++) {
    const ly = y + r * (laneH + gap);
    if (opts.showTracks !== false) {
      out.push(...buildRegionSpec([[x, ly], [x + w, ly], [x + w, ly + laneH], [x, ly + laneH]], G, { fill: G.P.surface, weight: "solid", stroke: "none", fillOpacity: 0.55, seed: seed + r }));
    }
    const ivs = rows[r]?.intervals || rows[r] || [];
    for (let k = 0; k < ivs.length; k++) {
      const iv = ivs[k];
      const u0 = clamp((iv.start - d0) / dSpan, 0, 1);
      const u1 = clamp((iv.end - d0) / dSpan, 0, 1);
      const prog = clamp(iv.progress ?? 1, 0, 1);
      const iw = (u1 - u0) * w * prog;
      if (iw < 0.8) continue;
      const ix = x + u0 * w;
      const pts = [[ix, ly], [ix + iw, ly], [ix + iw, ly + laneH], [ix, ly + laneH]];
      out.push(...buildRegionSpec(pts, G, { role: iv.role || "primary", weight: iv.weight || "strong", stroke: iv.stroke ?? (iv.dashed ? resolveRoleColor(G, iv.role || "primary") : "none"), dash: iv.dashed ? "4 3" : "", seed: seed + 50 + r * 29 + k }));
    }
  }
  if (opts.cursor != null) {
    const cx = x + clamp((opts.cursor - d0) / dSpan, 0, 1) * w;
    out.push(...buildCurveSpec([[cx, y - 4], [cx, y + h + 4]], G, { role: "ink", strokeWidth: 1.8, dash: "4 3", seed: seed + 888 }));
  }
  return out;
}

export function buildStackBarSpec(x, y, w, h, segments = [], G, opts = {}) {
  if (!segments.length) return [];
  const horiz = opts.orientation !== "vertical";
  const gap = Number(opts.gap ?? 2);
  const sum = segments.reduce((acc, s) => acc + Math.max(0, Number(s.value || 0)), 0) || 1;
  const norm = opts.normalize !== false ? sum : 1;
  const totalSpan = (horiz ? w : h) - gap * Math.max(0, segments.length - 1);
  const seed = hashSeed(opts.seed ?? anchorSeed4(0x73746b, x, y, w, h));
  const out = [];
  let cursor = 0;

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const frac = clamp(Math.max(0, Number(s.value || 0)) / norm, 0, 1);
    const span = totalSpan * frac;
    if (span < 0.5) continue;
    const rx = horiz ? x + cursor : x;
    const ry = horiz ? y : y + cursor;
    const rw = horiz ? span : w;
    const rh = horiz ? h : span;
    const pts = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]];
    out.push(...buildRegionSpec(pts, G, {
      role: s.role || "primary",
      fill: s.fill,
      weight: s.weight || (i === 0 ? "strong" : i === 1 ? "medium" : "subtle"),
      stroke: s.dashed ? (s.stroke || G.P.muted) : (s.stroke || G.P.bg),
      strokeWidth: 1.2,
      dash: s.dashed ? "5 4" : "",
      seed: seed + i * 17,
    }));
    cursor += span + gap;
  }
  return out;
}

export function buildGaugeSpec(x, y, w, h, fraction, G, opts = {}) {
  const f = clamp(fraction ?? 0, 0, 1);
  const horiz = opts.orientation !== "vertical";
  const seed = hashSeed(opts.seed ?? anchorSeed4(0x676175, x, y, w, h));
  const out = [...buildPanelSpec(x, y, w, h, G, { fill: G.P.surface, stroke: G.P.grid, strokeWidth: 1.3, seed })];
  const fw = horiz ? w * f : w;
  const fh = horiz ? h : h * f;
  const fy = horiz ? y : y + (h - fh);
  if (fw > 0.5 && fh > 0.5) {
    out.push(...buildRegionSpec([[x, fy], [x + fw, fy], [x + fw, fy + fh], [x, fy + fh]], G, { role: opts.role || "primary", fill: opts.fill, weight: "strong", stroke: "none", seed: seed + 3 }));
  }
  if (opts.threshold != null) {
    const th = clamp(opts.threshold, 0, 1);
    if (horiz) {
      const tx = x + w * th;
      out.push(...buildCurveSpec([[tx, y - 4], [tx, y + h + 4]], G, { role: "caveat", strokeWidth: 1.8, dash: "4 3", seed: seed + 9 }));
    } else {
      const ty = y + h * (1 - th);
      out.push(...buildCurveSpec([[x - 4, ty], [x + w + 4, ty]], G, { role: "caveat", strokeWidth: 1.8, dash: "4 3", seed: seed + 9 }));
    }
  }
  return out;
}

export function buildFunnelSpec(x, y, w, h, stages = [], G, opts = {}) {
  const layout = computeFunnelLayout(x, y, w, h, stages, opts);
  const seed = hashSeed(opts.seed ?? anchorSeed4(0x666e6c, x, y, w, h));
  const out = [];
  for (let i = 0; i < stages.length; i++) {
    const st = stages[i];
    const L = layout[i];
    const prog = clamp(st.fillProgress ?? 1, 0, 1);
    if (prog < 0.002) continue;
    const cols = Math.max(1, Math.floor(Number(st.splitCols ?? 1)));
    const yEnd = lerp(L.y0, L.y1, prog);
    const curBotW = lerp(L.topW, L.botW, prog);
    if (cols === 1) {
      const poly = [
        [L.cx - L.topW * 0.5, L.y0],
        [L.cx + L.topW * 0.5, L.y0],
        [L.cx + curBotW * 0.5, yEnd],
        [L.cx - curBotW * 0.5, yEnd],
      ];
      out.push(...buildRegionSpec(poly, G, { role: st.role || (i === stages.length - 1 ? "primary" : "surface"), fill: st.fill, stroke: st.stroke || G.P.muted, strokeWidth: 1.4, weight: i === stages.length - 1 ? "strong" : "medium", seed: seed + i * 19 }));
    } else {
      const splitGap = 6;
      for (let c = 0; c < cols; c++) {
        const u0 = c / cols, u1 = (c + 1) / cols;
        const tx0 = L.cx - L.topW * 0.5 + L.topW * u0 + (c > 0 ? splitGap * 0.5 : 0);
        const tx1 = L.cx - L.topW * 0.5 + L.topW * u1 - (c < cols - 1 ? splitGap * 0.5 : 0);
        const bx0 = L.cx - curBotW * 0.5 + curBotW * u0 + (c > 0 ? splitGap * 0.5 : 0);
        const bx1 = L.cx - curBotW * 0.5 + curBotW * u1 - (c < cols - 1 ? splitGap * 0.5 : 0);
        out.push(...buildRegionSpec([[tx0, L.y0], [tx1, L.y0], [bx1, yEnd], [bx0, yEnd]], G, { role: st.role || "primary", stroke: G.P.muted, strokeWidth: 1.3, weight: "medium", seed: seed + i * 19 + c }));
      }
    }
  }
  return out;
}

export function buildWhiskerSpec(x, yLow, yHigh, G, opts = {}) {
  const sc = opts.scale || null;
  const pLo = sc ? sc.pt(x, yLow) : [x, yLow];
  const pHi = sc ? sc.pt(x, yHigh) : [x, yHigh];
  const cap = Number(opts.capWidth ?? 7) * 0.5;
  const col = opts.stroke || resolveRoleColor(G, opts.role || "primary");
  const sw = Number(opts.strokeWidth ?? 1.6);
  const seed = hashSeed(opts.seed ?? anchorSeed3(0x77686b, pLo[0], pLo[1], pHi[1]));
  const out = [
    ...buildCurveSpec([pLo, pHi], G, { stroke: col, strokeWidth: sw, seed }),
    ...buildCurveSpec([[pLo[0] - cap, pLo[1]], [pLo[0] + cap, pLo[1]]], G, { stroke: col, strokeWidth: sw, seed: seed + 1 }),
    ...buildCurveSpec([[pHi[0] - cap, pHi[1]], [pHi[0] + cap, pHi[1]]], G, { stroke: col, strokeWidth: sw, seed: seed + 2 }),
  ];
  if (opts.yMid != null) {
    const pMid = sc ? sc.pt(x, opts.yMid) : [x, opts.yMid];
    out.push(...buildDotSpec(pMid[0], pMid[1], Number(opts.r ?? 4.6), G, { role: opts.role || "primary", fill: opts.hollow ? G.P.bg : col, stroke: col, strokeWidth: sw, hollow: opts.hollow !== false, seed: seed + 3 }));
  }
  return out;
}

export function buildBox2dSpec(xRange, yRange, G, opts = {}) {
  const sc = opts.scale || null;
  const p0 = sc ? sc.pt(xRange[0], yRange[0]) : [xRange[0], yRange[0]];
  const p1 = sc ? sc.pt(xRange[1], yRange[1]) : [xRange[1], yRange[1]];
  const rx = Math.min(p0[0], p1[0]), ry = Math.min(p0[1], p1[1]);
  const rw = Math.abs(p1[0] - p0[0]), rh = Math.abs(p1[1] - p0[1]);
  const role = opts.role || "primary";
  const col = opts.stroke || resolveRoleColor(G, role);
  const seed = hashSeed(opts.seed ?? anchorSeed4(0x627832, rx, ry, rw, rh));
  const out = [
    ...buildRegionSpec([[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]], G, {
      role,
      fill: opts.fill,
      weight: opts.weight || "subtle",
      fillOpacity: opts.fillOpacity ?? 0.48,
      stroke: col,
      strokeWidth: opts.strokeWidth ?? 1.5,
      dash: opts.dashed ? "4 3" : "",
      seed,
    }),
  ];
  if (opts.capY != null) {
    const cy = sc ? sc.y(opts.capY) : opts.capY;
    out.push(...buildCurveSpec([[rx - 4, cy], [rx + rw + 4, cy]], G, { role: opts.capRole || "caveat", strokeWidth: 2.1, seed: seed + 5 }));
  }
  return out;
}

export function buildOctantRoomSpec(octant, G, opts = {}) {
  const P3 = octant.project;
  const ticks = Math.max(0, Math.min(12, Math.floor(Number(opts.ticks ?? 3))));
  const seed = hashSeed(opts.seed ?? 901);
  const out = [];
  const wallLeft = [P3(0, 0, 0), P3(0, 1, 0), P3(0, 1, 1), P3(0, 0, 1)];
  const wallRight = [P3(0, 0, 0), P3(1, 0, 0), P3(1, 0, 1), P3(0, 0, 1)];
  const floorPoly = [P3(0, 0, 0), P3(1, 0, 0), P3(1, 1, 0), P3(0, 1, 0)];

  out.push(...buildRegionSpec(wallLeft, G, { role: "surface", weight: "subtle", stroke: G.P.grid, strokeWidth: 1, fillOpacity: 0.45, seed }));
  out.push(...buildRegionSpec(wallRight, G, { role: "surface", weight: "subtle", stroke: G.P.grid, strokeWidth: 1, fillOpacity: 0.35, seed: seed + 1 }));
  out.push(...buildRegionSpec(floorPoly, G, { role: "surface", weight: "medium", stroke: G.P.grid, strokeWidth: 1.1, fillOpacity: 0.55, seed: seed + 2 }));

  for (let i = 1; i <= ticks; i++) {
    const u = i / (ticks + 1);
    out.push({ tag: "line", attrs: { x1: f2(P3(u, 0, 0)[0]), y1: f2(P3(u, 0, 0)[1]), x2: f2(P3(u, 1, 0)[0]), y2: f2(P3(u, 1, 0)[1]), stroke: G.P.grid, "stroke-width": "1", opacity: "0.55" } });
    out.push({ tag: "line", attrs: { x1: f2(P3(0, u, 0)[0]), y1: f2(P3(0, u, 0)[1]), x2: f2(P3(1, u, 0)[0]), y2: f2(P3(1, u, 0)[1]), stroke: G.P.grid, "stroke-width": "1", opacity: "0.55" } });
    out.push({ tag: "line", attrs: { x1: f2(P3(0, 1, u)[0]), y1: f2(P3(0, 1, u)[1]), x2: f2(P3(0, 0, u)[0]), y2: f2(P3(0, 0, u)[1]), stroke: G.P.grid, "stroke-width": "1", opacity: "0.45" } });
    out.push({ tag: "line", attrs: { x1: f2(P3(0, 0, u)[0]), y1: f2(P3(0, 0, u)[1]), x2: f2(P3(1, 0, u)[0]), y2: f2(P3(1, 0, u)[1]), stroke: G.P.grid, "stroke-width": "1", opacity: "0.45" } });
  }

  if (Array.isArray(opts.subbox) && opts.subbox.length >= 3) {
    const [gx, gy, gz] = opts.subbox;
    const sRole = opts.subboxRole || "primary";
    const sCol = resolveRoleColor(G, sRole);
    const faces = [
      [P3(0, gy, 0), P3(gx, gy, 0), P3(gx, gy, gz), P3(0, gy, gz)],
      [P3(gx, 0, 0), P3(gx, gy, 0), P3(gx, gy, gz), P3(gx, 0, gz)],
      [P3(0, 0, gz), P3(gx, 0, gz), P3(gx, gy, gz), P3(0, gy, gz)],
    ];
    for (let f = 0; f < 3; f++) {
      out.push(...buildRegionSpec(faces[f], G, { role: sRole, weight: "subtle", stroke: sCol, strokeWidth: 1.5, dash: opts.subboxDashed ? "4 3" : "", fillOpacity: 0.5, seed: seed + 20 + f }));
    }
  }

  const O = P3(0, 0, 0);
  for (const tip of [P3(1.05, 0, 0), P3(0, 1.05, 0), P3(0, 0, 1.05)]) {
    out.push(...buildAxisSpec(O[0], O[1], tip[0], tip[1], G, { role: "ink", strokeWidth: 2 }));
  }
  return out;
}

export function buildPin3dSpec(octant, pt3, G, opts = {}) {
  const [x, y, z] = pt3;
  const P3 = octant.project;
  const top = P3(x, y, z);
  const flr = P3(x, y, 0);
  const role = opts.role || "primary";
  const col = opts.stroke || opts.fill || resolveRoleColor(G, role);
  const r = Number(opts.r ?? 6);
  const seed = hashSeed(opts.seed ?? anchorSeed3(0x706e33, top[0], top[1], r));
  const out = [];

  if (opts.dropWalls) {
    const wx = P3(x, 0, 0), wy = P3(0, y, 0);
    out.push(...buildCurveSpec([flr, wx], G, { stroke: col, strokeWidth: 1.1, dash: "3 3", opacity: 0.36, seed }));
    out.push(...buildCurveSpec([flr, wy], G, { stroke: col, strokeWidth: 1.1, dash: "3 3", opacity: 0.36, seed: seed + 1 }));
  }
  if (opts.dropFloor !== false) {
    out.push(...buildDotSpec(flr[0], flr[1], r * 0.65, G, { fill: col, stroke: "none", opacity: 0.28, seed: seed + 2 }));
    out.push(...buildCurveSpec([flr, top], G, { stroke: col, strokeWidth: 1.8, dash: opts.solidStem ? "" : "4 3", opacity: 0.78, seed: seed + 3 }));
  }
  out.push(...buildDotSpec(top[0], top[1], r, G, { role, fill: col, stroke: G.P.bg, strokeWidth: 1.5, seed: seed + 4 }));
  return out;
}

export function buildLatticeSpec(scale, G, opts = {}) {
  const [x0, x1] = opts.xRange || [0, 4];
  const [y0, y1] = opts.yRange || [0, 4];
  const step = Math.max(0.25, Number(opts.step ?? 1));
  const poly = opts.insidePoly || null;
  const r = Number(opts.r ?? 3.4);
  const out = [];

  const ptInConvex = (vx, vy) => {
    if (!poly || poly.length < 3) return true;
    let pos = 0, neg = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const cross = (b[0] - a[0]) * (vy - a[1]) - (b[1] - a[1]) * (vx - a[0]);
      if (cross > 1e-6) pos++;
      else if (cross < -1e-6) neg++;
      if (pos && neg) return false;
    }
    return true;
  };

  let idx = 0;
  for (let vx = x0; vx <= x1 + 1e-9; vx += step) {
    for (let vy = y0; vy <= y1 + 1e-9; vy += step) {
      const inside = ptInConvex(vx, vy);
      if (!inside && opts.hideOutside) continue;
      const [px, py] = scale ? scale.pt(vx, vy) : [vx, vy];
      out.push(...buildDotSpec(px, py, r, G, {
        role: inside ? (opts.role || "ink") : "muted",
        opacity: inside ? 1 : 0.28,
        seed: 1200 + idx++,
      }));
    }
  }
  return out;
}

export function buildHalfspaceCutSpec(scale, a, b, G, opts = {}) {
  const box = opts.box || (scale ? [scale.domainX[0], scale.domainX[1], scale.domainY[0], scale.domainY[1]] : [0, 1, 0, 1]);
  const segPts = lineInBox(a, b, box);
  if (!segPts) return [];
  const p0 = scale ? scale.pt(segPts[0][0], segPts[0][1]) : segPts[0];
  const p1 = scale ? scale.pt(segPts[1][0], segPts[1][1]) : segPts[1];
  const role = opts.role || "caveat";
  const col = opts.stroke || resolveRoleColor(G, role);
  const prog = clamp(opts.progress ?? 1, 0, 1);
  const seed = hashSeed(opts.seed ?? anchorSeed4(0x637574, p0[0], p0[1], p1[0], p1[1]));
  const out = [...buildCurveSpec([p0, p1], G, {
    role,
    stroke: col,
    strokeWidth: opts.strokeWidth ?? 2.2,
    dash: opts.dashed === false ? "" : "6 4",
    progress: prog,
    seed,
  })];
  if (opts.showNormal && prog > 0.5) {
    const mx = (segPts[0][0] + segPts[1][0]) * 0.5;
    const my = (segPts[0][1] + segPts[1][1]) * 0.5;
    const nL = hypot2(a[0], a[1]) || 1;
    const nScale = Number(opts.normalLength ?? (box[1] - box[0]) * 0.12);
    const tipData = [mx - (a[0] / nL) * nScale, my - (a[1] / nL) * nScale];
    const mPx = scale ? scale.pt(mx, my) : [mx, my];
    const tPx = scale ? scale.pt(tipData[0], tipData[1]) : tipData;
    out.push(...buildArrowSpecsInline([mPx, tPx], G, { role, stroke: col, strokeWidth: 1.6, headSize: 6.5 }, seed + 7));
  }
  return out;
}

// ============================================================================
// Shared Opacity-Invariant Geometry Spec Cache (SVG + Canvas)
// ============================================================================

const SPEC_CACHE = new Map();
const SEEN_SPEC_KEYS = new Set();
const STAMP_CACHE = new Map();

function toUnitSpecs(raw) {
  const len = raw.length;
  const unit = new Array(len);
  for (let i = 0; i < len; i++) {
    const sp = raw[i];
    const srcA = sp.attrs;
    let baseOp = 1;
    const cleanAttrs = {};
    for (const k in srcA) {
      if (k === "opacity") {
        baseOp = srcA.opacity != null ? Number(srcA.opacity) : 1;
      } else {
        cleanAttrs[k] = srcA[k];
      }
    }
    unit[i] = {
      tag: sp.tag,
      attrs: cleanAttrs,
      baseOp,
      wash: sp.wash || null,
      pattern: sp.pattern || null,
      closedPts: sp.closedPts || null,
      segs: sp.segs || null,
      qsegs: sp.qsegs || null,
      qloop: sp.qloop || null,
      smoothPoly: sp.smoothPoly || null,
      __path2d: null,
      __nums: sp.nums || null,
      __dash: null,
      __perim: -1,
    };
  }
  return unit;
}

function getCachedUnitSpecs(geomKey, buildUnitFn) {
  const cached = SPEC_CACHE.get(geomKey);
  if (cached !== undefined) return cached;
  const unit = toUnitSpecs(buildUnitFn());
  if (!SEEN_SPEC_KEYS.has(geomKey)) {
    if (SEEN_SPEC_KEYS.size >= 3072) SEEN_SPEC_KEYS.clear();
    SEEN_SPEC_KEYS.add(geomKey);
    return unit;
  }
  if (SPEC_CACHE.size >= 2048) {
    let n = 0;
    for (const k of SPEC_CACHE.keys()) {
      SPEC_CACHE.delete(k);
      if (++n >= 512) break;
    }
  }
  SPEC_CACHE.set(geomKey, unit);
  return unit;
}

function getCachedStampSpecs(stampKey, buildStampFn) {
  let unit = STAMP_CACHE.get(stampKey);
  if (unit !== undefined) return unit;
  unit = toUnitSpecs(buildStampFn());
  if (STAMP_CACHE.size >= 1024) STAMP_CACHE.clear();
  STAMP_CACHE.set(stampKey, unit);
  return unit;
}

// ============================================================================
// SVG Renderer (`createSvgMarks` + `hydrateSvgMarks`)
// ============================================================================

const COLOR_Q_CACHE = new Map();

function quantColorInfo(col) {
  let info = COLOR_Q_CACHE.get(col);
  if (info !== undefined) return info;
  const [r, g, b] = parseRgb(col, [127, 127, 127]);
  const qr = Math.min(255, Math.round(r / 4) * 4);
  const qg = Math.min(255, Math.round(g / 4) * 4);
  const qb = Math.min(255, Math.round(b / 4) * 4);
  info = { key: `${qr}_${qg}_${qb}`, rgb: `rgb(${qr},${qg},${qb})` };
  if (COLOR_Q_CACHE.size >= 512) COLOR_Q_CACHE.clear();
  COLOR_Q_CACHE.set(col, info);
  return info;
}

function quantColorKey(col) {
  return quantColorInfo(col).key;
}

function getDefsPool(svgEl) {
  let pool = svgEl.__pfDefs;
  if (!pool || (pool.el && pool.el.parentNode !== svgEl)) {
    let defs = svgEl.querySelector("defs");
    let owned = false;
    if (!defs) {
      defs = svgEl.ownerDocument.createElementNS(SVG_NS, "defs");
      defs.setAttribute("data-pf-defs", "1");
      svgEl.insertBefore(defs, svgEl.firstChild);
      owned = true;
    }
    pool = { el: defs, owned, map: new Map(), active: new Set() };
    svgEl.__pfDefs = pool;
  }
  return pool;
}

function clearDefsPool(svgEl) {
  const pool = svgEl.__pfDefs;
  if (!pool) return;
  for (const node of pool.map.values()) {
    if (node.parentNode) node.parentNode.removeChild(node);
  }
  pool.map.clear();
  pool.active.clear();
  if (pool.owned && pool.el && pool.el.parentNode && (!pool.el.children || pool.el.children.length === 0)) {
    pool.el.parentNode.removeChild(pool.el);
    svgEl.__pfDefs = null;
  }
}

function sweepDefsPool(svgEl) {
  const pool = svgEl.__pfDefs;
  if (!pool) return;
  if (pool.map.size > 32) {
    for (const [id, node] of pool.map.entries()) {
      if (!pool.active.has(id)) {
        if (node.parentNode) node.parentNode.removeChild(node);
        pool.map.delete(id);
      }
    }
  }
  pool.active.clear();
}

function ensureWashGradient(svgEl, washSpec, defIdsOut) {
  const { color, dir, stops } = washSpec;
  const orient = dir === "h" ? "h" : "v";
  const cInfo = quantColorInfo(color);
  const id = `pf-wash-${orient}-${cInfo.key}-${Math.round(stops[0] * 100)}-${Math.round(stops[1] * 100)}-${Math.round(stops[2] * 100)}`;
  const pool = getDefsPool(svgEl);
  pool.active.add(id);
  if (defIdsOut) defIdsOut.push(id);
  if (!pool.map.has(id)) {
    const doc = svgEl.ownerDocument;
    const lg = doc.createElementNS(SVG_NS, "linearGradient");
    lg.setAttribute("id", id);
    lg.setAttribute("x1", "0");
    lg.setAttribute("y1", "0");
    lg.setAttribute("x2", orient === "h" ? "1" : "0");
    lg.setAttribute("y2", orient === "h" ? "0" : "1");
    const offsets = ["0%", orient === "h" ? "58%" : "52%", "100%"];
    for (let i = 0; i < 3; i++) {
      const st = doc.createElementNS(SVG_NS, "stop");
      st.setAttribute("offset", offsets[i]);
      st.setAttribute("stop-color", cInfo.rgb);
      st.setAttribute("stop-opacity", stops[i].toFixed(3));
      lg.appendChild(st);
    }
    pool.el.appendChild(lg);
    pool.map.set(id, lg);
  }
  return `url(#${id})`;
}

function getDitherCells(density) {
  if (density >= 45) return [[0, 0, 2, 2], [2, 2, 2, 2]];
  if (density >= 20) return [[0, 0, 2, 2]];
  return [[0, 0, 1, 1], [2, 2, 1, 1]];
}

function ensurePatternDef(svgEl, patSpec, defIdsOut) {
  const { kind, density, fg, bg } = patSpec;
  const fgKey = quantColorKey(fg);
  const bgKey = quantColorKey(bg);
  const id = `pf-pat-${kind}-${density}-${fgKey}-${bgKey}`;
  const pool = getDefsPool(svgEl);
  pool.active.add(id);
  if (defIdsOut) defIdsOut.push(id);
  if (!pool.map.has(id)) {
    const doc = svgEl.ownerDocument;
    const pat = doc.createElementNS(SVG_NS, "pattern");
    pat.setAttribute("id", id);
    pat.setAttribute("patternUnits", "userSpaceOnUse");
    if (kind === "screentone") {
      const step = density >= 30 ? 6 : density >= 20 ? 6.5 : 7.2;
      const r = density >= 30 ? 1.42 : density >= 20 ? 1.08 : 0.75;
      pat.setAttribute("width", String(step));
      pat.setAttribute("height", String(step));
      pat.setAttribute("patternTransform", "rotate(45)");
      const rect = doc.createElementNS(SVG_NS, "rect");
      rect.setAttribute("width", String(step));
      rect.setAttribute("height", String(step));
      rect.setAttribute("fill", bg);
      const circ = doc.createElementNS(SVG_NS, "circle");
      circ.setAttribute("cx", String(step / 2));
      circ.setAttribute("cy", String(step / 2));
      circ.setAttribute("r", String(r));
      circ.setAttribute("fill", fg);
      pat.appendChild(rect);
      pat.appendChild(circ);
    } else {
      const step = 4;
      pat.setAttribute("width", String(step));
      pat.setAttribute("height", String(step));
      const rect = doc.createElementNS(SVG_NS, "rect");
      rect.setAttribute("width", String(step));
      rect.setAttribute("height", String(step));
      rect.setAttribute("fill", bg);
      rect.setAttribute("shape-rendering", "crispEdges");
      pat.appendChild(rect);
      for (const [px, py, pw, ph] of getDitherCells(density)) {
        const pxEl = doc.createElementNS(SVG_NS, "rect");
        pxEl.setAttribute("x", String(px));
        pxEl.setAttribute("y", String(py));
        pxEl.setAttribute("width", String(pw));
        pxEl.setAttribute("height", String(ph));
        pxEl.setAttribute("fill", fg);
        pxEl.setAttribute("shape-rendering", "crispEdges");
        pat.appendChild(pxEl);
      }
    }
    pool.el.appendChild(pat);
    pool.map.set(id, pat);
  }
  return `url(#${id})`;
}

function hostSignature(el) {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  const s1 = readDatasetScheme(el);
  const s2 = readDatasetScheme(root);
  const t1 = el && el.dataset ? el.dataset.theme || "" : "";
  const t2 = root && root.dataset ? root.dataset.theme || "" : "";
  return `${s1}|${s2}|${t1}|${t2}`;
}

function computeLayoutKey(unitSpecs, className, forceGroup) {
  if (unitSpecs.length === 1 && !className && !forceGroup) {
    return `1|${unitSpecs[0].tag}`;
  }
  let sig = `g|${className || ""}|${unitSpecs[0].tag}`;
  for (let i = 1; i < unitSpecs.length; i++) sig += `,${unitSpecs[i].tag}`;
  return sig;
}

function applyRecycledAlpha(node, alpha) {
  const leaves = node.__pfLeaves;
  if (!leaves) return;
  for (let i = 0; i < leaves.length; i++) {
    const t = leaves[i];
    const eff = alpha * t.baseOp;
    const qEff = eff < 0.999 ? Math.round(eff * 1000) : 1000;
    if (qEff === t.qEffOp) continue;
    if (qEff < 1000) {
      t.el.setAttribute("opacity", eff.toFixed(3));
    } else {
      t.el.removeAttribute("opacity");
    }
    t.qEffOp = qEff;
  }
}

/**
 * Create a semantic SVG mark emitter bound to `svgEl` and theme tokens on `hostEl`.
 * Two-tier DOM recycling across `beginFrame()` ticks:
 *  - Tier 1 (`prevExact`): exact geometry key match -> 0 path builds, 0 `createElementNS`, 0 `setAttribute`.
 *  - Tier 2 (`freeByLayout`): structural tag-signature recycling for moving/morphing marks -> 0 `createElementNS`, minimal attribute diffing.
 */
export function createSvgMarks(svgEl, hostEl = null, grammarOverrides = null) {
  const doc = svgEl.ownerDocument;
  const target = hostEl || svgEl;
  let cachedG = null;
  let lastOverrides = undefined;
  let lastSig = "";
  let inFrame = false;
  let prevExact = new Map();
  let activeExact = new Map();
  const freeByLayout = new Map();

  function syncGrammar(overrides = grammarOverrides) {
    cachedG = markGrammar(target, overrides);
    lastOverrides = overrides;
    lastSig = hostSignature(target);
    return cachedG;
  }

  let autoContainer = null;

  function beginFrame(overrides = grammarOverrides) {
    autoContainer = null;
    inFrame = true;
    if (prevExact.size > 0) {
      for (const bucket of prevExact.values()) {
        for (let i = 0; i < bucket.length; i++) {
          const nd = bucket[i];
          const lk = nd.__pfLayoutKey;
          if (!lk) continue;
          let fb = freeByLayout.get(lk);
          if (!fb) {
            fb = [];
            freeByLayout.set(lk, fb);
          }
          if (fb.length < 192) fb.push(nd);
        }
      }
    }
    prevExact = activeExact;
    activeExact = new Map();
    sweepDefsPool(svgEl);
    const sig = hostSignature(target);
    if (cachedG && overrides === lastOverrides && sig === lastSig) {
      return cachedG;
    }
    return syncGrammar(overrides);
  }

  function frame(containerEl = svgEl, overrides = grammarOverrides) {
    const c = containerEl || svgEl;
    if (c === svgEl && svgEl.__pfDefs && svgEl.__pfDefs.el) {
      const keep = svgEl.__pfDefs.el;
      const kids = Array.from(c.children || []);
      for (let i = 0; i < kids.length; i++) {
        if (kids[i] !== keep) c.removeChild(kids[i]);
      }
    } else if (typeof c.replaceChildren === "function") {
      c.replaceChildren();
    } else {
      while (c.firstChild) c.removeChild(c.firstChild);
    }
    const g = beginFrame(overrides);
    autoContainer = c;
    return g;
  }

  function storeActive(poolKey, node) {
    let bucket = activeExact.get(poolKey);
    if (!bucket) {
      bucket = [];
      activeExact.set(poolKey, bucket);
    }
    bucket.push(node);
  }

  function applySpecToLeaf(leaf, sp, defIds) {
    const el = leaf.el;
    const prev = leaf.domAttrs;
    const next = sp.attrs;
    let fillOverride = null;
    if (sp.wash) fillOverride = ensureWashGradient(svgEl, sp.wash, defIds);
    else if (sp.pattern) fillOverride = ensurePatternDef(svgEl, sp.pattern, defIds);

    for (const k in prev) {
      if (k === "fill" && fillOverride !== null) continue;
      if (!(k in next)) {
        el.removeAttribute(k);
        delete prev[k];
      }
    }
    for (const k in next) {
      if (k === "fill" && fillOverride !== null) continue;
      const v = String(next[k]);
      if (prev[k] !== v) {
        el.setAttribute(k, v);
        prev[k] = v;
      }
    }
    if (fillOverride !== null && prev.fill !== fillOverride) {
      el.setAttribute("fill", fillOverride);
      prev.fill = fillOverride;
    }
    leaf.baseOp = sp.baseOp;
  }

  function materializeUnitSpecs(unitSpecs, className, forceGroup, layoutKey) {
    const leaves = new Array(unitSpecs.length);
    let defIds = null;
    const mkLeaf = (sp, idx) => {
      const node = doc.createElementNS(SVG_NS, sp.tag);
      const leaf = { el: node, domAttrs: {}, baseOp: sp.baseOp, qEffOp: 1000 };
      if ((sp.wash || sp.pattern) && !defIds) defIds = [];
      applySpecToLeaf(leaf, sp, defIds);
      leaves[idx] = leaf;
      return node;
    };
    let rootNode;
    if (unitSpecs.length === 1 && !className && !forceGroup) {
      rootNode = mkLeaf(unitSpecs[0], 0);
    } else {
      const g = doc.createElementNS(SVG_NS, "g");
      if (className) g.setAttribute("class", className);
      for (let i = 0; i < unitSpecs.length; i++) g.appendChild(mkLeaf(unitSpecs[i], i));
      rootNode = g;
    }
    rootNode.__pfLayoutKey = layoutKey;
    rootNode.__pfLeaves = leaves;
    rootNode.__pfDefIds = defIds;
    rootNode.__pfQOp = -1;
    return rootNode;
  }

  function emit(geomKey, rawOp, className, buildUnitFn, forceGroup = false) {
    const alpha = clamp(rawOp ?? 1, 0, 1);
    if (alpha < 0.002) return doc.createElementNS(SVG_NS, "g");
    const qOp = Math.round(alpha * 1000);
    const poolKey = className || forceGroup ? `${geomKey}|c:${className || ""}|g:${forceGroup ? 1 : 0}` : geomKey;

    if (inFrame) {
      const bucket = prevExact.get(poolKey);
      while (bucket && bucket.length > 0) {
        const cand = bucket.pop();
        if (!cand.parentNode) {
          if (cand.__pfDefIds) {
            const dp = getDefsPool(svgEl);
            for (let i = 0; i < cand.__pfDefIds.length; i++) dp.active.add(cand.__pfDefIds[i]);
          }
          if (cand.__pfQOp !== qOp) {
            applyRecycledAlpha(cand, alpha);
            cand.__pfQOp = qOp;
          }
          storeActive(poolKey, cand);
          if (autoContainer) autoContainer.appendChild(cand);
          return cand;
        }
      }
    }

    const unitSpecs = getCachedUnitSpecs(geomKey, buildUnitFn);
    if (!unitSpecs.length) return doc.createElementNS(SVG_NS, "g");
    const layoutKey = computeLayoutKey(unitSpecs, className, forceGroup);

    if (inFrame) {
      const fb = freeByLayout.get(layoutKey);
      while (fb && fb.length > 0) {
        const cand = fb.pop();
        if (!cand.parentNode && !cand.__pfPinned) {
          const leaves = cand.__pfLeaves;
          let defIds = null;
          for (let i = 0; i < unitSpecs.length; i++) {
            const sp = unitSpecs[i];
            if ((sp.wash || sp.pattern) && !defIds) defIds = [];
            applySpecToLeaf(leaves[i], sp, defIds);
          }
          cand.__pfDefIds = defIds;
          applyRecycledAlpha(cand, alpha);
          cand.__pfQOp = qOp;
          storeActive(poolKey, cand);
          if (autoContainer) autoContainer.appendChild(cand);
          return cand;
        }
      }
    }

    const node = materializeUnitSpecs(unitSpecs, className, forceGroup, layoutKey);
    applyRecycledAlpha(node, alpha);
    node.__pfQOp = qOp;
    if (inFrame) storeActive(poolKey, node);
    if (autoContainer) autoContainer.appendChild(node);
    return node;
  }

  const G = () => cachedG || syncGrammar();
  return attachMarkMethods({ grammar: G, beginFrame, frame, syncGrammar }, G, emit, null);
}

function attachMarkMethods(api, getG, emitFn, emitStampFn = null) {
  api.dot = function dot(cx, cy, r, opts = {}) {
    const curG = getG();
    if (emitStampFn && curG.node !== "pixel") {
      const alpha = clamp(opts.opacity ?? 1, 0, 1);
      if (alpha < 0.002 || !(r > 0)) return;
      const usesSeed = curG.node === "dab" || curG.node === "chisel";
      const seed = usesSeed ? (opts.seed ?? anchorSeed2(0x646f74, cx, cy, opts.role)) : 1;
      const sk = `ds|${curG.id}|${f2(r)}|${opts.role || ""}|${opts.fill ?? ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${opts.hollow ? 1 : 0}|${opts.labelInside ? 1 : 0}|${seed}`;
      return emitStampFn(sk, alpha, () => buildDotSpec(0, 0, r, curG, { ...opts, opacity: 1, seed }), cx, cy);
    }
    const seed = opts.seed ?? anchorSeed2(0x646f74, cx, cy, opts.role);
    const gk = `d|${curG.id}|${f2(cx)},${f2(cy)},${f2(r)}|${opts.role || ""}|${opts.fill ?? ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${opts.hollow ? 1 : 0}|${opts.labelInside ? 1 : 0}|${seed}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildDotSpec(cx, cy, r, curG, { ...opts, opacity: 1, seed }), false);
  };

  api.ring = function ring(cx, cy, r, opts = {}) {
    const curG = getG();
    if (emitStampFn && curG.node !== "pixel") {
      const alpha = clamp(opts.opacity ?? 1, 0, 1);
      if (alpha < 0.002 || !(r > 0)) return;
      const usesSeed = curG.node === "dab" || curG.node === "chisel";
      const seed = usesSeed ? (opts.seed ?? anchorSeed2(0x72696e67, cx, cy, opts.role)) : 7;
      const sk = `rs|${curG.id}|${f2(r)}|${opts.role || ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${opts.dash || ""}|${seed}`;
      return emitStampFn(sk, alpha, () => buildRingSpec(0, 0, r, curG, { ...opts, opacity: 1, seed }), cx, cy);
    }
    const seed = opts.seed ?? anchorSeed2(0x72696e67, cx, cy, opts.role);
    const gk = `r|${curG.id}|${f2(cx)},${f2(cy)},${f2(r)}|${opts.role || ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${opts.dash || ""}|${seed}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildRingSpec(cx, cy, r, curG, { ...opts, opacity: 1, seed }), false);
  };

  api.arrowHead = function arrowHead(x, y, angle, opts = {}) {
    const curG = getG();
    const gk = `ah|${curG.id}|${f2(x)},${f2(y)},${Math.round(angle * 1000)}|${opts.role || ""}|${opts.fill ?? ""}|${opts.stroke ?? ""}|${opts.size ?? ""}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildArrowHeadSpec(x, y, angle, curG, { ...opts, opacity: 1 }), false);
  };

  api.panel = function panel(x, y, w, h, opts = {}) {
    const curG = getG();
    const seed = opts.seed ?? anchorSeed4(0x70616e, x, y, w, h);
    const progQ = opts.progress != null ? Math.round(clamp(opts.progress, 0, 1) * 1000) : 1000;
    const fillPQ = opts.fillOpacity != null ? Math.round(clamp(opts.fillOpacity, 0, 1) * 1000) : 1000;
    const gk = `p|${curG.id}|${f2(x)},${f2(y)},${f2(w)},${f2(h)}|${opts.isCell ? 1 : 0}|${opts.role || ""}|${opts.fill ?? ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${opts.dash || ""}|${progQ}|${fillPQ}|${seed}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildPanelSpec(x, y, w, h, curG, { ...opts, opacity: 1, seed }), false);
  };

  api.cell = function cell(x, y, size, opts = {}) {
    const curG = getG();
    const seed = opts.seed ?? anchorSeed3(0x63656c6c, x, y, size);
    const progQ = opts.progress != null ? Math.round(clamp(opts.progress, 0, 1) * 1000) : 1000;
    const fillPQ = opts.fillOpacity != null ? Math.round(clamp(opts.fillOpacity, 0, 1) * 1000) : 1000;
    const gk = `cl|${curG.id}|${f2(x)},${f2(y)},${f2(size)}|${opts.role || ""}|${opts.fill ?? ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${opts.dash || ""}|${progQ}|${fillPQ}|${seed}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildPanelSpec(x, y, size, size, curG, { ...opts, isCell: true, opacity: 1, seed }), false);
  };

  api.region = function region(points, opts = {}) {
    const curG = getG();
    const seed = opts.seed ?? (Array.isArray(points) && points.length
      ? anchorSeed3(0x726567, points[0][0], points[0][1], points.length, roleCode(opts.role))
      : 29);
    const fillPQ = opts.fillOpacity != null ? Math.round(clamp(opts.fillOpacity, 0, 1) * 1000) : 1000;
    const gk = `rg|${curG.id}|${serializePointsKey(points)}|${opts.role || ""}|${opts.weight || ""}|${opts.fill ?? ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${opts.dash || ""}|${fillPQ}|${seed}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildRegionSpec(points, curG, { ...opts, opacity: 1, seed }), false);
  };

  api.bar = function bar(x, y, w, h, opts = {}) {
    const curG = getG();
    const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const seed = opts.seed ?? anchorSeed2(0x626172, x, y + h, opts.role);
    const fillPQ = opts.fillOpacity != null ? Math.round(clamp(opts.fillOpacity, 0, 1) * 1000) : 1000;
    const gk = `b|${curG.id}|${f2(x)},${f2(y)},${f2(w)},${f2(h)}|${opts.role || ""}|${opts.weight || ""}|${opts.fill ?? ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${opts.dash || ""}|${fillPQ}|${seed}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildRegionSpec(pts, curG, { ...opts, opacity: 1, seed }), false);
  };

  api.curve = function curve(pointsOrPath, opts = {}) {
    const curG = getG();
    const seed = polylineAnchorSeed(0x637276, pointsOrPath, opts.seed);
    const progQ = opts.progress != null ? Math.round(clamp(opts.progress, 0, 1) * 1000) : 1000;
    const gk = `c|${curG.id}|${serializePointsKey(pointsOrPath)}|${opts.role || ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${opts.dash || ""}|${opts.lineCap || ""}|${opts.lineJoin || ""}|${opts.forceBrush ? 1 : 0}|${progQ}|${seed}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildCurveSpec(pointsOrPath, curG, { ...opts, opacity: 1, seed }), false);
  };

  api.segment = function segment(x1, y1, x2, y2, opts = {}) {
    const curG = getG();
    const seed = opts.seed ?? anchorSeed3(0x736567, x1, y1, Math.round(Math.atan2(y2 - y1, x2 - x1) * 32));
    const progQ = opts.progress != null ? Math.round(clamp(opts.progress, 0, 1) * 1000) : 1000;
    const gk = `s|${curG.id}|${f2(x1)},${f2(y1)},${f2(x2)},${f2(y2)}|${opts.role || ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${opts.dash || ""}|${opts.lineCap || ""}|${progQ}|${seed}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildCurveSpec([[x1, y1], [x2, y2]], curG, { ...opts, opacity: 1, seed }), false);
  };

  api.arrow = function arrow(points, opts = {}) {
    const curG = getG();
    const seed = polylineAnchorSeed(0x617272, points, opts.seed);
    const progQ = opts.progress != null ? Math.round(clamp(opts.progress, 0, 1) * 1000) : 1000;
    const gk = `ar|${curG.id}|${serializePointsKey(points)}|${opts.role || ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${opts.dash || ""}|${opts.headSize ?? ""}|${progQ}|${seed}`;
    return emitFn(gk, opts.opacity, opts.className, () => {
      const prep = prepareArrowGeometry(points, curG, opts);
      const specs = [];
      if (prep.shaftInput) {
        specs.push(...buildCurveSpec(prep.shaftInput, curG, { ...opts, opacity: 1, progress: prep.shaftProgress, seed }));
      }
      if (prep.head) {
        specs.push(...buildArrowHeadSpec(prep.head.x, prep.head.y, prep.head.angle, curG, {
          role: opts.role,
          fill: opts.stroke,
          size: prep.head.size,
          opacity: 1,
        }));
      }
      return specs;
    }, true);
  };

  api.axis = function axis(x1, y1, x2, y2, opts = {}) {
    const curG = getG();
    const seed = opts.seed ?? anchorSeed4(0x61786973, x1, y1, x2, y2);
    const tKey = Array.isArray(opts.ticks) ? opts.ticks.join(",") : String(opts.ticks ?? "");
    const gk = `ax|${curG.id}|${f2(x1)},${f2(y1)},${f2(x2)},${f2(y2)}|${opts.role || ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${opts.arrow === false ? 0 : 1}|${tKey}|${opts.tickSize ?? ""}|${seed}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildAxisSpec(x1, y1, x2, y2, curG, { ...opts, opacity: 1, seed }), true);
  };

  api.brace = function brace(x1, y1, x2, y2, opts = {}) {
    const curG = getG();
    const seed = opts.seed ?? anchorSeed4(0x627263, x1, y1, x2, y2);
    const progQ = opts.progress != null ? Math.round(clamp(opts.progress, 0, 1) * 1000) : 1000;
    const gk = `br|${curG.id}|${f2(x1)},${f2(y1)},${f2(x2)},${f2(y2)}|${opts.depth ?? 10}|${opts.flip ? 1 : 0}|${opts.role || ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${progQ}|${seed}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildBraceSpec(x1, y1, x2, y2, curG, { ...opts, opacity: 1, seed }), true);
  };

  api.bracket = function bracket(x1, y1, x2, y2, opts = {}) {
    const curG = getG();
    const seed = opts.seed ?? anchorSeed4(0x62726b, x1, y1, x2, y2);
    const progQ = opts.progress != null ? Math.round(clamp(opts.progress, 0, 1) * 1000) : 1000;
    const gk = `bk|${curG.id}|${f2(x1)},${f2(y1)},${f2(x2)},${f2(y2)}|${opts.tick ?? 5}|${opts.flip ? 1 : 0}|${opts.role || ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${progQ}|${seed}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildBracketSpec(x1, y1, x2, y2, curG, { ...opts, opacity: 1, seed }), false);
  };

  api.connect = function connect(from, to, opts = {}) {
    const routed = routeConnector(from, to, opts);
    if (opts.arrow === false) return api.curve(routed, opts);
    if (opts.arrow === "both") {
      const curG = getG();
      const rawPts = typeof routed === "string" ? sampleSimpleSvgPath(routed) : routed;
      if (!rawPts || rawPts.length < 2) return api.arrow(routed, opts);
      const rev = rawPts.slice().reverse();
      const seed = polylineAnchorSeed(0x636f6e, rawPts, opts.seed);
      const progQ = opts.progress != null ? Math.round(clamp(opts.progress, 0, 1) * 1000) : 1000;
      const gk = `cn2|${curG.id}|${serializePointsKey(rawPts)}|${opts.role || ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${progQ}|${seed}`;
      return emitFn(gk, opts.opacity, opts.className, () => {
        const pFwd = prepareArrowGeometry(rawPts, curG, opts);
        const pBwd = prepareArrowGeometry(rev, curG, { ...opts, progress: 1 });
        const specs = [];
        if (pFwd.shaftInput) {
          const trimmed = pBwd.head ? trimPolylineEnd(pFwd.shaftInput.slice().reverse(), pBwd.head.size * 0.72).reverse() : pFwd.shaftInput;
          specs.push(...buildCurveSpec(trimmed, curG, { ...opts, opacity: 1, progress: pFwd.shaftProgress, seed }));
        }
        if (pBwd.head) specs.push(...buildArrowHeadSpec(pBwd.head.x, pBwd.head.y, pBwd.head.angle, curG, { role: opts.role, fill: opts.stroke, size: pBwd.head.size, opacity: 1 }));
        if (pFwd.head && (opts.progress ?? 1) > 0.15) specs.push(...buildArrowHeadSpec(pFwd.head.x, pFwd.head.y, pFwd.head.angle, curG, { role: opts.role, fill: opts.stroke, size: pFwd.head.size, opacity: 1 }));
        return specs;
      }, true);
    }
    return api.arrow(routed, opts);
  };

  api.annotate = function annotate(box, opts = {}) {
    const curG = getG();
    const b = normBox(box);
    const seed = opts.seed ?? anchorSeed4(0x616e6e, b.x, b.y, b.w, b.h);
    const progQ = opts.progress != null ? Math.round(clamp(opts.progress, 0, 1) * 1000) : 1000;
    const gk = `an|${curG.id}|${opts.type || "underline"}|${f2(b.x)},${f2(b.y)},${f2(b.w)},${f2(b.h)}|${opts.pad ?? 4}|${opts.role || ""}|${opts.fill ?? ""}|${opts.stroke ?? ""}|${opts.strokeWidth ?? ""}|${progQ}|${seed}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildAnnotateSpec(b, curG, { ...opts, opacity: 1, seed }), true);
  };

  api.plot = function plot(fn, domain, opts = {}) {
    const pts = sampleFunctionPoints(fn, domain, opts);
    return api.curve(pts, opts);
  };

  api.area = function area(fn, domain, opts = {}) {
    const prog = clamp(opts.progress ?? 1, 0, 1);
    if (prog < 0.002) return api.region([], { ...opts, opacity: 0 });
    const subDom = [domain[0], lerp(domain[0], domain[1], prog)];
    const pts = sampleFunctionPoints(fn, subDom, opts);
    const sc = opts.scale || null;
    const baseVal = opts.baseline ?? (sc ? sc.domainY[0] : 0);
    const endBase = sc ? sc.pt(subDom[1], baseVal) : [subDom[1], baseVal];
    const startBase = sc ? sc.pt(subDom[0], baseVal) : [subDom[0], baseVal];
    pts.push(endBase, startBase);
    return api.region(pts, { stroke: "none", ...opts });
  };

  api.grid = function grid(scale, opts = {}) {
    const curG = getG();
    const [rx0, rx1] = scale.rangeX;
    const [ry0, ry1] = scale.rangeY;
    const xtKey = Array.isArray(opts.xTicks) ? opts.xTicks.map(f2).join(",") : String(opts.ticksX ?? 4);
    const ytKey = Array.isArray(opts.yTicks) ? opts.yTicks.map(f2).join(",") : String(opts.ticksY ?? 4);
    const gk = `gd|${curG.id}|${f2(rx0)},${f2(rx1)},${f2(ry0)},${f2(ry1)}|${xtKey}|${ytKey}|${opts.axes === false ? 0 : 1}|${opts.role || ""}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildGridSpec(scale, curG, { ...opts, opacity: 1 }), true);
  };

  const resolveColOrRole = (G, c) => {
    if (!c) return G.P.slate;
    const s = String(c);
    if (s.charCodeAt(0) === 35 || s.startsWith("rgb") || s.startsWith("var(")) return s;
    return resolveRoleColor(G, s);
  };

  api.mixColor = function mixCol(colA, colB, p) {
    const curG = getG();
    return mixColor(resolveColOrRole(curG, colA), resolveColOrRole(curG, colB), p);
  };

  api.band = function band(fnLow, fnHigh, domain, opts = {}) {
    const prog = clamp(opts.progress ?? 1, 0, 1);
    if (prog < 0.002) return api.region([], { ...opts, opacity: 0 });
    const subDom = [domain[0], lerp(domain[0], domain[1], prog)];
    const samples = Math.max(4, Math.min(256, Math.floor(Number(opts.samples ?? 48))));
    const sc = opts.scale || null;
    const upper = new Array(samples + 1);
    const lower = new Array(samples + 1);
    for (let i = 0; i <= samples; i++) {
      const vx = lerp(subDom[0], subDom[1], i / samples);
      const lo = fnLow(vx);
      let hi = fnHigh(vx);
      if (opts.clampCrossings && hi < lo) hi = lo;
      upper[i] = sc ? sc.pt(vx, hi) : [vx, hi];
      lower[samples - i] = sc ? sc.pt(vx, lo) : [vx, lo];
    }
    const poly = upper.concat(lower);
    const reg = api.region(poly, { stroke: "none", weight: opts.weight || "subtle", ...opts });
    if (opts.strokeEdges) {
      const edgeOpts = { role: opts.role || "primary", stroke: opts.edgeStroke || opts.stroke, strokeWidth: opts.edgeWidth ?? 1.2, dash: opts.edgeDash || "", opacity: opts.opacity };
      api.curve(upper, edgeOpts);
      api.curve(lower.slice().reverse(), edgeOpts);
    }
    return reg;
  };

  api.whisker = function whisker(x, yLow, yHigh, opts = {}) {
    const curG = getG();
    const sc = opts.scale || null;
    const pLo = sc ? sc.pt(x, yLow) : [x, yLow];
    const pHi = sc ? sc.pt(x, yHigh) : [x, yHigh];
    const midKey = opts.yMid != null ? f2(sc ? sc.y(opts.yMid) : opts.yMid) : "";
    const gk = `wh|${curG.id}|${f2(pLo[0])},${f2(pLo[1])},${f2(pHi[1])}|${midKey}|${opts.capWidth ?? 7}|${opts.role || ""}|${opts.hollow === false ? 0 : 1}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildWhiskerSpec(x, yLow, yHigh, curG, { ...opts, opacity: 1 }), true);
  };

  api.box2d = function box2d(xRange, yRange, opts = {}) {
    const curG = getG();
    const sc = opts.scale || null;
    const p0 = sc ? sc.pt(xRange[0], yRange[0]) : [xRange[0], yRange[0]];
    const p1 = sc ? sc.pt(xRange[1], yRange[1]) : [xRange[1], yRange[1]];
    const capKey = opts.capY != null ? f2(sc ? sc.y(opts.capY) : opts.capY) : "";
    const gk = `bx2|${curG.id}|${f2(p0[0])},${f2(p0[1])},${f2(p1[0])},${f2(p1[1])}|${capKey}|${opts.dashed ? 1 : 0}|${opts.role || ""}|${opts.weight || ""}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildBox2dSpec(xRange, yRange, curG, { ...opts, opacity: 1 }), true);
  };

  api.frontier = function frontier(points, opts = {}) {
    const front = opts.precomputed ? points : paretoFrontier(points, opts);
    if (!front.length) return undefined;
    const sc = opts.scale || null;
    const pxPts = sc ? front.map((p) => sc.pt(p[0], p[1])) : front.slice();
    let curvePts = pxPts;
    if (opts.step === "hv" || opts.step === "vh") {
      curvePts = [pxPts[0]];
      for (let i = 1; i < pxPts.length; i++) {
        const a = pxPts[i - 1], b = pxPts[i];
        curvePts.push(opts.step === "hv" ? [b[0], a[1]] : [a[0], b[1]], b);
      }
      if (opts.extendX != null) {
        const ex = sc ? sc.x(opts.extendX) : opts.extendX;
        const last = curvePts[curvePts.length - 1];
        curvePts.push([ex, last[1]]);
      }
    }
    const res = curvePts.length >= 2 ? api.curve(curvePts, opts) : undefined;
    if (opts.showPoints) {
      const r = Number(opts.pointRadius ?? 4.2);
      for (let i = 0; i < pxPts.length; i++) {
        api.dot(pxPts[i][0], pxPts[i][1], r, { role: opts.role || "primary", opacity: opts.opacity });
      }
    }
    return res;
  };

  api.histogram = function histogram(scale, bins = [], opts = {}) {
    const baseVal = opts.baseline ?? (scale ? scale.domainY[0] : 0);
    const gap = Number(opts.gap ?? 1.5);
    const baseY = scale ? scale.y(baseVal) : baseVal;
    let last;
    for (let i = 0; i < bins.length; i++) {
      const b = bins[i];
      const x0 = Array.isArray(b) ? b[0] : b.x0;
      const x1 = Array.isArray(b) ? b[1] : b.x1;
      const yv = Array.isArray(b) ? b[2] : b.y;
      const px0 = scale ? scale.x(x0) : x0;
      const px1 = scale ? scale.x(x1) : x1;
      const py = scale ? scale.y(yv) : yv;
      const rx = Math.min(px0, px1) + gap * 0.5;
      const rw = Math.max(1, Math.abs(px1 - px0) - gap);
      const ry = Math.min(py, baseY);
      const rh = Math.max(0.5, Math.abs(baseY - py));
      last = api.bar(rx, ry, rw, rh, {
        role: (!Array.isArray(b) && b.role) || opts.role || "primary",
        weight: (!Array.isArray(b) && b.weight) || opts.weight || "medium",
        stroke: opts.stroke,
        opacity: (!Array.isArray(b) && b.opacity != null ? b.opacity : 1) * (opts.opacity ?? 1),
      });
    }
    return last;
  };

  api.graph = function graph(graphSpec, opts = {}) {
    const curG = getG();
    const ns = graphSpec.nodes || [];
    const es = graphSpec.edges || [];
    const hs = graphSpec.highlights || [];
    let k = `gr|${curG.id}|${graphSpec.directed === false ? 0 : 1}|`;
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i];
      k += `${n.id}:${f1(n.x)},${f1(n.y)},${n.r ?? 8},${n.w ?? 0},${n.role || ""},${n.status || ""},${Math.round((n.opacity ?? 1) * 100)};`;
    }
    k += "|";
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      k += `${e.from}>${e.to},${e.role || ""},${f2(e.bend ?? 0)},${e.dashed ? 1 : 0},${Math.round((e.progress ?? 1) * 200)},${Math.round((e.opacity ?? 1) * 100)};`;
    }
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      k += `|h:${h.kind || ""},${(h.nodes || []).join(",")},${h.role || ""},${h.fill ? 1 : 0},${Math.round((h.progress ?? 1) * 200)},${Math.round((h.opacity ?? 1) * 100)}`;
    }
    return emitFn(k, opts.opacity, opts.className, () => buildGraphSpec(graphSpec, curG, { ...opts, opacity: 1 }), true);
  };

  api.tape = function tape(x, y, cells = [], opts = {}) {
    const curG = getG();
    const cKey = cells.map((c) => `${c?.state || "e"}:${c?.role || ""}`).join(",");
    const wKey = Array.isArray(opts.window) ? opts.window.join("-") : "";
    const hKey = opts.head ? `${f2(opts.head.index)}:${opts.head.side || ""}` : "";
    const gk = `tp|${curG.id}|${f2(x)},${f2(y)}|${opts.cellW ?? opts.size ?? 28},${opts.cellH ?? ""}|${cKey}|${wKey}|${hKey}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildTapeSpec(x, y, cells, curG, { ...opts, opacity: 1 }), true);
  };

  api.matrix = function matrix(x, y, grid = [], opts = {}) {
    const curG = getG();
    const gKey = grid.map((r) => r.map((v) => (v === true ? 1 : v === false ? 0 : v ?? "_")).join("")).join("/");
    const aKey = opts.activeRows ? opts.activeRows.join(",") : "";
    const pKey = opts.prunedRows ? opts.prunedRows.join(",") : "";
    const swQ = opts.sweepProgress != null ? Math.round(clamp(opts.sweepProgress, 0, 1) * 250) : -1;
    const gk = `mx|${curG.id}|${f2(x)},${f2(y)}|${opts.cellW ?? 26},${opts.cellH ?? ""}|${opts.shape || "cell"}|${gKey}|${aKey}|${pKey}|${swQ}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildMatrixSpec(x, y, grid, curG, { ...opts, opacity: 1 }), true);
  };

  api.lanes = function lanes(x, y, w, h, rows = [], opts = {}) {
    const curG = getG();
    const rKey = rows.map((r) => (r?.intervals || r || []).map((iv) => `${f2(iv.start)}-${f2(iv.end)}:${iv.role || ""}:${Math.round((iv.progress ?? 1) * 200)}`).join(",")).join("/");
    const curQ = opts.cursor != null ? f2(opts.cursor) : "";
    const gk = `ln|${curG.id}|${f2(x)},${f2(y)},${f2(w)},${f2(h)}|${rKey}|${curQ}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildLanesSpec(x, y, w, h, rows, curG, { ...opts, opacity: 1 }), true);
  };

  api.stackBar = function stackBar(x, y, w, h, segments = [], opts = {}) {
    const curG = getG();
    const sKey = segments.map((s) => `${f2(s.value)}:${s.role || ""}:${s.weight || ""}:${s.dashed ? 1 : 0}`).join(",");
    const gk = `sb|${curG.id}|${f2(x)},${f2(y)},${f2(w)},${f2(h)}|${opts.orientation || "h"}|${sKey}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildStackBarSpec(x, y, w, h, segments, curG, { ...opts, opacity: 1 }), true);
  };

  api.gauge = function gauge(x, y, w, h, fraction, opts = {}) {
    const curG = getG();
    const fQ = Math.round(clamp(fraction ?? 0, 0, 1) * 500);
    const thQ = opts.threshold != null ? f2(opts.threshold) : "";
    const gk = `gg|${curG.id}|${f2(x)},${f2(y)},${f2(w)},${f2(h)}|${fQ}|${thQ}|${opts.orientation || "h"}|${opts.role || ""}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildGaugeSpec(x, y, w, h, fraction, curG, { ...opts, opacity: 1 }), true);
  };

  api.funnel = function funnel(x, y, w, h, stages = [], opts = {}) {
    const curG = getG();
    const stKey = stages.map((s) => `${f2(s.topWidthRatio ?? s.widthRatio ?? 1)}-${f2(s.bottomWidthRatio ?? -1)}:${s.role || ""}:${Math.round((s.fillProgress ?? 1) * 200)}:${s.splitCols ?? 1}`).join(",");
    const gk = `fn|${curG.id}|${f2(x)},${f2(y)},${f2(w)},${f2(h)}|${stKey}`;
    const node = emitFn(gk, opts.opacity, opts.className, () => buildFunnelSpec(x, y, w, h, stages, curG, { ...opts, opacity: 1 }), true);
    const layout = computeFunnelLayout(x, y, w, h, stages, opts);
    if (node && typeof node === "object") node.stages = layout;
    return node || layout;
  };

  const PATH_SAMPLE_CACHE = new WeakMap();
  api.flowToken = function flowToken(pathOrSampled, u, opts = {}) {
    let sp = pathOrSampled && typeof pathOrSampled.at === "function" ? pathOrSampled : null;
    if (!sp) {
      if (Array.isArray(pathOrSampled)) {
        sp = PATH_SAMPLE_CACHE.get(pathOrSampled);
        if (!sp) {
          sp = samplePath(pathOrSampled);
          PATH_SAMPLE_CACHE.set(pathOrSampled, sp);
        }
      } else {
        sp = samplePath(pathOrSampled);
      }
    }
    const r = Number(opts.r ?? 4.8);
    const role = opts.role || "primary";
    const baseOp = clamp(opts.opacity ?? 1, 0, 1);
    const repeat = Math.max(1, Math.min(16, Math.floor(Number(opts.repeat ?? 1))));
    const trail = Math.max(0, Math.min(8, Math.floor(Number(opts.trail ?? 0))));
    const trailSpan = Number(opts.trailSpan ?? 0.08);
    let headPos = sp.at(clamp(u, 0, 1));
    for (let k = 0; k < repeat; k++) {
      const uk = repeat === 1 ? clamp(u, 0, 1) : (((u + k / repeat) % 1) + 1) % 1;
      for (let t = trail; t >= 1; t--) {
        const ut = uk - (t / trail) * trailSpan;
        if (ut < 0) continue;
        const tp = sp.at(ut);
        const fade = 1 - t / (trail + 1);
        api.dot(tp.x, tp.y, Math.max(1.2, r * (0.45 + 0.45 * fade)), { role, fill: opts.fill, stroke: "none", opacity: baseOp * fade * 0.55 });
      }
      const hp = sp.at(uk);
      if (k === 0) headPos = hp;
      api.dot(hp.x, hp.y, r, { role, fill: opts.fill, stroke: opts.stroke, opacity: baseOp });
    }
    return headPos;
  };

  api.plaque = function plaque(x, y, w, h, opts = {}) {
    const curG = getG();
    const gk = `plq|${curG.id}|${f2(x)},${f2(y)},${f2(w)},${f2(h)}|${opts.accentSide || "left"}|${opts.accentRole || opts.role || ""}|${opts.accent ?? ""}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildPlaqueSpec(x, y, w, h, curG, { ...opts, opacity: 1 }), true);
  };

  api.docCard = function docCard(x, y, w, h, opts = {}) {
    const curG = getG();
    const rKey = Array.isArray(opts.ruledLines) ? opts.ruledLines.join(",") : String(opts.ruledLines ?? 0);
    const gk = `dc|${curG.id}|${f2(x)},${f2(y)},${f2(w)},${f2(h)}|${opts.stackDepth ?? 0}|${opts.foldedCorner ? 1 : 0}|${rKey}|${opts.role || ""}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildDocCardSpec(x, y, w, h, curG, { ...opts, opacity: 1 }), true);
  };

  api.glyph = function glyph(kind, x, y, opts = {}) {
    const curG = getG();
    const gk = `gly|${curG.id}|${kind}|${f2(x)},${f2(y)}|${opts.size ?? 10}|${opts.badge || ""}|${opts.role || ""}|${opts.stroke ?? ""}|${Math.round((opts.angle ?? 0) * 100)}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildGlyphSpec(kind, x, y, curG, { ...opts, opacity: 1 }), true);
  };

  api.octantRoom = function octantRoom(octant, opts = {}) {
    const curG = getG();
    const o = octant.origin;
    const subKey = Array.isArray(opts.subbox) ? opts.subbox.map(f2).join(",") : "";
    const gk = `oct|${curG.id}|${f1(o[0])},${f1(o[1])}|${opts.ticks ?? 3}|${subKey}|${opts.subboxRole || ""}|${opts.subboxDashed ? 1 : 0}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildOctantRoomSpec(octant, curG, { ...opts, opacity: 1 }), true);
  };

  api.pin3d = function pin3d(octant, pt3, opts = {}) {
    const curG = getG();
    const top = octant.project(pt3[0], pt3[1], pt3[2]);
    const flr = octant.project(pt3[0], pt3[1], 0);
    const gk = `p3d|${curG.id}|${f2(top[0])},${f2(top[1])},${f2(flr[0])},${f2(flr[1])}|${opts.r ?? 6}|${opts.role || ""}|${opts.dropWalls ? 1 : 0}|${opts.dropFloor === false ? 0 : 1}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildPin3dSpec(octant, pt3, curG, { ...opts, opacity: 1 }), true);
  };

  api.curve3d = function curve3d(octant, pts3 = [], opts = {}) {
    if (!pts3.length) return undefined;
    if (opts.floorShadow) {
      const shPts = pts3.map((p) => octant.project(p[0], p[1], 0));
      api.curve(shPts, {
        role: opts.role || "muted",
        strokeWidth: 1.2,
        dash: "4 3",
        progress: opts.progress,
        opacity: (opts.opacity ?? 1) * 0.38,
      });
    }
    const pts2 = pts3.map((p) => octant.project(p[0], p[1], p[2]));
    return opts.arrow ? api.arrow(pts2, opts) : api.curve(pts2, opts);
  };

  api.lattice = function lattice(scale, opts = {}) {
    const curG = getG();
    const [rx0, rx1] = scale ? scale.rangeX : [0, 1];
    const [ry0, ry1] = scale ? scale.rangeY : [0, 1];
    const xr = (opts.xRange || [0, 4]).join(",");
    const yr = (opts.yRange || [0, 4]).join(",");
    const pKey = opts.insidePoly ? serializePointsKey(opts.insidePoly) : "";
    const gk = `lat|${curG.id}|${f1(rx0)},${f1(rx1)},${f1(ry0)},${f1(ry1)}|${xr}|${yr}|${opts.step ?? 1}|${pKey}|${opts.hideOutside ? 1 : 0}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildLatticeSpec(scale, curG, { ...opts, opacity: 1 }), true);
  };

  api.halfspaceCut = function halfspaceCut(scale, a, b, opts = {}) {
    const curG = getG();
    const [rx0, rx1] = scale ? scale.rangeX : [0, 1];
    const [ry0, ry1] = scale ? scale.rangeY : [0, 1];
    const progQ = opts.progress != null ? Math.round(clamp(opts.progress, 0, 1) * 500) : 500;
    const gk = `hsc|${curG.id}|${f1(rx0)},${f1(rx1)},${f1(ry0)},${f1(ry1)}|${f2(a[0])},${f2(a[1])},${f2(b)}|${opts.role || ""}|${opts.showNormal ? 1 : 0}|${progQ}`;
    return emitFn(gk, opts.opacity, opts.className, () => buildHalfspaceCutSpec(scale, a, b, curG, { ...opts, opacity: 1 }), true);
  };

  api.tangentLine = function tangentLine(fn, x0, domain, opts = {}) {
    const y0 = fn(x0);
    const slope = opts.deriv != null
      ? (typeof opts.deriv === "function" ? opts.deriv(x0) : Number(opts.deriv))
      : (fn(x0 + 1e-4) - fn(x0 - 1e-4)) / 2e-4;
    const sc = opts.scale || null;
    const box = opts.yClamp
      ? [domain[0], domain[1], opts.yClamp[0], opts.yClamp[1]]
      : sc
        ? [domain[0], domain[1], Math.min(sc.domainY[0], sc.domainY[1]), Math.max(sc.domainY[0], sc.domainY[1])]
        : null;
    let segData;
    if (box) {
      segData = lineInBox([-slope, 1], y0 - slope * x0, box);
    } else {
      segData = [[domain[0], y0 + slope * (domain[0] - x0)], [domain[1], y0 + slope * (domain[1] - x0)]];
    }
    if (!segData) return undefined;
    const segPx = sc ? [sc.pt(segData[0][0], segData[0][1]), sc.pt(segData[1][0], segData[1][1])] : segData;
    const lineNode = api.curve(segPx, { role: opts.role || "caveat", dash: opts.dash ?? "5 4", strokeWidth: opts.strokeWidth ?? 1.8, ...opts });
    if (opts.markPoint !== false) {
      const p0 = sc ? sc.pt(x0, y0) : [x0, y0];
      api.dot(p0[0], p0[1], Number(opts.r ?? 4.5), { role: opts.role || "caveat", opacity: opts.opacity });
    }
    return lineNode;
  };

  return api;
}

function parsePointsAttr(pointsStr) {
  const nums = String(pointsStr || "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) pts.push([nums[i], nums[i + 1]]);
  }
  return pts;
}

function resolveCssVarColor(raw, cs) {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s.startsWith("var(")) return s;
  const m = s.match(/^var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^)]+))?\)$/);
  if (!m) return s;
  if (cs) {
    const val = cs.getPropertyValue(m[1]).trim();
    if (val) return /^color-mix\(/i.test(val) ? rgba(parseRgb(val), 1) : val;
  }
  return m[2] ? m[2].trim() : undefined;
}

const PASSTHROUGH_ATTRS = ["id", "transform", "clip-path", "mask", "filter", "data-marpit-fragment", "role"];

function copyPassthroughAttrs(attrs, node) {
  for (let i = 0; i < PASSTHROUGH_ATTRS.length; i++) {
    const k = PASSTHROUGH_ATTRS[i];
    if (attrs[k] != null && !node.getAttribute(k)) node.setAttribute(k, attrs[k]);
  }
  for (const k in attrs) {
    if (k.startsWith("aria-") && !node.getAttribute(k)) node.setAttribute(k, attrs[k]);
  }
  if (attrs.style) {
    const existing = node.getAttribute("style");
    node.setAttribute("style", existing ? `${attrs.style};${existing}` : attrs.style);
  }
}

/**
 * Hydrate declarative `<svg>` elements carrying `data-pf-mark="dot|ring|bar|region|panel|cell|curve|segment|arrow|axis"`
 * so static Markdown / Marp figures rematerialize cleanly across themes and palettes.
 */
export function hydrateSvgMarks(svgEl, hostEl = null, grammarOverrides = null) {
  if (!svgEl.__pfMarkSnapshots) {
    const items = [];
    let idx = 1;
    const found = svgEl.querySelectorAll("[data-pf-mark]");
    for (let i = 0; i < found.length; i++) {
      const el = found[i];
      if (el.getAttribute("data-pf-mark-generated")) continue;
      const attrs = {};
      const attrList = el.attributes;
      for (let j = 0; j < attrList.length; j++) {
        attrs[attrList[j].name] = attrList[j].value;
      }
      const origClone = typeof el.cloneNode === "function" ? el.cloneNode(true) : null;
      const kind = attrs["data-pf-mark"];
      let prePts = null;
      if (kind === "region") {
        if (attrs.points) prePts = parsePointsAttr(attrs.points);
        else if (attrs.d) prePts = sampleSimpleSvgPath(attrs.d);
        else if (attrs.width != null && attrs.height != null) {
          const rx = Number(attrs.x || 0), ry = Number(attrs.y || 0), rw = Number(attrs.width), rh = Number(attrs.height);
          prePts = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]];
        }
      } else if (kind === "arrow" || kind === "curve" || kind === "segment") {
        prePts = attrs.d || (attrs.points ? parsePointsAttr(attrs.points) : [[Number(attrs.x1 || 0), Number(attrs.y1 || 0)], [Number(attrs.x2 || 0), Number(attrs.y2 || 0)]]);
      }
      items.push({ tag: el.tagName.toLowerCase(), attrs, prePts, origClone, placeholder: el, seed: idx++ * 6151 + 7 });
    }
    svgEl.__pfMarkSnapshots = items;
  }
  const snapshots = svgEl.__pfMarkSnapshots;
  if (!snapshots.length) return;

  const target = hostEl || svgEl;
  let holder = svgEl.__pfHydrateHolder;
  if (!holder || holder.target !== target) {
    holder = { target, marks: createSvgMarks(svgEl, target, grammarOverrides) };
    svgEl.__pfHydrateHolder = holder;
  }
  const marks = holder.marks;
  const G = marks.syncGrammar(grammarOverrides);
  const hasCustomColorMap = Boolean(grammarOverrides && grammarOverrides.mapColor);

  if (G.isSwiss && !G.isDark && !hasCustomColorMap && snapshots.every((s) => s.origClone)) {
    if (svgEl.__pfHydratedKey === "__swiss_native__") return;
    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const restored = snap.origClone.cloneNode(true);
      if (snap.placeholder.parentNode) {
        snap.placeholder.parentNode.replaceChild(restored, snap.placeholder);
        snap.placeholder = restored;
      }
    }
    clearDefsPool(svgEl);
    svgEl.removeAttribute("data-pf-hydrated");
    svgEl.__pfHydratedKey = "__swiss_native__";
    return;
  }

  if (!hasCustomColorMap && svgEl.__pfHydratedKey === G.key && snapshots[0].placeholder.parentNode) {
    return;
  }

  svgEl.setAttribute("data-pf-hydrated", "1");
  sweepDefsPool(svgEl);
  const cs = target && typeof getComputedStyle === "function" ? getComputedStyle(target) : null;
  const mapCol = hasCustomColorMap ? grammarOverrides.mapColor : (c) => c;

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const a = snap.attrs;
    const kind = a["data-pf-mark"];
    const rawFill = resolveCssVarColor(a.fill, cs);
    const rawStroke = resolveCssVarColor(a.stroke, cs);
    const common = {
      role: a["data-pf-role"] || undefined,
      weight: a["data-pf-weight"] || undefined,
      fill: rawFill != null ? mapCol(rawFill) : undefined,
      stroke: rawStroke != null ? mapCol(rawStroke) : undefined,
      fillOpacity: a["fill-opacity"] != null ? Number(a["fill-opacity"]) : undefined,
      strokeWidth: a["stroke-width"] != null ? Number(a["stroke-width"]) : undefined,
      dash: a["stroke-dasharray"] || undefined,
      lineCap: a["stroke-linecap"] || undefined,
      lineJoin: a["stroke-linejoin"] || undefined,
      opacity: a.opacity != null ? Number(a.opacity) : undefined,
      hollow: a["data-pf-hollow"] === "1" || a["data-pf-hollow"] === "true" || rawFill === "none",
      labelInside: a["data-pf-label-inside"] === "1" || a["data-pf-label-inside"] === "true",
      className: a.class || undefined,
      seed: a["data-pf-seed"] != null ? Number(a["data-pf-seed"]) : snap.seed,
    };

    let replacement = null;
    if (kind === "dot") {
      const r = a.r != null ? Number(a.r) : (a.rx != null || a.ry != null ? (Number(a.rx || a.ry || 6) + Number(a.ry || a.rx || 6)) / 2 : 6);
      replacement = marks.dot(Number(a.cx || 0), Number(a.cy || 0), r, common);
    } else if (kind === "ring") {
      const r = a.r != null ? Number(a.r) : Number(a.rx || 10);
      replacement = marks.ring(Number(a.cx || 0), Number(a.cy || 0), r, common);
    } else if (kind === "bar") {
      replacement = marks.bar(Number(a.x || 0), Number(a.y || 0), Number(a.width || 0), Number(a.height || 0), common);
    } else if (kind === "panel") {
      replacement = marks.panel(Number(a.x || 0), Number(a.y || 0), Number(a.width || 0), Number(a.height || 0), common);
    } else if (kind === "cell") {
      const sz = Number(a.width || a.height || 28);
      replacement = marks.cell(Number(a.x || 0), Number(a.y || 0), sz, common);
    } else if (kind === "region") {
      if (snap.prePts && snap.prePts.length >= 3) replacement = marks.region(snap.prePts, common);
    } else if (kind === "arrow") {
      replacement = marks.arrow(snap.prePts, common);
    } else if (kind === "axis") {
      const ticks = a["data-pf-ticks"] != null ? Number(a["data-pf-ticks"]) : undefined;
      replacement = marks.axis(Number(a.x1 || 0), Number(a.y1 || 0), Number(a.x2 || 0), Number(a.y2 || 0), { ...common, ticks });
    } else if (kind === "brace") {
      const depth = a["data-pf-depth"] != null ? Number(a["data-pf-depth"]) : undefined;
      const flip = a["data-pf-flip"] === "1" || a["data-pf-flip"] === "true";
      replacement = marks.brace(Number(a.x1 || 0), Number(a.y1 || 0), Number(a.x2 || 0), Number(a.y2 || 0), { ...common, depth, flip });
    } else if (kind === "bracket") {
      const tick = a["data-pf-tick"] != null ? Number(a["data-pf-tick"]) : undefined;
      const flip = a["data-pf-flip"] === "1" || a["data-pf-flip"] === "true";
      replacement = marks.bracket(Number(a.x1 || 0), Number(a.y1 || 0), Number(a.x2 || 0), Number(a.y2 || 0), { ...common, tick, flip });
    } else if (kind === "annotate") {
      const type = a["data-pf-type"] || "underline";
      const pad = a["data-pf-pad"] != null ? Number(a["data-pf-pad"]) : undefined;
      replacement = marks.annotate({ x: Number(a.x || 0), y: Number(a.y || 0), w: Number(a.width || 0), h: Number(a.height || 0) }, { ...common, type, pad });
    } else if (kind === "curve" || kind === "segment") {
      replacement = marks.curve(snap.prePts, common);
    }

    if (replacement && snap.placeholder.parentNode) {
      replacement.__pfPinned = true;
      replacement.setAttribute("data-pf-mark-generated", "1");
      copyPassthroughAttrs(a, replacement);
      snap.placeholder.parentNode.replaceChild(replacement, snap.placeholder);
      snap.placeholder = replacement;
    }
  }
  svgEl.__pfHydratedKey = hasCustomColorMap ? "" : G.key;
}

// ============================================================================
// HTML5 <canvas> Renderer (`createCanvasMarks` + `mountMarkedDiagram`)
// ============================================================================

const canvasPatternCache = new Map();

function getCanvasPattern(ctx, patSpec) {
  if (!ctx || typeof ctx.createPattern !== "function") return null;
  const { kind, density, fg, bg } = patSpec;
  const key = `${kind}|${density}|${fg}|${bg}`;
  if (canvasPatternCache.has(key)) return canvasPatternCache.get(key);

  const size = kind === "screentone" ? (density >= 30 ? 6 : density >= 20 ? 7 : 8) : 4;
  let tile = null;
  if (typeof OffscreenCanvas !== "undefined") {
    tile = new OffscreenCanvas(size, size);
  } else if (typeof document !== "undefined" && typeof document.createElement === "function") {
    tile = document.createElement("canvas");
    if (tile) {
      tile.width = size;
      tile.height = size;
    }
  }
  const tctx = tile && typeof tile.getContext === "function" ? tile.getContext("2d") : null;
  if (!tctx) return null;

  tctx.fillStyle = bg;
  tctx.fillRect(0, 0, size, size);
  tctx.fillStyle = fg;
  if (kind === "screentone") {
    const r = density >= 30 ? 1.42 : density >= 20 ? 1.08 : 0.75;
    tctx.beginPath();
    tctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    tctx.fill();
  } else {
    for (const [px, py, pw, ph] of getDitherCells(density)) {
      tctx.fillRect(px, py, pw, ph);
    }
  }

  const pat = ctx.createPattern(tile, "repeat");
  if (pat && kind === "screentone" && typeof pat.setTransform === "function" && typeof DOMMatrix !== "undefined") {
    pat.setTransform(new DOMMatrix().rotate(45));
  }
  if (pat) {
    if (canvasPatternCache.size > 64) canvasPatternCache.clear();
    canvasPatternCache.set(key, pat);
  }
  return pat;
}

const EMPTY_DASH = [];

/**
 * Create a semantic Canvas 2D mark renderer compatible with `chao-ui/diagrams.js`.
 * Draws typed `Float32Array`/`Float64Array` geometry directly on `ctx` with zero `Path2D`
 * allocations, caches origin-centered `dot`/`ring` stamps across moving frames, and skips
 * redundant C++ `ctx.save()/restore()` stack copies when no composite/smoothing state changes.
 */
export function createCanvasMarks(ctx, hostEl = null, grammarOverrides = null) {
  const target = hostEl || (ctx && ctx.canvas) || null;
  let cachedG = markGrammar(target, grammarOverrides);
  let lastOverrides = grammarOverrides;
  let lastSig = hostSignature(target);
  const hasQuad = Boolean(ctx && typeof ctx.quadraticCurveTo === "function");

  function syncGrammar(overrides = grammarOverrides) {
    cachedG = markGrammar(target, overrides);
    lastOverrides = overrides;
    lastSig = hostSignature(target);
    return cachedG;
  }

  function beginFrame(overrides = grammarOverrides) {
    const sig = hostSignature(target);
    if (cachedG && overrides === lastOverrides && sig === lastSig) return cachedG;
    return syncGrammar(overrides);
  }

  function applyDash(sp, a, perim = 0) {
    const dashStr = a["stroke-dasharray"];
    if (!dashStr) return false;
    let raw = sp.__dash;
    if (!raw) {
      raw = String(dashStr).trim().split(/[\s,]+/).map(Number);
      sp.__dash = raw;
    }
    if (a.pathLength === "1" && perim > 0) {
      const scaled = new Array(raw.length);
      for (let i = 0; i < raw.length; i++) scaled[i] = raw[i] * perim;
      ctx.setLineDash(scaled);
      if (a["stroke-dashoffset"] != null && "lineDashOffset" in ctx) {
        ctx.lineDashOffset = Number(a["stroke-dashoffset"]) * perim;
      }
    } else {
      ctx.setLineDash(raw);
      if (a["stroke-dashoffset"] != null && "lineDashOffset" in ctx) {
        ctx.lineDashOffset = Number(a["stroke-dashoffset"]);
      }
    }
    return true;
  }

  function drawUnitSpecs(unitSpecs, rawOp, offX = 0, offY = 0) {
    const alpha = clamp(rawOp ?? 1, 0, 1);
    if (alpha < 0.002 || !unitSpecs.length) return;
    const prevAlpha = ctx.globalAlpha;

    for (let sIdx = 0; sIdx < unitSpecs.length; sIdx++) {
      const sp = unitSpecs[sIdx];
      const a = sp.attrs;
      const op = alpha * sp.baseOp;
      if (op < 0.002) continue;

      const fillOp = a["fill-opacity"] != null ? Number(a["fill-opacity"]) : 1;
      let prevBlend = null;
      if (a.style && String(a.style).indexOf("multiply") !== -1 && "globalCompositeOperation" in ctx) {
        prevBlend = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = "multiply";
      }
      let prevSmooth = null;
      if (a["shape-rendering"] === "crispEdges" && "imageSmoothingEnabled" in ctx) {
        prevSmooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
      }
      let prevCap = null;
      if (a["stroke-linecap"] && "lineCap" in ctx) {
        prevCap = ctx.lineCap;
        ctx.lineCap = a["stroke-linecap"];
      }
      let prevJoin = null;
      if (a["stroke-linejoin"] && "lineJoin" in ctx) {
        prevJoin = ctx.lineJoin;
        ctx.lineJoin = a["stroke-linejoin"];
      }

      let fillStyle = a.fill;
      if (sp.wash && typeof ctx.createLinearGradient === "function") {
        const { color, dir, stops, bounds } = sp.wash;
        const rgb = parseRgb(color, [79, 125, 150]);
        const grad = dir === "h"
          ? ctx.createLinearGradient(bounds.minX + offX, 0, bounds.maxX + offX, 0)
          : ctx.createLinearGradient(0, bounds.minY + offY, 0, bounds.maxY + offY);
        grad.addColorStop(0, rgba(rgb, stops[0]));
        grad.addColorStop(dir === "h" ? 0.58 : 0.52, rgba(rgb, stops[1]));
        grad.addColorStop(1, rgba(rgb, stops[2]));
        fillStyle = grad;
      } else if (sp.pattern) {
        const pat = getCanvasPattern(ctx, sp.pattern);
        if (pat) fillStyle = pat;
      }

      let usedDash = false;
      const doFillStroke = (drawShape, perim = 0) => {
        if (fillStyle && fillStyle !== "none") {
          ctx.globalAlpha = op * fillOp;
          ctx.fillStyle = fillStyle;
          drawShape("fill");
        }
        if (a.stroke && a.stroke !== "none") {
          usedDash = applyDash(sp, a, perim);
          ctx.globalAlpha = op;
          ctx.strokeStyle = a.stroke;
          ctx.lineWidth = Number(a["stroke-width"] || 1);
          drawShape("stroke");
        }
      };

      if (sp.tag === "circle") {
        const cx = Number(a.cx) + offX, cy = Number(a.cy) + offY, r = Number(a.r);
        doFillStroke((mode) => {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          if (mode === "fill") ctx.fill(); else ctx.stroke();
        }, 2 * Math.PI * r);
      } else if (sp.tag === "rect") {
        const rx = Number(a.x) + offX, ry = Number(a.y) + offY, rw = Number(a.width), rh = Number(a.height);
        doFillStroke((mode) => {
          if (mode === "fill") ctx.fillRect(rx, ry, rw, rh); else ctx.strokeRect(rx, ry, rw, rh);
        }, 2 * (rw + rh));
      } else if (sp.tag === "line") {
        const x1 = Number(a.x1) + offX, y1 = Number(a.y1) + offY, x2 = Number(a.x2) + offX, y2 = Number(a.y2) + offY;
        doFillStroke(() => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }, hypot2(x2 - x1, y2 - y1));
      } else if (sp.closedPts) {
        const pts = sp.closedPts;
        doFillStroke((mode) => {
          ctx.beginPath();
          ctx.moveTo(pts[0] + offX, pts[1] + offY);
          for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + offX, pts[i + 1] + offY);
          ctx.closePath();
          if (mode === "fill") ctx.fill(); else ctx.stroke();
        }, 0);
      } else if (sp.segs) {
        const segs = sp.segs;
        doFillStroke(() => {
          ctx.beginPath();
          for (let i = 0; i + 3 < segs.length; i += 4) {
            ctx.moveTo(segs[i] + offX, segs[i + 1] + offY);
            ctx.lineTo(segs[i + 2] + offX, segs[i + 3] + offY);
          }
          ctx.stroke();
        }, 0);
      } else if (sp.qsegs) {
        const q = sp.qsegs;
        doFillStroke(() => {
          ctx.beginPath();
          for (let i = 0; i + 5 < q.length; i += 6) {
            ctx.moveTo(q[i] + offX, q[i + 1] + offY);
            if (hasQuad) ctx.quadraticCurveTo(q[i + 2] + offX, q[i + 3] + offY, q[i + 4] + offX, q[i + 5] + offY);
            else ctx.lineTo(q[i + 4] + offX, q[i + 5] + offY);
          }
          ctx.stroke();
        }, 0);
      } else if (sp.qloop) {
        const q = sp.qloop;
        doFillStroke((mode) => {
          ctx.beginPath();
          ctx.moveTo(q[0] + offX, q[1] + offY);
          for (let i = 0; i + 5 < q.length; i += 6) {
            if (hasQuad) ctx.quadraticCurveTo(q[i + 2] + offX, q[i + 3] + offY, q[i + 4] + offX, q[i + 5] + offY);
            else ctx.lineTo(q[i + 4] + offX, q[i + 5] + offY);
          }
          ctx.closePath();
          if (mode === "fill") ctx.fill(); else ctx.stroke();
        }, 0);
      } else if (sp.smoothPoly) {
        const flat = sp.smoothPoly;
        const nPts = flat.length >> 1;
        if (nPts >= 3) {
          doFillStroke((mode) => {
            ctx.beginPath();
            const p0x = flat[0] + offX, p0y = flat[1] + offY;
            const p1x = flat[2] + offX, p1y = flat[3] + offY;
            if (hasQuad) {
              ctx.moveTo((p0x + p1x) * 0.5, (p0y + p1y) * 0.5);
              for (let i = 2; i < flat.length; i += 2) {
                const cxp = flat[i] + offX, cyp = flat[i + 1] + offY;
                const ni = i + 2 < flat.length ? i + 2 : 0;
                const nxp = flat[ni] + offX, nyp = flat[ni + 1] + offY;
                ctx.quadraticCurveTo(cxp, cyp, (cxp + nxp) * 0.5, (cyp + nyp) * 0.5);
              }
            } else {
              ctx.moveTo(p0x, p0y);
              for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i] + offX, flat[i + 1] + offY);
            }
            ctx.closePath();
            if (mode === "fill") ctx.fill(); else ctx.stroke();
          }, 0);
        }
      } else if (sp.tag === "polyline" || sp.tag === "polygon" || sp.__nums) {
        if (!sp.__nums) {
          const parsed = String(a.points || "").trim().split(/[\s,]+/).map(Number);
          sp.__nums = new Float64Array(parsed);
        }
        if (sp.__perim < 0 && a.pathLength === "1") {
          let p = 0;
          for (let i = 2; i + 1 < sp.__nums.length; i += 2) {
            p += hypot2(sp.__nums[i] - sp.__nums[i - 2], sp.__nums[i + 1] - sp.__nums[i - 1]);
          }
          sp.__perim = p;
        }
        const nums = sp.__nums;
        const isClosed = sp.tag === "polygon";
        doFillStroke((mode) => {
          ctx.beginPath();
          if (nums.length >= 2) {
            ctx.moveTo(nums[0] + offX, nums[1] + offY);
            for (let i = 2; i + 1 < nums.length; i += 2) ctx.lineTo(nums[i] + offX, nums[i + 1] + offY);
          }
          if (isClosed) ctx.closePath();
          if (mode === "fill") ctx.fill(); else ctx.stroke();
        }, sp.__perim > 0 ? sp.__perim : 0);
      } else if (sp.tag === "path" && a.d) {
        if (typeof Path2D !== "undefined" && offX === 0 && offY === 0) {
          const p2 = sp.__path2d || (sp.__path2d = new Path2D(a.d));
          doFillStroke((mode) => {
            if (mode === "fill") ctx.fill(p2); else ctx.stroke(p2);
          }, 0);
        } else {
          const subs = sampleSvgSubpaths(a.d, 8);
          if (subs) {
            doFillStroke((mode) => {
              ctx.beginPath();
              for (let s = 0; s < subs.length; s++) {
                const sub = subs[s];
                for (let i = 0; i < sub.length; i++) {
                  if (i === 0) ctx.moveTo(sub[i][0] + offX, sub[i][1] + offY);
                  else ctx.lineTo(sub[i][0] + offX, sub[i][1] + offY);
                }
              }
              if (mode === "fill") ctx.fill(); else ctx.stroke();
            }, 0);
          }
        }
      }

      if (usedDash) {
        ctx.setLineDash(EMPTY_DASH);
        if ("lineDashOffset" in ctx) ctx.lineDashOffset = 0;
      }
      if (prevBlend !== null) ctx.globalCompositeOperation = prevBlend;
      if (prevSmooth !== null) ctx.imageSmoothingEnabled = prevSmooth;
      if (prevCap !== null) ctx.lineCap = prevCap;
      if (prevJoin !== null) ctx.lineJoin = prevJoin;
    }
    ctx.globalAlpha = prevAlpha;
  }

  function emitCanvas(geomKey, rawOp, _className, buildUnitFn) {
    const alpha = clamp(rawOp ?? 1, 0, 1);
    if (alpha < 0.002) return;
    drawUnitSpecs(getCachedUnitSpecs(geomKey, buildUnitFn), alpha, 0, 0);
  }

  function emitStampCanvas(stampKey, alpha, buildStampFn, offX, offY) {
    drawUnitSpecs(getCachedStampSpecs(stampKey, buildStampFn), alpha, offX, offY);
  }

  function frame(_unusedContainer = null, overrides = grammarOverrides) {
    return beginFrame(overrides);
  }

  const G = () => cachedG;
  return attachMarkMethods({ grammar: G, beginFrame, frame, syncGrammar }, G, emitCanvas, emitStampCanvas);
}

/**
 * Mount a responsive HiDPI <canvas> diagram with pre-bound semantic `state.marks` and `state.G`.
 */
export function mountMarkedDiagram(canvas, spec, grammarOverrides = null) {
  let marks = null;
  return mountDiagram(canvas, {
    ...spec,
    draw(ctx, W, H, state) {
      if (!marks) marks = createCanvasMarks(ctx, canvas, grammarOverrides);
      const G = marks.beginFrame(grammarOverrides);
      spec.draw(ctx, W, H, { ...state, marks, G });
    },
  });
}

/**
 * Mount an animated or static <svg> stage with the exact same zero-boilerplate lifecycle
 * as `mountMarkedDiagram`: auto-manages `m.frame(sceneGroup)`, `IntersectionObserver`
 * off-screen pause, `prefers-reduced-motion`, `[data-diagram-toggle]`, pointer coordinates
 * in SVG `viewBox` space, and live `chao-theme-change` updates.
 *
 * spec: {
 *   viewBox?: [W, H] | [x, y, W, H], // defaults to svgEl viewBox or width/height
 *   cycle?: number,                  // loop period in seconds (0 or omit for static)
 *   reduceAt?: number,               // static timestamp under prefers-reduced-motion
 *   container?: Element,             // optional <g> layer to clear/draw into (auto-created if omitted)
 *   draw: (marks, W, H, state) => void
 * }
 */
export function mountMarkedSvg(svgEl, spec, grammarOverrides = null) {
  const doc = svgEl.ownerDocument;
  const host = spec.host || svgEl;
  const vbAttr = svgEl.getAttribute && svgEl.getAttribute("viewBox");
  let vbX = 0, vbY = 0, W = 600, H = 360;
  if (Array.isArray(spec.viewBox)) {
    if (spec.viewBox.length >= 4) { [vbX, vbY, W, H] = spec.viewBox; }
    else if (spec.viewBox.length >= 2) { [W, H] = spec.viewBox; }
  } else if (vbAttr) {
    const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) [vbX, vbY, W, H] = parts;
  } else {
    W = Number(svgEl.getAttribute?.("width")) || 600;
    H = Number(svgEl.getAttribute?.("height")) || 360;
  }

  let sceneGroup = spec.container || null;
  if (!sceneGroup) {
    sceneGroup = doc.createElementNS(SVG_NS, "g");
    sceneGroup.setAttribute("data-pf-scene", "1");
    svgEl.appendChild(sceneGroup);
  }

  const marks = createSvgMarks(svgEl, host, grammarOverrides);
  const cycle = spec.cycle || 0;
  const hasWindow = typeof window !== "undefined";
  const reducedMotion = () =>
    Boolean(hasWindow && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  let inView = !hasWindow || typeof IntersectionObserver === "undefined";
  let paused = reducedMotion();
  let rafId = 0;
  let elapsedMs = paused && cycle > 0 ? (spec.reduceAt ?? cycle * 0.95) * 1000 : 0;
  let lastNow = null;
  const pointer = { x: vbX + W * 0.5, y: vbY + H * 0.5, normX: 0.5, normY: 0.5, active: false };

  function renderOnce() {
    const G = marks.frame(sceneGroup, grammarOverrides);
    const t = cycle > 0 ? (elapsedMs / 1000) % cycle : elapsedMs / 1000;
    spec.draw(marks, W, H, { t, elapsedMs, cycle, paused, pointer, P: G.P, G, marks, sceneGroup });
  }

  function tick(now) {
    rafId = 0;
    if (!inView) { lastNow = null; return; }
    if (!paused && cycle > 0) {
      if (lastNow !== null) elapsedMs += Math.min(100, Math.max(0, now - lastNow));
      lastNow = now;
    } else {
      lastNow = null;
    }
    renderOnce();
    if (!paused && cycle > 0 && inView && hasWindow) {
      rafId = window.requestAnimationFrame(tick);
    }
  }

  function schedule() {
    if (!hasWindow) { renderOnce(); return; }
    if (!rafId) rafId = window.requestAnimationFrame(tick);
  }

  if (!hasWindow) {
    renderOnce();
    return { redraw: renderOnce, marks, destroy() {} };
  }

  const io = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          inView = e.isIntersecting;
          if (inView) schedule();
          else if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; lastNow = null; }
        }
      }, { threshold: 0.05 })
    : null;
  if (io) io.observe(svgEl);

  const onMove = (ev) => {
    if (!svgEl.getBoundingClientRect) return;
    const r = svgEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    pointer.normX = clamp((ev.clientX - r.left) / r.width, 0, 1);
    pointer.normY = clamp((ev.clientY - r.top) / r.height, 0, 1);
    pointer.x = vbX + pointer.normX * W;
    pointer.y = vbY + pointer.normY * H;
    pointer.active = true;
    if (paused || cycle === 0) renderOnce();
  };
  const onLeave = () => {
    pointer.active = false;
    if (paused || cycle === 0) renderOnce();
  };
  const onTheme = () => renderOnce();

  svgEl.addEventListener?.("pointermove", onMove);
  svgEl.addEventListener?.("pointerleave", onLeave);
  window.addEventListener("chao-theme-change", onTheme);

  const fig = svgEl.closest?.("figure");
  const btn = fig && fig.querySelector?.("[data-diagram-toggle]");
  const syncBtn = () => {
    if (!btn) return;
    btn.textContent = paused ? "▶ Play" : "❚❚ Pause";
    btn.setAttribute("aria-pressed", String(paused));
  };
  const onToggle = () => {
    paused = !paused;
    lastNow = null;
    syncBtn();
    if (!paused) schedule(); else renderOnce();
  };
  if (btn) { syncBtn(); btn.addEventListener("click", onToggle); }

  if (inView) schedule(); else renderOnce();

  return {
    redraw: renderOnce,
    marks,
    setTime(sec) { elapsedMs = Math.max(0, sec * 1000); renderOnce(); },
    destroy() {
      if (rafId) window.cancelAnimationFrame(rafId);
      if (io) io.disconnect();
      svgEl.removeEventListener?.("pointermove", onMove);
      svgEl.removeEventListener?.("pointerleave", onLeave);
      window.removeEventListener("chao-theme-change", onTheme);
      if (btn) btn.removeEventListener("click", onToggle);
    },
  };
}
