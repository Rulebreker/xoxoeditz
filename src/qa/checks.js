// QA PIPELINE. Pure functions over (plan, manifest, inspect, build metadata, build report, capabilities).
// Each check returns issues: { check, code, severity: 'error'|'warning'|'info', message, comp?, layer?, data?, repairable? }

import fs from 'node:fs';
import path from 'node:path';
import { resolveStyle } from '../motion/styles.js';
import { masterEnd } from '../plan/schema.js';
import { MASTER } from '../ae/compile.js';

export const CHECKS = ['PROJECT_CHECK', 'ASSET_CHECK', 'TIMELINE_CHECK', 'TEXT_CHECK', 'AUDIO_CHECK', 'EFFECT_CHECK', 'COMPOSITION_CHECK', 'RENDER_CHECK'];

const issue = (check, code, severity, message, extra = {}) => ({ check, code, severity, message, ...extra });
const compsOf = (ins) => ins.items.filter((i) => i.type === 'comp');
const compByName = (ins, n) => ins.items.find((i) => i.type === 'comp' && i.name === n);

function luminance(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrastRatio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export function projectCheck({ inspect }) {
  const out = [];
  if (!inspect.project.file) out.push(issue('PROJECT_CHECK', 'PROJECT_UNSAVED', 'error', 'The project has never been saved; rendering needs a saved .aep.'));
  else if (inspect.project.dirty) out.push(issue('PROJECT_CHECK', 'PROJECT_DIRTY', 'warning', 'The project has unsaved changes; it will be saved before rendering.'));
  if (!compByName(inspect, MASTER)) out.push(issue('PROJECT_CHECK', 'COMP_MASTER_MISSING', 'error', `Master composition ${MASTER} does not exist.`));
  for (const c of compsOf(inspect)) if (!/^COMP_[A-Z0-9_]+$/.test(c.name)) out.push(issue('PROJECT_CHECK', 'NAMING', 'warning', `Composition "${c.name}" does not follow the COMP_* naming convention.`, { comp: c.name }));
  return out;
}

export function assetCheck({ plan, manifest, inspect, build }) {
  const out = [];
  const ids = new Set(build?.meta?.assetsUsed || []);
  for (const id of ids) {
    const a = manifest.assets.find((x) => x.id === id);
    if (!a) { out.push(issue('ASSET_CHECK', 'ASSET_UNKNOWN', 'error', `Plan uses asset ${id}, which is not in the manifest.`)); continue; }
    if (!fs.existsSync(a.path)) out.push(issue('ASSET_CHECK', 'ASSET_FILE_MISSING', 'error', `Source file for ${id} is gone: ${a.path}`, { data: { id } }));
    const it = inspect.items.find((i) => i.type === 'footage' && i.name === id);
    if (!it) out.push(issue('ASSET_CHECK', 'ASSET_NOT_IN_PROJECT', 'error', `${id} was not imported into the After Effects project.`, { data: { id } }));
    else if (it.missing) out.push(issue('ASSET_CHECK', 'ASSET_MISSING_IN_AE', 'error', `After Effects reports ${id} as missing footage.`, { data: { id } }));
    if (a.meta?.probe === 'fallback' && a.type === 'video') out.push(issue('ASSET_CHECK', 'ASSET_UNPROBED', 'warning', `No metadata for ${id} (ffprobe unavailable); trims could not be validated.`));
  }
  for (const c of compsOf(inspect)) for (const l of c.layers || []) {
    if (/_MISSING$/.test(l.name) || (l.kind === 'solid' && l.name.startsWith('MISSING'))) out.push(issue('ASSET_CHECK', 'PLACEHOLDER_PRESENT', 'error', `A placeholder stands in for a missing asset (${l.name}).`, { comp: c.name, layer: l.name }));
  }
  return out;
}

export function timelineCheck({ plan, narration, inspect, build }) {
  const out = [];
  const fps = build.meta.fps; const eps = 2 / fps;
  const master = compByName(inspect, MASTER);
  if (master) {
    if (Math.abs(master.duration - masterEnd(plan)) > 1 / fps) out.push(issue('TIMELINE_CHECK', 'COMP_DURATION_MISMATCH', 'error', `${MASTER} is ${master.duration.toFixed(2)}s but the plan ends at ${masterEnd(plan).toFixed(2)}s.`, { comp: MASTER, repairable: true, data: { want: masterEnd(plan) } }));
    for (const sc of build.meta.sceneComps) {
      const l = master.layers?.find((x) => x.name === sc.layer);
      if (!l) continue; // reported as MISSING_LAYER below
      if (Math.abs(l.inPoint - sc.start) > eps || Math.abs(l.outPoint - (sc.end + sc.tail)) > eps) out.push(issue('TIMELINE_CHECK', 'SCENE_LAYER_TIMING', 'error', `${sc.layer} spans ${l.inPoint.toFixed(2)}–${l.outPoint.toFixed(2)}s, expected ${sc.start.toFixed(2)}–${(sc.end + sc.tail).toFixed(2)}s.`, { comp: MASTER, layer: sc.layer }));
    }
  }
  if (narration && Math.abs(narration.duration - masterEnd(plan)) > 2) out.push(issue('TIMELINE_CHECK', 'NARRATION_LENGTH', 'warning', `Narration is ${narration.duration.toFixed(1)}s but the timeline is ${masterEnd(plan).toFixed(1)}s.`));
  for (const c of compsOf(inspect)) for (const l of c.layers || []) {
    if (l.outPoint <= l.inPoint) out.push(issue('TIMELINE_CHECK', 'LAYER_ZERO_LENGTH', 'error', `${c.name}/${l.name} has no duration.`, { comp: c.name, layer: l.name }));
    else if (l.inPoint >= c.duration - 1e-6) out.push(issue('TIMELINE_CHECK', 'LAYER_OUTSIDE_COMP', 'warning', `${c.name}/${l.name} starts after the composition ends.`, { comp: c.name, layer: l.name }));
  }
  for (const u of build.meta.expectedUnits) {
    if (!u.comp) continue;
    const c = compByName(inspect, u.comp);
    const present = c?.layers?.some((l) => l.name === u.layer);
    if (!present) out.push(issue('TIMELINE_CHECK', 'MISSING_LAYER', u.optional ? 'warning' : 'error', `Expected layer ${u.comp}/${u.layer} is not in the project.`, { comp: u.comp, layer: u.layer, repairable: true, data: { stage: u.stage } }));
  }
  return out;
}

export function textCheck({ plan, inspect, build, caps }) {
  const out = [];
  const { width: W, height: H } = plan.output;
  const style = resolveStyle(plan.style, caps);
  const edge = Math.min(W, H) * 0.03;
  for (const c of compsOf(inspect)) {
    const texts = (c.layers || []).filter((l) => l.kind === 'text');
    for (const l of texts) {
      if (!String(l.text || '').trim()) out.push(issue('TEXT_CHECK', 'TEXT_EMPTY', 'warning', `${c.name}/${l.name} is empty.`, { comp: c.name, layer: l.name }));
      if (l.fontSize && l.fontSize < H * 0.022) out.push(issue('TEXT_CHECK', 'TEXT_TOO_SMALL', 'warning', `${c.name}/${l.name} is ${l.fontSize}px on a ${H}px frame — likely unreadable.`, { comp: c.name, layer: l.name }));
      const b = l.bounds;
      if (!b) continue;
      const right = b.left + b.width; const bottom = b.top + b.height;
      if (b.left < 0 || b.top < 0 || right > W || bottom > H) {
        out.push(issue('TEXT_CHECK', 'TEXT_OUT_OF_FRAME', 'error', `${c.name}/${l.name} extends outside the frame (${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}).`, { comp: c.name, layer: l.name, repairable: true, data: { bounds: b, position: l.position, scale: l.scale } }));
      } else if (b.left < edge || b.top < edge || right > W - edge || bottom > H - edge) {
        out.push(issue('TEXT_CHECK', 'TEXT_OUTSIDE_SAFE', 'warning', `${c.name}/${l.name} is inside the title-safe margin.`, { comp: c.name, layer: l.name }));
      }
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]; const b = texts[j];
      if (!a.bounds || !b.bounds || a.outPoint <= b.inPoint || b.outPoint <= a.inPoint) continue;
      const w = Math.min(a.bounds.left + a.bounds.width, b.bounds.left + b.bounds.width) - Math.max(a.bounds.left, b.bounds.left);
      const h = Math.min(a.bounds.top + a.bounds.height, b.bounds.top + b.bounds.height) - Math.max(a.bounds.top, b.bounds.top);
      if (w > 0 && h > 0) {
        const area = w * h; const small = Math.min(a.bounds.width * a.bounds.height, b.bounds.width * b.bounds.height) || 1;
        if (area / small > 0.15) out.push(issue('TEXT_CHECK', 'TEXT_OVERLAP', 'warning', `${c.name}: ${a.name} and ${b.name} overlap on screen at the same time.`, { comp: c.name, layer: a.name, data: { other: b.name } }));
      }
    }
  }
  for (const [name, hex] of [['text', style.colors.text], ['accent', style.colors.accent], ['muted', style.colors.muted]]) {
    const r = contrastRatio(hex, style.colors.bg);
    if (r < 3) out.push(issue('TEXT_CHECK', 'LOW_CONTRAST', 'warning', `Style ${name} colour ${hex} has contrast ${r.toFixed(1)}:1 against the background ${style.colors.bg}.`));
  }
  return out;
}

export function audioCheck({ plan, narration, inspect, build }) {
  const out = [];
  const master = compByName(inspect, MASTER);
  const layers = master?.layers || [];
  if (plan.audio.narration) {
    const n = layers.find((l) => l.name === 'NARR_MAIN');
    if (!n) out.push(issue('AUDIO_CHECK', 'AUDIO_NARRATION_MISSING', 'error', 'Narration layer NARR_MAIN is missing from the master composition.', { comp: MASTER, layer: 'NARR_MAIN' }));
    else if (n.audioEnabled === false) out.push(issue('AUDIO_CHECK', 'AUDIO_MUTED', 'error', 'Narration layer is muted.', { comp: MASTER, layer: 'NARR_MAIN', repairable: true }));
  } else out.push(issue('AUDIO_CHECK', 'NO_NARRATION', 'info', 'The plan has no narration track.'));
  if (narration?.loudness?.clipping) out.push(issue('AUDIO_CHECK', 'AUDIO_CLIPPING', 'warning', `Narration peaks at ${narration.loudness.maxDb} dB (clipping). Normalise or re-record.`));
  if (narration?.loudness?.meanDb !== null && narration?.loudness?.meanDb < -35) out.push(issue('AUDIO_CHECK', 'AUDIO_QUIET', 'warning', `Narration is very quiet (mean ${narration.loudness.meanDb} dB).`));
  for (const l of layers.filter((x) => x.name.startsWith('MUSIC_'))) {
    if (plan.audio.narration && narration?.speech?.length && !(l.audioKeys > 0)) out.push(issue('AUDIO_CHECK', 'AUDIO_NOT_DUCKED', 'warning', `${l.name} has no level keyframes, so it will not duck under the narration.`, { comp: MASTER, layer: l.name, repairable: true }));
    const lv = Array.isArray(l.audioLevel) ? l.audioLevel[0] : l.audioLevel;
    if (typeof lv === 'number' && !l.audioKeys && lv > -10) out.push(issue('AUDIO_CHECK', 'MUSIC_TOO_LOUD', 'warning', `${l.name} sits at ${lv} dB, which will fight narration.`, { comp: MASTER, layer: l.name }));
  }
  for (const l of layers.filter((x) => /^SFX_/.test(x.name))) {
    const lv = Array.isArray(l.audioLevel) ? l.audioLevel[0] : l.audioLevel;
    if (typeof lv === 'number' && lv > -3) out.push(issue('AUDIO_CHECK', 'SFX_TOO_LOUD', 'warning', `${l.name} is at ${lv} dB.`, { comp: MASTER, layer: l.name }));
  }
  for (const c of compsOf(inspect)) if (c.name !== MASTER) for (const l of c.layers || []) {
    if (l.kind === 'footage' && l.hasAudio && l.audioEnabled) out.push(issue('AUDIO_CHECK', 'AUDIO_BROLL_UNMUTED', 'warning', `${c.name}/${l.name} carries its own audio under the narration.`, { comp: c.name, layer: l.name, repairable: true }));
  }
  return out;
}

export function effectCheck({ report }) {
  const out = [];
  for (const f of report?.fallbacksUsed || []) {
    const poor = f.quality < 0.5;
    out.push(issue('EFFECT_CHECK', poor ? 'FALLBACK_LOW_QUALITY' : 'FALLBACK_USED', poor ? 'warning' : 'info', `${f.effect || f.label}: used "${f.using}"${f.requested && f.requested !== f.effect ? ` (requested ${f.requested})` : ''} instead of the preferred implementation. ${(f.reasons || [])[0] || ''}`.trim(), { data: f }));
  }
  for (const d of report?.degraded || []) out.push(issue('EFFECT_CHECK', 'ELEMENT_DROPPED', 'warning', `Optional element ${d.label} could not be created: ${d.message}`, { data: { unit: d.unit } }));
  return out;
}

export function compositionCheck({ plan, inspect, build }) {
  const out = [];
  const { width: W, height: H, fps } = plan.output;
  for (const c of compsOf(inspect)) {
    if (c.width !== W || c.height !== H || Math.abs(c.fps - fps) > 0.01) out.push(issue('COMPOSITION_CHECK', 'COMP_SETTINGS', 'error', `${c.name} is ${c.width}x${c.height}@${c.fps} but the output is ${W}x${H}@${fps}.`, { comp: c.name }));
    if (c.name !== MASTER && c.numLayers === 0) out.push(issue('COMPOSITION_CHECK', 'EMPTY_COMP', 'error', `${c.name} has no layers.`, { comp: c.name }));
    if (c.numLayers > 3000) out.push(issue('COMPOSITION_CHECK', 'HEAVY_COMP', 'warning', `${c.name} has ${c.numLayers} layers; previews may be slow.`, { comp: c.name }));
  }
  const master = compByName(inspect, MASTER);
  for (const sc of build.meta.sceneComps) {
    if (!compByName(inspect, sc.comp)) out.push(issue('COMPOSITION_CHECK', 'SCENE_COMP_MISSING', 'error', `Scene composition ${sc.comp} is missing.`, { comp: sc.comp }));
    else if (master && !master.layers?.some((l) => l.name === sc.layer)) out.push(issue('COMPOSITION_CHECK', 'SCENE_NOT_NESTED', 'error', `${sc.comp} is not placed in ${MASTER}.`, { comp: MASTER, layer: sc.layer }));
  }
  return out;
}

export function renderCheck({ plan, caps, config, outputPath, dryRun }) {
  const out = [];
  const R = (code, sev, msg, extra) => out.push(issue('RENDER_CHECK', code, sev, msg, extra));
  const dir = path.dirname(outputPath);
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); } catch { R('OUTPUT_DIR_NOT_WRITABLE', 'error', `Cannot write to ${dir}.`); }
  try {
    const st = fs.statfsSync(dir); const free = st.bavail * st.bsize;
    const need = ((plan.output.bitrateMbps || (plan.output.height >= 2000 ? 60 : 20)) * 1e6 / 8) * masterEnd(plan) * 2.5; // intermediate + final
    if (free < need) R('LOW_DISK', 'warning', `Only ${(free / 1e9).toFixed(1)} GB free; this render may need about ${(need / 1e9).toFixed(1)} GB.`);
  } catch { /* statfs unsupported */ }
  const ext = path.extname(outputPath).toLowerCase();
  if (!['.mp4', '.mov', '.mkv', '.webm', '.avi'].includes(ext)) R('OUTPUT_EXT', 'warning', `Unusual output extension "${ext}".`);
  if (!caps?.aerender && !caps?.media_encoder && config.transport !== 'mock') R('NO_RENDERER', dryRun ? 'warning' : 'error', 'Neither aerender nor Media Encoder was found, so After Effects projects cannot be rendered headlessly.');
  if (!caps?.ffmpeg) R('NO_FFMPEG', 'warning', 'FFmpeg is missing: no H.264 transcode and no automated verification of the rendered file.');
  if (plan.output.width % 2 || plan.output.height % 2) R('ODD_DIMENSIONS', 'error', 'H.264 needs even output dimensions.');
  return out;
}

export const CHECK_FNS = { PROJECT_CHECK: projectCheck, ASSET_CHECK: assetCheck, TIMELINE_CHECK: timelineCheck, TEXT_CHECK: textCheck, AUDIO_CHECK: audioCheck, EFFECT_CHECK: effectCheck, COMPOSITION_CHECK: compositionCheck, RENDER_CHECK: renderCheck };

/** Run all checks; produce the QA_REPORT.json structure. */
export function runQa(ctx) {
  const checks = {}; const errors = []; const warnings = [];
  for (const name of CHECKS) {
    let issues;
    try { issues = CHECK_FNS[name](ctx); } catch (e) { issues = [issue(name, 'CHECK_CRASHED', 'error', `${name} crashed: ${e.message}`)]; }
    checks[name] = { passed: !issues.some((i) => i.severity === 'error'), issues };
    for (const i of issues) { if (i.severity === 'error') errors.push(i); else if (i.severity === 'warning') warnings.push(i); }
  }
  const fallbacks = (ctx.report?.fallbacksUsed || []).map((f) => ({ effect: f.effect || f.label, using: f.using, quality: f.quality, when: f.when, reason: (f.reasons || [])[0] || null }));
  return {
    passed: errors.length === 0, generatedAt: new Date().toISOString(),
    summary: `${errors.length} errors, ${warnings.length} warnings, ${fallbacks.length} fallbacks`,
    errors, warnings, fallbacks_used: fallbacks, checks,
  };
}
