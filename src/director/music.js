// MUSIC SELECTION: pick the track the edit will be cut to. Project music (the user's own) wins over the universal
// library; an explicit request (edit.config music: "<id|file name|path>") wins over everything. Every candidate is
// scored on genre, tempo, energy and length, and the scoring is returned so the choice can be explained.

import path from 'node:path';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * @param {object} o { directive, manifest (project), library, duration }
 * @returns {{ source:'project'|'library'|'explicit'|'none', asset|null, file|null, score, candidates:[{id,score,reasons}], reason }}
 */
export function chooseMusic({ directive, manifest = null, library = null, duration = 30 }) {
  const et = directive.editType; const pref = directive.musicPref;
  if (directive.flags.music === false) return { source: 'none', asset: null, file: null, score: 0, candidates: [], reason: 'music disabled' };
  const project = (manifest?.assets || []).filter((a) => a.type === 'audio' && a.role === 'music').map((a) => ({ a, from: 'project' }));
  const lib = (library?.assets || []).filter((a) => a.type === 'music' && !a.duplicateOf).map((a) => ({ a, from: 'library' }));
  // the user's own music is the soundtrack they chose: the library is only consulted when they supplied none
  const all = project.length ? project : [...lib];
  const pool = [...project, ...lib];
  if (pref) {
    const q = String(pref).toLowerCase(); const base = path.basename(q);
    const hit = pool.find(({ a }) => a.id.toLowerCase() === q || (a.relPath || a.file || '').toLowerCase().endsWith(base) || path.basename(a.path || '').toLowerCase() === base);
    if (hit) return { source: hit.from, asset: hit.a, file: hit.a.path, score: 1, candidates: [{ id: hit.a.id, score: 1, reasons: ['requested explicitly'] }], reason: `requested: ${pref}` };
    return { source: 'explicit', asset: null, file: path.resolve(pref), score: 1, candidates: [], reason: `explicit file ${pref} (not in the project or library: it will be imported as given)` };
  }
  const want = new Set((et.music.genres || []).map((g) => g.toUpperCase()));
  const [bLo, bHi] = et.music.bpmRange || [70, 130]; const mid = (bLo + bHi) / 2;
  const scored = all.map(({ a, from }) => {
    const reasons = []; let s = 0.15;
    const genre = String(a.genre || a.subcategory || '').toUpperCase().replace(/-/g, '_');
    if (want.has(genre)) { s += 0.3; reasons.push(`genre ${genre}`); }
    if ((a.recommended_for || []).includes(et.id) || (a.preferred_edit_types || []).includes(et.id)) { s += 0.12; reasons.push(`recommended for ${et.id}`); }
    const bpm = a.bpm || a.analysis?.bpm;
    if (bpm) { if (bpm >= bLo && bpm <= bHi) { s += 0.2 - 0.1 * Math.abs(bpm - mid) / ((bHi - bLo) / 2 || 1); reasons.push(`${Math.round(bpm)} BPM in range`); } else { s -= 0.1; reasons.push(`${Math.round(bpm)} BPM outside ${bLo}-${bHi}`); } }
    if (typeof a.energy === 'number') { const d = Math.abs(a.energy - directive.dials.intensity); s += 0.2 * (1 - d); reasons.push(`energy ${a.energy.toFixed(2)} vs wanted ${directive.dials.intensity.toFixed(2)}`); }
    const dur = a.duration ?? a.meta?.duration;
    if (dur) { if (dur >= duration * 0.95) { s += 0.1; reasons.push('long enough'); } else { s -= 0.12; reasons.push(`only ${dur.toFixed(0)}s (will loop)`); } }
    if (from === 'project') { s += 0.35; reasons.push('supplied with the project'); }
    return { id: a.id, score: +clamp01(s).toFixed(3), reasons, a, from };
  }).sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
  if (!scored.length) return { source: 'none', asset: null, file: null, score: 0, candidates: [], reason: 'no music in the project or the library: the edit is cut to a virtual grid' };
  const best = scored[0];
  return { source: best.from, asset: best.a, file: best.a.path, score: best.score, candidates: scored.slice(0, 5).map(({ id, score, reasons }) => ({ id, score, reasons })), reason: best.reasons.join('; ') };
}
