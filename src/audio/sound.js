import { round } from '../core/time.js';

export const SILENT_DB = -96;

/** Merge speech segments separated by less than `gap` seconds so the music doesn't pump on every breath. */
export function duckRegions(speech, { gap = 1.0, pad = 0.15 } = {}) {
  const out = [];
  for (const s of speech) {
    const last = out[out.length - 1];
    if (last && s.start - last.end < gap) last.end = s.end + pad;
    else out.push({ start: Math.max(0, s.start - pad), end: s.end + pad });
  }
  return out;
}

/**
 * Level keyframes (dB, stereo) for a music bed: fade in, duck under narration, fade out.
 * All times are master-timeline seconds. `layerStart/layerEnd` bound the layer.
 */
export function musicLevelKeys({ gainDb, duckDb = -10, fadeIn = 2, fadeOut = 3, layerStart, layerEnd, speech = [], ramp = 0.45 }) {
  const lv = (db) => [db, db];
  const keys = [{ t: layerStart, v: lv(fadeIn > 0 ? SILENT_DB : gainDb) }];
  if (fadeIn > 0) keys.push({ t: layerStart + fadeIn, v: lv(gainDb) });
  const ducked = gainDb + duckDb;
  const endFade = layerEnd - fadeOut;
  for (const r of duckRegions(speech)) {
    const a = Math.max(r.start, layerStart + fadeIn); const b = Math.min(r.end, endFade);
    if (b - a < ramp) continue;
    const lastT = keys[keys.length - 1].t;
    const tIn = Math.max(lastT + 0.05, a - ramp);
    keys.push({ t: round(tIn), v: lv(gainDb) }, { t: round(Math.max(tIn + 0.05, a)), v: lv(ducked) }, { t: round(b), v: lv(ducked) }, { t: round(b + ramp), v: lv(gainDb) });
  }
  if (fadeOut > 0) {
    const last = keys[keys.length - 1];
    if (last.t < endFade) keys.push({ t: round(endFade), v: lv(gainDb) });
    keys.push({ t: round(layerEnd), v: lv(SILENT_DB) });
  }
  const dedup = [];
  for (const k of keys) if (!dedup.length || k.t > dedup[dedup.length - 1].t + 1e-4) dedup.push(k);
  return dedup;
}

const WHOOSH_TRANSITIONS = new Set(['slide', 'zoom_punch', 'wipe', 'glitch']);

/**
 * Sound-design cues derived from the edit itself: whooshes on moving transitions, soft hits on titles.
 * Cues are spaced >= minGap apart.
 */
export function autoSfxCues(plan, { minGap = 1.0, maxCues = 60 } = {}) {
  const cues = [];
  plan.scenes.forEach((s, i) => {
    const type = s.transition?.type;
    if (i > 0 && WHOOSH_TRANSITIONS.has(type)) cues.push({ kind: 'whoosh', at: round(s.start - (s.transition.duration ?? 0.5) * 0.3), gainDb: -10, why: `${s.id} ${type} transition` });
    for (const g of s.graphics || []) {
      if (g.kind === 'title') cues.push({ kind: 'impact', at: round(s.start + (g.start ?? 0) + 0.1), gainDb: -12, why: `${s.id} title` });
      if (g.kind === 'stat') cues.push({ kind: 'tick', at: round(s.start + (g.start ?? 0) + 0.2), gainDb: -18, why: `${s.id} stat` });
    }
  });
  cues.sort((a, b) => a.at - b.at);
  const out = [];
  for (const c of cues) if (!out.length || c.at - out[out.length - 1].at >= minGap) out.push(c);
  return out.slice(0, maxCues).filter((c) => c.at >= 0);
}

/** Find a manifest SFX asset for a cue kind by id/keyword; null when none. */
export function pickSfxAsset(manifest, kind) {
  const sfx = manifest.assets.filter((a) => a.type === 'audio' && a.role === 'sfx');
  return sfx.find((a) => a.id.toLowerCase().includes(kind) || a.keywords.includes(kind)) || null;
}
