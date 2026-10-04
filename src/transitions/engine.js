// TRANSITION ENGINE: decides, for every cut in a timeline, WHICH transition to use and HOW LONG it lasts - then
// turns the decision into camera motion (composed into the shots' camera tracks) and ops (opacity, overlays,
// effects). Decisions are weighted by the edit type's palette, the transitions dial, what the machine can actually
// render (a transition that would only run as a dissolve is down-weighted, not silently faked), shot lengths and
// history (no repeats, chapter changes get a distinct transition). Everything is seeded and explainable.

import { resolveEffect, resolveChain } from '../effects/registry.js';
import { TRANSITION_META, TRANSITION_TYPES } from './entries.js';
import { makeRng } from '../core/rng.js';
import { snapT } from '../motion/layout.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ADVANCED = ['light', 'mask', 'luma', 'glitch', 'distortion', 'zoom', 'light_leak', 'motion_blur', 'whip'];

/** Quality (0..1) of the best implementation this machine can run for a type; 'cut' is always 1. */
export function transitionQuality(type, caps) {
  const meta = TRANSITION_META[type]; if (!meta) return 0;
  if (type === 'cut') return 1;
  const r = resolveEffect(meta.effectId, caps);
  return r.unavailable ? 0 : r.quality;
}

/**
 * @param {{id?:string,start:number,end:number}[]} shots ordered, contiguous
 * @param {object} o {
 *   editType (profile), dials ({transitions}), caps, seed, bpm (default 120), fps (24), overlayAssets: [item ids] (light leaks),
 *   chapters: [boundary indices needing a distinct transition], force: {index: type}, noTransitions: false }
 * @returns {object[]} one entry per boundary (shots.length - 1)
 */
export function planTransitions(shots, o = {}) {
  const { editType, dials = {}, caps = null, seed = 'transitions', bpm = 120, fps = 24, overlayAssets = [], chapters = [], force = {}, noTransitions = false } = o;
  const rng = makeRng('transitions', seed);
  const spec = editType?.transitions || { palette: [{ type: 'dissolve', w: 1 }], durationBeats: 1, hardCutShare: 0.2 };
  const td = clamp(dials.transitions ?? editType?.dials?.transitions ?? 0.4, 0, 1);
  const beat = 60 / clamp(bpm, 40, 220);
  const out = [];
  const history = [];
  const palette = spec.palette.filter((p) => TRANSITION_META[p.type]).map((p) => ({ ...p }));
  if (overlayAssets.length && palette.some((p) => p.type === 'light')) palette.push({ type: 'light_leak', w: palette.find((p) => p.type === 'light').w * 0.8 });
  const total = palette.reduce((a, p) => a + p.w, 0) || 1;
  const cutShare = palette.filter((p) => p.type === 'cut').reduce((a, p) => a + p.w, 0) / total;
  // restrained edits (low dial) cut more often, adventurous ones less: +-0.15 around the palette's own cut share
  const pCut = noTransitions ? 1 : clamp(0.5 * (spec.hardCutShare ?? 0.2) + 0.5 * cutShare + 0.6 * (0.5 - td), 0.04, 0.88);

  for (let i = 0; i < shots.length - 1; i++) {
    const a = shots[i]; const b = shots[i + 1]; const tc = a.end;
    const shortest = Math.min(a.end - a.start, b.end - b.start);
    const notes = [];
    let type;
    if (force[i]) { type = force[i]; notes.push('forced by the plan'); }
    else if (noTransitions) type = 'cut';
    else {
      const isChapter = chapters.includes(i);
      const cands = palette.filter((p) => p.type !== 'cut').map((p) => {
        const meta = TRANSITION_META[p.type]; let w = p.w;
        if (shortest < meta.minShot) return null;                               // shots too short for this transition
        w *= 0.4 + 1.2 * td;                                                    // the dial scales how adventurous we are
        const q = transitionQuality(p.type, caps); w *= 0.15 + 0.85 * q * q;    // prefer what this machine renders properly
        if (history.slice(-2).includes(p.type)) w *= 0.001;                     // no repeats (practically excluded; only chosen when nothing else fits)
        else if (history.length && TRANSITION_META[history[history.length - 1]].family === meta.family) w *= 0.5;
        if (isChapter) w *= ADVANCED.includes(p.type) ? 2.5 : p.type === 'dissolve' ? 0.2 : 1;
        return w > 0 ? { type: p.type, w } : null;
      }).filter(Boolean);
      const wantCut = !isChapter && rng.chance(pCut);
      if (wantCut || !cands.length) { type = 'cut'; if (!cands.length && !wantCut) notes.push('no transition fits these shot lengths: hard cut'); }
      else type = rng.weighted(cands).type;
      if (isChapter && type === 'cut') type = 'dissolve';
      if (isChapter) notes.push('chapter change');
    }
    history.push(type);
    const meta = TRANSITION_META[type];
    // length: in beats when a tempo is known, clamped to the shots it has to live inside, snapped to frames
    let d = type === 'cut' ? 0 : spec.durationBeats * beat * (type === 'flash' ? 0.5 : type === 'dissolve' || type === 'pull' ? 1.3 : 1);
    if (type !== 'cut') {
      const cap = meta.maxFrac * shortest;
      if (d > cap) { d = cap; notes.push(`length capped to ${(meta.maxFrac * 100) | 0}% of the shorter shot`); }
      d = Math.max(snapT(d, fps), 3 / fps);
    }
    const dir = i % 2 === 0 ? 0 : 180; // alternate so consecutive motion transitions don't all go the same way
    out.push({ index: i, from: a.id ?? `shot${i}`, to: b.id ?? `shot${i + 1}`, type, family: meta.family, effectId: meta.effectId, cut: tc, d, dir, notes, overlap: d / 2, strength: clamp(0.35 + 0.5 * td, 0, 1),
      window: { start: +(tc - d / 2).toFixed(4), end: +(tc + d / 2).toFixed(4) }, sfx: meta.sfx && type !== 'cut' ? { role: meta.sfx, at: tc } : (meta.sfx ? { role: meta.sfx, at: tc } : null) });
  }

  // second pass: resolve against capabilities and compute shot-relative motion now that every layer's start is known
  const layerStart = (idx) => (idx === 0 ? shots[0].start : shots[idx].start - out[idx - 1].d / 2);
  for (const e of out) {
    e.outAt = +(e.window.start - layerStart(e.index)).toFixed(4); // where the window starts on the OUTGOING layer's own clock
    const c = contextFor(e);
    const r = resolveEffect(e.effectId, caps);
    e.implementation = r.implementation; e.quality = r.quality; e.degraded = r.degraded; e.skipped = r.skipped;
    if (r.degraded && e.type !== 'cut') e.notes.push(`running as "${r.implementation}"${r.skipped.length ? ` (${r.skipped.map((s) => s.reason).join('; ')})` : ''}`);
    e.overlayAsset = overlayAssets.length && e.type === 'light_leak' ? overlayAssets[e.index % overlayAssets.length] : null;
    e.motion = r.unavailable || !r.motion ? { outgoing: [], incoming: [] } : r.motion({ ...c, overlayAsset: e.overlayAsset });
  }
  return out;
}

/** The build context an entry's implementations expect (the incoming layer starts exactly at the window start). */
export function contextFor(e, extra = {}) {
  return { id: `T${String(e.index + 1).padStart(2, '0')}`, t: e.window.start, d: e.d, outAt: e.outAt, inAt: 0, dir: e.dir, strength: e.strength, overlayAsset: e.overlayAsset ?? null, ...extra };
}

/**
 * Ops for one transition as fallback alternatives (best first) for the executor.
 * `layers` = { comp, incoming, outgoing|null, w, h, fps } - the names of the two shot layers in the master comp.
 */
export function transitionAlternatives(e, caps, layers) {
  if (e.type === 'cut' || e.d === 0) return [{ name: 'cut', quality: 1, ops: [] }];
  const c = contextFor(e, layers);
  return resolveChain(e.effectId, caps).chain.map((impl) => ({ name: impl.id, quality: impl.quality, ops: impl.build(c, impl.resolved) }));
}

export { TRANSITION_TYPES };
