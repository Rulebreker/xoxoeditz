// TIMELINE PLAN (version 2). The scene plan (version 1) describes narration-driven documentaries as scenes of clips.
// A timeline plan describes music/beat-driven edits as a flat list of SHOTS on one master timeline, each with a
// compositing template, a velocity map, a camera decision, text and transition into the next shot.
//
// The plan is the single source of truth: the Director writes it, a human (or Claude) may edit it, `compileTimeline`
// turns it into After Effects work. Nothing here touches After Effects.

import { TEMPLATES } from '../compositing/templates.js';
import { TRANSITION_TYPES } from '../transitions/entries.js';
import { resolveOutput } from '../plan/output.js';
import { PRIMITIVES } from '../motion/primitives.js';
import { LOOK_NAMES } from '../color/looks.js';
import { mapDuration } from '../velocity/speedmap.js';

export const TIMELINE_VERSION = 2;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

export const isTimelinePlan = (plan) => plan?.mode === 'timeline' || plan?.version === TIMELINE_VERSION;

/** End of the master timeline (seconds). */
export const timelineEnd = (plan) => plan.timeline.duration;

/**
 * @param {object} plan
 * @param {object} ctx { manifest (project assets), library (universal library manifest or null) }
 * @returns {{valid, errors:{path,message}[], warnings}}
 */
export function validateTimeline(plan, { manifest = null, library = null } = {}) {
  const errors = []; const warnings = [];
  const err = (path, message) => errors.push({ path, message });
  const warn = (path, message) => warnings.push({ path, message });
  if (!plan || typeof plan !== 'object') return { valid: false, errors: [{ path: '', message: 'plan must be an object' }], warnings };
  if (plan.version !== TIMELINE_VERSION) err('version', `timeline plans are version ${TIMELINE_VERSION}`);
  if (plan.mode !== 'timeline') err('mode', 'mode must be "timeline"');
  if (!isStr(plan.title)) err('title', 'title is required (used for project and file names)');
  const tl = plan.timeline;
  if (!tl || !Array.isArray(tl.shots) || tl.shots.length === 0) { err('timeline.shots', 'at least one shot is required'); return { valid: false, errors, warnings }; }
  if (!isNum(tl.duration) || tl.duration <= 0) err('timeline.duration', 'duration must be a positive number of seconds');

  const out = plan.output;
  if (!out || !isNum(out.width) || !isNum(out.height) || !isNum(out.fps)) err('output', 'output {width,height,fps} is required (resolveOutput)');
  else if (out.width % 2 || out.height % 2) err('output', 'H.264 needs even width and height');
  const fps = out?.fps || 24;

  const ids = new Map();
  for (const a of manifest?.assets || []) ids.set(a.id, a);
  for (const a of library?.assets || []) ids.set(a.id, a);
  const known = (id) => !manifest && !library ? true : ids.has(id);

  const seen = new Set(); let prevEnd = 0;
  tl.shots.forEach((s, i) => {
    const p = `timeline.shots[${i}]`;
    if (!isStr(s.id)) err(`${p}.id`, 'shot id is required'); else if (seen.has(s.id)) err(`${p}.id`, `duplicate shot id ${s.id}`); else seen.add(s.id);
    if (!isNum(s.start) || !isNum(s.end)) { err(p, 'start and end (seconds) are required'); return; }
    if (s.end - s.start < 2 / fps) err(p, `shot is shorter than 2 frames (${(s.end - s.start).toFixed(3)}s)`);
    if (Math.abs(s.start - prevEnd) > 1e-3) err(`${p}.start`, `shots must be contiguous: shot starts at ${s.start} but the previous one ended at ${prevEnd}`);
    prevEnd = s.end;
    const t = s.template === 'SLATE' ? { implemented: true } : TEMPLATES[s.template];
    if (!t) err(`${p}.template`, `unknown template "${s.template}" (known: ${Object.keys(TEMPLATES).join(', ')})`);
    else if (!t.implemented) err(`${p}.template`, `${s.template} is not implemented (TODO)`);
    if (!Array.isArray(s.layers) || s.layers.length === 0) err(`${p}.layers`, 'a shot needs at least one layer');
    const names = new Set();
    for (const [j, L] of (s.layers || []).entries()) {
      const lp = `${p}.layers[${j}]`;
      if (!isStr(L.name)) err(`${lp}.name`, 'layer name is required'); else if (names.has(L.name)) err(`${lp}.name`, `duplicate layer name ${L.name}`); else names.add(L.name);
      if (L.kind === 'footage') {
        if (!isStr(L.asset)) err(`${lp}.asset`, 'footage layer needs an asset');
        else if (!known(L.asset)) err(`${lp}.asset`, `asset "${L.asset}" is in neither the project manifest nor the library`);
        for (const [k, m] of (L.motion || []).entries()) if (!PRIMITIVES[m.type]) err(`${lp}.motion[${k}]`, `unknown motion primitive "${m.type}"`);
        if (L.remap) {
          const a = ids.get(L.asset); const dur = a?.meta?.duration ?? a?.duration;
          if (!L.remap.map?.segments?.length) err(`${lp}.remap`, 'remap needs a speed map');
          else if (Math.abs(mapDuration(L.remap.map) - (s.end - s.start)) > 0.02) err(`${lp}.remap`, `speed map lasts ${mapDuration(L.remap.map).toFixed(3)}s but the shot lasts ${(s.end - s.start).toFixed(3)}s`);
          if (dur && L.remap.sourceIn !== undefined && L.remap.sourceIn > dur) err(`${lp}.remap.sourceIn`, `source in-point ${L.remap.sourceIn}s is beyond the ${dur.toFixed(2)}s clip`);
        }
      } else if (!['solid', 'shape', 'frame', 'divider', 'hud'].includes(L.kind)) err(`${lp}.kind`, `unknown layer kind "${L.kind}"`);
    }
    for (const [k, tx] of (s.text || []).entries()) {
      const tp = `${p}.text[${k}]`;
      if (!isStr(tx.text)) err(`${tp}.text`, 'text is required');
      if (!isNum(tx.at) || tx.at < s.start - 0.5 || tx.at > s.end + 0.5) err(`${tp}.at`, `text starts at ${tx.at}s, outside its shot (${s.start}-${s.end}s)`);
      if (tx.layout && tx.layout.fits === false) warn(`${tp}.layout`, `text "${tx.text}" does not fit the safe area: ${(tx.layout.warnings || []).join('; ')}`);
    }
  });
  if (isNum(tl.duration) && Math.abs(prevEnd - tl.duration) > 1e-3) err('timeline.duration', `the last shot ends at ${prevEnd}s but the timeline duration is ${tl.duration}s`);

  const tr = tl.transitions || [];
  if (tr.length !== tl.shots.length - 1) err('timeline.transitions', `expected ${tl.shots.length - 1} transitions (one per cut), got ${tr.length}`);
  tr.forEach((t, i) => {
    const p = `timeline.transitions[${i}]`;
    if (!TRANSITION_TYPES.includes(t.type)) err(`${p}.type`, `unknown transition "${t.type}" (known: ${TRANSITION_TYPES.join(', ')})`);
    const a = tl.shots[i]; const b = tl.shots[i + 1];
    if (a && b && t.type !== 'cut') {
      if (t.d > 0.5 * Math.min(a.end - a.start, b.end - b.start) + 1e-6) err(`${p}.d`, `a ${t.d}s transition does not fit the shorter neighbouring shot`);
      if (Math.abs(t.cut - a.end) > 1e-3) err(`${p}.cut`, `transition is centred on ${t.cut}s but the cut is at ${a.end}s`);
    }
  });

  for (const [i, m] of (plan.audio?.music || []).entries()) { if (!isStr(m.asset)) err(`audio.music[${i}].asset`, 'music asset is required'); else if (!known(m.asset)) err(`audio.music[${i}].asset`, `music asset "${m.asset}" not found`); }
  if (plan.audio?.narration && !known(plan.audio.narration.asset)) err('audio.narration.asset', `narration asset "${plan.audio.narration.asset}" not found`);
  for (const [i, e] of (plan.audio?.sfxEvents || []).entries()) {
    const p = `audio.sfxEvents[${i}]`;
    if (!known(e.assetId)) err(`${p}.assetId`, `SFX asset "${e.assetId}" not found`);
    if (!isNum(e.at) || e.at < -0.01 || e.at > (tl.duration || 0) + 0.5) err(`${p}.at`, `SFX at ${e.at}s is outside the timeline`);
    if (!e.fit?.layers?.length) err(`${p}.fit`, 'SFX event needs a fit plan (planSfxFit)');
  }
  if (plan.look?.color && !LOOK_NAMES.includes(plan.look.color)) err('look.color', `unknown colour look "${plan.look.color}" (known: ${LOOK_NAMES.join(', ')})`);
  return { valid: errors.length === 0, errors, warnings };
}

/** Defaults a hand-edited plan may leave out. Pure. */
export function normalizeTimeline(plan) {
  const p = JSON.parse(JSON.stringify(plan));
  p.output = { ...resolveOutput(p.output || {}), ...(p.output || {}) };
  p.audio = { narration: null, music: [], sfx: [], sfxEvents: [], autoSfx: false, ...(p.audio || {}) };
  p.look = { color: null, strength: 0.5, grain: 0, vignette: 0, glow: 0, letterbox: false, ...(p.look || {}) };
  p.captions = { enabled: false, ...(p.captions || {}) };
  p.endFade = p.endFade ?? 0;
  p.style = p.style || 'cinematic-documentary';
  p.timeline.transitions = p.timeline.transitions || [];
  p.timeline.shots.forEach((s) => { s.layers ||= []; s.text ||= []; s.overlays ||= []; });
  return p;
}
