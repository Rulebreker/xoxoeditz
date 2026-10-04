import { resolveOutput } from './output.js';
import { REGISTRY } from '../effects/registry.js';
import { OPS_DOC } from '../bridge/ops-doc.js';

export const PLAN_VERSION = 1;

export const GRAPHIC_KINDS = ['title', 'subtitle', 'lower_third', 'callout', 'stat', 'bar_chart', 'highlight_box', 'timeline', 'hud_corners', 'kinetic'];
export const NOT_IMPLEMENTED_KINDS = ['map'];
export const MOTIONS = ['static', 'push_in', 'pull_out', 'pan_left', 'pan_right', 'pan_up', 'pan_down', 'drift'];
export const POSITIONS = ['center', 'top-center', 'bottom-center', 'lower-left', 'lower-right', 'upper-left', 'upper-right', 'left-center', 'right-center'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

/** `advanced` blocks run typed host ops inside the idempotent build (cameras, 3D, mattes, blend modes, masks...). */
function checkAdvanced(path, adv, err) {
  if (!adv || !Array.isArray(adv.ops) || adv.ops.length === 0) { err(path, 'advanced block needs ops: [{op, args}]'); return; }
  adv.ops.forEach((o, i) => {
    if (!o || !OPS_DOC[o.op]) err(`${path}.ops[${i}]`, `unknown host op "${o?.op}" (see xoxo bridge ops)`);
    else if (['raw_eval', 'batch', 'project_new', 'project_open', 'project_save'].includes(o.op)) err(`${path}.ops[${i}]`, `op "${o.op}" is not allowed inside an advanced block`);
  });
}

/**
 * Validate a plan against the manifest. Pure; returns {valid, errors, warnings}. Paths are JSON-pointer-ish.
 * The plan is Claude's (the Director's) output, so messages are written to be actionable for it.
 */
export function validatePlan(plan, { manifest = null, narration = null } = {}) {
  const errors = []; const warnings = [];
  const err = (path, message) => errors.push({ path, message });
  const warn = (path, message) => warnings.push({ path, message });

  if (!plan || typeof plan !== 'object') return { valid: false, errors: [{ path: '', message: 'plan must be an object' }], warnings };
  if (plan.version !== undefined && plan.version !== PLAN_VERSION) warn('version', `plan version ${plan.version} differs from supported ${PLAN_VERSION}`);
  if (!isStr(plan.title)) err('title', 'title is required (used for project and file names)');
  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) { err('scenes', 'at least one scene is required'); return { valid: false, errors, warnings }; }

  const assetIds = new Set((manifest?.assets || []).map((a) => a.id));
  const checkAsset = (path, id) => {
    if (!isStr(id)) { err(path, 'asset id is required'); return null; }
    if (manifest && !assetIds.has(id)) { err(path, `unknown asset "${id}" (not in assets.manifest.json)`); return null; }
    return manifest?.assets.find((a) => a.id === id) || null;
  };

  const seen = new Set();
  let prevEnd = null;
  plan.scenes.forEach((s, i) => {
    const p = `scenes[${i}]`;
    if (!isStr(s.id)) err(`${p}.id`, 'scene id required, e.g. "S01"');
    else if (seen.has(s.id)) err(`${p}.id`, `duplicate scene id ${s.id}`);
    else seen.add(s.id);
    if (!isNum(s.start) || !isNum(s.end)) { err(p, 'start and end (seconds) are required numbers'); return; }
    if (s.end <= s.start) err(p, `end (${s.end}) must be after start (${s.start})`);
    if (s.end - s.start < 0.5) warn(p, `scene is only ${(s.end - s.start).toFixed(2)}s long`);
    if (prevEnd !== null) {
      if (s.start < prevEnd - 1e-6) err(`${p}.start`, `scene overlaps previous scene (starts ${s.start}, previous ends ${prevEnd}); use transition.duration for overlap`);
      else if (s.start > prevEnd + 1 / 24 + 1e-6) warn(`${p}.start`, `gap of ${(s.start - prevEnd).toFixed(2)}s before this scene (black in the master)`);
    }
    prevEnd = s.end;
    const len = s.end - s.start;

    (s.clips || []).forEach((c, j) => {
      const cp = `${p}.clips[${j}]`;
      const a = checkAsset(`${cp}.asset`, c.asset);
      if (a && !['video', 'image'].includes(a.type)) err(`${cp}.asset`, `asset ${c.asset} is ${a.type}, not video/image`);
      const cs = c.start ?? 0; const ce = c.end ?? len;
      if (!isNum(cs) || !isNum(ce) || ce <= cs) err(cp, 'clip start/end must be numbers with end > start (scene-local seconds)');
      else if (ce > len + 1e-6) err(cp, `clip ends at ${ce}s but scene is ${len.toFixed(2)}s long`);
      if (c.motion && !MOTIONS.includes(c.motion)) err(`${cp}.motion`, `unknown motion "${c.motion}" (use ${MOTIONS.join(', ')})`);
      if (a?.type === 'video' && a.meta?.duration && isNum(ce) && isNum(cs)) {
        const need = ((c.sourceIn ?? 0)) + (ce - cs) * (c.speed ?? 1);
        if (need > a.meta.duration + 0.05) warn(cp, `needs ${need.toFixed(2)}s of source but ${c.asset} is ${a.meta.duration.toFixed(2)}s — it will run out (shorten, slow down, or loop)`);
      }
    });

    (s.graphics || []).forEach((g, j) => {
      const gp = `${p}.graphics[${j}]`;
      if (NOT_IMPLEMENTED_KINDS.includes(g.kind)) { warn(gp, `graphic kind "${g.kind}" is not implemented yet; use a map image asset as a clip with callouts/highlight_box`); return; }
      if (!GRAPHIC_KINDS.includes(g.kind)) { err(`${gp}.kind`, `unknown graphic kind "${g.kind}" (use ${GRAPHIC_KINDS.join(', ')})`); return; }
      const gs = g.start ?? 0; const ge = g.end ?? len;
      if (!isNum(gs) || !isNum(ge) || ge <= gs) err(gp, 'graphic start/end must be numbers with end > start (scene-local seconds)');
      else if (ge > len + 1e-6) err(gp, `graphic ends at ${ge}s but scene is ${len.toFixed(2)}s long`);
      if (g.position && !POSITIONS.includes(g.position)) err(`${gp}.position`, `unknown position "${g.position}" (use ${POSITIONS.join(', ')})`);
      if (['title', 'subtitle', 'callout', 'kinetic'].includes(g.kind) && !isStr(g.text)) err(`${gp}.text`, `${g.kind} needs "text"`);
      if (g.kind === 'lower_third' && !isStr(g.title) && !isStr(g.text)) err(gp, 'lower_third needs "title" (and optional "subtitle")');
      if (g.kind === 'stat' && !isNum(g.value)) err(`${gp}.value`, 'stat needs a numeric "value"');
      if (g.kind === 'bar_chart' && !(Array.isArray(g.items) && g.items.length && g.items.every((it) => isStr(it.label) && isNum(it.value)))) err(`${gp}.items`, 'bar_chart needs items: [{label, value}]');
      if (g.kind === 'timeline' && !(Array.isArray(g.items) && g.items.length >= 2)) err(`${gp}.items`, 'timeline needs at least 2 items: [{label, date}]');
      if (g.kind === 'callout' && g.target && !(isNum(g.target.x) && isNum(g.target.y))) err(`${gp}.target`, 'callout target must be {x,y} in 0..1 frame coordinates');
      if (g.kind === 'highlight_box' && !(Array.isArray(g.rect) && g.rect.length === 4)) err(`${gp}.rect`, 'highlight_box needs rect: [x,y,w,h] in 0..1 frame coordinates');
    });

    (s.advanced || []).forEach((adv, j) => checkAdvanced(`${p}.advanced[${j}]`, adv, err));

    if (s.transition) {
      const t = s.transition;
      if (t.type && !REGISTRY[`transition.${t.type}`]) warn(`${p}.transition.type`, `unknown transition "${t.type}" — will fall back to a dissolve`);
      if (t.duration !== undefined && (!isNum(t.duration) || t.duration < 0 || t.duration > len)) err(`${p}.transition.duration`, 'transition duration must be 0..scene length');
    }
  });

  (plan.advanced || []).forEach((adv, j) => checkAdvanced(`advanced[${j}]`, adv, err));

  const audio = plan.audio || {};
  if (audio.narration) {
    checkAsset('audio.narration.asset', audio.narration.asset);
    if (audio.narration.end !== undefined && !(isNum(audio.narration.end) && audio.narration.end > 0)) err('audio.narration.end', 'narration end must be a positive number (master seconds)');
  }
  (audio.music || []).forEach((m, i) => {
    checkAsset(`audio.music[${i}].asset`, m.asset);
    if (isNum(m.gainDb) && m.gainDb > -6) warn(`audio.music[${i}].gainDb`, `music at ${m.gainDb} dB will fight the narration; typical bed is -18 to -24 dB`);
  });
  (audio.sfx || []).forEach((x, i) => {
    checkAsset(`audio.sfx[${i}].asset`, x.asset);
    if (!isNum(x.at)) err(`audio.sfx[${i}].at`, 'sfx needs "at" (master timeline seconds)');
  });
  if (audio.narration && narration && Math.abs(plan.scenes.at(-1).end - narration.duration) > 2) {
    warn('scenes', `timeline ends at ${plan.scenes.at(-1).end}s but narration is ${narration.duration}s long`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Fill defaults and derive resolved values. Does not mutate the input.
 * Adds: output {width,height,fps,...}, scene lengths, clip defaults, audio defaults.
 */
export function normalizePlan(plan, { manifest = null } = {}) {
  const out = structuredClone(plan);
  out.version = PLAN_VERSION;
  out.output = { format: 'mp4', codec: 'h264', ...out.output };
  const dims = resolveOutput(out.output);
  Object.assign(out.output, { width: dims.width, height: dims.height, fps: dims.fps });
  out.outputNotes = dims.notes;
  out.scenes = [...out.scenes].sort((a, b) => a.start - b.start);
  for (const s of out.scenes) {
    s.clips ||= []; s.graphics ||= [];
    const len = s.end - s.start;
    for (const c of s.clips) {
      c.start ??= 0; c.end ??= len; c.sourceIn ??= 0; c.speed ??= 1; c.fit ??= 'cover';
      const a = manifest?.assets.find((x) => x.id === c.asset);
      c.motion ??= a?.type === 'image' ? 'push_in' : 'static';
    }
    for (const g of s.graphics) { g.start ??= 0; g.end ??= len; }
  }
  out.audio ||= {};
  out.audio.music ||= []; out.audio.sfx ||= [];
  out.audio.autoSfx ??= true;
  out.captions ||= { enabled: false };
  return out;
}

export const masterEnd = (plan) => (plan.mode === 'timeline' ? plan.timeline.duration : plan.scenes[plan.scenes.length - 1].end);
