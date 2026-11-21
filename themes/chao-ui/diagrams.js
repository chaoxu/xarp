/* ==========================================================================
   Chao-UI Analytical Diagram Kit (diagrams.js)
   Zero-dependency ES module for empirical & mathematical HTML5 <canvas> figures.

   Design contract (per chao-ui/docs/experience-principles.md):
   - Reads live CSS tokens (--pf-*) so light/dark themes match natively.
   - Enforces chao-ui 0px square geometry, hairline axes, and IBM Plex + Inconsolata type.
   - Uses IntersectionObserver to start episodes in view and pause off-screen loops.
   - Respects prefers-reduced-motion with a complete explanatory frame, while
     preserving manual Pause / Replay and pointer scrubbing.
   ========================================================================== */

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
export const seg = (t, a, b) => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a), 0, 1));

/** Cascade `count` items across `[a, b]` with overlap in `[0, 0.95]`, returning eased `[0..1]`. */
export function stagger(t, index, count, a = 0, b = 1, overlap = 0.55) {
  if (count <= 1 || b <= a) return ease(seg(t, a, b));
  const ov = clamp(overlap, 0, 0.95);
  const total = b - a;
  const itemDur = total / (1 + (count - 1) * (1 - ov));
  const step = itemDur * (1 - ov);
  const start = a + clamp(index, 0, count - 1) * step;
  return ease(seg(t, start, start + itemDur));
}

/** Deterministic, scrubbable analytical spring easing `[0..1] -> [0..1]` (`bounce = 0` is critically damped). */
export function spring(u, bounce = 0.18) {
  const x = clamp(u, 0, 1);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const b = clamp(bounce, 0, 0.6);
  const decay = 6.5 - b * 3.2;
  const omega = 4 + b * 18;
  const endErr = Math.exp(-decay) * Math.cos(omega);
  const raw = 1 - Math.exp(-decay * x) * Math.cos(omega * x);
  return raw / (1 - endErr);
}

/** Smooth half-sine pulse envelope `0 -> 1 -> 0` across `[a, b]`. */
export function bump(t, a, b) {
  const u = seg(t, a, b);
  return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u);
}

/** Piecewise keyframe knot evaluator `[[t0, v0], [t1, v1], ...]`. */
export function knots(t, pairs, easeFn = null) {
  if (!pairs || !pairs.length) return 0;
  if (t <= pairs[0][0]) return pairs[0][1];
  const last = pairs[pairs.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < pairs.length - 1; i++) {
    const [t0, v0] = pairs[i];
    const [t1, v1] = pairs[i + 1];
    if (t <= t1) {
      const u = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return lerp(v0, v1, easeFn ? easeFn(u) : u);
    }
  }
  return last[1];
}

function makeAxisTransform(kind) {
  if (kind === "log10") return { fwd: (v) => Math.log10(Math.max(1e-300, v)), inv: (u) => Math.pow(10, u) };
  if (kind === "log2") return { fwd: (v) => Math.log2(Math.max(1e-300, v)), inv: (u) => Math.pow(2, u) };
  return { fwd: (v) => v, inv: (u) => u };
}

/**
 * 2D linear or logarithmic coordinate mapper (`xScale` / `yScale`: `'linear' | 'log10' | 'log2'`).
 * Accepts either `(domainX, domainY, rangeX, rangeY, opts)` or `(box, { x, y, xScale, yScale })`.
 */
export function createPlotScale(domainX, domainY, rangeX, rangeY, opts = {}) {
  let dx = domainX, dy = domainY, rx = rangeX, ry = rangeY, cfg = opts || {};
  if (!Array.isArray(rangeX) && domainY && typeof domainY === "object" && !Array.isArray(domainY)) {
    cfg = domainY;
    dx = cfg.x || [0, 1];
    dy = cfg.y || [0, 1];
    if (Array.isArray(domainX) && domainX.length >= 4) {
      rx = [domainX[0], domainX[1]];
      ry = [domainX[2], domainX[3]];
    } else {
      const b = domainX || { x: 0, y: 0, w: 100, h: 100 };
      rx = [b.x, b.x + b.w];
      ry = [b.y + b.h, b.y];
    }
  }
  const xScale = cfg.xScale || "linear";
  const yScale = cfg.yScale || "linear";
  const tx = makeAxisTransform(xScale);
  const ty = makeAxisTransform(yScale);
  const dx0 = tx.fwd(dx[0]), dxSpan = (tx.fwd(dx[1]) - dx0) || 1;
  const dy0 = ty.fwd(dy[0]), dySpan = (ty.fwd(dy[1]) - dy0) || 1;
  const rx0 = rx[0], rxSpan = rx[1] - rx0;
  const ry0 = ry[0], rySpan = ry[1] - ry0;
  const x = (vx) => rx0 + ((tx.fwd(vx) - dx0) / dxSpan) * rxSpan;
  const y = (vy) => ry0 + ((ty.fwd(vy) - dy0) / dySpan) * rySpan;
  const invX = (px) => tx.inv(dx0 + ((px - rx0) / (rxSpan || 1)) * dxSpan);
  const invY = (py) => ty.inv(dy0 + ((py - ry0) / (rySpan || 1)) * dySpan);
  return {
    domainX: dx,
    domainY: dy,
    rangeX: rx,
    rangeY: ry,
    xScale,
    yScale,
    x,
    y,
    pt: (vx, vy) => [x(vx), y(vy)],
    invX,
    invY,
    invertX: invX,
    invertY: invY,
  };
}

/** Generate clean human-readable axis ticks for `'linear' | 'log10' | 'log2'` domains. */
export function niceTicks(min, max, count = 5, scaleType = "linear") {
  const lo = Math.min(min, max), hi = Math.max(min, max);
  if (!(hi > lo)) return [lo];
  if (scaleType === "log10" && lo > 0) {
    const e0 = Math.ceil(Math.log10(lo) - 1e-9), e1 = Math.floor(Math.log10(hi) + 1e-9);
    const out = [];
    const sub = e1 - e0 <= 2 ? [1, 2, 5] : [1];
    for (let e = e0 - 1; e <= e1 + 1; e++) {
      const base = Math.pow(10, e);
      for (let i = 0; i < sub.length; i++) {
        const v = Number((base * sub[i]).toPrecision(12));
        if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) out.push(v);
      }
    }
    return out.length ? out : [lo, hi];
  }
  if (scaleType === "log2" && lo > 0) {
    const e0 = Math.ceil(Math.log2(lo) - 1e-9), e1 = Math.floor(Math.log2(hi) + 1e-9);
    const step = Math.max(1, Math.ceil((e1 - e0 + 1) / Math.max(2, count)));
    const out = [];
    for (let e = e0; e <= e1; e += step) out.push(Math.pow(2, e));
    return out.length ? out : [lo, hi];
  }
  const rawStep = (hi - lo) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const mult = norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10;
  const step = mult * mag;
  const start = Math.ceil((lo - 1e-12) / step) * step;
  const out = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) {
    out.push(Number(v.toPrecision(12)));
  }
  return out;
}

export const FONTS = {
  sans: '12px "IBM Plex Sans", system-ui, -apple-system, sans-serif',
  sansSmall: '11px "IBM Plex Sans", system-ui, -apple-system, sans-serif',
  sansBold: '600 12px "IBM Plex Sans", system-ui, -apple-system, sans-serif',
  mono: '12px "Inconsolata", "IBM Plex Mono", ui-monospace, monospace',
  monoSmall: '11px "Inconsolata", "IBM Plex Mono", ui-monospace, monospace',
  monoBold: '600 11.5px "Inconsolata", "IBM Plex Mono", ui-monospace, monospace',
  math: 'italic 14px "IBM Plex Serif", "STIX Two Text", Georgia, serif',
  mathBold: 'italic 600 14px "IBM Plex Serif", "STIX Two Text", Georgia, serif',
};

function splitTopLevelComma(str) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(str.slice(start).trim());
  return parts;
}

function parseColorMixArg(raw) {
  const m = raw.match(/^(.*?)\s+([-+]?(?:\d+\.?\d*|\.\d+))%\s*$/);
  if (m && m[1]) return { color: m[1].trim(), pct: clamp(Number(m[2]) / 100, 0, 1) };
  return { color: raw.trim(), pct: null };
}

const rgbCache = new Map();

function cacheRgb(key, tuple) {
  if (rgbCache.size >= 512) rgbCache.clear();
  rgbCache.set(key, tuple);
  return tuple;
}

export function parseRgb(str, fallback = [31, 29, 26]) {
  if (!str) return fallback;
  const hit = rgbCache.get(str);
  if (hit !== undefined) return hit;
  const s = String(str).trim();
  if (!s || s === "none" || s === "transparent") return fallback;
  const hitTrim = rgbCache.get(s);
  if (hitTrim !== undefined) return hitTrim;
  if (s.charCodeAt(0) === 35 /* '#' */) {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return cacheRgb(s, [r, g, b]);
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return cacheRgb(s, [r, g, b]);
    }
  }
  if (/^color-mix\(/i.test(s) && s.endsWith(")")) {
    const inner = s.slice(s.indexOf("(") + 1, -1);
    const parts = splitTopLevelComma(inner);
    if (parts.length >= 3) {
      const a1 = parseColorMixArg(parts[1]);
      const a2 = parseColorMixArg(parts[2]);
      if (a1.color.toLowerCase() === "transparent") return cacheRgb(s, parseRgb(a2.color, fallback));
      if (a2.color.toLowerCase() === "transparent") return cacheRgb(s, parseRgb(a1.color, fallback));
      let w1 = 0.5;
      let w2 = 0.5;
      if (a1.pct != null && a2.pct != null) {
        const sum = a1.pct + a2.pct;
        if (sum > 1e-6) {
          w1 = a1.pct / sum;
          w2 = a2.pct / sum;
        }
      } else if (a1.pct != null) {
        w1 = a1.pct;
        w2 = 1 - w1;
      } else if (a2.pct != null) {
        w2 = a2.pct;
        w1 = 1 - w2;
      }
      const c1 = parseRgb(a1.color, fallback);
      const c2 = parseRgb(a2.color, fallback);
      return cacheRgb(s, [
        c1[0] * w1 + c2[0] * w2,
        c1[1] * w1 + c2[1] * w2,
        c1[2] * w1 + c2[2] * w2,
      ]);
    }
  }
  const m = s.match(/^rgba?\(\s*([^\s,/)]+%?)\s*[\s,]\s*([^\s,/)]+%?)\s*[\s,]\s*([^\s,/)]+%?)/i);
  if (m) {
    const chan = (v) => (v.endsWith("%") ? clamp((Number(v.slice(0, -1)) * 255) / 100, 0, 255) : clamp(Number(v), 0, 255));
    const r = chan(m[1]), g = chan(m[2]), b = chan(m[3]);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return cacheRgb(s, [r, g, b]);
  }
  return fallback;
}

export function rgba(rgbTuple, a = 1) {
  const r = (rgbTuple[0] + 0.5) | 0;
  const g = (rgbTuple[1] + 0.5) | 0;
  const b = (rgbTuple[2] + 0.5) | 0;
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

export function mixRgb(c1, c2, t) {
  const f = clamp(t, 0, 1);
  return [lerp(c1[0], c2[0], f), lerp(c1[1], c2[1], f), lerp(c1[2], c2[2], f)];
}

/** Blend any two CSS hex / rgb / color-mix strings at `p` in `[0, 1]`. */
export function mixColor(colA, colB, p) {
  const f = clamp(p, 0, 1);
  if (f <= 0) return colA;
  if (f >= 1) return colB;
  return rgba(mixRgb(parseRgb(colA), parseRgb(colB), f), 1);
}

export function palette(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const read = (name, fb) => {
    const raw = cs.getPropertyValue(name).trim() || fb;
    return /^color-mix\(/i.test(raw) ? rgba(parseRgb(raw, parseRgb(fb)), 1) : raw;
  };
  const bg = read("--pf-essay-bg", read("--pf-bg", "#ffffff"));
  const fg = read("--pf-vis-ink", read("--pf-fg", "#1f1d1a"));
  const muted = read("--pf-vis-muted", read("--pf-muted", "#6e6a63"));
  const grid = read("--pf-vis-grid", read("--pf-border", "#e6e2dc"));
  const surface = read("--pf-essay-surface", read("--pf-surface", "#f7f6f2"));
  const slateHex = read("--pf-vis-slate", "#4f7d96");
  const terraHex = read("--pf-vis-terracotta", "#c85a40");
  const ochreHex = read("--pf-vis-ochre", "#c68d28");
  const stoneHex = read("--pf-vis-stone", "#cbc6be");

  const slateRgb = parseRgb(slateHex, [79, 125, 150]);
  const terraRgb = parseRgb(terraHex, [200, 90, 64]);
  const ochreRgb = parseRgb(ochreHex, [198, 141, 40]);
  const stoneRgb = parseRgb(stoneHex, [203, 198, 190]);
  const fgRgb = parseRgb(fg, [31, 29, 26]);

  return {
    bg,
    fg,
    muted,
    grid,
    surface,
    slate: slateHex,
    terracotta: terraHex,
    ochre: ochreHex,
    stone: stoneHex,
    slateRgb,
    terraRgb,
    ochreRgb,
    stoneRgb,
    fgRgb,
    slateAlpha: (a) => rgba(slateRgb, a),
    terraAlpha: (a) => rgba(terraRgb, a),
    ochreAlpha: (a) => rgba(ochreRgb, a),
    fgAlpha: (a) => rgba(fgRgb, a),
  };
}

export function label(ctx, text, x, y, opts = {}) {
  ctx.font = opts.font || FONTS.sans;
  ctx.fillStyle = opts.color || "#1f1d1a";
  ctx.textAlign = opts.align || "left";
  ctx.textBaseline = opts.baseline || "middle";
  ctx.fillText(text, x, y);
}

/** Square-swatch chao-ui legend (0px corners). */
export function legend(ctx, items, cx, y, P) {
  ctx.font = FONTS.sans;
  ctx.textBaseline = "middle";
  const sw = 10;
  const gap = 6;
  const pad = 18;
  const widths = items.map((it) => sw + gap + ctx.measureText(it.label).width);
  const total = widths.reduce((a, b) => a + b, 0) + pad * Math.max(0, items.length - 1);
  let x = cx - total / 2;
  items.forEach((it, i) => {
    ctx.fillStyle = it.color;
    ctx.fillRect(Math.round(x), Math.round(y - sw / 2), sw, sw);
    ctx.fillStyle = P.muted;
    ctx.textAlign = "left";
    ctx.fillText(it.label, x + sw + gap, y + 0.5);
    x += widths[i] + pad;
  });
}

/** Architectural 0px chao-ui framed panel with title & right-aligned mono metadata. */
export function panel(ctx, x, y, w, h, title, rightMeta, P) {
  ctx.fillStyle = P.bg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = P.grid;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  ctx.beginPath();
  ctx.moveTo(x, Math.round(y + 26) + 0.5);
  ctx.lineTo(x + w, Math.round(y + 26) + 0.5);
  ctx.stroke();
  if (title) label(ctx, title, x + 10, y + 13.5, { color: P.fg, font: FONTS.sansBold });
  if (rightMeta) label(ctx, rightMeta, x + w - 10, y + 13.5, { color: P.muted, font: FONTS.monoSmall, align: "right" });
}

export function arrow(ctx, x0, y0, x1, y1, color, lw = 1.6, head = 7) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return;
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - Math.cos(a) * head * 0.78, y1 - Math.sin(a) * head * 0.78);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(a - 0.38), y1 - head * Math.sin(a - 0.38));
  ctx.lineTo(x1 - head * Math.cos(a + 0.38), y1 - head * Math.sin(a + 0.38));
  ctx.closePath();
  ctx.fill();
}

/** Clip a 2D convex polygon against half-space a[0]*x + a[1]*y <= b. */
export function clipHalfspace(poly, a, b) {
  const evalPt = (p) => a[0] * p[0] + a[1] * p[1] - b;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = evalPt(p);
    const fq = evalPt(q);
    if (fp <= 1e-9) out.push(p);
    if ((fp < -1e-9 && fq > 1e-9) || (fp > 1e-9 && fq < -1e-9)) {
      const s = fp / (fp - fq);
      out.push([lerp(p[0], q[0], s), lerp(p[1], q[1], s)]);
    }
  }
  return out;
}

export function feasiblePolygon(box, constraints) {
  const [x0, x1, y0, y1] = box;
  let poly = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  for (const c of constraints) {
    poly = clipHalfspace(poly, c.a, c.b);
    if (poly.length === 0) break;
  }
  return poly;
}

export function lineInBox(a, b, box) {
  const [x0, x1, y0, y1] = box;
  const pts = [];
  const [a1, a2] = a;
  if (Math.abs(a2) > 1e-9) {
    for (const x of [x0, x1]) {
      const y = (b - a1 * x) / a2;
      if (y >= y0 - 1e-6 && y <= y1 + 1e-6) pts.push([x, clamp(y, y0, y1)]);
    }
  }
  if (Math.abs(a1) > 1e-9) {
    for (const y of [y0, y1]) {
      const x = (b - a2 * y) / a1;
      if (x > x0 + 1e-6 && x < x1 - 1e-6) pts.push([clamp(x, x0, x1), y]);
    }
  }
  if (pts.length < 2) return null;
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return [pts[0], pts[pts.length - 1]];
}

/** Exact small-N Cholesky 1D RBF Gaussian Process posterior `(x) => { mean, std, variance }` (also exposes `.mean(x)`, `.std(x)`, `.band(x, z)`). */
export function gpPosterior1D(observations = [], opts = {}) {
  const ell = Math.max(1e-6, Number(opts.lengthScale ?? 0.22));
  const sig2 = Math.max(1e-9, Number(opts.signalVar ?? 1));
  const defaultNoise = Math.max(1e-12, Number(opts.noiseVar ?? 1e-4));
  const inv2Ell2 = 0.5 / (ell * ell);
  const priorMean = typeof opts.priorMean === "function" ? opts.priorMean : () => Number(opts.priorMean ?? 0);
  const n = observations.length;
  let evalAt;
  if (n === 0) {
    const s0 = Math.sqrt(sig2);
    evalAt = (x) => ({ mean: priorMean(x), std: s0, variance: sig2 });
  } else {
    const xs = new Float64Array(n);
    const yDiff = new Float64Array(n);
    const L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      xs[i] = observations[i][0];
      yDiff[i] = observations[i][1] - priorMean(xs[i]);
    }
    for (let i = 0; i < n; i++) {
      const nv = Math.max(1e-12, Number(observations[i][2] ?? defaultNoise));
      for (let j = 0; j <= i; j++) {
        const dx = xs[i] - xs[j];
        let sum = sig2 * Math.exp(-dx * dx * inv2Ell2) + (i === j ? nv : 0);
        for (let k = 0; k < j; k++) sum -= L[i * n + k] * L[j * n + k];
        if (i === j) L[i * n + i] = Math.sqrt(Math.max(1e-12, sum));
        else L[i * n + j] = sum / L[j * n + j];
      }
    }
    const z = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = yDiff[i];
      for (let k = 0; k < i; k++) s -= L[i * n + k] * z[k];
      z[i] = s / L[i * n + i];
    }
    const alpha = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = z[i];
      for (let k = i + 1; k < n; k++) s -= L[k * n + i] * alpha[k];
      alpha[i] = s / L[i * n + i];
    }
    const kVec = new Float64Array(n);
    const vVec = new Float64Array(n);
    evalAt = (x) => {
      let mean = priorMean(x);
      for (let i = 0; i < n; i++) {
        const dx = x - xs[i];
        const kv = sig2 * Math.exp(-dx * dx * inv2Ell2);
        kVec[i] = kv;
        mean += kv * alpha[i];
      }
      let vNorm2 = 0;
      for (let i = 0; i < n; i++) {
        let s = kVec[i];
        for (let k = 0; k < i; k++) s -= L[i * n + k] * vVec[k];
        const vi = s / L[i * n + i];
        vVec[i] = vi;
        vNorm2 += vi * vi;
      }
      const variance = Math.max(0, sig2 - vNorm2);
      return { mean, std: Math.sqrt(variance), variance };
    };
  }
  evalAt.mean = (x) => evalAt(x).mean;
  evalAt.std = (x) => evalAt(x).std;
  evalAt.variance = (x) => evalAt(x).variance;
  evalAt.band = (x, z = 2) => {
    const r = evalAt(x);
    return [r.mean - z * r.std, r.mean + z * r.std];
  };
  return evalAt;
}

/** Extract non-dominated Pareto frontier vertices `[[x, y], ...]` sorted along `x` (also attaches `.indices` and `.vertices`). */
export function paretoFrontier(points = [], opts = {}) {
  const minX = opts.maximizeX !== undefined ? !opts.maximizeX : opts.minimizeX !== false;
  const minY = opts.maximizeY !== undefined ? !opts.maximizeY : opts.minimizeY !== false;
  const order = points.map((_, idx) => idx);
  order.sort((i, j) => {
    const dx = minX ? points[i][0] - points[j][0] : points[j][0] - points[i][0];
    if (Math.abs(dx) > 1e-12) return dx;
    return minY ? points[i][1] - points[j][1] : points[j][1] - points[i][1];
  });
  const indices = [];
  let bestY = minY ? Infinity : -Infinity;
  for (let k = 0; k < order.length; k++) {
    const idx = order[k];
    const y = points[idx][1];
    if (minY ? y < bestY - 1e-12 : y > bestY + 1e-12) {
      indices.push(idx);
      bestY = y;
    }
  }
  if (!minX) indices.reverse();
  const vertices = indices.map((i) => points[i]);
  Object.defineProperties(vertices, {
    indices: { value: indices, enumerable: false },
    vertices: { value: vertices, enumerable: false },
  });
  return vertices;
}

/** 3D axonometric / oblique octant projector `{ origin, axes, project(x,y,z), interpPath(pts3, u) }`. */
export function createOctantScale(originOrCfg = {}, maybeAxes = null) {
  const isOriginArr = Array.isArray(originOrCfg);
  const origin = isOriginArr ? originOrCfg : (originOrCfg.origin || [520, 390]);
  const ax = isOriginArr ? (maybeAxes || {}) : (originOrCfg.axes || {});
  const vx = ax.x || [310, 42];
  const vy = ax.y || [-220, 96];
  const vz = ax.z || [0, -250];
  const project = (x, y, z) => [
    origin[0] + x * vx[0] + y * vy[0] + z * vz[0],
    origin[1] + x * vx[1] + y * vy[1] + z * vz[1],
  ];
  const interpPath = (pts3, u) => {
    if (!pts3 || !pts3.length) return [0, 0, 0];
    if (pts3.length === 1) return pts3[0].slice();
    const p = clamp(u, 0, 1) * (pts3.length - 1);
    const i = Math.min(pts3.length - 2, Math.floor(p));
    const f = p - i;
    return [
      lerp(pts3[i][0], pts3[i + 1][0], f),
      lerp(pts3[i][1], pts3[i + 1][1], f),
      lerp(pts3[i][2], pts3[i + 1][2], f),
    ];
  };
  return { origin, axes: { x: vx, y: vy, z: vz }, project, interpPath };
}

/** Boundary points of a 2D ellipsoid `{ x : (x - c)^T Q^{-1} (x - c) <= 1 }` for SPD 2x2 matrix `Q`. */
export function ellipseMatrixPoints(center, Q, steps = 64, closed = false) {
  const q00 = Math.max(1e-12, Q[0][0]);
  const l00 = Math.sqrt(q00);
  const l10 = Q[1][0] / l00;
  const l11 = Math.sqrt(Math.max(0, Q[1][1] - l10 * l10));
  const count = closed ? steps + 1 : steps;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const th = (i / steps) * Math.PI * 2;
    const ct = Math.cos(th), st = Math.sin(th);
    out[i] = [center[0] + l00 * ct, center[1] + l10 * ct + l11 * st];
  }
  return out;
}

/** Khachiyan central-cut ellipsoid step keeping `{ x : cutNormal^T (x - c) <= 0 }`. Accepts `(E, g)` or `(center, P, g)`. */
export function ellipsoidCutUpdate(eOrCenter, cutOrP, maybeCut = null) {
  const threeArg = Array.isArray(eOrCenter);
  const c = threeArg ? eOrCenter : (eOrCenter.c || eOrCenter.center);
  const Q = threeArg ? cutOrP : (eOrCenter.Q || eOrCenter.P);
  const cutNormal = threeArg ? maybeCut : cutOrP;
  const n = c.length;
  const Qa = new Array(n).fill(0);
  let aQa = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) Qa[i] += Q[i][j] * cutNormal[j];
    aQa += cutNormal[i] * Qa[i];
  }
  if (aQa <= 1e-15) {
    const copyC = c.slice(), copyQ = Q.map((r) => r.slice());
    return { c: copyC, center: copyC, Q: copyQ, P: copyQ };
  }
  const invSqrt = 1 / Math.sqrt(aQa);
  const b = Qa.map((v) => v * invSqrt);
  const nextC = c.map((v, i) => v - b[i] / (n + 1));
  const scale = (n * n) / (n * n - 1);
  const factor = 2 / (n + 1);
  const nextQ = Q.map((row, i) => row.map((v, j) => scale * (v - factor * b[i] * b[j])));
  return { c: nextC, center: nextC, Q: nextQ, P: nextQ };
}

/** Boundary points of an `l_p` norm ball (`p = 1`, `2`, `Infinity`, or any `p >= 0.5`). */
export function normBallPoints(p = 2, radius = 1, center = [0, 0], steps = 64, closed = false) {
  const cx = center[0], cy = center[1];
  if (p === 1) {
    const v = [[cx + radius, cy], [cx, cy + radius], [cx - radius, cy], [cx, cy - radius]];
    if (closed) v.push(v[0]);
    return v;
  }
  if (!Number.isFinite(p)) {
    const v = [[cx - radius, cy - radius], [cx + radius, cy - radius], [cx + radius, cy + radius], [cx - radius, cy + radius]];
    if (closed) v.push(v[0]);
    return v;
  }
  const exp = 2 / Math.max(0.5, p);
  const count = closed ? steps + 1 : steps;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const th = (i / steps) * Math.PI * 2;
    const ct = Math.cos(th), st = Math.sin(th);
    out[i] = [
      cx + radius * Math.sign(ct) * Math.pow(Math.abs(ct), exp),
      cy + radius * Math.sign(st) * Math.pow(Math.abs(st), exp),
    ];
  }
  return out;
}

/** Exact breakpoints of upper (`'max'`) or lower (`'min'`) envelope of affine lines `{ slope, intercept }` or `[slope, intercept]` on `[x0, x1]`. */
export function linearEnvelope(lines = [], domain = [0, 1], kind = "max") {
  const normLines = lines.map((L) => (Array.isArray(L) ? { slope: L[0], intercept: L[1] } : L));
  const isMax = kind !== "min";
  const valueAt = (x) => {
    if (!normLines.length) return 0;
    let best = isMax ? -Infinity : Infinity;
    for (let i = 0; i < normLines.length; i++) {
      const y = normLines[i].slope * x + normLines[i].intercept;
      if (isMax ? y > best : y < best) best = y;
    }
    return best;
  };
  if (!normLines.length) {
    const empty = [];
    Object.defineProperties(empty, { points: { value: empty }, valueAt: { value: valueAt } });
    return empty;
  }
  const x0 = domain[0], x1 = domain[1];
  const sorted = normLines.slice().sort((a, b) => (isMax ? a.slope - b.slope || a.intercept - b.intercept : b.slope - a.slope || b.intercept - a.intercept));
  const hull = [];
  const intersectX = (L1, L2) => (L2.intercept - L1.intercept) / (L1.slope - L2.slope);
  for (const L of sorted) {
    if (hull.length && Math.abs(hull[hull.length - 1].slope - L.slope) < 1e-12) {
      const keepNew = isMax ? L.intercept > hull[hull.length - 1].intercept : L.intercept < hull[hull.length - 1].intercept;
      if (keepNew) hull.pop();
      else continue;
    }
    while (hull.length >= 2) {
      const xPrev = intersectX(hull[hull.length - 2], hull[hull.length - 1]);
      const xNew = intersectX(hull[hull.length - 1], L);
      if (xNew <= xPrev + 1e-12) hull.pop();
      else break;
    }
    hull.push(L);
  }
  const xs = [x0];
  for (let i = 0; i < hull.length - 1; i++) {
    const xi = intersectX(hull[i], hull[i + 1]);
    if (xi > x0 + 1e-9 && xi < x1 - 1e-9) xs.push(xi);
  }
  xs.push(x1);
  const pts = xs.map((x) => [x, valueAt(x)]);
  Object.defineProperties(pts, {
    points: { value: pts, enumerable: false },
    valueAt: { value: valueAt, enumerable: false },
  });
  return pts;
}

/** Vertices of a regular `n`-gon (e.g. `C_5` pentagon, `K_k` ring). */
export function regularPolygonPoints(cx, cy, r, n = 5, startAngle = -Math.PI / 2) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = startAngle + (i * Math.PI * 2) / n;
    out[i] = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  }
  return out;
}

/**
 * Tidy layered tree layout for evolutionary archives, search trees, and `TC^0` fan-in pyramids.
 * Returns `{ nodes, edges, byId }` directly consumable by `marks.graph(...)`.
 */
export function layoutTree(rootSpec, opts = {}) {
  const bounds = opts.bounds || (opts.w != null ? opts : { x: 40, y: 40, w: 400, h: 240 });
  const orient = opts.orientation || "top-down";
  const nodes = [];
  const edges = [];
  const byId = new Map();
  let maxDepth = 0;
  let leafCount = 0;

  function walk(spec, depth, parentId) {
    if (depth > maxDepth) maxDepth = depth;
    const kids = spec.children || [];
    const entry = { ...spec, id: String(spec.id), depth, u: 0 };
    delete entry.children;
    nodes.push(entry);
    byId.set(entry.id, entry);
    if (parentId != null) edges.push({ from: parentId, to: entry.id, ...(spec.edge || {}) });
    if (!kids.length) {
      entry.u = leafCount++;
    } else {
      let sum = 0;
      for (let i = 0; i < kids.length; i++) sum += walk(kids[i], depth + 1, entry.id);
      entry.u = sum / kids.length;
    }
    return entry.u;
  }
  walk(rootSpec, 0, null);
  const uSpan = Math.max(1, leafCount - 1);
  const dSpan = Math.max(1, maxDepth);
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    const tu = leafCount <= 1 ? 0.5 : nd.u / uSpan;
    const td = maxDepth === 0 ? 0.5 : nd.depth / dSpan;
    if (orient === "bottom-up") {
      nd.x = bounds.x + tu * bounds.w;
      nd.y = bounds.y + (1 - td) * bounds.h;
    } else if (orient === "left-right") {
      nd.x = bounds.x + td * bounds.w;
      nd.y = bounds.y + tu * bounds.h;
    } else if (orient === "right-left") {
      nd.x = bounds.x + (1 - td) * bounds.w;
      nd.y = bounds.y + tu * bounds.h;
    } else {
      nd.x = bounds.x + tu * bounds.w;
      nd.y = bounds.y + td * bounds.h;
    }
  }
  return { nodes, edges, byId };
}

export function wrapMono(text, maxChars) {
  const out = [];
  for (const para of String(text).split("\n")) {
    if (para.length <= maxChars) {
      out.push(para);
      continue;
    }
    const indent = (para.match(/^\s*/) || [""])[0].slice(0, Math.floor(maxChars / 3));
    let line = "";
    for (const word of para.trim().split(/ +/)) {
      const cand = line ? `${line} ${word}` : `${indent}${word}`;
      if (cand.length <= maxChars) line = cand;
      else {
        if (line) out.push(line);
        line = `${indent}${word}`.slice(0, maxChars);
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * Mount a responsive HiDPI canvas diagram.
 * spec: {
 *   height: (W, ctx) => number,
 *   cycle?: number,          // loop period in seconds (omit or 0 for static/pointer-only)
 *   reduceAt?: number,       // static timestamp in seconds under prefers-reduced-motion
 *   draw: (ctx, W, H, state) => void
 * }
 */
export function mountDiagram(canvas, spec) {
  const ctx = canvas.getContext("2d");
  const cycle = spec.cycle || 0;
  const reducedMotion = () =>
    !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  let W = 0;
  let H = 0;
  let inView = false;
  let paused = reducedMotion();
  let rafId = 0;
  let elapsedMs = paused && cycle > 0 ? (spec.reduceAt ?? cycle * 0.95) * 1000 : 0;
  let lastNow = null;

  const pointer = { x: 0, y: 0, normX: 0.5, normY: 0.5, active: false };

  let cachedP = null;
  let cachedPSig = "";

  function readThemeSig() {
    const root = typeof document !== "undefined" ? document.documentElement : null;
    const ds1 = canvas.dataset;
    const ds2 = root && root.dataset;
    const a1 = ds1 ? `${ds1.theme || ""}|${ds1.pfStyle || ""}|${ds1.colorScheme || ""}|${ds1.xarpColorScheme || ""}|${ds1.hrsStyle || ""}` : "";
    const a2 = ds2 ? `${ds2.theme || ""}|${ds2.pfStyle || ""}|${ds2.colorScheme || ""}|${ds2.xarpColorScheme || ""}|${ds2.hrsStyle || ""}` : "";
    return `${a1}||${a2}||${canvas.className || ""}||${(root && root.className) || ""}`;
  }

  function currentPalette() {
    const sig = readThemeSig();
    if (cachedP && sig === cachedPSig) return cachedP;
    cachedPSig = sig;
    cachedP = palette(canvas);
    return cachedP;
  }

  function syncToggleButton() {
    const fig = canvas.closest("figure");
    const btn = fig && fig.querySelector("[data-diagram-toggle]");
    if (!btn) return;
    btn.textContent = paused ? "▶ Play" : "❚❚ Pause";
    btn.setAttribute("aria-pressed", String(paused));
  }

  function renderOnce() {
    if (W <= 0 || H <= 0) return;
    ctx.clearRect(0, 0, W, H);
    const P = currentPalette();
    const t = cycle > 0 ? (elapsedMs / 1000) % cycle : elapsedMs / 1000;
    spec.draw(ctx, W, H, { t, elapsedMs, cycle, paused, pointer, P });
  }

  function tick(now) {
    rafId = 0;
    if (!inView) {
      lastNow = null;
      return;
    }
    if (!paused && cycle > 0) {
      if (lastNow !== null) elapsedMs += Math.min(100, Math.max(0, now - lastNow));
      lastNow = now;
    } else {
      lastNow = null;
    }
    renderOnce();
    if (!paused && cycle > 0 && inView) {
      rafId = window.requestAnimationFrame(tick);
    }
  }

  function schedule() {
    if (!rafId && inView && !paused && cycle > 0) {
      lastNow = null;
      rafId = window.requestAnimationFrame(tick);
    } else {
      renderOnce();
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.floor(canvas.clientWidth || canvas.getBoundingClientRect().width || 640));
    H = Math.max(1, Math.round(spec.height(W, ctx)));
    canvas.style.height = `${H}px`;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderOnce();
  }

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(
    (entries) => {
      const vis = entries.some((e) => e.isIntersecting);
      inView = vis;
      if (vis) schedule();
    },
    { threshold: 0.05 }
  ).observe(canvas);

  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    pointer.normX = clamp(pointer.x / Math.max(1, r.width), 0, 1);
    pointer.normY = clamp(pointer.y / Math.max(1, r.height), 0, 1);
    pointer.active = true;
    if (paused || cycle === 0) renderOnce();
  });
  canvas.addEventListener("pointerleave", () => {
    pointer.active = false;
    if (paused || cycle === 0) renderOnce();
  });

  const fig = canvas.closest("figure");
  const toggleBtn = fig && fig.querySelector("[data-diagram-toggle]");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      paused = !paused;
      if (!paused && reducedMotion() && elapsedMs >= (spec.reduceAt ?? cycle * 0.95) * 990) {
        elapsedMs = 0;
      }
      syncToggleButton();
      schedule();
    });
  }

  window.addEventListener("chao-theme-change", () => {
    cachedP = null;
    renderOnce();
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(renderOnce).catch(() => {});
  }

  syncToggleButton();
  resize();
  return { redraw: renderOnce, pause: () => { paused = true; syncToggleButton(); }, play: () => { paused = false; syncToggleButton(); schedule(); } };
}
