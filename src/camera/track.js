// Turn a list of motion primitives into ONE set of After Effects keyframe tracks for a footage layer:
//   scale (percent), position (comp pixels) and rotation (degrees), all sharing the same key times.
// Guarantees: the picture always covers the comp (uniform overscan "lift"), amplitude is reduced - never the lift
// exceeded - when a rig's `maxLift` would be crossed, and the key count stays small (RDP simplification).

import { frameTimes, sampleMotion, requiredCover, simplify } from '../motion/primitives.js';
import { round } from '../core/time.js';

const TOL = { x: 0.0005, y: 0.0005, ls: 0.0008, r: 0.04 }; // per-channel tolerance: ~2 px at 4K, 0.08 % scale, 0.04 deg

/**
 * @param {object} o
 *  specs     motion primitive specs
 *  comp      {w,h}
 *  asset     {w,h} source size in pixels (unknown -> assumed to have the comp's aspect)
 *  base      cover-fit scale in percent (src px -> comp px); default derived from asset
 *  t0, dur   absolute start and length of the shot (seconds)
 *  fps, seed, maxLift (default 1.35), maxKeys (default 48)
 */
export function buildCameraTrack({ specs, comp, asset = null, base = null, t0 = 0, dur, fps = 24, seed = 'cam', maxLift = 1.35, maxKeys = 48 }) {
  const warnings = [];
  const src = asset && asset.w && asset.h ? asset : { w: comp.w, h: comp.h };
  if (!(asset && asset.w && asset.h)) warnings.push('source size unknown: overscan assumes the picture has the comp aspect');
  const basePct = base ?? Math.max(comp.w / src.w, comp.h / src.h) * 100;
  const img = { w: src.w * basePct / 100, h: src.h * basePct / 100 };
  const times = frameTimes(dur, fps);
  const raw = sampleMotion(specs, times, { shotDur: dur, seed });

  // 1. find the biggest offset multiplier k in (0,1] whose overscan fits under maxLift (offsets/rotation scale, zoom does not)
  const at = (k) => raw.map((q) => ({ t: q.t, x: q.x * k, y: q.y * k, s: q.s, r: q.r * k }));
  let k = 1; let lift = requiredCover(at(1), comp, img);
  if (lift > maxLift) {
    let lo = 0; let hi = 1;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (requiredCover(at(mid), comp, img) <= maxLift) lo = mid; else hi = mid; }
    k = lo; lift = requiredCover(at(k), comp, img);
    warnings.push(`motion amplitude reduced to ${Math.round(k * 100)}% so the picture never shows an edge (overscan cap ${maxLift}x)`);
  }
  const samples = at(k);
  lift = Math.max(1, lift) * 1.002; // 0.2 % safety margin against rounding in AE

  // 2. simplify jointly, loosening the tolerance until the key budget is met
  const series = samples.map((q) => ({ ...q, ls: Math.log(q.s) }));
  let tol = { ...TOL }; let keys = simplify(series, tol);
  for (let i = 0; i < 8 && keys.length > maxKeys; i++) { tol = { x: tol.x * 1.7, y: tol.y * 1.7, ls: tol.ls * 1.7, r: tol.r * 1.7 }; keys = simplify(series, tol); }

  // 3. AE values
  const cx = comp.w / 2; const cy = comp.h / 2;
  const K = (q, v) => ({ t: round(t0 + q.t, 4), v });
  const scale = keys.map((q) => K(q, [round(basePct * q.s * lift, 3), round(basePct * q.s * lift, 3)]));
  const position = keys.map((q) => K(q, [round(cx + q.x * comp.w, 2), round(cy + q.y * comp.h, 2)]));
  const rotation = keys.some((q) => Math.abs(q.r) > 0.01) ? keys.map((q) => K(q, round(q.r, 3))) : null;

  // 4. diagnostics: speed (for motion blur), resolution
  let peakSpeed = 0;
  for (let i = 1; i < samples.length; i++) { const dt = samples[i].t - samples[i - 1].t || 1e-6; peakSpeed = Math.max(peakSpeed, Math.hypot(samples[i].x - samples[i - 1].x, (samples[i].y - samples[i - 1].y) * comp.h / comp.w) / dt, Math.abs(Math.log(samples[i].s / samples[i - 1].s)) / dt * 0.5); }
  const maxEffectivePct = Math.max(...samples.map((q) => basePct * q.s * lift));
  const upscale = maxEffectivePct / 100; // >1 means the source is magnified beyond 1:1
  if (upscale > 1.5) warnings.push(`source is magnified ${round(upscale, 2)}x at its tightest: expect softness (use a higher-resolution source or less push)`);
  const motionBlur = peakSpeed > 0.45; // more than ~45 % of the frame width per second

  return { scale, position, rotation, lift: round(lift, 4), amplitude: round(k, 3), keys: keys.length, peakSpeed: round(peakSpeed, 3), motionBlur, upscale: round(upscale, 2), basePct: round(basePct, 3), warnings, samples };
}

/** Check a finished track the way QA does: sample the AE keyframes back (linear) and verify coverage. Returns worst uncovered fraction. */
export function verifyCoverage(track, { comp, asset = null, fps = 24 }) {
  const src = asset && asset.w && asset.h ? asset : { w: comp.w, h: comp.h };
  const interp = (keys, t) => {
    if (t <= keys[0].t) return keys[0].v; if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
    for (let i = 1; i < keys.length; i++) if (t <= keys[i].t) { const a = keys[i - 1]; const b = keys[i]; const f = (t - a.t) / (b.t - a.t || 1); return Array.isArray(a.v) ? a.v.map((x, j) => x + (b.v[j] - x) * f) : a.v + (b.v - a.v) * f; }
    return keys[keys.length - 1].v;
  };
  const t0 = track.scale[0].t; const t1 = track.scale[track.scale.length - 1].t;
  let worst = 0;
  for (const t of frameTimes(t1 - t0, fps).map((x) => x + t0)) {
    const s = interp(track.scale, t)[0] / 100; const pos = interp(track.position, t); const r = track.rotation ? interp(track.rotation, t) : 0;
    const w = src.w * s; const h = src.h * s; // picture size in comp pixels at this instant
    const q = [{ x: (pos[0] - comp.w / 2) / comp.w, y: (pos[1] - comp.h / 2) / comp.h, s: 1, r }];
    worst = Math.max(worst, requiredCover(q, comp, { w, h }) - 1);
  }
  return Math.max(0, worst);
}
