// VELOCITY ENGINE: turns a profile + dials + clip into a speed map, with controlled variation so successive
// shots never repeat the same curve, and with the source-window maths that keeps every frame readable.

import { VELOCITY_PROFILES, profileForDials } from './profiles.js';
import { mapDuration, sourceWindow, fitToSource, toTimeRemapKeys, describeMap } from './speedmap.js';
import { round } from '../core/time.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Build one speed map for `duration` seconds from a pattern.
 * @param {object} o { profile, pattern, duration, rng, fps, shape, avoidCurve, allowReverse }
 */
export function buildSpeedMap({ profile, pattern, duration, rng, fps = 24, shape = 1, avoidCurve = null, allowReverse = true }) {
  const jitter = 0.07 + 0.08 * shape;
  // shape first, then jitter, then clamp: speeds can never leave the profile's range
  const nodes = pattern.map((n) => (n === 'impact' ? n : clamp((1 + (n - 1) * shape) * (1 + rng.range(-jitter, jitter)), profile.minSpeed, profile.maxSpeed)));
  const items = nodes.map((n) => (n === 'impact' ? { impact: true } : { s: n, w: rng.range(0.8, 1.25) }));
  const impactDur = (rng.int(2, 4)) / fps;
  const nImpacts = items.filter((i) => i.impact).length;
  const speedItems = items.filter((i) => !i.impact);
  const wSum = speedItems.reduce((a, b) => a + b.w, 0);
  const avail = Math.max(0.2, duration - nImpacts * impactDur);
  for (const it of speedItems) it.d = (avail * it.w) / wSum;

  const segments = []; const curvesUsed = []; const impacts = []; let t = 0; let lastCurve = avoidCurve; let reversed = false;
  const pickCurve = () => { const options = profile.curves.filter((c) => c !== lastCurve); const c = rng.pick(options.length ? options : profile.curves); lastCurve = c; curvesUsed.push(c); return c; };
  let prevSpeed = null; let prevWasImpact = false;
  items.forEach((it, idx) => {
    if (it.impact) {
      // pre-impact slowdown (inside the previous plateau) then a freeze
      const last = segments[segments.length - 1];
      if (last && Math.abs(last.from - last.to) < 1e-6 && last.dur > 0.2) {
        const slow = Math.min(0.14, last.dur * 0.4);
        last.dur -= slow; segments.push({ dur: slow, from: last.to, to: Math.max(0.12, last.to * 0.15), curve: 'ease-in', preImpact: true });
      }
      impacts.push(round(segments.reduce((a, s) => a + s.dur, 0), 4)); // time at which the freeze starts
      segments.push({ dur: impactDur, from: 0, to: 0, curve: 'linear', freeze: true });
      prevWasImpact = true; prevSpeed = 0; return;
    }
    let remaining = it.d;
    if (prevSpeed !== null) {
      const ramp = Math.min(rng.range(profile.rampDur[0], profile.rampDur[1]) * (prevWasImpact ? 0.7 : 1), remaining * 0.55);
      const cName = prevWasImpact ? 'ease-out-expo' : pickCurve();
      if (ramp > 1 / fps) { segments.push({ dur: ramp, from: prevSpeed, to: it.s, curve: cName, ...(prevWasImpact ? { postImpact: true } : {}) }); remaining -= ramp; }
    }
    if (remaining > 1 / fps / 2) segments.push({ dur: remaining, from: it.s, to: it.s, curve: 'linear' });
    // optional rewind stutter between plateaus (never first/last)
    if (allowReverse && !reversed && profile.reverse > 0 && idx > 0 && idx < items.length - 1 && rng.chance(profile.reverse * 2)) {
      const rd = rng.range(0.18, 0.32);
      const tail = segments[segments.length - 1];
      if (tail.dur > rd + 0.25) { tail.dur -= rd; segments.push({ dur: rd, from: -rng.range(1.1, 2), to: -rng.range(1.1, 2), curve: 'linear', reverse: true }); segments.push({ dur: 0.001, from: tail.to, to: tail.to, curve: 'linear' }); reversed = true; }
    }
    prevSpeed = it.s; prevWasImpact = false;
  });
  // make the total exactly `duration`
  const total = segments.reduce((a, s) => a + s.dur, 0);
  const lastHold = [...segments].reverse().find((s) => !s.freeze && !s.reverse && s.dur > 0.01);
  if (lastHold) lastHold.dur += duration - total;
  const cleaned = segments.filter((s) => s.dur > 1e-4).map((s) => ({ ...s, dur: round(s.dur, 6), from: round(s.from, 4), to: round(s.to, 4) }));
  // absorb rounding drift so the map is exactly the requested length
  const drift = duration - cleaned.reduce((a, s) => a + s.dur, 0);
  const holdIdx = cleaned.map((s, i) => (!s.freeze && !s.reverse ? i : -1)).filter((i) => i >= 0).pop();
  if (holdIdx !== undefined) cleaned[holdIdx].dur = round(cleaned[holdIdx].dur + drift, 6);
  return { segments: cleaned, curvesUsed, impacts, reverse: reversed, duration: round(cleaned.reduce((a, s) => a + s.dur, 0), 6) };
}

export class VelocityPlanner {
  constructor({ profileId = null, dials = {}, rng, fps = 24 }) {
    this.profileId = profileId || profileForDials(dials);
    this.profile = VELOCITY_PROFILES[this.profileId];
    if (!this.profile) throw new Error(`unknown velocity profile "${this.profileId}"`);
    this.dials = dials; this.rng = rng; this.fps = fps;
    this.history = { lastPattern: -1, lastCurve: null, patterns: [], curves: [], maps: [] };
  }

  /** Speed variation dial -> how far nodes stray from 1.0x (0.2 -> gentle, 0.8+ -> full profile range). */
  get shape() { return clamp(0.35 + 0.85 * (this.dials.speedVariation ?? 0.5), 0.3, 1.25); }

  /**
   * Plan a variable-speed shot for a VIDEO clip.
   * @param {object} o { duration (slot seconds), clip: {duration, fps}, handleIn, handleOut, prefer: {start} (source seconds worth showing), forceImpactAt }
   * @returns {null | { map, sourceIn, k, fits, patternId, window, frameBlend, notes }}
   */
  plan({ duration, clip, handleIn = 0, handleOut = 0, prefer = null }) {
    const p = this.profile; const rng = this.rng;
    let idx; let tries = 0;
    do { idx = rng.int(0, p.patterns.length - 1); tries++; } while (idx === this.history.lastPattern && tries < 8 && p.patterns.length > 1);
    const pattern = p.patterns[idx];
    const map = buildSpeedMap({ profile: p, pattern, duration, rng, fps: this.fps, shape: this.shape, avoidCurve: this.history.lastCurve, allowReverse: (this.dials.speedVariation ?? 0.5) > 0.5 });
    const avail = Math.max(0.2, clip.duration - 0.12 - (handleIn + handleOut) * Math.max(1, this.profile.maxSpeed * 0.5));
    const fit = fitToSource(map, avail, { minK: 0.45 });
    const w = fit.window;
    const slack = Math.max(0, clip.duration - 0.06 - (w.span + (handleIn + handleOut) * 1.5));
    let sourceIn = prefer && Number.isFinite(prefer.start) ? prefer.start - w.min : 0.18 * slack + handleIn * 1.5 - w.min;
    sourceIn = clamp(sourceIn, -w.min + handleIn * 1.5, Math.max(-w.min + handleIn * 1.5, clip.duration - 0.06 - w.max - handleOut * 1.5));
    this.history.lastPattern = idx; this.history.lastCurve = fit.map.curvesUsed.at(-1) ?? this.history.lastCurve;
    this.history.patterns.push(idx); this.history.curves.push(...fit.map.curvesUsed); this.history.maps.push(describeMap(fit.map));
    const slowParts = fit.map.segments.some((s) => Math.min(s.from, s.to) < 0.8 && Math.min(s.from, s.to) > 0.02);
    return { map: fit.map, sourceIn: round(sourceIn, 4), k: round(fit.k, 3), fits: fit.fits, patternId: `${this.profileId}#${idx + 1}`, window: fit.window, frameBlend: slowParts ? 'pixel' : 'mix', notes: fit.fits ? [] : [`needs ${round(fit.k, 2)}x slow-down to fit the clip: prefer a longer clip`] };
  }

  keysFor(plan, { srcClipDuration, handleIn = 0, handleOut = 0 }) {
    return toTimeRemapKeys(plan.map, { fps: this.fps, srcStart: plan.sourceIn, clipDuration: srcClipDuration, handleIn, handleOut });
  }
}

export { describeMap, mapDuration, sourceWindow };
