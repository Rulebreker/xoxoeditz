// SOUND DESIGN for timeline edits. Events come from the structure of the edit (transitions, drops, impacts, risers,
// text hits, freeze frames), are budgeted by the SFX dial, and every event is resolved through the semantic search
// (never random) and the smart fit (so the sound's transient lands on the visual event). The result is a list of
// events that already carry their fit plan: layer in/out, fades, gain.

import { searchLibrary, pick, ROLE_QUERY, categoriesForRole } from '../sfx/search.js';
import { planSfxFit, layeringFor, thinEvents } from '../sfx/fit.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const PRIORITY = { big_impact: 10, drop: 10, impact: 9, riser: 8, hit: 7, whip: 6, transition: 6, soft_transition: 5, glitch: 5, text: 3, tick: 2, ambience: 1 };
const MAX_LEN = { riser: 3.5, reverse: 3, swell: 3, ambience: 20, transition: 1.4, whip: 1, soft_transition: 1.6, impact: 2.2, big_impact: 2.6, hit: 0.8, text: 0.6, tick: 0.3, glitch: 0.7, drop: 2.2 };

/**
 * Candidate events from the plan structure.
 * @param {object} o { shots, transitions, textItems, map (beat map), duration, editType, dials }
 */
export function sfxCandidates({ shots, transitions, textItems = [], map, duration, editType, dials }) {
  const ev = [];
  const push = (role, at, intensity, why) => { if (at >= 0 && at <= duration) ev.push({ role, at: +at.toFixed(4), intensity: clamp(intensity, 0, 1), why }); };
  for (const t of transitions) if (t.sfx && t.type !== 'cut') push(t.sfx.role, t.type === 'whip' || t.type === 'motion_blur' ? t.cut : t.cut, 0.45 + 0.4 * dials.sfx, `${t.type} transition`);
  for (const d of map.drops || []) { push('big_impact', d.t, 0.75 + 0.25 * (d.strength ?? 1), 'drop'); }
  for (const i of map.impacts || []) if (!(map.drops || []).some((d) => Math.abs(d.t - i.t) < 0.1)) push(i.kind === 'accent' ? 'hit' : 'impact', i.t, 0.5 + 0.4 * (i.strength ?? 0.6), `music ${i.kind || 'impact'}`);
  for (const r of map.rises || []) push('riser', r.end, 0.7, 'rise into drop');
  for (const s of shots) for (const o of s.overlays || []) if (o.kind === 'flash') push('impact', s.start + o.at, 0.6 + 0.3 * (o.peak ?? 60) / 100, `${s.template} hit`);
  for (const s of shots) if (s.template === 'FREEZE_FRAME' && s.velocity?.map) { const f = s.velocity.map.impacts?.[0]; if (f !== undefined) push('hit', s.start + f, 0.6, 'freeze frame'); }
  for (const t of textItems) if (['TITLE', 'KEYWORD', 'STAT', 'END_CARD'].includes(t.kind)) push(t.animation === 'scale_punch' || t.animation === 'glitch_reveal' ? (t.animation === 'glitch_reveal' ? 'glitch' : 'hit') : 'text', t.at, t.kind === 'KEYWORD' ? 0.65 : 0.4, `${t.kind} appears`);
  if ((editType.sfx.prefer.ambience || []).length && dials.sfx >= 0.2 && duration > 6) push('ambience', 0, 0.3, 'room tone bed');
  return ev;
}

/**
 * Budget, thin, resolve and fit.
 * @param {object} o { candidates, library, editType, dials, rng, memory, usage }
 * @returns {{ events:[], notes:[], dropped:[] }}
 */
export function planSound({ candidates, library, editType, dials, rng, memory = {}, duration }) {
  const notes = []; const dropped = [];
  if (!library) { return { events: [], notes: ['no SFX library: the edit has no sound effects'], dropped: candidates.map((c) => ({ ...c, reason: 'no library' })) }; }
  const budget = Math.max(2, Math.round(duration * (0.12 + 1.15 * dials.sfx)));
  const ranked = [...candidates].sort((a, b) => (PRIORITY[b.role] ?? 4) - (PRIORITY[a.role] ?? 4) || b.intensity - a.intensity || a.at - b.at);
  const keep = ranked.slice(0, budget); for (const r of ranked.slice(budget)) dropped.push({ ...r, reason: 'over the SFX budget' });
  const usage = {}; const events = []; const layeringMax = editType.sfx.layering || 1;
  for (const c of keep.sort((a, b) => a.at - b.at)) {
    const q = ROLE_QUERY[c.role] || c.role;
    const found = searchLibrary(library, q, { type: 'sfx', editType: editType.id, preferSubs: categoriesForRole(editType, c.role), energy: clamp(0.3 + 0.6 * c.intensity, 0, 1), intensity: c.intensity, duration: MAX_LEN[c.role], usage, memory, limit: 5 });
    const chosen = pick(found, { rng, slack: 0.04 });
    if (!chosen) { dropped.push({ ...c, reason: `no library sound matches "${q}"` }); notes.push(`no SFX found for ${c.role} (${q})`); continue; }
    usage[chosen.asset.id] = (usage[chosen.asset.id] || 0) + 1;
    const fit = planSfxFit(chosen.asset, { at: c.at, role: c.role, maxLength: MAX_LEN[c.role], intensity: c.intensity }, { sfxDial: dials.sfx });
    events.push({ id: `SFX_${String(events.length + 1).padStart(3, '0')}`, role: c.role, assetId: chosen.asset.id, at: c.at, why: c.why, query: q, score: chosen.score, reasons: chosen.reasons, fit, layer: 0 });
    for (const extra of layeringFor(c.role, c.intensity, layeringMax)) {
      const f2 = searchLibrary(library, extra.query, { type: 'sfx', editType: editType.id, usage, memory, limit: 3, exclude: [chosen.asset.id] });
      const c2 = pick(f2, { rng, slack: 0.04 }); if (!c2) continue;
      usage[c2.asset.id] = (usage[c2.asset.id] || 0) + 1;
      const fit2 = planSfxFit(c2.asset, { at: c.at + extra.delay + (extra.endsOnEvent ? 0 : 0), role: extra.role, maxLength: MAX_LEN[extra.role], intensity: c.intensity }, { sfxDial: dials.sfx });
      fit2.layers[0].gainDb = Math.round((fit2.layers[0].gainDb + extra.gainOffset) * 10) / 10;
      events.push({ id: `SFX_${String(events.length + 1).padStart(3, '0')}`, role: extra.role, assetId: c2.asset.id, at: c.at, why: `${c.why} (layer)`, query: extra.query, score: c2.score, reasons: c2.reasons, fit: fit2, layer: 1 });
    }
  }
  const thin = thinEvents(events.map((e) => ({ ...e, layers: e.fit.layers })), { window: 0.06, max: 3 });
  const kept = new Set(thin.map((e) => e.id));
  for (const e of events) if (!kept.has(e.id)) dropped.push({ role: e.role, at: e.at, reason: 'too many simultaneous sounds' });
  return { events: events.filter((e) => kept.has(e.id)).sort((a, b) => a.at - b.at), notes, dropped };
}
