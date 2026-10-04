// ASSET ASSIGNMENT: which clip or still goes in which shot. Scored on what the shot needs (role, subject, motion),
// how the picture relates to its neighbours (no near-duplicates side by side, alternate brightness) and how much it
// has been used (the pool is exhausted before anything repeats). The final choice among the leaders is seeded.

import { hamming } from '../assets/visual.js';
import { tokenize } from '../library/lexicon.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const dimsOf = (a) => ({ w: a.meta?.width || a.width || null, h: a.meta?.height || a.height || null });
const durOf = (a) => (a.type === 'video' ? a.meta?.duration ?? null : null);

export class AssetAssigner {
  /**
   * @param {object[]} pool visual assets (images + videos) with .visual when analysed
   * @param {object} o { rng, comp:{w,h}, keywords:[], memory:{id:score} }
   */
  constructor(pool, { rng, comp, keywords = [], memory = {} }) {
    this.pool = pool; this.rng = rng; this.comp = comp; this.keywords = new Set(keywords.flatMap((k) => tokenize(k)));
    this.memory = memory; this.uses = new Map(); this.recent = []; this.windows = new Map(); this.log = [];
  }

  relevance(a) {
    if (!this.keywords.size) return 0;
    const bag = new Set([...tokenize(a.description || ''), ...(a.keywords || []).flatMap((k) => tokenize(k)), ...tokenize(a.relPath || a.id)]);
    let hit = 0; for (const k of this.keywords) if (bag.has(k)) hit++;
    return Math.min(1, hit / Math.max(1, Math.min(3, this.keywords.size)));
  }

  score(a, shot) {
    const v = a.visual; const reasons = {}; let s = 0;
    const used = this.uses.get(a.id) || 0;
    reasons.reuse = -5 * used; s += reasons.reuse; // dominant: nothing repeats until the whole pool has been used
    const last = this.recent[this.recent.length - 1]; const last2 = this.recent[this.recent.length - 2];
    if (v?.hash) for (const [prev, pen] of [[last, 2.2], [last2, 1.0]]) if (prev?.visual?.hash && hamming(v.hash, prev.visual.hash) <= 6) { reasons.similar = (reasons.similar || 0) - pen; s -= pen; }
    if (v && last?.visual) { const dB = Math.abs(v.brightness - last.visual.brightness); reasons.contrastWithPrev = dB > 0.12 ? 0.25 : -0.1; s += reasons.contrastWithPrev; }
    const role = shot.role;
    if (v) {
      if (role === 'impact') { reasons.energy = (a.type === 'video' ? clamp((v.motion?.avg || 0) * 8, 0, 1) : 0.2) + v.contrast; s += reasons.energy; }
      else if (role === 'detail') { reasons.subject = (v.subject?.conf >= 0.3 ? 1 : 0) + (v.subject?.conf || 0); s += reasons.subject; }
      else if (role === 'wide') { reasons.wide = (1 - (v.subject?.conf || 0)) * 0.5 + v.colorfulness * 0.5; s += reasons.wide; }
      else { reasons.hero = v.colorfulness * 0.6 + v.contrast * 0.8 + (v.subject?.conf || 0) * 0.4; s += reasons.hero; }
    }
    const rel = this.relevance(a); if (rel) { reasons.relevance = rel * 1.2; s += reasons.relevance; }
    const d = dimsOf(a);
    if (d.w && d.h) {
      const portrait = d.h > d.w; const compPortrait = this.comp.h > this.comp.w;
      if (portrait !== compPortrait && Math.abs(d.w / d.h - this.comp.w / this.comp.h) > 0.4) { reasons.orientation = -0.35; s += reasons.orientation; }
      if (d.w < this.comp.w * 0.5) { reasons.lowRes = -0.3; s += reasons.lowRes; }
    }
    if (a.type === 'video' && shot.needSeconds && durOf(a) && durOf(a) < shot.needSeconds) { reasons.short = -1.2; s -= 1.2; }
    if (this.memory[a.id]) { reasons.memory = 0.2 * this.memory[a.id]; s += reasons.memory; }
    return { score: s, reasons };
  }

  /** Choose an asset for a shot; `exclude` ids are never returned (used for the PIP/split partner). */
  pick(shot, { exclude = [], types = null } = {}) {
    const cands = this.pool.filter((a) => !exclude.includes(a.id) && (!types || types.includes(a.type))).map((a) => ({ a, ...this.score(a, shot) })).sort((x, y) => y.score - x.score || x.a.id.localeCompare(y.a.id));
    if (!cands.length) return null;
    const top = cands.slice(0, 3).filter((c) => cands[0].score - c.score < 0.6);
    const chosen = this.rng.weighted(top.map((c) => ({ c, w: Math.exp(c.score) }))).c;
    this.uses.set(chosen.a.id, (this.uses.get(chosen.a.id) || 0) + 1);
    this.recent.push(chosen.a);
    this.log.push({ shot: shot.id, asset: chosen.a.id, score: +chosen.score.toFixed(3), reasons: Object.fromEntries(Object.entries(chosen.reasons).map(([k, x]) => [k, +x.toFixed(2)])), alternatives: cands.slice(0, 3).map((c) => ({ id: c.a.id, score: +c.score.toFixed(2) })) });
    return chosen.a;
  }

  /**
   * Source in-point for a video shot: the most active window for energetic roles, an unused stretch otherwise.
   * `span` = seconds of source the shot needs. Returns seconds (>= handle).
   */
  window(a, { span, handle = 0, role }) {
    const dur = durOf(a); if (!dur) return 0;
    const lo = handle; const hi = Math.max(lo, dur - span - handle - 0.05);
    const taken = this.windows.get(a.id) || [];
    const best = a.visual?.motion?.bestWindow;
    let start = role === 'impact' && best ? best.start : lo + (hi - lo) * this.rng.range(0.05, 0.95);
    // avoid overlapping a stretch already used
    for (let tries = 0; tries < 10 && taken.some(([s, e]) => start < e && start + span > s); tries++) start = lo + (hi - lo) * this.rng.range(0, 1);
    start = clamp(start, lo, hi);
    taken.push([start, start + span]); this.windows.set(a.id, taken);
    return +start.toFixed(3);
  }
}
