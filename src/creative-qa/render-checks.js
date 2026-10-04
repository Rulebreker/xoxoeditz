// CREATIVE QA, render level: look at the pixels and samples of an actual render (or preview) with FFmpeg and compare
// them with what the plan says should be there. Catches what no plan can: black frames where there should be
// picture, frozen stretches, bars nobody asked for, clipped or silent audio, cuts that are not where the plan put them.
// Every FFmpeg call goes through the single tool resolver (shell:false).

import { runTool } from '../core/resolve-tool.js';

const issue = (category, code, severity, message, extra = {}) => ({ category, code, severity, message, ...extra });
const num = (s) => Number.parseFloat(s);

// ---- parsers (pure; unit-tested against canned FFmpeg output) ----
export function parseBlackdetect(stderr) {
  const out = []; for (const m of stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)) out.push({ start: num(m[1]), end: num(m[2]), duration: num(m[3]) });
  return out;
}
export function parseFreezedetect(stderr) {
  const starts = [...stderr.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => num(m[1])); const durs = [...stderr.matchAll(/freeze_duration:\s*([\d.]+)/g)].map((m) => num(m[1]));
  return starts.map((s, i) => ({ start: s, duration: durs[i] ?? null, end: durs[i] !== undefined ? s + durs[i] : null }));
}
export function parseSceneCuts(stderr) { return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => num(m[1])); }
export function parseVolumedetect(stderr) {
  const mean = /mean_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(stderr); const max = /max_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(stderr);
  const f = (m) => (m ? (m[1] === '-inf' ? -120 : num(m[1])) : null);
  return { meanDb: f(mean), maxDb: f(max) };
}
export function parseSilencedetect(stderr) {
  const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Math.max(0, num(m[1]))); const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)].map((m) => ({ end: num(m[1]), duration: num(m[2]) }));
  return starts.map((s, i) => ({ start: s, duration: ends[i]?.duration ?? null, end: ends[i]?.end ?? null }));
}
export function parseCropdetect(stderr) { const all = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)]; const last = all.at(-1); return last ? { w: +last[1], h: +last[2], x: +last[3], y: +last[4] } : null; }

const within = (t, wins, pad = 0) => wins.some(([a, b]) => t >= a - pad && t <= b + pad);

/** Time windows in which the plan intentionally shows (near-)black or a static picture. */
export function intentionalWindows(plan) {
  const dark = []; const still = [];
  for (const s of plan.timeline.shots) {
    if (['DARK_TITLE', 'END_CARD', 'TEXT_SCENE', 'STAT_SCENE', 'SLATE'].includes(s.template)) { dark.push([s.start - 0.1, s.end + 0.1]); still.push([s.start - 0.1, s.end + 0.1]); }
    if (s.template === 'FREEZE_FRAME' || s.layers.some((l) => l.remap?.map?.segments?.some((g) => g.freeze))) still.push([s.start - 0.1, s.end + 0.1]);
  }
  const d = plan.timeline.duration; dark.push([0, 0.35], [d - Math.max(plan.endFade || 0.6, 0.6) - 0.3, d + 0.1]); still.push([0, 0.35], [d - 1.2, d + 0.1]);
  return { dark, still };
}

/** Planned hard-cut times (a cut or a flash is visible as a scene change; dissolves are not). */
export function plannedHardCuts(plan) {
  return plan.timeline.transitions.filter((t) => ['cut', 'flash', 'whip', 'glitch', 'push', 'motion_blur'].includes(t.type)).map((t) => t.cut);
}

const ff = (config, args, timeoutMs = 600000) => runTool(config, 'ffmpeg', ['-hide_banner', '-nostats', '-protocol_whitelist', 'file', ...args], { timeoutMs });

/**
 * @param {object} config
 * @param {string} file  the render
 * @param {object} o     { plan, probe?: {width,height,duration,hasAudio} }
 */
export async function renderChecks(config, file, { plan, probe = null }) {
  const issues = []; const metrics = {};
  const win = intentionalWindows(plan); const dur = probe?.duration ?? plan.timeline.duration;
  const note = (r, what) => { if (r.error) { issues.push(issue('render', 'CHECK_FAILED', 'info', `${what} could not run: ${r.error}`)); return false; } return true; };

  const bl = await ff(config, ['-i', file, '-vf', 'blackdetect=d=0.12:pix_th=0.10', '-an', '-f', 'null', '-']);
  if (note(bl, 'black-frame detection')) {
    const blacks = parseBlackdetect(bl.stderr); metrics.blackSegments = blacks.length;
    for (const b of blacks) if (!within((b.start + b.end) / 2, win.dark)) issues.push(issue('render', 'BLACK_FRAMES', 'error', `black picture from ${b.start.toFixed(2)}s to ${b.end.toFixed(2)}s where the plan shows picture`, { data: b }));
  }
  const fz = await ff(config, ['-i', file, '-vf', 'freezedetect=n=-55dB:d=0.5', '-an', '-f', 'null', '-']);
  if (note(fz, 'freeze detection')) {
    const frozen = parseFreezedetect(fz.stderr); metrics.frozenSegments = frozen.length;
    for (const f of frozen) if (!within(f.start + (f.duration || 0) / 2, win.still)) issues.push(issue('render', 'FROZEN_PICTURE', 'warning', `the picture is frozen from ${f.start.toFixed(2)}s${f.duration ? ` for ${f.duration.toFixed(1)}s` : ''} without a planned freeze`, { data: f }));
  }
  // cuts: planned hard cuts should be visible; visible scene changes should be planned
  const sc = await ff(config, ['-i', file, '-vf', "select='gt(scene,0.32)',showinfo", '-an', '-f', 'null', '-']);
  if (note(sc, 'cut detection')) {
    const seen = parseSceneCuts(sc.stderr); const planned = plannedHardCuts(plan); const tol = 3 / plan.output.fps + 0.04;
    metrics.detectedCuts = seen.length; metrics.plannedHardCuts = planned.length;
    const hit = planned.filter((c) => seen.some((s) => Math.abs(s - c) <= tol));
    metrics.cutDetectionRate = planned.length ? +(hit.length / planned.length).toFixed(3) : 1;
    if (planned.length >= 5 && metrics.cutDetectionRate < 0.5) issues.push(issue('render', 'CUTS_NOT_VISIBLE', 'warning', `only ${hit.length} of ${planned.length} planned hard cuts show up as picture changes (very similar neighbouring shots, or the render does not match the plan)`));
    const allWins = plan.timeline.transitions.map((t) => [t.window.start - tol, t.window.end + tol]).concat(plan.timeline.shots.flatMap((s) => (s.overlays || []).map((o) => [s.start + o.at - 0.2, s.start + o.at + (o.d || 0.15) + 0.3])));
    const extra = seen.filter((s) => !planned.some((c) => Math.abs(c - s) <= tol) && !within(s, allWins) && !plan.timeline.shots.some((sh) => (sh.layers.some((l) => l.remap) || sh.template === 'IMPACT_SCENE') && s >= sh.start && s <= sh.end));
    metrics.unplannedChanges = extra.length;
    if (extra.length > Math.max(3, plan.timeline.shots.length * 0.3)) issues.push(issue('render', 'UNPLANNED_CUTS', 'warning', `${extra.length} sudden picture changes happen where no cut is planned (first at ${extra[0].toFixed(2)}s)`, { data: { at: extra.slice(0, 8) } }));
  }
  // unexpected letterbox bars
  if (probe?.width && !plan.look?.letterbox) {
    const times = [0.2, 0.45, 0.7].map((f) => Math.min(dur - 0.1, dur * f)); const bars = [];
    for (const t of times) { const r = await ff(config, ['-ss', String(t), '-i', file, '-frames:v', '2', '-vf', 'cropdetect=24:2:0', '-an', '-f', 'null', '-']); if (!r.error) { const c = parseCropdetect(r.stderr); if (c) bars.push(c); } }
    const barred = bars.filter((c) => c.h < probe.height * 0.92 || c.w < probe.width * 0.92); metrics.barSamples = barred.length;
    if (bars.length >= 3 && barred.length >= 3 && !times.some((t) => within(t, win.dark))) issues.push(issue('render', 'UNPLANNED_BARS', 'warning', `the picture is boxed in (${barred[0].w}x${barred[0].h} inside ${probe.width}x${probe.height}) although no letterbox was planned`));
  }
  // audio
  if (probe?.hasAudio !== false) {
    const vol = await ff(config, ['-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
    if (note(vol, 'loudness check')) {
      const v = parseVolumedetect(vol.stderr); metrics.meanDb = v.meanDb; metrics.maxDb = v.maxDb;
      if (v.maxDb !== null && v.maxDb >= -0.2) issues.push(issue('render', 'AUDIO_CLIPPING', 'error', `the mix peaks at ${v.maxDb} dB: it clips`));
      if (v.meanDb !== null && v.meanDb < -34 && plan.audio.music.length) issues.push(issue('render', 'AUDIO_QUIET', 'warning', `the mix is very quiet (mean ${v.meanDb} dB)`));
      if (v.maxDb !== null && v.maxDb < -18) issues.push(issue('render', 'AUDIO_WEAK_PEAKS', 'warning', `the loudest moment is only ${v.maxDb} dB: no punch`));
    }
    const sil = await ff(config, ['-i', file, '-vn', '-af', 'silencedetect=noise=-55dB:d=1.5', '-f', 'null', '-']);
    if (note(sil, 'silence check') && plan.audio.music.length) {
      const s = parseSilencedetect(sil.stderr).filter((x) => x.start > 0.5 && (x.end ?? dur) < dur - 1.5); metrics.silentStretches = s.length;
      for (const x of s) issues.push(issue('render', 'AUDIO_SILENT_STRETCH', 'warning', `silence from ${x.start.toFixed(1)}s${x.duration ? ` for ${x.duration.toFixed(1)}s` : ''} in an edit that has music`, { data: x }));
    }
  } else if (plan.audio.music.length || plan.audio.sfxEvents.length) issues.push(issue('render', 'AUDIO_MISSING', 'error', 'the render has no audio stream although the plan has music/SFX'));
  return { issues, metrics };
}
