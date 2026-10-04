// RHYTHM: cut the timeline into shots whose boundaries sit on the music. Shot length follows the section's energy
// and the edit's cut frequency; cut points are chosen from beat-grid candidates weighted towards downbeats, phrase
// starts, drops and impacts, so a cut lands ON a hit rather than near it. Deterministic for a seed.

import { gridPoints, energyAt, sectionAt } from '../beat/analyze.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const near = (list, t, tol) => list.some((x) => Math.abs((x.t ?? x) - t) <= tol);

/**
 * @param {object} map beat map (real or virtual)
 * @param {object} o { duration, shotSeconds:[lo,hi], cutFrequency (0..1), rng, phrasing:'bars'|'sentences'|'free', introSeconds=0, outroSeconds=0, fps }
 * @returns {{start,end,energy,section,onDownbeat,onImpact}[]}
 */
export function slotShots(map, { duration, shotSeconds = [1.5, 4], cutFrequency = 0.5, rng, phrasing = 'bars', introSeconds = 0, outroSeconds = 0, fps = 24 }) {
  const [lo, hi] = shotSeconds;
  const half = gridPoints(map, 'half'); const beats = map.beats.length ? gridPoints(map, 'beat') : half;
  const quarter = gridPoints(map, 'quarter');
  const grid = (cutFrequency >= 0.7 ? half : beats).filter((t) => t > 0 && t < duration);
  const downs = map.downbeats; const phrases = map.phrases.map((p) => p.start); const hits = [...map.drops.map((d) => d.t ?? d), ...map.impacts.map((i) => i.t ?? i)];
  const strong = [...map.drops.map((d) => d.t ?? d), ...map.impacts.filter((i) => i.kind === 'drop' || (i.strength ?? 0) >= 0.85).map((i) => i.t ?? i)]; // only these make a shot an "impact" shot
  const snapFrame = (t) => Math.round(t * fps) / fps;
  const cuts = [0];
  const fixedIntro = introSeconds > 0 ? snapToNearestGrid(introSeconds, downs.length ? downs : beats, 1.2) : 0;
  if (fixedIntro > 0 && fixedIntro < duration - lo) cuts.push(snapFrame(fixedIntro));
  const outroStart = outroSeconds > 0 ? duration - outroSeconds : duration;
  let t = cuts[cuts.length - 1];
  const stop = outroSeconds > 0 ? snapFrame(snapToNearestGrid(outroStart, downs.length ? downs : beats, 1.2, duration - lo)) : duration;
  let guard = 0;
  while (stop - t > lo * 1.05 && guard++ < 500) {
    const e = energyAt(map, t); const sec = sectionAt(map, t);
    const secBoost = sec?.kind === 'drop' ? 0.25 : sec?.kind === 'break' ? -0.3 : sec?.kind === 'build' ? 0.1 : 0;
    const urgency = clamp(0.55 * e + 0.45 * cutFrequency + secBoost, 0, 1);
    const want = lerp(hi, lo, urgency) * rng.range(0.8, 1.2);
    const cands = grid.filter((g) => g >= t + lo * 0.85 && g <= Math.min(stop, t + hi * 1.15) && stop - g >= (g === stop ? 0 : lo * 0.6) || Math.abs(g - stop) < 1e-3);
    let pick;
    if (!cands.length) pick = Math.min(stop, t + clamp(want, lo, hi));
    else {
      const w = cands.map((g) => {
        let s = Math.exp(-(((g - t) - want) ** 2) / (2 * (0.35 * (hi - lo) + 0.15) ** 2));
        if (near(downs, g, 0.03) && phrasing === 'bars') s *= 2.2;
        if (near(phrases, g, 0.03)) s *= 1.6;
        if (near(hits, g, 0.05)) s *= 4;
        return { g, w: s + 1e-6 };
      });
      pick = rng.weighted(w).g;
    }
    pick = snapFrame(pick);
    if (pick <= t + 1 / fps) break;
    cuts.push(pick); t = pick;
  }
  if (stop > t + 1 / fps && Math.abs(stop - t) > 1e-6) cuts.push(snapFrame(stop));
  // a trailing sliver merges into its neighbour
  if (cuts.length > 2 && cuts[cuts.length - 1] - cuts[cuts.length - 2] < lo * 0.6) cuts.splice(cuts.length - 2, 1);
  if (outroSeconds > 0) { if (cuts[cuts.length - 1] !== snapFrame(duration)) cuts.push(snapFrame(duration)); } else cuts[cuts.length - 1] = snapFrame(duration);
  const shots = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i]; const b = cuts[i + 1]; if (b - a < 2 / fps) continue;
    shots.push({ start: +a.toFixed(4), end: +b.toFixed(4), energy: +energyAt(map, (a + b) / 2).toFixed(3), section: sectionAt(map, a)?.kind ?? null, onDownbeat: near(downs, a, 0.03), onImpact: near(strong, a, 0.06) });
  }
  return shots;
}

function snapToNearestGrid(t, list, tol, max = Infinity) {
  let best = t; let d = Infinity;
  for (const g of list) { const dd = Math.abs(g - t); if (dd < d && g <= max) { d = dd; best = g; } }
  return d <= tol ? best : t;
}

/** Impact times (relative to the shot) from the beat map: drops, impacts and, in hot sections, downbeats. */
export function impactsIn(map, start, end, { hot = false } = {}) {
  const out = [];
  for (const h of [...map.drops, ...map.impacts]) { const t = h.t ?? h; if (t >= start - 1e-6 && t < end - 0.05) out.push(+(t - start).toFixed(4)); }
  if (hot) for (const d of map.downbeats) if (d > start + 0.05 && d < end - 0.05) out.push(+(d - start).toFixed(4));
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Role of a shot, used by templates and asset scoring. */
export function roleFor(shot, index, count, map) {
  if (index === 0) return 'intro';
  if (index === count - 1) return 'outro';
  if (shot.onImpact) return 'impact';
  if (shot.energy >= 0.7) return 'detail';
  if (shot.energy <= 0.3) return 'wide';
  return 'hero';
}
