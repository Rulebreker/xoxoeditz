// SMART SFX FIT: decide where a sound starts, which part plays, how it fades and how loud it is so it lands ON the
// visual event, regardless of the file's own length. In After Effects this is done with layer in/out points and
// level keyframes (non-destructive). `makeFitVersion` writes a trimmed copy only when a file is really needed.

import fs from 'node:fs';
import path from 'node:path';
import { runTool } from '../core/resolve-tool.js';
import { ensureDir } from '../core/paths.js';
import { round } from '../core/time.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const ALIGN = { impact: 'peak', hit: 'peak', big_impact: 'peak', camera: 'peak', text: 'peak', tick: 'peak', ui: 'peak', glitch: 'peak', drop: 'peak', transition: 'peak', whip: 'peak', soft_transition: 'peak', riser: 'end', reverse: 'end', swell: 'end', ambience: 'start', vehicle: 'peak', weapon: 'peak' };
export const BASE_GAIN_DB = { big_impact: -6, impact: -8, drop: -6, hit: -10, camera: -12, transition: -11, whip: -10, soft_transition: -14, riser: -14, reverse: -14, swell: -16, text: -17, ui: -17, tick: -19, glitch: -13, ambience: -26, vehicle: -14, weapon: -9 };
export const PEAK_CEILING_DB = -6; // dBFS: leaves room for the music bed and simultaneous sounds in the sum
export const TARGET_RMS_DB = -22; // loudness every SFX is normalised to before the role gain is applied

/**
 * @param {object} asset library SFX (with .features from the scan)
 * @param {object} ev    { at (master seconds the event happens), role, maxLength?, intensity?, window?:[start,end] }
 * @param {object} opts  { sfxDial (0..1 overall SFX level), allowStretch, layering (1..3) }
 */
export function planSfxFit(asset, ev, opts = {}) {
  const role = ev.role || 'impact';
  const dur = asset.duration || asset.features?.duration || 1;
  const f = asset.features || {};
  const align = ALIGN[role] || 'peak';
  const notes = [];

  // ---- which part of the file plays ----
  let sourceIn = 0; let sourceOut = dur;
  const maxLen = ev.maxLength ?? (role === 'ambience' ? dur : Math.max(0.25, dur));
  if (dur > maxLen) { sourceOut = maxLen; notes.push(`trimmed ${round(dur, 2)}s -> ${round(maxLen, 2)}s`); }
  // the transient is the part that must land on the event
  const peakT = align === 'peak' ? clamp(f.peakTime ?? Math.min(dur * 0.1, 0.1), 0, sourceOut) : 0;
  let start;
  if (align === 'peak') start = ev.at - peakT;
  else if (align === 'end') start = ev.at - (sourceOut - sourceIn);          // build-ups END on the event
  else start = ev.at;
  // a riser/long tail that would begin before the timeline: cut its head, keep the alignment
  if (start < 0) { const cut = -start; sourceIn += cut; start = 0; notes.push(`head trimmed ${round(cut, 2)}s (starts before 0)`); if (sourceIn >= sourceOut - 0.05) { sourceIn = Math.max(0, sourceOut - 0.05); notes.push('almost nothing left to play'); } }
  const playLen = sourceOut - sourceIn;

  // ---- limited time-stretch (pitch shifts with it in AE, so only a few percent) ----
  let stretch = 1;
  if (opts.allowStretch && ev.targetLength && playLen > 0.2) {
    const want = ev.targetLength / playLen;
    if (Math.abs(want - 1) <= 0.08) { stretch = round(want, 3); notes.push(`stretched ${round((stretch - 1) * 100, 1)}%`); }
  }

  // ---- fades: never click; long sounds get proper tails ----
  const fadeIn = align === 'end' ? clamp(playLen * 0.35, 0.05, 1.2) : (f.attack > 0.05 ? clamp(f.attack * 0.6, 0.004, 0.2) : 0.004);
  const fadeOut = clamp(Math.max(0.03, Math.min(playLen * 0.3, role === 'ambience' ? 1.2 : 0.5)), 0.03, 1.2);
  const trimmedTail = sourceOut < dur - 0.02;

  // ---- level: normalise by measured loudness, then role gain, scaled by the SFX dial and event intensity ----
  const norm = f.rmsDb !== undefined ? clamp(TARGET_RMS_DB - f.rmsDb, -12, 12) : 0;
  const dial = opts.sfxDial ?? 0.5;
  const inten = ev.intensity ?? asset.intensity ?? 0.6;
  let gainDb = round(clamp((BASE_GAIN_DB[role] ?? -12) + norm + (dial - 0.5) * 8 + (inten - 0.6) * 5, -40, -2), 1);
  // headroom for the mix: the sound's own peak, after the gain, stays below PEAK_CEILING_DB (music and other SFX add to it)
  if (f.peakDb !== undefined && f.peakDb + gainDb > PEAK_CEILING_DB) { gainDb = round(PEAK_CEILING_DB - f.peakDb, 1); notes.push(`gain reduced to keep the peak below ${PEAK_CEILING_DB} dBFS`); }

  const layers = [{ part: 'main', start: round(start, 4), sourceIn: round(sourceIn, 4), sourceOut: round(sourceOut, 4), stretch, fadeIn: round(fadeIn, 4), fadeOut: round(fadeOut, 4), gainDb, assetId: asset.id }];
  return { role, assetId: asset.id, at: round(ev.at, 4), align, alignedPeak: round(start + peakT, 4), start: round(start, 4), end: round(start + playLen * stretch, 4), layers, notes, needsFile: trimmedTail && opts.preferFile === true };
}

/** Where the sound actually ends up in the mix: its measured RMS plus the planned gain (dBFS). */
export const finalLevelDb = (asset, fit) => round((asset.features?.rmsDb ?? TARGET_RMS_DB) + fit.layers[0].gainDb, 1);

/** Companion layer for big events: a sub/boom under a hit, an air tail after a whoosh. Returns a plan list for the Director to search. */
export function layeringFor(role, intensity, layering = 1) {
  if (layering <= 1) return [];
  const out = [];
  if (['impact', 'big_impact', 'drop'].includes(role) && intensity >= 0.65) out.push({ role: 'drop', query: 'sub boom drop', gainOffset: -4, delay: 0 });
  if (['transition', 'whip'].includes(role) && layering >= 3 && intensity >= 0.7) out.push({ role: 'soft_transition', query: 'smooth swoosh', gainOffset: -6, delay: 0.02 });
  if (['impact', 'big_impact'].includes(role) && layering >= 3 && intensity >= 0.8) out.push({ role: 'riser', query: 'reverse build', gainOffset: -8, delay: -0.8, endsOnEvent: true });
  return out.slice(0, layering - 1);
}

/** Spread simultaneous events: keep at most `max` sounds within `window` seconds (strongest first). */
export function thinEvents(plans, { window = 0.08, max = 2 } = {}) {
  const sorted = [...plans].sort((a, b) => a.at - b.at);
  const kept = [];
  for (const p of sorted) {
    const near = kept.filter((k) => Math.abs(k.at - p.at) < window);
    if (near.length < max) kept.push(p);
    else { const weakest = near.reduce((m, k) => (k.layers[0].gainDb < m.layers[0].gainDb ? k : m)); if (p.layers[0].gainDb > weakest.layers[0].gainDb) { kept.splice(kept.indexOf(weakest), 1, p); } }
  }
  return kept.sort((a, b) => a.at - b.at);
}

/** Write a trimmed + faded copy (original untouched) for cases where a standalone file is needed. */
export async function makeFitVersion(config, asset, fit, outDir) {
  const l = fit.layers[0];
  ensureDir(outDir);
  const out = path.join(outDir, `${asset.id}_fit_${Math.round(l.sourceIn * 1000)}_${Math.round(l.sourceOut * 1000)}.wav`);
  if (fs.existsSync(out)) return out;
  const len = l.sourceOut - l.sourceIn;
  const filters = [`afade=t=in:st=0:d=${l.fadeIn}`, `afade=t=out:st=${Math.max(0, len - l.fadeOut).toFixed(4)}:d=${l.fadeOut}`];
  if (l.stretch && Math.abs(l.stretch - 1) > 0.001) filters.push(`atempo=${(1 / l.stretch).toFixed(4)}`);
  const r = await runTool(config, 'ffmpeg', ['-v', 'error', '-y', '-protocol_whitelist', 'file', '-ss', String(l.sourceIn), '-t', String(len), '-i', asset.path, '-af', filters.join(','), out], { timeoutMs: 60000 });
  if (r.error || r.code !== 0) throw new Error(`could not create fit version: ${r.error || r.stderr}`);
  return out;
}
