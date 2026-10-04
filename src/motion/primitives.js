// MOTION PRIMITIVES. Each primitive is a small pure function of time that returns a *delta* to the camera:
//   { x, y }  image translation as a fraction of the comp width/height (+x moves the picture right, +y down)
//   { s }     scale multiplier (1 = none)
//   { r }     rotation in degrees
// Primitives are plain JSON specs ({type, at, dur, amount, ...}) so they can live inside plan.json, be
// hand-edited, and be re-sampled deterministically. They COMPOSE: offsets and rotation add, scales multiply, and
// the sum is sampled once into a single keyframe track (see src/camera/track.js) - a push-in, a beat impact and a
// shake therefore share one set of keyframes instead of fighting over the same property.

import { curve, lerp } from './curves.js';
import { makeRng } from '../core/rng.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rad = (d) => (d * Math.PI) / 180;
const IDENT = { x: 0, y: 0, s: 1, r: 0 };

/** Zooming about a focus point (frame fractions, 0.5/0.5 = centre) shifts the picture so the focus stays put. */
const zoomAbout = (m, focus) => (focus ? { x: (focus.x - 0.5) * (1 - m), y: (focus.y - 0.5) * (1 - m) } : { x: 0, y: 0 });
const dirVec = (deg = 0) => ({ x: Math.cos(rad(deg)), y: Math.sin(rad(deg)) });

// Each entry: { hold, dur (default seconds, or null = until the end of the shot), amount (default), curve (default), fn }
// fn(p, e, u, t, ctx): e = eased progress 0..1, u = linear progress, t = seconds since the primitive started.
export const PRIMITIVES = {
  PUSH: { hold: true, dur: null, amount: 0.12, curve: 'ease-in-out', doc: 'Dolly in (scale up), optionally about a focus point.',
    fn: (p, e) => { const m = 1 + p.amount * e; return { ...zoomAbout(m, p.focus), s: m }; } },
  PULL: { hold: true, dur: null, amount: 0.12, curve: 'ease-in-out', doc: 'Dolly out: starts tight, ends wide.',
    fn: (p, e) => { const m = 1 + p.amount * (1 - e); return { ...zoomAbout(m, p.focus), s: m }; } },
  DRIFT: { hold: true, dur: null, amount: 0.08, curve: 'linear', doc: 'Slow diagonal float along `dir` degrees.',
    fn: (p, e) => { const d = dirVec(p.dir ?? 20); return { x: -(e - 0.5) * p.amount * d.x, y: -(e - 0.5) * p.amount * d.y }; } },
  PAN: { hold: true, dur: null, amount: 0.1, curve: 'ease-in-out', doc: 'Horizontal camera pan. dir 0 = camera moves right (picture slides left).',
    fn: (p, e) => ({ x: -(e - 0.5) * p.amount * Math.cos(rad(p.dir ?? 0)) }) },
  TILT: { hold: true, dur: null, amount: 0.1, curve: 'ease-in-out', doc: 'Vertical camera tilt. dir 0 = camera tilts down.',
    fn: (p, e) => ({ y: -(e - 0.5) * p.amount * Math.cos(rad(p.dir ?? 0)) }) },
  ORBIT: { hold: true, dur: null, amount: 0.06, curve: 'ease-in-out', doc: 'Elliptical arc around the subject with a hint of roll.',
    fn: (p, e) => { const sweep = rad(p.sweep ?? 80); const ph0 = rad(p.phase ?? -40); const ph = ph0 + sweep * e; const r = p.amount;
      return { x: r * (Math.cos(ph) - Math.cos(ph0)), y: r * 0.55 * (Math.sin(ph) - Math.sin(ph0)), r: (p.roll ?? 1.2) * (e - 0.5) * (p.amount / 0.06), s: 1 + p.amount * 0.25 * Math.sin(Math.PI * e) }; } },
  WHIP: { hold: true, dur: 0.2, amount: 0.45, curve: 'ease-out-expo', doc: 'Fast whip-pan. mode "in" arrives from off-axis and settles; "out" accelerates away. Wants motion blur.',
    fn: (p, e) => { const d = dirVec(p.dir ?? 0); const k = p.mode === 'out' ? e : (1 - e); const sign = p.mode === 'out' ? -1 : 1; return { x: sign * p.amount * d.x * k, y: sign * p.amount * d.y * k }; } },
  SHAKE: { hold: false, dur: null, amount: 0.012, curve: 'linear', doc: 'Seeded handheld/impact shake. `decay` 0 = constant, 1 = dies out linearly, >1 = snappy.',
    fn: (p, e, u, t, ctx) => {
      const env = p.decay ? (1 - u) ** (p.decay * 2) : 1;
      const f = p.freq ?? 9; const rng = ctx.rngFor(p);
      const lay = (i) => rng.layers[i];
      let nx = 0; let ny = 0; let nr = 0;
      for (let i = 0; i < 3; i++) { const L = lay(i); const w = 2 * Math.PI * f * L.f * t; nx += L.w * Math.sin(w + L.px); ny += L.w * Math.sin(w * 1.13 + L.py); nr += L.w * Math.sin(w * 0.87 + L.pr); }
      return { x: p.amount * env * nx, y: p.amount * env * ny, r: (p.roll ?? 40) * p.amount * env * nr };
    } },
  BOUNCE: { hold: true, dur: 0.55, amount: 0.07, curve: 'spring:0.16,2', doc: 'Starts punched-in and settles with a damped spring.',
    fn: (p, e) => { const m = 1 + p.amount * (1 - e); return { ...zoomAbout(m, p.focus), s: m }; } },
  IMPACT: { hold: false, dur: 0.35, amount: 0.06, curve: 'linear', doc: 'Beat hit: instant punch-in with a kick along `dir`, decaying exponentially.',
    fn: (p, e, u) => { const env = Math.exp(-u * 6.5); const d = dirVec(p.dir ?? 90); return { s: 1 + p.amount * env, x: d.x * p.amount * 0.5 * env, y: d.y * p.amount * 0.5 * env, r: (p.roll ?? 0.6) * (p.amount / 0.06) * env * (p.rollSign ?? 1) }; } },
  REVEAL: { hold: true, dur: null, amount: 0.18, curve: 'ease-out-expo', doc: 'Opens tight and settles fast - a "here it is" move.',
    fn: (p, e) => { const m = 1 + p.amount * (1 - e); return { ...zoomAbout(m, p.focus), s: m }; } },
  FOLLOW: { hold: true, dur: null, amount: 0.1, curve: 'ease-in-out', doc: 'Pushes in while sliding the subject toward the frame centre.',
    fn: (p, e) => { const sub = p.subject || { x: 0.5, y: 0.5 }; const st = p.strength ?? 0.6; return { x: (0.5 - sub.x) * st * e, y: (0.5 - sub.y) * st * e, s: 1 + p.amount * e }; } },
  TRACK: { hold: true, dur: null, amount: 0.1, curve: 'linear', doc: 'Keeps a moving subject (p.path = [{t,x,y}] in seconds/frame fractions) near the centre, smoothed.',
    fn: (p, e, u, t, ctx) => { const path = ctx.smoothPath(p); if (!path.length) return { s: 1 + p.amount * e }; const sub = ctx.pathAt(path, t); const st = p.strength ?? 0.6; return { x: (0.5 - sub.x) * st, y: (0.5 - sub.y) * st, s: 1 + p.amount * e }; } },
  PARALLAX: { hold: true, dur: null, amount: 0.08, curve: 'ease-in-out', doc: 'One layer of a depth stack: translation scaled by `depth` (1 = foreground, <1 = further away).',
    fn: (p, e) => { const dep = p.depth ?? 1; const d = dirVec(p.dir ?? 0); return { x: -(e - 0.5) * p.amount * dep * d.x, y: -(e - 0.5) * p.amount * dep * d.y, s: 1 + p.amount * 0.4 * dep * e }; } },
};

export const PRIMITIVE_NAMES = Object.keys(PRIMITIVES);

/** Sampling context: per-primitive seeded noise layers and smoothed subject paths, cached. */
function makeCtx(seed) {
  const cache = new Map(); const paths = new Map();
  return {
    rngFor(p) {
      const key = `${p.seed ?? seed}|${p.at ?? 0}|${p.type}`;
      if (!cache.has(key)) {
        const rng = makeRng('shake', key);
        cache.set(key, { layers: [{ f: 0.7, w: 0.5 }, { f: 1, w: 0.3 }, { f: 1.6, w: 0.2 }].map((L) => ({ ...L, px: rng.range(0, 6.28), py: rng.range(0, 6.28), pr: rng.range(0, 6.28) })) });
      }
      return cache.get(key);
    },
    smoothPath(p) {
      if (!p.path || !p.path.length) return [];
      if (!paths.has(p)) { // time-based exponential smoothing (tau 0.15 s) so sparse and dense paths smooth alike
        const out = []; let ex = p.path[0].x; let ey = p.path[0].y; let pt = p.path[0].t;
        for (const q of p.path) { const a = 1 - Math.exp(-Math.max(0, q.t - pt) / 0.15); ex += (q.x - ex) * a; ey += (q.y - ey) * a; pt = q.t; out.push({ t: q.t, x: ex, y: ey }); }
        paths.set(p, out);
      }
      return paths.get(p);
    },
    pathAt(path, t) {
      if (t <= path[0].t) return path[0]; if (t >= path[path.length - 1].t) return path[path.length - 1];
      for (let i = 1; i < path.length; i++) if (t <= path[i].t) { const a = path[i - 1]; const b = path[i]; const f = (t - a.t) / (b.t - a.t || 1); return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) }; }
      return path[path.length - 1];
    },
  };
}

/** Fill defaults for a primitive spec and validate it. Unknown types throw: a typo must not become "no motion". */
export function resolvePrimitive(spec, shotDur) {
  const def = PRIMITIVES[spec.type];
  if (!def) throw new Error(`unknown motion primitive "${spec.type}" (known: ${PRIMITIVE_NAMES.join(', ')})`);
  const at = spec.at ?? 0;
  const dur = spec.dur ?? def.dur ?? Math.max(0.05, shotDur - at);
  return { ...spec, at, dur, amount: spec.amount ?? def.amount, curveFn: curve(spec.curve ?? def.curve), def };
}

/** Delta of ONE resolved primitive at shot time t (identity outside its window unless it holds). */
function evalOne(p, t, ctx) {
  const u = (t - p.at) / p.dur;
  if (u < 0) return p.def.hold ? p.def.fn(p, p.curveFn(0), 0, 0, ctx) : IDENT; // a hold primitive sits at its first pose before it starts
  const uc = Math.min(1, u);
  if (u > 1 && !p.def.hold) return IDENT;
  return p.def.fn(p, p.curveFn(uc), uc, Math.min(t - p.at, p.dur), ctx);
}

/** Sample the composition of primitives at the given shot-relative times. */
export function sampleMotion(specs, times, { shotDur, seed = 'motion' } = {}) {
  const ctx = makeCtx(seed);
  const prims = specs.map((s) => resolvePrimitive(s, shotDur ?? (times[times.length - 1] || 1)));
  return times.map((t) => {
    let x = 0; let y = 0; let s = 1; let r = 0;
    for (const p of prims) { const d = evalOne(p, t, ctx); x += d.x || 0; y += d.y || 0; s *= d.s ?? 1; r += d.r || 0; }
    return { t, x, y, s, r };
  });
}

/** Frame-aligned sample times from 0 to dur inclusive. */
export function frameTimes(dur, fps) { const n = Math.max(1, Math.round(dur * fps)); return Array.from({ length: n + 1 }, (_, i) => (i / n) * dur); }

/**
 * Smallest uniform scale multiplier that keeps the whole comp rectangle covered by the (cover-fitted) picture for
 * every sample. `img` = picture size in comp pixels at the base scale; `comp` = {w,h}. Handles rotation by testing
 * the comp corners in the picture's own frame.
 */
export function requiredCover(samples, comp, img) {
  const hw = img.w / 2; const hh = img.h / 2; let worst = 1;
  for (const q of samples) {
    const c = Math.cos(rad(-q.r)); const sn = Math.sin(rad(-q.r));
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const px = sx * comp.w / 2 - q.x * comp.w; const py = sy * comp.h / 2 - q.y * comp.h; // corner relative to the picture centre
      const rx = Math.abs(px * c - py * sn); const ry = Math.abs(px * sn + py * c);
      worst = Math.max(worst, rx / (hw * q.s), ry / (hh * q.s)); // the picture already has scale q.s
    }
  }
  return worst;
}

/** Worst uncovered fraction (0 = never shows an edge) of a sampled track with a given extra uniform lift. */
export function uncovered(samples, comp, img, lift = 1) {
  return Math.max(0, requiredCover(samples, comp, img) / lift - 1);
}

/** Ramer-Douglas-Peucker on a multi-channel series: keeps the fewest keys that stay within tolerance per channel. */
export function simplify(samples, tol, channels = ['x', 'y', 'ls', 'r']) {
  const keep = new Uint8Array(samples.length); keep[0] = 1; keep[samples.length - 1] = 1;
  const stack = [[0, samples.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); if (b - a < 2) continue;
    let worst = 0; let wi = -1;
    for (let i = a + 1; i < b; i++) {
      const f = (samples[i].t - samples[a].t) / (samples[b].t - samples[a].t || 1);
      let err = 0; for (const ch of channels) err = Math.max(err, Math.abs(samples[i][ch] - lerp(samples[a][ch], samples[b][ch], f)) / tol[ch]);
      if (err > worst) { worst = err; wi = i; }
    }
    if (worst > 1) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  return samples.filter((_, i) => keep[i]);
}
