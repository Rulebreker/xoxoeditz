// SPEED MAP: speed as a function of time, built from segments {dur, from, to, curve}. Source position is the
// integral of speed, so any curve (smooth ramps, exponential snaps, freezes, reverse stutters) is expressible.
// Time remapping then needs only (comp time -> source time) keyframes sampled from this integral.

import { curve } from '../motion/curves.js';
import { round } from '../core/time.js';

const EPS = 1e-9;

export function segmentSpeed(seg, u) {
  const f = curve(seg.curve || 'linear');
  return seg.from + (seg.to - seg.from) * f(Math.min(1, Math.max(0, u)));
}

export const mapDuration = (map) => map.segments.reduce((a, s) => a + s.dur, 0);

export function speedAt(map, t) {
  let acc = 0;
  for (const s of map.segments) {
    if (t <= acc + s.dur + EPS) return segmentSpeed(s, s.dur ? (t - acc) / s.dur : 1);
    acc += s.dur;
  }
  const last = map.segments[map.segments.length - 1];
  return last.to;
}

/** Source position (seconds of source consumed since the start of the map) at fine resolution. */
export function positionTable(map, step = 1 / 96) {
  // integrate segment by segment so speed discontinuities (freezes, hard cuts in speed) are exact
  const times = [0]; const pos = [0]; let t = 0; let p = 0;
  for (const s of map.segments) {
    const n = Math.max(1, Math.ceil(s.dur / step));
    let prev = segmentSpeed(s, 0);
    for (let i = 1; i <= n; i++) {
      const sp = segmentSpeed(s, i / n); const dt = s.dur / n;
      p += ((prev + sp) / 2) * dt; t += dt; prev = sp; times.push(t); pos.push(p);
    }
  }
  return { times, pos };
}

export function posAt(table, t) {
  const { times, pos } = table;
  if (t <= 0) return pos[0] + 0; if (t >= times[times.length - 1]) return pos[pos.length - 1];
  let lo = 0; let hi = times.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  const f = (t - times[lo]) / (times[hi] - times[lo] || 1);
  return pos[lo] + (pos[hi] - pos[lo]) * f;
}

/** How much source the map touches: relative to its start, [min,max] positions and the final position. */
export function sourceWindow(map) {
  const tb = positionTable(map);
  return { min: Math.min(...tb.pos), max: Math.max(...tb.pos), end: tb.pos[tb.pos.length - 1], span: Math.max(...tb.pos) - Math.min(...tb.pos) };
}

const scaleMap = (map, k) => ({ ...map, segments: map.segments.map((s) => ({ ...s, from: s.from * k, to: s.to * k })) });

/**
 * Scale speeds (preserving the shape) so the map fits in `available` source seconds.
 * Returns { map, k, fits } - fits=false when the needed slow-down is beyond `minK` (caller should choose
 * another clip or a shorter slot instead of producing a near-freeze).
 */
export function fitToSource(map, available, { minK = 0.45 } = {}) {
  const w = sourceWindow(map);
  if (w.span <= available + EPS) return { map, k: 1, fits: true, window: w };
  const k = available / w.span;
  const scaled = scaleMap(map, k);
  return { map: scaled, k, fits: k >= minK, window: sourceWindow(scaled) };
}

/**
 * Time-remap keyframes for the map. t is relative to the map start; src is absolute source seconds
 * (srcStart is where the map's first frame reads). Ramps are sampled every `rampStep` frames and snapped to the
 * frame grid; constant stretches need only their end points. Handles extend the ends at the boundary speed so
 * overlapping transitions have footage to show. Positions are clamped into [0, clipDuration].
 */
export function toTimeRemapKeys(map, { fps, srcStart, clipDuration, handleIn = 0, handleOut = 0, rampStep = 2 }) {
  const total = mapDuration(map);
  const tb = positionTable(map);
  const times = new Set([0, round(total, 5)]);
  let acc = 0;
  for (const s of map.segments) {
    times.add(round(acc, 5));
    const constant = Math.abs(s.to - s.from) < 1e-6;
    if (!constant) { const n = Math.max(1, Math.ceil((s.dur * fps) / rampStep)); for (let i = 1; i < n; i++) times.add(round(acc + (s.dur * i) / n, 5)); }
    acc += s.dur;
    times.add(round(acc, 5));
  }
  const frame = 1 / fps;
  const snapped = [...times].map((t) => (t <= 0 || t >= total ? t : Math.round(t / frame) * frame)).sort((a, b) => a - b).filter((t, i, arr) => i === 0 || t - arr[i - 1] > 1e-6);
  let clamped = false;
  const lim = (v) => { const c = Math.min(Math.max(v, 0), Math.max(0, clipDuration - frame)); if (Math.abs(c - v) > 1e-6) clamped = true; return c; };
  const keys = snapped.map((t) => ({ t: round(t, 4), src: round(lim(srcStart + posAt(tb, t)), 4) }));
  const s0 = speedAt(map, 0); const s1 = speedAt(map, total);
  if (handleIn > 0) keys.unshift({ t: round(-handleIn, 4), src: round(lim(srcStart - s0 * handleIn), 4) });
  if (handleOut > 0) keys.push({ t: round(total + handleOut, 4), src: round(lim(srcStart + posAt(tb, total) + s1 * handleOut), 4) });
  return { keys, clamped };
}

/** Normalised progress curve u -> [0,1] from the forward part of a map: lets still images get velocity-shaped camera ramps. */
export function progressCurve(map) {
  const tb = positionTable(map); const total = tb.times[tb.times.length - 1]; const end = tb.pos[tb.pos.length - 1] || 1;
  return (u) => Math.min(1, Math.max(0, posAt(tb, u * total) / end));
}

/** Compact, human-readable summary for plan files and reports. */
export function describeMap(map) {
  return map.segments.map((s) => (Math.abs(s.from - s.to) < 1e-6 ? `${round(s.from, 2)}x for ${round(s.dur, 2)}s` : `${round(s.from, 2)}x->${round(s.to, 2)}x over ${round(s.dur, 2)}s (${s.curve})`)).join(' | ');
}
