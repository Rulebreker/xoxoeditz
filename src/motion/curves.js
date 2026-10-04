// Reusable animation curves: u in [0,1] -> value (may overshoot outside [0,1] on purpose).
// Used for motion (position/scale), velocity (speed ramps) and text animation, so everything shares one vocabulary.

const pow = (p) => (u) => u ** p;
const outPow = (p) => (u) => 1 - (1 - u) ** p;

/** CSS-style cubic-bezier(x1,y1,x2,y2): Newton-Raphson with a bisection fallback. */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1; const bx = 3 * (x2 - x1) - cx; const ax = 1 - cx - bx;
  const cy = 3 * y1; const by = 3 * (y2 - y1) - cy; const ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const Y = (t) => ((ay * t + by) * t + cy) * t;
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (u) => {
    if (u <= 0) return 0; if (u >= 1) return 1;
    let t = u;
    for (let i = 0; i < 8; i++) { const e = X(t) - u; if (Math.abs(e) < 1e-6) return Y(t); const d = dX(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0; let hi = 1; t = u;
    for (let i = 0; i < 40; i++) { const e = X(t) - u; if (Math.abs(e) < 1e-6) break; if (e > 0) hi = t; else lo = t; t = (lo + hi) / 2; }
    return Y(t);
  };
}

export const EASINGS = {
  linear: (u) => u,
  'ease-in': pow(2), 'ease-out': outPow(2),
  'ease-in-out': (u) => (u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2),
  'ease-in-cubic': pow(3), 'ease-out-cubic': outPow(3),
  'ease-in-out-cubic': (u) => (u < 0.5 ? 4 * u ** 3 : 1 - ((-2 * u + 2) ** 3) / 2),
  // exponential-like ramps: slow start, snap to speed (and the mirror)
  'ease-in-expo': (u) => (u === 0 ? 0 : 2 ** (10 * u - 10)),
  'ease-out-expo': (u) => (u === 1 ? 1 : 1 - 2 ** (-10 * u)),
  'ease-in-out-expo': (u) => (u === 0 ? 0 : u === 1 ? 1 : u < 0.5 ? 2 ** (20 * u - 10) / 2 : (2 - 2 ** (-20 * u + 10)) / 2),
  smoothstep: (u) => u * u * (3 - 2 * u),
  smootherstep: (u) => u * u * u * (u * (u * 6 - 15) + 10),
};

/** Parameterised curves. Each factory returns u -> value. */
export const FACTORIES = {
  bezier: (x1, y1, x2, y2) => cubicBezier(x1, y1, x2, y2),
  /** overshoots the target by ~`amount` (0.1 = 10%) then settles (ease-out-back). */
  overshoot: (amount = 0.12) => { const c1 = amount * 10 + 0.5; const c3 = c1 + 1; return (u) => 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2; },
  /** pulls back before moving (ease-in-back). */
  anticipation: (amount = 0.1) => { const c1 = amount * 10 + 0.5; const c3 = c1 + 1; return (u) => c3 * u ** 3 - c1 * u ** 2; },
  elastic: (amp = 1, period = 0.35) => (u) => (u === 0 ? 0 : u === 1 ? 1 : amp * 2 ** (-10 * u) * Math.sin(((u * 10 - 0.75) * 2 * Math.PI) / (period * 10)) + 1),
  /** damped spring: 0 -> 1 with decaying oscillation. */
  spring: (damping = 0.18, freq = 3) => (u) => (u >= 1 ? 1 : 1 - Math.exp(-u * damping * 30) * Math.cos(u * freq * Math.PI * 2)),
  /** hits hard and settles: fast rise, small rebound. */
  impact: (rebound = 0.08) => (u) => (u < 0.18 ? (u / 0.18) ** 0.6 * (1 + rebound) : 1 + rebound * Math.cos(((u - 0.18) / 0.82) * Math.PI * 2.5) * (1 - (u - 0.18) / 0.82) ** 2),
  /** piecewise-linear through points [[u,v], ...] (u ascending, first at 0, last at 1). */
  custom: (points) => (u) => {
    const p = points; if (u <= p[0][0]) return p[0][1]; if (u >= p[p.length - 1][0]) return p[p.length - 1][1];
    for (let i = 1; i < p.length; i++) if (u <= p[i][0]) { const [u0, v0] = p[i - 1]; const [u1, v1] = p[i]; return v0 + ((v1 - v0) * (u - u0)) / (u1 - u0); }
    return 1;
  },
};

/**
 * Build a curve from a spec: 'ease-out' | 'overshoot:0.15' | 'bezier:0.2,0.8,0.2,1' | 'spring:0.2,3' | {type, args} | function.
 * Unknown names throw (a typo must not silently become linear).
 */
export function curve(spec = 'linear') {
  if (typeof spec === 'function') return spec;
  if (spec && typeof spec === 'object') { const f = FACTORIES[spec.type]; if (!f) throw new Error(`unknown curve type "${spec.type}"`); return f(...(spec.args || (spec.points ? [spec.points] : []))); }
  const [name, argStr] = String(spec).split(':');
  if (EASINGS[name]) return EASINGS[name];
  if (FACTORIES[name]) return FACTORIES[name](...(argStr ? argStr.split(',').map(Number) : []));
  throw new Error(`unknown curve "${spec}"`);
}

export const CURVE_NAMES = [...Object.keys(EASINGS), ...Object.keys(FACTORIES)];
export const lerp = (a, b, t) => a + (b - a) * t;
