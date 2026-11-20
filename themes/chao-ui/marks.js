/* ==========================================================================
   Chao-UI Semantic Mark & Material Kit (marks.js)
   Bridges chao-ui's semantic roles + CSS tokens (--pf-vis-*, --pf-mark-*) with
   deterministic procedural geometry from Rough.js and perfect-freehand.

   Works identically across:
   1. Programmatic & 60fps animated <svg> stages  -> createSvgMarks(svg, host)
   2. Declarative inline <svg> figures            -> hydrateSvgMarks(svg, host)
   3. HTML5 <canvas> analytical figures           -> createCanvasMarks(ctx, host)
   ========================================================================== */

import rough from "./vendor/roughjs/rough.esm.js";
import { getStroke } from "./vendor/perfect-freehand/index.mjs";
import { clamp, lerp, mixRgb, palette, parseRgb, rgba } from "./diagrams.js";

export { palette, parseRgb, rgba };

const SVG_NS = "http://www.w3.org/2000/svg";
const roughGen = rough.generator();

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
  "song-scroll":  { node: "dab",     fill: "wash",       stroke: "gpen",   arrow: "flick",    panel: "inlay",     roughness: 0.14, gap: 7.2, multiply: true,  scanAngle: -42 },
  qinglu:         { node: "shippo",  fill: "wash",       stroke: "brush",  arrow: "flick",    panel: "inlay",     roughness: 0.18, gap: 6.8, multiply: false, scanAngle: -45 },
  // II. Japanese Wagara & Craft
  washi:          { node: "dab",     fill: "wash",       stroke: "gpen",   arrow: "flick",    panel: "scroll",    roughness: 0.18, gap: 7.5, multiply: true,  scanAngle: -40 },
  shippo:         { node: "shippo",  fill: "weave",      stroke: "crisp",  arrow: "barb",     panel: "inlay",     roughness: 0,    gap: 7.5, multiply: true,  scanAngle: -45 },
  kikko:          { node: "diamond", fill: "weave",      stroke: "crisp",  arrow: "barb",     panel: "inlay",     roughness: 0,    gap: 7.6, multiply: true,  scanAngle: -60 },
  yagasuri:       { node: "diamond", fill: "weave",      stroke: "crisp",  arrow: "vee",      panel: "inlay",     roughness: 0,    gap: 6.4, multiply: true,  scanAngle: -52 },
  edo:            { node: "nib",     fill: "hachure",    stroke: "gpen",   arrow: "barb",     panel: "inlay",     roughness: 0.22, gap: 7,   multiply: true,  scanAngle: -42 },
  hanami:         { node: "shippo",  fill: "wash",       stroke: "crisp",  arrow: "flick",    panel: "scroll",    roughness: 0.10, gap: 7.5, multiply: true,  scanAngle: -60 },
  "wabi-sabi":    { node: "dab",     fill: "stipple",    stroke: "brush",  arrow: "flick",    panel: "stone",     roughness: 0.42, gap: 8.5, multiply: true,  scanAngle: -32 },
  "ukiyo-e":      { node: "nib",     fill: "wash",       stroke: "gpen",   arrow: "barb",     panel: "inlay",     roughness: 0.24, gap: 6.8, multiply: true,  scanAngle: -40 },
  urushi:         { node: "shippo",  fill: "stipple",    stroke: "gpen",   arrow: "flick",    panel: "inlay",     roughness: 0.15, gap: 7.4, multiply: false, scanAngle: -45 },
  // III. Wood Mosaic, Kumiko & Mosque Tilework
  yosegi:         { node: "diamond", fill: "weave",      stroke: "crisp",  arrow: "vee",      panel: "inlay",     roughness: 0,    gap: 6.6, multiply: true,  scanAngle: -45 },
  kumiko:         { node: "star8",   fill: "weave",      stroke: "crisp",  arrow: "vee",      panel: "inlay",     roughness: 0,    gap: 7.2, multiply: true,  scanAngle: -60 },
  zellij:         { node: "star8",   fill: "weave",      stroke: "crisp",  arrow: "barb",     panel: "inlay",     roughness: 0,    gap: 6.8, multiply: true,  scanAngle: -45 },
  isfahan:        { node: "star8",   fill: "weave",      stroke: "gpen",   arrow: "barb",     panel: "inlay",     roughness: 0.10, gap: 7.2, multiply: false, scanAngle: -60 },
  // IV. Pelican 6000 · Art History
  sahara:         { node: "chisel",  fill: "stipple",    stroke: "chisel", arrow: "chisel",   panel: "stone",     roughness: 0.65, gap: 8.2, multiply: true,  scanAngle: -34 },
  egypt:          { node: "diamond", fill: "hachure",    stroke: "gpen",   arrow: "barb",     panel: "inlay",     roughness: 0.20, gap: 7.2, multiply: true,  scanAngle: -45 },
  maya:           { node: "chisel",  fill: "hachure",    stroke: "chisel", arrow: "chisel",   panel: "stone",     roughness: 0.48, gap: 7.0, multiply: true,  scanAngle: -40 },
  mughal:         { node: "star8",   fill: "weave",      stroke: "gpen",   arrow: "barb",     panel: "inlay",     roughness: 0.12, gap: 7,   multiply: true,  scanAngle: -45 },
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
  const isDark = (bgRgb[0] * 0.299 + bgRgb[1] * 0.587 + bgRgb[2] * 0.114) < 115;

  return {
    scheme: scheme || "default",
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
    multiply: overrides && overrides.multiply != null ? Boolean(overrides.multiply) : Boolean(base.multiply && !isDark),
    scanAngle,
    P,
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
  if (!col || col === "none" || col.startsWith("url(")) return fb;
  const [r, g, b] = parseRgb(col, [fb, fb, fb]);
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function colorDist(c1, c2) {
  const a = parseRgb(c1, [128, 128, 128]);
  const b = parseRgb(c2, [128, 128, 128]);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Convert a perfect-freehand polygon outline into a smooth quadratic SVG path.
 */
export function strokeOutlineToSvgPath(points, closed = true) {
  const len = points.length;
  if (len < 3) return "";
  const f = (n) => n.toFixed(2);
  let d = `M ${f(points[0][0])} ${f(points[0][1])} Q ${f(points[1][0])} ${f(points[1][1])} ${f((points[1][0] + points[2][0]) / 2)} ${f((points[1][1] + points[2][1]) / 2)}`;
  for (let i = 2; i < len - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    d += ` T ${f((p0[0] + p1[0]) / 2)} ${f((p0[1] + p1[1]) / 2)}`;
  }
  if (closed) {
    const last = points[len - 1];
    const first = points[0];
    d += ` T ${f((last[0] + first[0]) / 2)} ${f((last[1] + first[1]) / 2)} Z`;
  }
  return d;
}

function slicePolyline(pts, progress) {
  const p = clamp(progress ?? 1, 0, 1);
  if (p >= 0.999 || pts.length < 2) return pts;
  if (p <= 0.001) return [];
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segs.push(L);
    total += L;
  }
  if (total < 1e-6) return [pts[0]];
  let budget = total * p;
  const out = [pts[0]];
  for (let i = 0; i < segs.length; i++) {
    if (budget >= segs[i]) {
      out.push(pts[i + 1]);
      budget -= segs[i];
    } else {
      if (budget > 1e-4 && segs[i] > 1e-6) {
        const u = budget / segs[i];
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
    total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  if (total <= setback * 1.35) return pts;
  let rem = setback;
  const copy = pts.slice();
  while (copy.length >= 2 && rem > 1e-4) {
    const n = copy.length;
    const [x0, y0] = copy[n - 2];
    const [x1, y1] = copy[n - 1];
    const segLen = Math.hypot(x1 - x0, y1 - y0);
    if (segLen <= rem + 1e-6 && copy.length > 2) {
      rem -= segLen;
      copy.pop();
    } else if (segLen > 1e-6) {
      const u = clamp(1 - rem / segLen, 0.05, 1);
      copy[n - 1] = [lerp(x0, x1, u), lerp(y0, y1, u)];
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

/**
 * Sample all subpaths of an SVG path `d` into an array of polylines.
 * Supports absolute & relative M, L, H, V, C, S, Q, T, A, Z commands and packed decimals.
 */
export function sampleSvgSubpaths(d, samplesPerCurve = 12) {
  const tokens = String(d || "").match(/([A-Za-z])|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  if (!tokens || tokens.length < 3) return null;
  const needMap = {
    M: 2, m: 2, L: 2, l: 2, H: 1, h: 1, V: 1, v: 1,
    C: 6, c: 6, S: 4, s: 4, Q: 4, q: 4, T: 2, t: 2,
    A: 7, a: 7, Z: 0, z: 0,
  };

  const subpaths = [];
  let cur = null;
  let idx = 0;
  let cmd = "";
  let prevCmd = "";
  let cx = 0, cy = 0;
  let sx = 0, sy = 0;
  let lastCx = 0, lastCy = 0;

  while (idx < tokens.length) {
    const tk = tokens[idx];
    if (/^[A-Za-z]$/.test(tk)) {
      if (!(tk in needMap)) return null;
      cmd = tk;
      idx++;
      if (cmd === "Z" || cmd === "z") {
        if (cur && cur.length) {
          if (Math.hypot(cx - sx, cy - sy) > 1e-5) cur.push([sx, sy]);
          cx = sx;
          cy = sy;
        }
        prevCmd = cmd;
        continue;
      }
    }
    const need = needMap[cmd];
    if (need == null || idx + need > tokens.length) return null;
    const a = [];
    for (let k = 0; k < need; k++) {
      const v = Number(tokens[idx + k]);
      if (!Number.isFinite(v)) return null;
      a.push(v);
    }
    idx += need;
    const rel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();

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
        for (const p of arcPts) cur.push(p);
        cx = x2; cy = y2;
      }
    }
    prevCmd = upper;
  }
  const valid = subpaths.filter((sp) => sp.length >= 2);
  return valid.length ? valid : null;
}

/**
 * Sample a single-subpath SVG `d` string into a polyline.
 * Returns null if `d` is empty, malformed, or contains multiple subpaths.
 */
export function sampleSimpleSvgPath(d, samplesPerCurve = 12) {
  const subs = sampleSvgSubpaths(d, samplesPerCurve);
  return subs && subs.length === 1 ? subs[0] : null;
}

function polylineAnchorSeed(prefix, ptsOrPath, explicitSeed) {
  if (explicitSeed != null) return explicitSeed;
  const subs = typeof ptsOrPath === "string" ? sampleSvgSubpaths(ptsOrPath, 4) : (Array.isArray(ptsOrPath) ? [ptsOrPath] : null);
  const pts = subs && subs[0];
  if (!pts || pts.length === 0) return fnv1aSeed(`${prefix}:${String(ptsOrPath || "")}`);
  const [x0, y0] = pts[0];
  let angQ = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - x0;
    const dy = pts[i][1] - y0;
    if (Math.hypot(dx, dy) > 0.5) {
      angQ = Math.round(Math.atan2(dy, dx) * 32);
      break;
    }
  }
  return fnv1aSeed(`${prefix}:${Math.round(x0)}:${Math.round(y0)}:${angQ}:${subs.length}`);
}

function polygonBounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

function regularStarPath(cx, cy, outerR, innerR, points, rotRad = 0) {
  const total = points * 2;
  const parts = [];
  for (let i = 0; i < total; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = rotRad + (i * Math.PI) / points;
    parts.push(`${i === 0 ? "M" : "L"} ${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

function shippoFloretPath(cx, cy, r, lobes = 4) {
  const parts = [];
  for (let i = 0; i < lobes; i++) {
    const a0 = (i * 2 * Math.PI) / lobes - Math.PI / 4;
    const a1 = ((i + 1) * 2 * Math.PI) / lobes - Math.PI / 4;
    const am = (a0 + a1) / 2;
    const valleyR = lobes === 4 ? r * 0.62 : r * 0.86;
    const peakR = lobes === 4 ? r * 1.28 : r * 1.08;
    const x0 = cx + Math.cos(a0) * valleyR;
    const y0 = cy + Math.sin(a0) * valleyR;
    const xm = cx + Math.cos(am) * peakR;
    const ym = cy + Math.sin(am) * peakR;
    const x1 = cx + Math.cos(a1) * valleyR;
    const y1 = cy + Math.sin(a1) * valleyR;
    if (i === 0) parts.push(`M ${x0.toFixed(2)} ${y0.toFixed(2)}`);
    parts.push(`Q ${xm.toFixed(2)} ${ym.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

function chiseledNodePath(cx, cy, r, seed) {
  const rand = seededRand(seed);
  const facets = r >= 18 ? 14 : 10;
  const rot = rand() * Math.PI * 2;
  const parts = [];
  for (let i = 0; i < facets; i++) {
    const a = rot + (i * 2 * Math.PI) / facets + (rand() - 0.5) * 0.14;
    const rf = r * (0.94 + (rand() - 0.5) * 0.16);
    parts.push(`${i === 0 ? "M" : "L"} ${(cx + Math.cos(a) * rf).toFixed(2)} ${(cy + Math.sin(a) * rf).toFixed(2)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

// ============================================================================
// Pure Semantic Primitive Geometry Builders
// ============================================================================

/**
 * 1. Semantic Node / Vertex / Dot (`dot`)
 */
export function buildDotSpec(cx, cy, r, G, opts = {}) {
  if (!(r > 0)) return [];
  const seed = hashSeed(opts.seed ?? 1);
  const op = clamp(opts.opacity ?? 1, 0, 1);
  if (op < 0.002) return [];
  const roleCol = resolveRoleColor(G, opts.role || "primary");
  const fill = opts.fill !== undefined ? opts.fill : (opts.hollow ? G.P.bg : roleCol);
  const stroke = opts.stroke !== undefined ? opts.stroke : (opts.hollow ? roleCol : "none");
  const sw = Number(opts.strokeWidth ?? (stroke !== "none" ? 1.6 : 0));
  const isPaperFill = fill !== "none" && colorDist(fill, G.P.bg) < 28;
  const isHollow = Boolean(opts.hollow || fill === "none" || isPaperFill);
  const keepOpenInterior = Boolean(opts.labelInside || r >= 24);

  // Tiny micro-dots (keyholes, punctuation dots) stay crisp circles
  if (r <= 3.1 || G.node === "circle") {
    const a = { cx: cx.toFixed(2), cy: cy.toFixed(2), r: r.toFixed(2), fill };
    if (stroke && stroke !== "none" && sw > 0) {
      a.stroke = stroke;
      a["stroke-width"] = sw.toFixed(2);
    }
    if (op < 0.999) a.opacity = op.toFixed(3);
    return [{ tag: "circle", attrs: a }];
  }

  const out = [];
  const addCommon = (attrs, fCol = fill, sCol = stroke, sWidth = sw) => {
    attrs.fill = fCol;
    if (sCol && sCol !== "none" && sWidth > 0) {
      attrs.stroke = sCol;
      attrs["stroke-width"] = sWidth.toFixed(2);
    }
    if (op < 0.999) attrs.opacity = op.toFixed(3);
    return attrs;
  };

  if (G.node === "dab") {
    const rand = seededRand(seed);
    const ang = -0.48 + (rand() - 0.5) * 0.36;
    const hasExplicitRim = Boolean(stroke && stroke !== "none" && sw > 0);
    if (!isHollow && !hasExplicitRim && r < 22) {
      // Plump calligraphic ten (点) ink drop: rounded brush belly + subtle harai tip
      const c = Math.cos(ang), s = Math.sin(ang);
      const rot = (lx, ly) => `${(cx + lx * c - ly * s).toFixed(2)} ${(cy + lx * s + ly * c).toFixed(2)}`;
      const tip = keepOpenInterior || r >= 11 ? 1.08 : 1.22;
      const belly = keepOpenInterior || r >= 11 ? 1.02 : 0.96;
      const heel = keepOpenInterior || r >= 11 ? 1.00 : 0.90;
      const d = [
        `M ${rot(-r * heel, 0)}`,
        `C ${rot(-r * heel, -r * belly * 0.95)}, ${rot(r * 0.25, -r * belly * 1.04)}, ${rot(r * tip, -r * 0.06)}`,
        `Q ${rot(r * (tip + 0.08), r * 0.04)} ${rot(r * (tip - 0.08), r * 0.16)}`,
        `C ${rot(r * 0.22, r * belly * 1.02)}, ${rot(-r * heel, r * belly * 0.92)}, ${rot(-r * heel, 0)}`,
        "Z",
      ].join(" ");
      out.push({ tag: "path", attrs: addCommon({ d }, fill, stroke, sw) });
      return out;
    }
    // Ensō (円相) calligraphic brush ring over paper/wash ground
    if (fill && fill !== "none") {
      out.push({ tag: "circle", attrs: addCommon({ cx: cx.toFixed(2), cy: cy.toFixed(2), r: (r * 0.95).toFixed(2) }, fill, "none", 0) });
    }
    const ringCol = hasExplicitRim ? stroke : fill;
    const steps = 20;
    const startA = ang;
    const arcPts = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const a = startA + u * Math.PI * 1.98;
      const rr = r * (1 + 0.025 * Math.sin(u * Math.PI * 3));
      const p = 0.42 + 0.46 * Math.sin(Math.min(1, u * 1.1) * Math.PI * 0.88);
      arcPts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, p]);
    }
    const ringOutline = getStroke(arcPts, {
      size: Math.max(2.0, (sw || 1.8) * 1.42),
      thinning: 0.44,
      smoothing: 0.45,
      streamline: 0.3,
      simulatePressure: false,
      start: { taper: Math.min(6, r * 0.28), cap: true },
      end: { taper: Math.min(9, r * 0.45), cap: true },
    });
    const rd = strokeOutlineToSvgPath(ringOutline, true);
    if (rd) out.push({ tag: "path", attrs: addCommon({ d: rd }, ringCol, "none", 0) });
    return out;
  }

  if (G.node === "nib") {
    const swBoost = sw > 0 ? sw * 1.28 : 0;
    if (!isHollow && G.scheme === "manga" && r >= 4.5 && r < 22) {
      out.push({ tag: "circle", attrs: addCommon({ cx: cx.toFixed(2), cy: cy.toFixed(2), r: (r + 1.5).toFixed(2) }, G.P.bg, "none", 0) });
    }
    out.push({ tag: "circle", attrs: addCommon({ cx: cx.toFixed(2), cy: cy.toFixed(2), r: r.toFixed(2) }, fill, stroke, swBoost) });
    return out;
  }

  if (G.node === "chisel") {
    const d = chiseledNodePath(cx, cy, r * 1.05, seed);
    out.push({ tag: "path", attrs: addCommon({ d }, fill, stroke, sw > 0 ? sw * 1.12 : 0) });
    return out;
  }

  if (G.node === "star8") {
    const d = keepOpenInterior
      ? regularStarPath(cx, cy, r * 1.05, r * 0.90, r >= 24 ? 16 : 8, Math.PI / 16)
      : regularStarPath(cx, cy, r * 1.18, r * 0.66, 8, -Math.PI / 8);
    out.push({ tag: "path", attrs: addCommon({ d }, fill, stroke, sw) });
    return out;
  }

  if (G.node === "diamond") {
    const d = keepOpenInterior
      ? regularStarPath(cx, cy, r * 1.04, r * 1.04, 4, Math.PI / 8)
      : `M ${cx.toFixed(2)} ${(cy - r * 1.18).toFixed(2)} L ${(cx + r * 1.18).toFixed(2)} ${cy.toFixed(2)} L ${cx.toFixed(2)} ${(cy + r * 1.18).toFixed(2)} L ${(cx - r * 1.18).toFixed(2)} ${cy.toFixed(2)} Z`;
    out.push({ tag: "path", attrs: addCommon({ d }, fill, stroke, sw) });
    return out;
  }

  if (G.node === "shippo") {
    const d = shippoFloretPath(cx, cy, r, keepOpenInterior ? 8 : 4);
    out.push({ tag: "path", attrs: addCommon({ d }, fill, stroke, sw) });
    return out;
  }

  if (G.node === "reticle") {
    const tickCol = stroke && stroke !== "none" ? stroke : fill;
    if (keepOpenInterior) {
      out.push({ tag: "circle", attrs: addCommon({ cx: cx.toFixed(2), cy: cy.toFixed(2), r: r.toFixed(2) }, fill, stroke, sw) });
      const tIn = r >= 24 ? r * 0.84 : r * 0.98;
      const tOut = r >= 24 ? r * 1.0 : r + 3.0;
      const td = `M ${cx.toFixed(2)} ${(cy - tOut).toFixed(2)} L ${cx.toFixed(2)} ${(cy - tIn).toFixed(2)} M ${cx.toFixed(2)} ${(cy + tIn).toFixed(2)} L ${cx.toFixed(2)} ${(cy + tOut).toFixed(2)} M ${(cx - tOut).toFixed(2)} ${cy.toFixed(2)} L ${(cx - tIn).toFixed(2)} ${cy.toFixed(2)} M ${(cx + tIn).toFixed(2)} ${cy.toFixed(2)} L ${(cx + tOut).toFixed(2)} ${cy.toFixed(2)}`;
      out.push({ tag: "path", attrs: addCommon({ d: td }, "none", tickCol, 1.35) });
    } else {
      out.push({ tag: "circle", attrs: addCommon({ cx: cx.toFixed(2), cy: cy.toFixed(2), r: (r * 0.78).toFixed(2) }, fill, stroke, sw) });
      const arm = Math.max(r * 1.48, r + 3.2);
      const gapR = r * 0.42;
      const td = `M ${(cx - arm).toFixed(2)} ${cy.toFixed(2)} L ${(cx - gapR).toFixed(2)} ${cy.toFixed(2)} M ${(cx + gapR).toFixed(2)} ${cy.toFixed(2)} L ${(cx + arm).toFixed(2)} ${cy.toFixed(2)} M ${cx.toFixed(2)} ${(cy - arm).toFixed(2)} L ${cx.toFixed(2)} ${(cy - gapR).toFixed(2)} M ${cx.toFixed(2)} ${(cy + gapR).toFixed(2)} L ${cx.toFixed(2)} ${(cy + arm).toFixed(2)}`;
      out.push({ tag: "path", attrs: addCommon({ d: td }, "none", tickCol, 1.25) });
    }
    return out;
  }

  if (G.node === "pixel") {
    const snap = (v) => Math.round(v / 2) * 2;
    if (keepOpenInterior) {
      const c = r * 0.38;
      const x0 = snap(cx - r), x1 = snap(cx + r), y0 = snap(cy - r), y1 = snap(cy + r), k = Math.max(2, snap(c));
      const d = `M ${x0 + k} ${y0} H ${x1 - k} L ${x1} ${y0 + k} V ${y1 - k} L ${x1 - k} ${y1} H ${x0 + k} L ${x0} ${y1 - k} V ${y0 + k} Z`;
      out.push({ tag: "path", attrs: addCommon({ d, "shape-rendering": "crispEdges" }, fill, stroke, sw > 0 ? Math.max(sw, 2) : 0) });
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

  return [{ tag: "circle", attrs: addCommon({ cx: cx.toFixed(2), cy: cy.toFixed(2), r: r.toFixed(2) }) }];
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
  const base = { fill: "none", stroke, "stroke-width": sw.toFixed(2) };
  if (opts.dash) base["stroke-dasharray"] = opts.dash;
  if (op < 0.999) base.opacity = op.toFixed(3);

  if (G.node === "diamond") {
    const d = `M ${cx.toFixed(2)} ${(cy - r * 1.1).toFixed(2)} L ${(cx + r * 1.1).toFixed(2)} ${cy.toFixed(2)} L ${cx.toFixed(2)} ${(cy + r * 1.1).toFixed(2)} L ${(cx - r * 1.1).toFixed(2)} ${cy.toFixed(2)} Z`;
    return [{ tag: "path", attrs: { ...base, d } }];
  }
  if (G.node === "pixel") {
    const s = Math.round(r * 2);
    return [{ tag: "rect", attrs: { ...base, x: Math.round(cx - r), y: Math.round(cy - r), width: s, height: s, "shape-rendering": "crispEdges" } }];
  }
  if (G.node === "chisel") {
    return [{ tag: "path", attrs: { ...base, d: chiseledNodePath(cx, cy, r, opts.seed ?? 7) } }];
  }
  return [{ tag: "circle", attrs: { ...base, cx: cx.toFixed(2), cy: cy.toFixed(2), r: r.toFixed(2) } }];
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
  const pt = (back, side) => `${(x - c * back - n * side).toFixed(2)} ${(y - n * back + c * side).toFixed(2)}`;

  const wrap = (attrs) => {
    if (op < 0.999) attrs.opacity = op.toFixed(3);
    return [{ tag: "path", attrs }];
  };

  if (G.arrow === "flick") {
    // Asymmetric calligraphic harai brush flick
    const d = `M ${(x + c * 0.6).toFixed(2)} ${(y + n * 0.6).toFixed(2)} Q ${pt(s * 0.45, s * 0.58)} ${pt(s * 1.18, s * 0.66)} L ${pt(s * 0.66, s * 0.06)} L ${pt(s * 0.92, -s * 0.46)} Q ${pt(s * 0.38, -s * 0.36)} ${(x + c * 0.6).toFixed(2)} ${(y + n * 0.6).toFixed(2)} Z`;
    return wrap({ d, fill: col });
  }
  if (G.arrow === "barb") {
    // Swept spear / manga / girih barb with notched heel
    const d = `M ${(x + c * 0.8).toFixed(2)} ${(y + n * 0.8).toFixed(2)} L ${pt(s * 1.12, s * 0.62)} L ${pt(s * 0.64, 0)} L ${pt(s * 1.12, -s * 0.62)} Z`;
    return wrap({ d, fill: col });
  }
  if (G.arrow === "vee") {
    // Crisp open technical chevron + inner stem connector so shaft always meets vertex cleanly
    const d = `M ${pt(s * 0.88, 0)} L ${x.toFixed(2)} ${y.toFixed(2)} M ${pt(s * 0.96, s * 0.56)} L ${x.toFixed(2)} ${y.toFixed(2)} L ${pt(s * 0.96, -s * 0.56)}`;
    return wrap({ d, fill: "none", stroke: col, "stroke-width": Math.max(1.75, s * 0.22).toFixed(2), "stroke-linecap": "round", "stroke-linejoin": "round" });
  }
  if (G.arrow === "chisel") {
    const d = `M ${x.toFixed(2)} ${y.toFixed(2)} L ${pt(s * 0.95, s * 0.68)} L ${pt(s * 1.12, s * 0.28)} L ${pt(s * 1.12, -s * 0.28)} L ${pt(s * 0.95, -s * 0.68)} Z`;
    return wrap({ d, fill: col });
  }
  if (G.arrow === "pixel") {
    const u = Math.max(2, Math.round(s / 3.4));
    const bx = Math.round(x), by = Math.round(y);
    const d = `M ${bx} ${by} L ${pt(u * 3, u * 2)} L ${pt(u * 3, -u * 2)} Z`;
    return wrap({ d, fill: col, "shape-rendering": "crispEdges" });
  }

  const w = s * 0.56;
  const d = `M ${x.toFixed(2)} ${y.toFixed(2)} L ${pt(s, w)} L ${pt(s, -w)} Z`;
  return wrap({ d, fill: col });
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

  const [tipX, tipY] = visPts[visPts.length - 1];
  let refX = visPts[0][0], refY = visPts[0][1];
  for (let i = visPts.length - 2; i >= 0; i--) {
    if (Math.hypot(tipX - visPts[i][0], tipY - visPts[i][1]) > 1e-3) {
      refX = visPts[i][0];
      refY = visPts[i][1];
      break;
    }
  }
  const segDist = Math.hypot(tipX - refX, tipY - refY);
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
 * profile's architectural joinery, scroll mounting, bevel, or panel frame.
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
  const seed = hashSeed(opts.seed ?? 11);
  const isCell = Boolean(opts.isCell || (w <= 56 && h <= 56 && Math.abs(w - h) < 1.2));
  const out = [];

  const hasFill = fill && fill !== "none" && fillP > 0.002;
  const hasStroke = stroke && stroke !== "none" && sw > 0 && progress > 0.002;
  const isSolidAccent = hasFill && luminance(fill) < 140 && !G.isDark;

  if (G.panel === "comic") {
    if (hasFill && hasStroke && !dashed && progress > 0.85 && (w >= 80 || isSolidAccent)) {
      const off = isCell ? 2 : 3.2;
      out.push({
        tag: "rect",
        attrs: { x: (x + off).toFixed(2), y: (y + off).toFixed(2), width: w.toFixed(2), height: h.toFixed(2), fill: G.P.fg, opacity: (op * 0.88).toFixed(3) },
      });
    }
    if (hasFill) {
      out.push({
        tag: "rect",
        attrs: { x: x.toFixed(2), y: y.toFixed(2), width: w.toFixed(2), height: h.toFixed(2), fill, "fill-opacity": (op * fillP).toFixed(3) },
      });
    }
    if (hasStroke) {
      const sa = { x: x.toFixed(2), y: y.toFixed(2), width: w.toFixed(2), height: h.toFixed(2), fill: "none", stroke, "stroke-width": (sw * 1.32).toFixed(2) };
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
    if (hasFill) {
      out.push({
        tag: "rect",
        attrs: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), fill, "fill-opacity": (op * fillP).toFixed(3), "shape-rendering": "crispEdges" },
      });
    }
    if (hasStroke) {
      if (dashed) {
        out.push({
          tag: "rect",
          attrs: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), fill: "none", stroke, "stroke-width": "1", "stroke-dasharray": dashed, opacity: op.toFixed(3), "shape-rendering": "crispEdges" },
        });
      } else {
        const baseRgb = parseRgb(hasFill ? fill : G.P.surface, G.isDark ? [26, 32, 44] : [224, 224, 224]);
        const hiCol = G.isDark ? rgba(mixRgb(baseRgb, [255, 255, 255], 0.34), 1) : "#ffffff";
        const loCol = G.isDark ? rgba(mixRgb(baseRgb, [0, 0, 0], 0.68), 1) : "#404040";
        const x0 = Math.round(x) + 0.5, y0 = Math.round(y) + 0.5, x1 = Math.round(x + w) - 0.5, y1 = Math.round(y + h) - 0.5;
        out.push({ tag: "path", attrs: { d: `M ${x0} ${y1} V ${y0} H ${x1}`, fill: "none", stroke: hiCol, "stroke-width": "1.4", opacity: op.toFixed(3), "shape-rendering": "crispEdges" } });
        out.push({ tag: "path", attrs: { d: `M ${x0} ${y1} H ${x1} V ${y0}`, fill: "none", stroke: loCol, "stroke-width": "1.5", opacity: op.toFixed(3), "shape-rendering": "crispEdges" } });
        if (w >= 28 && h >= 22) {
          out.push({ tag: "path", attrs: { d: `M ${x0 + 1.2} ${y1 - 1.2} H ${x1 - 1.2} V ${y0 + 1.2}`, fill: "none", stroke, "stroke-width": "1", opacity: (op * 0.85).toFixed(3), "shape-rendering": "crispEdges" } });
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
    if (hasFill) {
      out.push({ tag: "rect", attrs: { x: rx, y: ry, width: rw, height: rh, fill, "fill-opacity": (op * fillP).toFixed(3), "shape-rendering": "crispEdges" } });
    }
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
      const fa = { x: x.toFixed(2), y: y.toFixed(2), width: w.toFixed(2), height: h.toFixed(2), fill, "fill-opacity": (op * fillP * 0.85).toFixed(3) };
      if (G.multiply && !isSolidAccent) fa.style = "mix-blend-mode:multiply";
      out.push({ tag: "rect", attrs: fa });
    }
    if (hasStroke) {
      const ext = Math.min(5, w * 0.02);
      const wVis = w * progress;
      out.push({ tag: "line", attrs: { x1: (x - ext).toFixed(2), y1: y.toFixed(2), x2: (x + wVis + ext).toFixed(2), y2: y.toFixed(2), stroke, "stroke-width": (sw * 1.12).toFixed(2), opacity: op.toFixed(3) } });
      out.push({ tag: "line", attrs: { x1: (x - ext).toFixed(2), y1: (y + h).toFixed(2), x2: (x + wVis + ext).toFixed(2), y2: (y + h).toFixed(2), stroke, "stroke-width": (sw * 1.12).toFixed(2), opacity: op.toFixed(3) } });
      out.push({ tag: "line", attrs: { x1: x.toFixed(2), y1: y.toFixed(2), x2: x.toFixed(2), y2: (y + h * progress).toFixed(2), stroke, "stroke-width": (sw * 0.65).toFixed(2), opacity: (op * 0.52).toFixed(3) } });
      out.push({ tag: "line", attrs: { x1: (x + w).toFixed(2), y1: y.toFixed(2), x2: (x + w).toFixed(2), y2: (y + h * progress).toFixed(2), stroke, "stroke-width": (sw * 0.65).toFixed(2), opacity: (op * 0.52).toFixed(3) } });
    }
    return out;
  }

  if (G.panel === "inlay" && !isCell && !dashed && w >= 76 && h >= 36) {
    if (hasFill) {
      const fa = { x: x.toFixed(2), y: y.toFixed(2), width: w.toFixed(2), height: h.toFixed(2), fill, "fill-opacity": (op * fillP).toFixed(3) };
      if (G.multiply && !isSolidAccent) fa.style = "mix-blend-mode:multiply";
      out.push({ tag: "rect", attrs: fa });
    }
    if (hasStroke) {
      const sa = { x: x.toFixed(2), y: y.toFixed(2), width: w.toFixed(2), height: h.toFixed(2), fill: "none", stroke, "stroke-width": sw.toFixed(2) };
      if (progress < 0.999) { sa.pathLength = "1"; sa["stroke-dasharray"] = "1 1"; sa["stroke-dashoffset"] = (1 - progress).toFixed(4); }
      if (op < 0.999) sa.opacity = op.toFixed(3);
      out.push({ tag: "rect", attrs: sa });
      if (progress > 0.7) {
        const ins = 3.5;
        out.push({
          tag: "rect",
          attrs: { x: (x + ins).toFixed(2), y: (y + ins).toFixed(2), width: (w - ins * 2).toFixed(2), height: (h - ins * 2).toFixed(2), fill: "none", stroke, "stroke-width": Math.max(0.75, sw * 0.45).toFixed(2), opacity: (op * 0.55).toFixed(3) },
        });
      }
    }
    return out;
  }

  if (G.panel === "graticule" && !isCell && !dashed && w >= 64 && h >= 32) {
    if (hasFill) {
      out.push({ tag: "rect", attrs: { x: x.toFixed(2), y: y.toFixed(2), width: w.toFixed(2), height: h.toFixed(2), fill, "fill-opacity": (op * fillP).toFixed(3) } });
    }
    if (hasStroke) {
      out.push({ tag: "rect", attrs: { x: x.toFixed(2), y: y.toFixed(2), width: w.toFixed(2), height: h.toFixed(2), fill: "none", stroke, "stroke-width": (sw * 0.65).toFixed(2), opacity: (op * 0.42).toFixed(3) } });
      const b = Math.min(10, w * 0.12, h * 0.24);
      const x1 = x + w, y1 = y + h;
      const d = `M ${x.toFixed(2)} ${(y + b).toFixed(2)} V ${y.toFixed(2)} H ${(x + b).toFixed(2)} M ${(x1 - b).toFixed(2)} ${y.toFixed(2)} H ${x1.toFixed(2)} V ${(y + b).toFixed(2)} M ${x.toFixed(2)} ${(y1 - b).toFixed(2)} V ${y1.toFixed(2)} H ${(x + b).toFixed(2)} M ${(x1 - b).toFixed(2)} ${y1.toFixed(2)} H ${x1.toFixed(2)} V ${(y1 - b).toFixed(2)}`;
      out.push({ tag: "path", attrs: { d, fill: "none", stroke, "stroke-width": (sw * 1.25).toFixed(2), opacity: op.toFixed(3) } });
    }
    return out;
  }

  if (G.panel === "stone" && !dashed && w >= 12 && h >= 12) {
    if (hasFill) {
      out.push({ tag: "rect", attrs: { x: x.toFixed(2), y: y.toFixed(2), width: w.toFixed(2), height: h.toFixed(2), fill, "fill-opacity": (op * fillP).toFixed(3) } });
    }
    if (hasStroke) {
      const drawable = roughGen.rectangle(x, y, w, h, {
        stroke,
        strokeWidth: sw,
        roughness: clamp(G.roughness, 0.3, 0.7),
        bowing: 0.5,
        disableMultiStroke: true,
        seed,
      });
      for (const p of roughGen.toPaths(drawable)) {
        const pa = { d: p.d, fill: "none", stroke: p.stroke || stroke, "stroke-width": Number(p.strokeWidth || sw).toFixed(2) };
        if (progress < 0.999) {
          pa.pathLength = "1";
          pa["stroke-dasharray"] = "1 1";
          pa["stroke-dashoffset"] = (1 - progress).toFixed(4);
        }
        if (op < 0.999) pa.opacity = op.toFixed(3);
        out.push({ tag: "path", attrs: pa });
      }
    }
    return out;
  }

  // Default hairline / scroll cell / dashed panel
  if (hasFill) {
    const fa = { x: x.toFixed(2), y: y.toFixed(2), width: w.toFixed(2), height: h.toFixed(2), fill, "fill-opacity": (op * fillP).toFixed(3) };
    if (G.multiply && !isSolidAccent && colorDist(fill, G.P.bg) > 8) fa.style = "mix-blend-mode:multiply";
    out.push({ tag: "rect", attrs: fa });
  }
  if (hasStroke) {
    const sa = { x: x.toFixed(2), y: y.toFixed(2), width: w.toFixed(2), height: h.toFixed(2), fill: "none", stroke, "stroke-width": sw.toFixed(2) };
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
 * Materializes fills according to --pf-mark-fill using Rough.js hachures,
 * yunran washes, manga screentones, CRT scanlines, stipples, and 8-bit dithers.
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

  const ptsAttr = points.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
  const out = [];

  if (!fill || fill === "none" || fill.startsWith("url(")) {
    const a = { points: ptsAttr, fill: fill || "none" };
    if (stroke && stroke !== "none" && sw > 0) { a.stroke = stroke; a["stroke-width"] = sw.toFixed(2); }
    if (dashed) a["stroke-dasharray"] = dashed;
    if (op * fillP < 0.999) a.opacity = (op * fillP).toFixed(3);
    out.push({ tag: "polygon", attrs: a });
    return out;
  }

  // Classify semantic weight from fill contrast against paper background
  const distBg = colorDist(fill, G.P.bg);
  const distFg = colorDist(fill, G.P.fg);
  const isNearInk = (role === "ink" && distFg < 45) || (!G.isDark && luminance(fill) < 48 && distFg < 45);
  const weight = opts.weight || (isNearInk ? "solid" : distBg > 135 ? "strong" : distBg > 52 ? "medium" : "subtle");
  const fillRgb = parseRgb(fill, [128, 128, 128]);
  const isReddish = (fillRgb[0] - Math.max(fillRgb[1], fillRgb[2])) > 22;
  const isCaveat = role === "caveat" || (role !== "primary" && role !== "ink" && isReddish && colorDist(fill, G.P.terracotta) < colorDist(fill, G.P.slate));
  const inkLineCol = isCaveat
    ? G.P.terracotta
    : weight === "subtle"
      ? G.P.muted
      : distBg > 95
        ? fill
        : G.P.slate;

  // Fill Mode A: Crisp flat analytical tint (Swiss default)
  if (G.fill === "tint") {
    const a = { points: ptsAttr, fill };
    if (op * fillP < 0.999) a.opacity = (op * fillP).toFixed(3);
    out.push({ tag: "polygon", attrs: a });
  }
  // Fill Mode B: Graded Yunran (晕染) / Bokashi ink & mineral wash fading into paper breath
  else if (G.fill === "wash") {
    if (weight === "solid") {
      out.push({ tag: "polygon", attrs: { points: ptsAttr, fill, opacity: (op * fillP * 0.92).toFixed(3) } });
    } else {
      const washInk = isCaveat ? G.P.terracotta : weight === "subtle" ? G.P.muted : (distBg > 125 ? fill : G.P.slate);
      const darkScale = G.isDark ? 0.62 : 1.0;
      const topAlpha = (weight === "strong" ? 0.68 : weight === "medium" ? 0.36 : 0.20) * darkScale;
      const midAlpha = (weight === "strong" ? 0.38 : weight === "medium" ? 0.18 : 0.10) * darkScale;
      const botAlpha = (weight === "strong" ? 0.12 : 0.03) * darkScale;
      const effOp = weight === "strong" ? op * fillP : op * clamp(fillP * 1.35, 0, 1);
      const a = {
        points: ptsAttr,
        fill: washInk,
        opacity: effOp.toFixed(3),
      };
      if (G.multiply) a.style = "mix-blend-mode:multiply";
      out.push({ tag: "polygon", attrs: a, wash: { color: washInk, stops: [topAlpha, midAlpha, botAlpha], bounds } });
    }
  }
  // Fill Mode C: Manga 45-deg halftone screentone + slash hachure on caveats
  else if (G.fill === "screentone") {
    if (weight === "solid") {
      out.push({ tag: "polygon", attrs: { points: ptsAttr, fill: G.P.fg, opacity: (op * fillP).toFixed(3) } });
    } else if (isCaveat) {
      out.push({ tag: "polygon", attrs: { points: ptsAttr, fill: G.P.bg, opacity: (op * fillP).toFixed(3) } });
      const d = roughGen.polygon(points, {
        stroke: "none",
        fill: G.P.terracotta,
        fillStyle: "hachure",
        hachureAngle: 36,
        hachureGap: 5.5,
        fillWeight: 1.15,
        roughness: 0.12,
        disableMultiStroke: true,
        seed,
      });
      for (const p of roughGen.toPaths(d)) {
        if (p.stroke && p.stroke !== "none") {
          out.push({ tag: "path", attrs: { d: p.d, fill: "none", stroke: p.stroke, "stroke-width": Number(p.strokeWidth || 1.1).toFixed(2), opacity: (op * clamp(fillP * 1.25, 0, 1) * 0.85).toFixed(3) } });
        }
      }
    } else {
      const density = weight === "strong" ? 34 : weight === "medium" ? 22 : 12;
      out.push({
        tag: "polygon",
        attrs: {
          points: ptsAttr,
          fill,
          opacity: (op * clamp(fillP * 1.35, 0, 1)).toFixed(3),
        },
        pattern: { kind: "screentone", density, fg: G.P.fg, bg: G.P.bg },
      });
    }
  }
  // Fill Mode D: Pixel Bayer Dither (pixel-8bit, win2000) across strong/medium/subtle
  else if (G.fill === "dither") {
    if (weight === "solid") {
      out.push({ tag: "polygon", attrs: { points: ptsAttr, fill, opacity: (op * fillP).toFixed(3), "shape-rendering": "crispEdges" } });
    } else {
      const density = weight === "strong" ? 50 : weight === "medium" ? 25 : 12;
      const fgCol = isCaveat ? G.P.terracotta : distBg > 85 ? fill : G.P.slate;
      out.push({
        tag: "polygon",
        attrs: {
          points: ptsAttr,
          fill,
          opacity: (op * clamp(fillP * (weight === "strong" ? 1.0 : 1.25), 0, 1)).toFixed(3),
          "shape-rendering": "crispEdges",
        },
        pattern: { kind: "dither", density, fg: fgCol, bg: G.P.bg },
      });
    }
  }
  // Fill Mode E: Rough.js Procedural Fills — hachure, weave, stipple, scanline
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
    out.push({ tag: "polygon", attrs: baseAttrs });

    const area = bounds.w * bounds.h;
    if (area >= 48 && bounds.w >= 4 && bounds.h >= 4) {
      let fillStyle = "hachure";
      let angle = isCaveat ? -G.scanAngle : G.scanAngle;
      let gap = G.gap;
      let rgh = G.roughness;
      let fw = 0.95;
      let lineAlpha = 0.44;
      let lineCol = weight === "solid" ? G.P.bg : inkLineCol;

      let extraDash = "";
      if (G.fill === "weave") {
        fillStyle = weight === "strong" && area < 95000 ? "cross-hatch" : "hachure";
        rgh = 0;
        gap = weight === "subtle" ? G.gap * 1.45 : G.gap * 1.08;
        fw = 0.82;
        lineAlpha = weight === "subtle" ? 0.24 : 0.36;
      } else if (G.fill === "stipple") {
        fillStyle = "hachure";
        rgh = Math.max(0.38, G.roughness);
        gap = G.gap * 1.05;
        fw = 1.35;
        lineAlpha = weight === "subtle" ? 0.30 : 0.50;
        extraDash = "2.4 5.6";
      } else if (G.fill === "scanline") {
        fillStyle = "hachure";
        angle = isCaveat && G.scanAngle === 90 ? 62 : G.scanAngle;
        rgh = 0;
        gap = weight === "strong" || weight === "solid" ? 4.2 : G.gap;
        fw = weight === "solid" ? 1.35 : 0.92;
        lineCol = weight === "solid" ? fill : inkLineCol;
        lineAlpha = weight === "solid" ? 0.85 : weight === "strong" ? 0.62 : 0.42;
      } else {
        // hachure (woodblock, etching, blueprint, expressionist)
        gap = weight === "strong" ? G.gap * 0.85 : weight === "subtle" ? G.gap * 1.35 : G.gap;
        fw = weight === "strong" ? 1.1 : 0.9;
        lineAlpha = weight === "subtle" ? 0.26 : 0.46;
      }
      if (G.isDark && weight !== "solid") {
        lineAlpha = Math.min(0.84, lineAlpha * 1.25);
      }

      const drawable = roughGen.polygon(points, {
        stroke: "none",
        fill: lineCol,
        fillStyle,
        hachureAngle: angle,
        hachureGap: Math.max(3.8, gap),
        fillWeight: fw,
        roughness: rgh,
        disableMultiStroke: true,
        seed,
      });
      for (const p of roughGen.toPaths(drawable)) {
        if (p.stroke && p.stroke !== "none" && p.d) {
          const pa = {
            d: p.d,
            fill: "none",
            stroke: p.stroke,
            "stroke-width": Number(p.strokeWidth || fw).toFixed(2),
            opacity: (op * fillP * lineAlpha).toFixed(3),
          };
          if (extraDash) {
            pa["stroke-dasharray"] = extraDash;
            pa["stroke-linecap"] = "round";
          }
          out.push({ tag: "path", attrs: pa });
        }
      }
    }
  }

  // Optional region boundary stroke
  if (stroke && stroke !== "none" && sw > 0) {
    const closedPts = points.concat([points[0]]);
    out.push(...buildCurveSpec(closedPts, G, { stroke, strokeWidth: sw, dash: dashed, opacity: op, seed: seed + 3 }));
  }

  return out;
}

/**
 * 6. Semantic Curve / Trajectory / Connector / Segment (`curve`)
 * Uses perfect-freehand for calligraphic brush & G-pen ink modulation and
 * Rough.js for chiseled / stone-cut paths, while preserving dashed lines & draw-in.
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

  // Multi-subpath SVG string (e.g. curly braces / compound glyphs): materialize each subpath smoothly
  if (subpaths && subpaths.length > 1) {
    const lengths = subpaths.map((sp) => {
      let L = 0;
      for (let i = 0; i < sp.length - 1; i++) L += Math.hypot(sp[i + 1][0] - sp[i][0], sp[i + 1][1] - sp[i][1]);
      return L;
    });
    const total = lengths.reduce((a, b) => a + b, 0);
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

  // Dashed curves keep explicit stroke-dasharray so mathematical semantics stay exact
  if (dashed || (!rawPts && isStringPath)) {
    const attrs = { fill: "none", stroke, "stroke-width": sw.toFixed(2) };
    if (dashed) attrs["stroke-dasharray"] = dashed;
    else if (progress < 0.999) {
      attrs.pathLength = "1"; attrs["stroke-dasharray"] = "1 1"; attrs["stroke-dashoffset"] = (1 - progress).toFixed(4);
    }
    if (opts.lineCap) attrs["stroke-linecap"] = opts.lineCap;
    if (opts.lineJoin) attrs["stroke-linejoin"] = opts.lineJoin;
    if (G.stroke === "pixel") attrs["shape-rendering"] = "crispEdges";
    if (op < 0.999) attrs.opacity = op.toFixed(3);
    if (isStringPath) return [{ tag: "path", attrs: { d: pointsOrPath, ...attrs } }];
    if (!rawPts || rawPts.length < 2) return [];
    if (rawPts.length === 2) {
      return [{ tag: "line", attrs: { x1: rawPts[0][0].toFixed(2), y1: rawPts[0][1].toFixed(2), x2: rawPts[1][0].toFixed(2), y2: rawPts[1][1].toFixed(2), ...attrs } }];
    }
    return [{ tag: "polyline", attrs: { points: rawPts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" "), ...attrs } }];
  }

  const pts = slicePolyline(rawPts, progress);
  if (!pts || pts.length < 2) return [];

  let totalLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    totalLen += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  if (totalLen < 0.5) return [];

  // Calligraphic Brush or G-Pen (min 26px protects tiny '×' crosses, ticks & serifs)
  const minBrushLen = opts.forceBrush ? 8 : 26;
  if ((G.stroke === "brush" || G.stroke === "gpen") && totalLen >= minBrushLen && sw >= 1.35) {
    const isBrush = G.stroke === "brush";
    const dense = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const segLen = Math.hypot(x1 - x0, y1 - y0);
      const steps = segLen > 24 && pts.length <= 4 ? Math.min(8, Math.ceil(segLen / 22)) : 1;
      for (let s = 0; s < steps; s++) {
        const u = s / steps;
        dense.push([lerp(x0, x1, u), lerp(y0, y1, u)]);
      }
    }
    dense.push(pts[pts.length - 1]);

    const phase = (seed % 97) * 0.064;
    let acc = 0;
    const withPressure = dense.map((p, idx) => {
      if (idx > 0) acc += Math.hypot(p[0] - dense[idx - 1][0], p[1] - dense[idx - 1][1]);
      const u = clamp(acc / totalLen, 0, 1);
      const env = isBrush
        ? 0.36 + 0.50 * Math.sin(Math.pow(u, 0.82) * Math.PI) + 0.06 * Math.sin(u * 9 + phase)
        : 0.48 + 0.34 * Math.sin(u * Math.PI) + 0.03 * Math.cos(u * 7 + phase);
      return [p[0], p[1], clamp(env, 0.2, 0.95)];
    });

    const outline = getStroke(withPressure, {
      size: sw * (isBrush ? 1.44 : 1.26),
      thinning: isBrush ? 0.48 : 0.26,
      smoothing: pts.length <= 4 ? 0.24 : 0.50,
      streamline: pts.length <= 4 ? 0.14 : 0.34,
      simulatePressure: false,
      start: { taper: isBrush ? Math.min(8, totalLen * 0.12) : Math.min(4, totalLen * 0.07), cap: true },
      end: { taper: isBrush ? Math.min(11, totalLen * 0.16) : Math.min(6, totalLen * 0.09), cap: true },
    });
    const d = strokeOutlineToSvgPath(outline, true);
    if (d) {
      const pa = { d, fill: stroke };
      if (op < 0.999) pa.opacity = op.toFixed(3);
      return [{ tag: "path", attrs: pa }];
    }
  }

  // Stone Chisel / Textured Stroke via Rough.js (min 24px keeps small glyphs clean)
  if (G.stroke === "chisel" && totalLen >= 24) {
    const drawable = roughGen.linearPath(pts, {
      stroke,
      strokeWidth: sw * 1.06,
      roughness: clamp(G.roughness, 0.32, 0.72),
      bowing: 0.55,
      disableMultiStroke: true,
      seed,
    });
    const out = [];
    for (const p of roughGen.toPaths(drawable)) {
      const pa = { d: p.d, fill: "none", stroke: p.stroke || stroke, "stroke-width": Number(p.strokeWidth || sw).toFixed(2) };
      if (op < 0.999) pa.opacity = op.toFixed(3);
      out.push({ tag: "path", attrs: pa });
    }
    if (out.length) return out;
  }

  // Pixel-quantized crisp stroke
  if (G.stroke === "pixel") {
    const q = (v) => Math.round(v);
    if (pts.length === 2) {
      const a = { x1: q(pts[0][0]), y1: q(pts[0][1]), x2: q(pts[1][0]), y2: q(pts[1][1]), stroke, "stroke-width": Math.max(1.5, Math.round(sw)), "stroke-linecap": "square", "shape-rendering": "crispEdges" };
      if (op < 0.999) a.opacity = op.toFixed(3);
      return [{ tag: "line", attrs: a }];
    }
    const a = { points: pts.map(([x, y]) => `${q(x)},${q(y)}`).join(" "), fill: "none", stroke, "stroke-width": Math.max(1.5, Math.round(sw)), "stroke-linecap": "square", "stroke-linejoin": "miter", "shape-rendering": "crispEdges" };
    if (op < 0.999) a.opacity = op.toFixed(3);
    return [{ tag: "polyline", attrs: a }];
  }

  // Crisp analytical stroke (Swiss, geometric, oscilloscope, win2000)
  if (isStringPath && progress >= 0.999) {
    const a = { d: pointsOrPath, fill: "none", stroke, "stroke-width": sw.toFixed(2) };
    if (opts.lineCap) a["stroke-linecap"] = opts.lineCap;
    if (opts.lineJoin) a["stroke-linejoin"] = opts.lineJoin;
    if (op < 0.999) a.opacity = op.toFixed(3);
    return [{ tag: "path", attrs: a }];
  }
  if (pts.length === 2) {
    const a = { x1: pts[0][0].toFixed(2), y1: pts[0][1].toFixed(2), x2: pts[1][0].toFixed(2), y2: pts[1][1].toFixed(2), stroke, "stroke-width": sw.toFixed(2) };
    if (opts.lineCap) a["stroke-linecap"] = opts.lineCap;
    if (op < 0.999) a.opacity = op.toFixed(3);
    return [{ tag: "line", attrs: a }];
  }
  const a = { points: pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" "), fill: "none", stroke, "stroke-width": sw.toFixed(2) };
  if (opts.lineCap) a["stroke-linecap"] = opts.lineCap;
  if (opts.lineJoin) a["stroke-linejoin"] = opts.lineJoin;
  if (op < 0.999) a.opacity = op.toFixed(3);
  return [{ tag: "polyline", attrs: a }];
}

// ============================================================================
// SVG Renderer (`createSvgMarks` + `hydrateSvgMarks`)
// ============================================================================

function quantColorKey(col) {
  const [r, g, b] = parseRgb(col, [127, 127, 127]);
  const q = (v) => Math.min(255, Math.round(v / 4) * 4);
  return `${q(r)}_${q(g)}_${q(b)}`;
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

function ensureWashGradient(svgEl, washSpec) {
  const { color, stops } = washSpec;
  const cKey = quantColorKey(color);
  const qRgb = cKey.split("_").map(Number);
  const qColor = `rgb(${qRgb[0]},${qRgb[1]},${qRgb[2]})`;
  const id = `pf-wash-${cKey}-${stops.map((s) => Math.round(s * 100)).join("-")}`;
  const pool = getDefsPool(svgEl);
  pool.active.add(id);
  if (!pool.map.has(id)) {
    const doc = svgEl.ownerDocument;
    const lg = doc.createElementNS(SVG_NS, "linearGradient");
    lg.setAttribute("id", id);
    lg.setAttribute("x1", "0");
    lg.setAttribute("y1", "0");
    lg.setAttribute("x2", "0");
    lg.setAttribute("y2", "1");
    [
      ["0%", stops[0]],
      ["52%", stops[1]],
      ["100%", stops[2]],
    ].forEach(([off, alpha]) => {
      const st = doc.createElementNS(SVG_NS, "stop");
      st.setAttribute("offset", off);
      st.setAttribute("stop-color", qColor);
      st.setAttribute("stop-opacity", alpha.toFixed(3));
      lg.appendChild(st);
    });
    pool.el.appendChild(lg);
    pool.map.set(id, lg);
  }
  return `url(#${id})`;
}

function getDitherCells(density) {
  // 3-step Bayer progression on a 4x4 macro tile: 50% -> 25% -> 12.5%
  if (density >= 45) return [[0, 0, 2, 2], [2, 2, 2, 2]];
  if (density >= 20) return [[0, 0, 2, 2]];
  return [[0, 0, 1, 1], [2, 2, 1, 1]];
}

function ensurePatternDef(svgEl, patSpec) {
  const { kind, density, fg, bg } = patSpec;
  const fgKey = quantColorKey(fg);
  const bgKey = quantColorKey(bg);
  const id = `pf-pat-${kind}-${density}-${fgKey}-${bgKey}`;
  const pool = getDefsPool(svgEl);
  pool.active.add(id);
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

/**
 * Create a semantic SVG mark emitter bound to `svgEl` and theme tokens on `hostEl`.
 */
export function createSvgMarks(svgEl, hostEl = null, grammarOverrides = null) {
  const doc = svgEl.ownerDocument;
  const target = hostEl || svgEl;
  let cachedG = null;
  let lastOverrides = undefined;
  let lastSig = "";

  function syncGrammar(overrides = grammarOverrides) {
    cachedG = markGrammar(target, overrides);
    lastOverrides = overrides;
    lastSig = hostSignature(target);
    return cachedG;
  }

  function beginFrame(overrides = grammarOverrides) {
    sweepDefsPool(svgEl);
    const sig = hostSignature(target);
    if (cachedG && overrides === lastOverrides && sig === lastSig) {
      return cachedG;
    }
    return syncGrammar(overrides);
  }

  function materializeSpecs(specs, className) {
    if (!specs || specs.length === 0) {
      return doc.createElementNS(SVG_NS, "g");
    }
    const mkNode = (sp) => {
      const node = doc.createElementNS(SVG_NS, sp.tag);
      for (const [k, v] of Object.entries(sp.attrs)) {
        node.setAttribute(k, String(v));
      }
      if (sp.wash) {
        node.setAttribute("fill", ensureWashGradient(svgEl, sp.wash));
      } else if (sp.pattern) {
        node.setAttribute("fill", ensurePatternDef(svgEl, sp.pattern));
      }
      return node;
    };
    if (specs.length === 1 && !className) return mkNode(specs[0]);
    const g = doc.createElementNS(SVG_NS, "g");
    if (className) g.setAttribute("class", className);
    for (const sp of specs) g.appendChild(mkNode(sp));
    return g;
  }

  const G = () => cachedG || syncGrammar();

  return {
    grammar: G,
    beginFrame,
    syncGrammar,
    dot(cx, cy, r, opts = {}) {
      const seed = opts.seed ?? fnv1aSeed(`dot:${Math.round(cx)}:${Math.round(cy)}:${opts.role || ""}`);
      return materializeSpecs(buildDotSpec(cx, cy, r, G(), { ...opts, seed }), opts.className);
    },
    ring(cx, cy, r, opts = {}) {
      const seed = opts.seed ?? fnv1aSeed(`ring:${Math.round(cx)}:${Math.round(cy)}:${opts.role || ""}`);
      return materializeSpecs(buildRingSpec(cx, cy, r, G(), { ...opts, seed }), opts.className);
    },
    arrowHead(x, y, angle, opts = {}) {
      return materializeSpecs(buildArrowHeadSpec(x, y, angle, G(), opts), opts.className);
    },
    panel(x, y, w, h, opts = {}) {
      const seed = opts.seed ?? fnv1aSeed(`panel:${Math.round(x)}:${Math.round(y)}:${Math.round(w)}:${Math.round(h)}`);
      return materializeSpecs(buildPanelSpec(x, y, w, h, G(), { ...opts, seed }), opts.className);
    },
    cell(x, y, size, opts = {}) {
      const seed = opts.seed ?? fnv1aSeed(`cell:${Math.round(x)}:${Math.round(y)}:${Math.round(size)}`);
      return materializeSpecs(buildPanelSpec(x, y, size, size, G(), { ...opts, isCell: true, seed }), opts.className);
    },
    region(points, opts = {}) {
      const seed = opts.seed ?? (Array.isArray(points) && points.length
        ? fnv1aSeed(`reg:${Math.round(points[0][0])}:${Math.round(points[0][1])}:${points.length}:${opts.role || ""}`)
        : 29);
      return materializeSpecs(buildRegionSpec(points, G(), { ...opts, seed }), opts.className);
    },
    bar(x, y, w, h, opts = {}) {
      const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      const seed = opts.seed ?? fnv1aSeed(`bar:${Math.round(x)}:${Math.round(y + h)}:${opts.role || ""}`);
      return materializeSpecs(buildRegionSpec(pts, G(), { ...opts, seed }), opts.className);
    },
    curve(pointsOrPath, opts = {}) {
      const seed = polylineAnchorSeed("crv", pointsOrPath, opts.seed);
      return materializeSpecs(buildCurveSpec(pointsOrPath, G(), { ...opts, seed }), opts.className);
    },
    segment(x1, y1, x2, y2, opts = {}) {
      const seed = opts.seed ?? fnv1aSeed(`seg:${Math.round(x1)}:${Math.round(y1)}:${Math.round(Math.atan2(y2 - y1, x2 - x1) * 32)}`);
      return materializeSpecs(buildCurveSpec([[x1, y1], [x2, y2]], G(), { ...opts, seed }), opts.className);
    },
    arrow(points, opts = {}) {
      const g = doc.createElementNS(SVG_NS, "g");
      if (opts.className) g.setAttribute("class", opts.className);
      const curG = G();
      const seed = polylineAnchorSeed("arr", points, opts.seed);
      const prep = prepareArrowGeometry(points, curG, opts);
      if (prep.shaftInput) {
        const shaft = buildCurveSpec(prep.shaftInput, curG, { ...opts, progress: prep.shaftProgress, seed });
        for (const sp of shaft) g.appendChild(materializeSpecs([sp]));
      }
      if (prep.head) {
        const headSpecs = buildArrowHeadSpec(prep.head.x, prep.head.y, prep.head.angle, curG, {
          role: opts.role,
          fill: opts.stroke,
          size: prep.head.size,
          opacity: opts.opacity,
        });
        for (const sp of headSpecs) g.appendChild(materializeSpecs([sp]));
      }
      return g;
    },
  };
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
  for (const k of PASSTHROUGH_ATTRS) {
    if (attrs[k] != null && !node.getAttribute(k)) node.setAttribute(k, attrs[k]);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("aria-") && !node.getAttribute(k)) node.setAttribute(k, v);
  }
  if (attrs.style) {
    const existing = node.getAttribute("style");
    node.setAttribute("style", existing ? `${attrs.style};${existing}` : attrs.style);
  }
}

/**
 * Hydrate declarative `<svg>` elements carrying `data-pf-mark="dot|ring|bar|region|panel|cell|curve|segment|arrow"`
 * so static Markdown / Marp figures rematerialize cleanly across themes and palettes.
 */
export function hydrateSvgMarks(svgEl, hostEl = null, grammarOverrides = null) {
  if (!svgEl.__pfMarkSnapshots) {
    const items = [];
    let idx = 1;
    for (const el of Array.from(svgEl.querySelectorAll("[data-pf-mark]"))) {
      if (el.getAttribute("data-pf-mark-generated")) continue;
      const attrs = {};
      for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
      const origClone = typeof el.cloneNode === "function" ? el.cloneNode(true) : null;
      items.push({ tag: el.tagName.toLowerCase(), attrs, origClone, placeholder: el, seed: idx++ * 6151 + 7 });
    }
    svgEl.__pfMarkSnapshots = items;
  }
  if (!svgEl.__pfMarkSnapshots.length) return;

  const target = hostEl || svgEl;
  const marks = createSvgMarks(svgEl, target, grammarOverrides);
  const G = marks.syncGrammar(grammarOverrides);
  const hasCustomColorMap = Boolean(grammarOverrides && grammarOverrides.mapColor);

  // Lossless original DOM restore in default Swiss light mode when cloneNode is available
  if (G.isSwiss && !G.isDark && !hasCustomColorMap && svgEl.__pfMarkSnapshots.every((s) => s.origClone)) {
    for (const snap of svgEl.__pfMarkSnapshots) {
      const restored = snap.origClone.cloneNode(true);
      if (snap.placeholder.parentNode) {
        snap.placeholder.parentNode.replaceChild(restored, snap.placeholder);
        snap.placeholder = restored;
      }
    }
    clearDefsPool(svgEl);
    svgEl.removeAttribute("data-pf-hydrated");
    return;
  }

  svgEl.setAttribute("data-pf-hydrated", "1");
  const cs = target && typeof getComputedStyle === "function" ? getComputedStyle(target) : null;
  const mapCol = hasCustomColorMap ? grammarOverrides.mapColor : (c) => c;

  for (const snap of svgEl.__pfMarkSnapshots) {
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
      let pts = null;
      if (a.points) pts = parsePointsAttr(a.points);
      else if (a.d) pts = sampleSimpleSvgPath(a.d);
      else if (a.width != null && a.height != null) {
        const rx = Number(a.x || 0), ry = Number(a.y || 0), rw = Number(a.width), rh = Number(a.height);
        pts = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]];
      }
      if (pts && pts.length >= 3) replacement = marks.region(pts, common);
    } else if (kind === "arrow") {
      const src = a.d || (a.points ? parsePointsAttr(a.points) : [[Number(a.x1 || 0), Number(a.y1 || 0)], [Number(a.x2 || 0), Number(a.y2 || 0)]]);
      replacement = marks.arrow(src, common);
    } else if (kind === "curve" || kind === "segment") {
      const src = a.d || (a.points ? parsePointsAttr(a.points) : [[Number(a.x1 || 0), Number(a.y1 || 0)], [Number(a.x2 || 0), Number(a.y2 || 0)]]);
      replacement = marks.curve(src, common);
    }

    if (replacement && snap.placeholder.parentNode) {
      replacement.setAttribute("data-pf-mark-generated", "1");
      copyPassthroughAttrs(a, replacement);
      snap.placeholder.parentNode.replaceChild(replacement, snap.placeholder);
      snap.placeholder = replacement;
    }
  }
}

// ============================================================================
// HTML5 <canvas> Renderer (`createCanvasMarks`)
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

/**
 * Create a semantic Canvas 2D mark renderer compatible with `chao-ui/diagrams.js`.
 */
export function createCanvasMarks(ctx, hostEl = null, grammarOverrides = null) {
  const target = hostEl || (ctx && ctx.canvas) || null;
  let cachedG = markGrammar(target, grammarOverrides);
  let lastOverrides = grammarOverrides;
  let lastSig = hostSignature(target);

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

  function applyDash(a, perim = 0) {
    if (!a["stroke-dasharray"]) return;
    const raw = String(a["stroke-dasharray"]).trim().split(/[\s,]+/).map(Number);
    if (a.pathLength === "1" && perim > 0) {
      ctx.setLineDash(raw.map((v) => v * perim));
      if (a["stroke-dashoffset"] != null && "lineDashOffset" in ctx) {
        ctx.lineDashOffset = Number(a["stroke-dashoffset"]) * perim;
      }
    } else {
      ctx.setLineDash(raw);
      if (a["stroke-dashoffset"] != null && "lineDashOffset" in ctx) {
        ctx.lineDashOffset = Number(a["stroke-dashoffset"]);
      }
    }
  }

  function drawSpecs(specs) {
    for (const sp of specs) {
      const a = sp.attrs;
      ctx.save();
      const op = a.opacity != null ? Number(a.opacity) : 1;
      const fillOp = a["fill-opacity"] != null ? Number(a["fill-opacity"]) : 1;
      if (a.style && String(a.style).includes("multiply") && "globalCompositeOperation" in ctx) {
        ctx.globalCompositeOperation = "multiply";
      }
      if (a["shape-rendering"] === "crispEdges" && "imageSmoothingEnabled" in ctx) {
        ctx.imageSmoothingEnabled = false;
      }
      if (a["stroke-linecap"] && "lineCap" in ctx) ctx.lineCap = a["stroke-linecap"];
      if (a["stroke-linejoin"] && "lineJoin" in ctx) ctx.lineJoin = a["stroke-linejoin"];

      let fillStyle = a.fill;
      if (sp.wash && typeof ctx.createLinearGradient === "function") {
        const { color, stops, bounds } = sp.wash;
        const rgb = parseRgb(color, [79, 125, 150]);
        const grad = ctx.createLinearGradient(0, bounds.minY, 0, bounds.maxY);
        grad.addColorStop(0, rgba(rgb, stops[0]));
        grad.addColorStop(0.52, rgba(rgb, stops[1]));
        grad.addColorStop(1, rgba(rgb, stops[2]));
        fillStyle = grad;
      } else if (sp.pattern) {
        const pat = getCanvasPattern(ctx, sp.pattern);
        if (pat) fillStyle = pat;
      }

      const doFillStroke = (drawShape, perim = 0) => {
        if (fillStyle && fillStyle !== "none") {
          ctx.globalAlpha = op * fillOp;
          ctx.fillStyle = fillStyle;
          drawShape("fill");
        }
        if (a.stroke && a.stroke !== "none") {
          applyDash(a, perim);
          ctx.globalAlpha = op;
          ctx.strokeStyle = a.stroke;
          ctx.lineWidth = Number(a["stroke-width"] || 1);
          drawShape("stroke");
        }
      };

      if (sp.tag === "circle") {
        const r = Number(a.r);
        doFillStroke((mode) => {
          ctx.beginPath();
          ctx.arc(Number(a.cx), Number(a.cy), r, 0, Math.PI * 2);
          if (mode === "fill") ctx.fill(); else ctx.stroke();
        }, 2 * Math.PI * r);
      } else if (sp.tag === "rect") {
        const rx = Number(a.x), ry = Number(a.y), rw = Number(a.width), rh = Number(a.height);
        doFillStroke((mode) => {
          if (mode === "fill") ctx.fillRect(rx, ry, rw, rh); else ctx.strokeRect(rx, ry, rw, rh);
        }, 2 * (rw + rh));
      } else if (sp.tag === "line") {
        const x1 = Number(a.x1), y1 = Number(a.y1), x2 = Number(a.x2), y2 = Number(a.y2);
        doFillStroke(() => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }, Math.hypot(x2 - x1, y2 - y1));
      } else if (sp.tag === "polyline" || sp.tag === "polygon") {
        const nums = String(a.points || "").trim().split(/[\s,]+/).map(Number);
        let perim = 0;
        for (let i = 2; i + 1 < nums.length; i += 2) {
          perim += Math.hypot(nums[i] - nums[i - 2], nums[i + 1] - nums[i - 1]);
        }
        doFillStroke((mode) => {
          ctx.beginPath();
          for (let i = 0; i + 1 < nums.length; i += 2) {
            if (i === 0) ctx.moveTo(nums[i], nums[i + 1]); else ctx.lineTo(nums[i], nums[i + 1]);
          }
          if (sp.tag === "polygon") ctx.closePath();
          if (mode === "fill") ctx.fill(); else ctx.stroke();
        }, perim);
      } else if (sp.tag === "path" && a.d) {
        if (typeof Path2D !== "undefined") {
          const p2 = new Path2D(a.d);
          doFillStroke((mode) => {
            if (mode === "fill") ctx.fill(p2); else ctx.stroke(p2);
          }, 0);
        } else {
          const subs = sampleSvgSubpaths(a.d, 8);
          if (subs) {
            doFillStroke((mode) => {
              ctx.beginPath();
              for (const sub of subs) {
                for (let i = 0; i < sub.length; i++) {
                  if (i === 0) ctx.moveTo(sub[i][0], sub[i][1]); else ctx.lineTo(sub[i][0], sub[i][1]);
                }
              }
              if (mode === "fill") ctx.fill(); else ctx.stroke();
            }, 0);
          }
        }
      }
      ctx.restore();
    }
  }

  return {
    grammar: () => cachedG,
    beginFrame,
    syncGrammar,
    dot(cx, cy, r, opts = {}) {
      const seed = opts.seed ?? fnv1aSeed(`dot:${Math.round(cx)}:${Math.round(cy)}:${opts.role || ""}`);
      drawSpecs(buildDotSpec(cx, cy, r, cachedG, { ...opts, seed }));
    },
    ring(cx, cy, r, opts = {}) {
      const seed = opts.seed ?? fnv1aSeed(`ring:${Math.round(cx)}:${Math.round(cy)}:${opts.role || ""}`);
      drawSpecs(buildRingSpec(cx, cy, r, cachedG, { ...opts, seed }));
    },
    arrowHead(x, y, angle, opts = {}) {
      drawSpecs(buildArrowHeadSpec(x, y, angle, cachedG, opts));
    },
    panel(x, y, w, h, opts = {}) {
      const seed = opts.seed ?? fnv1aSeed(`panel:${Math.round(x)}:${Math.round(y)}:${Math.round(w)}:${Math.round(h)}`);
      drawSpecs(buildPanelSpec(x, y, w, h, cachedG, { ...opts, seed }));
    },
    cell(x, y, size, opts = {}) {
      const seed = opts.seed ?? fnv1aSeed(`cell:${Math.round(x)}:${Math.round(y)}:${Math.round(size)}`);
      drawSpecs(buildPanelSpec(x, y, size, size, cachedG, { ...opts, isCell: true, seed }));
    },
    region(points, opts = {}) {
      const seed = opts.seed ?? (Array.isArray(points) && points.length
        ? fnv1aSeed(`reg:${Math.round(points[0][0])}:${Math.round(points[0][1])}:${points.length}:${opts.role || ""}`)
        : 29);
      drawSpecs(buildRegionSpec(points, cachedG, { ...opts, seed }));
    },
    bar(x, y, w, h, opts = {}) {
      const seed = opts.seed ?? fnv1aSeed(`bar:${Math.round(x)}:${Math.round(y + h)}:${opts.role || ""}`);
      drawSpecs(buildRegionSpec([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], cachedG, { ...opts, seed }));
    },
    curve(pointsOrPath, opts = {}) {
      const seed = polylineAnchorSeed("crv", pointsOrPath, opts.seed);
      drawSpecs(buildCurveSpec(pointsOrPath, cachedG, { ...opts, seed }));
    },
    segment(x1, y1, x2, y2, opts = {}) {
      const seed = opts.seed ?? fnv1aSeed(`seg:${Math.round(x1)}:${Math.round(y1)}:${Math.round(Math.atan2(y2 - y1, x2 - x1) * 32)}`);
      drawSpecs(buildCurveSpec([[x1, y1], [x2, y2]], cachedG, { ...opts, seed }));
    },
    arrow(points, opts = {}) {
      const seed = polylineAnchorSeed("arr", points, opts.seed);
      const prep = prepareArrowGeometry(points, cachedG, opts);
      if (prep.shaftInput) {
        drawSpecs(buildCurveSpec(prep.shaftInput, cachedG, { ...opts, progress: prep.shaftProgress, seed }));
      }
      if (prep.head) {
        drawSpecs(buildArrowHeadSpec(prep.head.x, prep.head.y, prep.head.angle, cachedG, {
          role: opts.role,
          fill: opts.stroke,
          size: prep.head.size,
          opacity: opts.opacity,
        }));
      }
    },
  };
}
