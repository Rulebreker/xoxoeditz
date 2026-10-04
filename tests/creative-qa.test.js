import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir } from './helpers/env.js';
import { hasFfmpeg } from './helpers/media.js';
import { CAPS, projectManifest, library, beatMap, directive } from './helpers/fixtures.js';
import { directTimeline } from '../src/director/direct.js';
import { critiquePlan, scoreIssues, critiqueRender } from '../src/creative-qa/index.js';
import { planChecks } from '../src/creative-qa/plan-checks.js';
import { parseBlackdetect, parseFreezedetect, parseSceneCuts, parseVolumedetect, parseSilencedetect, parseCropdetect, intentionalWindows, plannedHardCuts, renderChecks } from '../src/creative-qa/render-checks.js';
import { refineDirection, previewLoop, SEED_FIXABLE } from '../src/creative-qa/refine.js';
import { virtualBeatMap } from '../src/beat/analyze.js';
import { testConfig } from './helpers/env.js';

const codes = (c) => new Set([...c.errors, ...c.warnings, ...c.info].map((i) => i.code));
const clone = (x) => JSON.parse(JSON.stringify(x));
async function good(seed = 5) {
  const L = await library(); const manifest = projectManifest(12);
  const { plan } = directTimeline({ directive: directive({ config: { seed } }), manifest, library: L, beatMap: beatMap(), caps: CAPS });
  return { plan, manifest, L, ctx: { manifest, library: L } };
}

test('plan critique: a Director plan is judged on structure with per-category scores; nothing it makes is a slideshow, off the beat or silent', { skip: !hasFfmpeg, timeout: 120000 }, async () => {
  const { plan, ctx } = await good(); const c = critiquePlan(plan, ctx);
  assert.equal(c.level, 'plan'); assert.ok(c.score > 0.6 && c.score <= 1, `score ${c.score}`); assert.deepEqual(Object.keys(c.categories).sort(), ['composition', 'motion', 'pacing', 'render', 'rhythm', 'sound', 'transitions', 'type', 'variety']);
  for (const code of ['SLIDESHOW', 'ZOOM_ONLY', 'CUTS_OFF_BEAT', 'DUPLICATE_ADJACENT', 'ACCIDENTAL_BOX', 'EMPTY_SHOT', 'TEXT_DOES_NOT_FIT', 'NO_SFX']) assert.ok(!codes(c).has(code), `${code} on a good plan: ${JSON.stringify([...c.errors, ...c.warnings].map((i) => i.message))}`);
  assert.ok(c.metrics.cutsOnBeat >= 0.85 && c.metrics.cameraMoves >= 3 && c.metrics.speedMaps >= 3 && c.metrics.sfxEvents >= 8, JSON.stringify(c.metrics));
  const again = critiquePlan(plan, ctx); assert.deepEqual(again.errors, c.errors); assert.equal(again.score, c.score);
});

test('plan critique: each editorial failure is detected, by name, on a plan made to have it - and only there', { skip: !hasFfmpeg, timeout: 120000 }, async () => {
  const { plan, ctx } = await good(); const base = critiquePlan(plan, ctx);
  const run = (mut) => { const p = clone(plan); mut(p); return critiquePlan(p, ctx); };
  // slideshow: every shot a full-bleed push, no speed ramps, dissolves only
  const slide = run((p) => { for (const s of p.timeline.shots) { s.template = 'FULL_BLEED'; s.camera = { rig: 'X', move: 'push', family: 'dolly' }; for (const l of s.layers) { delete l.remap; l.motion = [{ type: 'PUSH', amount: 0.1 }]; } } for (const t of p.timeline.transitions) t.type = 'dissolve'; });
  assert.ok(codes(slide).has('SLIDESHOW') && codes(slide).has('ZOOM_ONLY') && slide.errors.some((e) => e.code === 'SLIDESHOW'), 'slideshow is an ERROR on an intense edit'); assert.ok(slide.score < base.score - 0.1);
  // cuts shifted off the beat
  const off = run((p) => { const sh = p.timeline.shots; for (let i = 1; i < sh.length - 1; i++) { const d = 0.043 + (i % 3) * 0.011; sh[i].start += d; sh[i - 1].end += d; p.timeline.transitions[i - 1].cut += d; } }); assert.ok(codes(off).has('CUTS_OFF_BEAT'), JSON.stringify(off.metrics.cutsOnBeat));
  // the same asset twice in a row
  const dup = run((p) => { const a = p.timeline.shots.filter((s) => s.template === 'FULL_BLEED' || s.template === 'CAMERA'); const [x, y] = [p.timeline.shots.indexOf(a[0]), p.timeline.shots.indexOf(a[1])]; p.timeline.shots[y].assets.main = p.timeline.shots[x].assets.main; if (y === x + 1) return; p.timeline.shots[x + 1] && (p.timeline.shots[x + 1].assets.main = p.timeline.shots[x].assets.main); p.timeline.shots[x + 1].template = 'FULL_BLEED'; p.timeline.shots[x].template = 'FULL_BLEED'; }); assert.ok(codes(dup).has('DUPLICATE_ADJACENT') || codes(dup).has('NEAR_DUPLICATE_ADJACENT'));
  // an opaque box over a picture shot
  const box = run((p) => { const s = p.timeline.shots.find((x) => x.template === 'FULL_BLEED' || x.template === 'CAMERA'); s.layers.push({ kind: 'solid', name: 'OOPS', color: '#ff0000', opacity: 100 }); }); assert.ok(box.errors.some((e) => e.code === 'ACCIDENTAL_BOX'));
  // text that does not fit, an empty shot
  const fit = run((p) => { const s = p.timeline.shots.find((x) => x.text.length); s.text[0].layout.fits = false; }); assert.ok(fit.errors.some((e) => e.code === 'TEXT_DOES_NOT_FIT'));
  const empty = run((p) => { const s = p.timeline.shots[2]; s.layers = [{ kind: 'solid', name: 'x', color: '#000', opacity: 10 }]; s.text = []; }); assert.ok(empty.errors.some((e) => e.code === 'EMPTY_SHOT'));
  // sound: none at all / a long gap / too hot / nothing on the drop
  assert.ok(codes(run((p) => { p.audio.sfxEvents = []; })).has('NO_SFX'));
  const gap = run((p) => { p.audio.sfxEvents = p.audio.sfxEvents.filter((e) => e.at < 4 || e.at > 27); }); assert.ok(codes(gap).has('SFX_GAP'));
  assert.ok(codes(run((p) => { p.audio.sfxEvents[0].fit.layers[0].gainDb = 40; })).has('SFX_HOT'));
  const nodrop = run((p) => { p.audio.sfxEvents = p.audio.sfxEvents.filter((e) => Math.abs(e.at - p.beatMap.drops[0]) > 0.15); }); assert.ok(codes(nodrop).has('DROP_NO_SFX'));
  assert.ok(codes(run((p) => { p.audio.music = []; })).has('NO_MUSIC')); assert.ok(codes(run((p) => { p.audio.music[0].gainDb = -1; })).has('MUSIC_TOO_LOUD'));
  // rhythm/pacing: metronome and flash shots
  const metro = run((p) => { const n = p.timeline.shots.length; const L = p.timeline.duration / n; p.timeline.shots.forEach((s, i) => { s.start = i * L; s.end = (i + 1) * L; }); p.timeline.transitions.forEach((t, i) => { t.cut = (i + 1) * L; }); }); assert.ok(codes(metro).has('METRONOME'));
  assert.ok(codes(run((p) => { p.timeline.shots[3].end = p.timeline.shots[3].start + 0.12; })).has('FLASH_SHOT'));
  // transitions: three in a row, one kind only, too long, off palette
  assert.ok(codes(run((p) => { for (const i of [2, 3, 4]) p.timeline.transitions[i].type = 'whip'; })).has('TRANSITION_REPEAT'));
  assert.ok(codes(run((p) => { for (const t of p.timeline.transitions) t.type = t.type === 'cut' ? 'cut' : 'zoom'; })).has('ONE_TRANSITION'));
  assert.ok(codes(run((p) => { p.timeline.transitions.find((t) => t.type !== 'cut').d = 2.4; })).has('LONG_TRANSITION'));
  // type: density, repeated animation
  assert.ok(codes(run((p) => { for (const s of p.timeline.shots) s.text.push({ text: 'A VERY LONG LINE OF ON SCREEN COPY THAT KEEPS GOING', at: s.start, animation: 'fade', kind: 'SUBTITLE', layout: { fits: true } }); })).has('TEXT_DENSE'));
  // composition: soft crop
  const soft = run((p) => { const s = p.timeline.shots.find((x) => x.layers.some((l) => l.kind === 'footage' && l.role !== 'inset')); const l = s.layers.find((x) => x.kind === 'footage'); l.crop = { x: 0.3, y: 0.3, w: 0.2, h: 0.2 }; l.rect = { x: 0, y: 0, w: 1, h: 1 }; }, ctx); assert.ok(codes(soft).has('SOFT_CROP') || codes(soft).has('TIGHT_CROP'));
  // static shots in a camera-driven edit
  const still = run((p) => { for (const s of p.timeline.shots) { s.camera = null; for (const l of s.layers) { l.motion = []; delete l.remap; } } }); assert.ok(codes(still).has('STATIC_SHOTS') || codes(still).has('FEW_SPEED_RAMPS'));
  // calm types: the same structural facts are not held against a documentary (no speed-ramp or transition complaints)
  const L = await library(); const manifest = projectManifest(12);
  const doc = directTimeline({ directive: directive({ type: 'documentary', prompt: 'a calm documentary about the airbase "AIRBASE 7"', config: { duration: 30 } }), manifest, library: L, beatMap: virtualBeatMap({ bpm: 80, duration: 30 }), caps: CAPS }).plan;
  const dc = critiquePlan(doc, { manifest, library: L }); assert.ok(!codes(dc).has('FEW_SPEED_RAMPS') && !codes(dc).has('SAME_SPEED_MAP') && !codes(dc).has('OVER_TRANSITIONED'), JSON.stringify([...dc.errors, ...dc.warnings].map((i) => i.code)));
});

test('scoring: an error costs more than a warning than info; categories are independent; worst category weighs in', () => {
  const mk = (...sev) => sev.map((s, i) => ({ category: i % 2 ? 'sound' : 'motion', code: 'X', severity: s, message: '' }));
  assert.equal(scoreIssues([]).overall, 1);
  assert.ok(scoreIssues(mk('error')).overall < scoreIssues(mk('warning')).overall && scoreIssues(mk('warning')).overall < scoreIssues(mk('info')).overall);
  const s = scoreIssues([{ category: 'sound', code: 'X', severity: 'error', message: '' }]); assert.equal(s.categories.motion, 1); assert.ok(s.categories.sound < 1);
  const spread = scoreIssues([{ category: 'sound', code: 'X', severity: 'error', message: '' }, { category: 'sound', code: 'Y', severity: 'error', message: '' }, { category: 'sound', code: 'Z', severity: 'error', message: '' }]);
  const even = scoreIssues([{ category: 'sound', code: 'X', severity: 'error', message: '' }, { category: 'motion', code: 'Y', severity: 'error', message: '' }, { category: 'type', code: 'Z', severity: 'error', message: '' }]);
  assert.ok(spread.overall < even.overall, 'concentrated failure is worse than the same damage spread thin');
});

test('render checks: FFmpeg output parsers', () => {
  assert.deepEqual(parseBlackdetect('[blackdetect @ 0x1] black_start:1.5 black_end:3 black_duration:1.5\nblack_start:5 black_end:5.2 black_duration:0.2'), [{ start: 1.5, end: 3, duration: 1.5 }, { start: 5, end: 5.2, duration: 0.2 }]);
  assert.deepEqual(parseFreezedetect('lavfi.freezedetect.freeze_start: 3.0\nlavfi.freezedetect.freeze_duration: 1.5\nlavfi.freezedetect.freeze_end: 4.5'), [{ start: 3, duration: 1.5, end: 4.5 }]);
  assert.deepEqual(parseSceneCuts('n:0 pts:1 pts_time:1.5 \nn:1 pts_time:3.04 x'), [1.5, 3.04]);
  assert.deepEqual(parseVolumedetect('mean_volume: -20.1 dB\nmax_volume: -0.0 dB'), { meanDb: -20.1, maxDb: -0 }); assert.deepEqual(parseVolumedetect('max_volume: -inf dB'), { meanDb: null, maxDb: -120 });
  assert.deepEqual(parseSilencedetect('silence_start: 2.5\nsilence_end: 5.5 | silence_duration: 3'), [{ start: 2.5, duration: 3, end: 5.5 }]);
  assert.deepEqual(parseCropdetect('crop=640:272:0:44\ncrop=640:270:0:45'), { w: 640, h: 270, x: 0, y: 45 });
});

// ---- real FFmpeg: a synthetic render with planted defects ----
function ffmpeg(args) { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]); if (r.status !== 0) throw new Error(r.stderr.toString()); }
function plantedRender(dir, { bars = false, clip = true, silentMid = false } = {}) {
  const parts = ['testsrc2=s=640x360:r=24:d=1.5', 'color=c=black:s=640x360:r=24:d=1.5', 'color=c=0x2a5599:s=640x360:r=24:d=1.5', 'testsrc=s=640x360:r=24:d=1.5'];
  const vf = parts.map((_, i) => `[${i}:v]format=yuv420p,setsar=1[v${i}]`).join(';');
  const inputs = []; parts.forEach((p) => inputs.push('-f', 'lavfi', '-i', p));
  inputs.push('-f', 'lavfi', '-t', '6', '-i', clip ? "aevalsrc='1.2*sin(2*PI*220*t)':s=44100" : 'sine=frequency=220:sample_rate=44100');
  const post = bars ? ',drawbox=x=0:y=0:w=iw:h=ih*0.14:color=black:t=fill,drawbox=x=0:y=ih*0.86:w=iw:h=ih*0.14:color=black:t=fill' : '';
  const out = path.join(dir, bars ? 'bars.mp4' : 'planted.mp4');
  ffmpeg([...inputs, '-filter_complex', `${vf};[v0][v1][v2][v3]concat=n=4:v=1:a=0${post}[v]${silentMid ? ';[4:a]volume=enable=\'between(t,1.5,4)\':volume=0[a]' : ''}`, '-map', '[v]', '-map', silentMid ? '[a]' : '4:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-t', '6', out]);
  return out;
}
const miniPlan = (o = {}) => ({ output: { width: 640, height: 360, fps: 24 }, look: { letterbox: Boolean(o.letterbox) }, endFade: 0.6, audio: { music: [{ asset: 'm' }], sfxEvents: [] }, timeline: { duration: 6, shots: [0, 1.5, 3, 4.5].map((s, i) => ({ id: `S${i + 1}`, start: s, end: s + 1.5, template: o.templates?.[i] || 'FULL_BLEED', layers: [], overlays: [], text: [] })), transitions: [1.5, 3, 4.5].map((c, i) => ({ index: i, type: 'cut', cut: c, d: 0, window: { start: c, end: c } })) } });

test('render checks on real media: planted black frames, frozen picture, clipping and bars are found; the clean parts are not', { skip: !hasFfmpeg, timeout: 180000 }, async () => {
  const cfg = testConfig({}); const dir = tmpDir(); const file = plantedRender(dir);
  const r = await renderChecks(cfg, file, { plan: miniPlan(), probe: { width: 640, height: 360, duration: 6, hasAudio: true } });
  const c = new Set(r.issues.map((i) => i.code));
  assert.ok(c.has('BLACK_FRAMES'), JSON.stringify(r.issues.map((i) => i.code + ':' + i.message))); assert.ok(c.has('FROZEN_PICTURE')); assert.ok(c.has('AUDIO_CLIPPING'));
  const black = r.issues.find((i) => i.code === 'BLACK_FRAMES'); assert.ok(black.data.start > 1.2 && black.data.start < 1.8 && black.data.end > 2.8, JSON.stringify(black.data));
  assert.ok(r.metrics.cutDetectionRate >= 0.66, `cuts seen ${r.metrics.cutDetectionRate}`);
  // the same render with the plan saying "this is a dark title, then a static text scene": nothing to complain about
  const intended = miniPlan({ templates: ['FULL_BLEED', 'DARK_TITLE', 'TEXT_SCENE', 'FULL_BLEED'] });
  const r2 = await renderChecks(cfg, file, { plan: intended, probe: { width: 640, height: 360, duration: 6, hasAudio: true } }); const c2 = new Set(r2.issues.map((i) => i.code));
  assert.ok(!c2.has('BLACK_FRAMES') && !c2.has('FROZEN_PICTURE'), `intentional black/still must not be flagged: ${[...c2]}`);
  // bars
  const barred = path.join(dir, 'bars.mp4'); // continuous moving picture with 14% black bars top and bottom
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=24:d=6', '-f', 'lavfi', '-t', '6', '-i', 'sine=frequency=220:sample_rate=44100', '-vf', 'drawbox=x=0:y=0:w=iw:h=ih*0.14:color=black:t=fill,drawbox=x=0:y=ih*0.86:w=iw:h=ih*0.14:color=black:t=fill,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', barred]);
  const rb = await renderChecks(cfg, barred, { plan: miniPlan(), probe: { width: 640, height: 360, duration: 6, hasAudio: true } }); assert.ok(rb.issues.some((i) => i.code === 'UNPLANNED_BARS'), JSON.stringify(rb.issues.map((i) => i.code)));
  const rl = await renderChecks(cfg, barred, { plan: miniPlan({ letterbox: true }), probe: { width: 640, height: 360, duration: 6, hasAudio: true } }); assert.ok(!rl.issues.some((i) => i.code === 'UNPLANNED_BARS'), 'planned letterbox is fine');
  // silence inside an edit that has music
  const quiet = plantedRender(dir, { clip: false, silentMid: true }); const rq = await renderChecks(cfg, quiet, { plan: miniPlan(), probe: { width: 640, height: 360, duration: 6, hasAudio: true } });
  assert.ok(rq.issues.some((i) => i.code === 'AUDIO_SILENT_STRETCH'), JSON.stringify(rq.issues.map((i) => i.code)));
  assert.ok(!rq.issues.some((i) => i.code === 'AUDIO_CLIPPING'));
  // missing audio stream
  const noA = path.join(dir, 'silent.mp4'); ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=2', '-pix_fmt', 'yuv420p', noA]);
  const rn = await renderChecks(cfg, noA, { plan: miniPlan(), probe: { width: 320, height: 180, duration: 2, hasAudio: false } }); assert.ok(rn.issues.some((i) => i.code === 'AUDIO_MISSING'));
  // windows + planned cuts
  const w = intentionalWindows(intended); assert.ok(w.dark.some(([a, b]) => a <= 1.5 && b >= 3) && w.still.length >= 3); assert.deepEqual(plannedHardCuts(miniPlan()), [1.5, 3, 4.5]);
  // combined critique + missing file
  const { plan } = await good(); const crit = await critiqueRender(cfg, plan, path.join(dir, 'nope.mp4'), {}, null); assert.equal(crit.renderChecked, false);
});

test('refineDirection: tries more cuts only while a new seed could help, keeps the best, is deterministic, and says what it could not fix', { skip: !hasFfmpeg, timeout: 240000 }, async () => {
  const L = await library(); const manifest = projectManifest(12);
  const input = (seed = 5, m = manifest) => ({ directive: directive({ config: { seed } }), manifest: m, library: L, beatMap: beatMap(), caps: CAPS });
  const a = refineDirection(input(), { rounds: 4 }); const b = refineDirection(input(), { rounds: 4 });
  assert.equal(JSON.stringify(a.plan), JSON.stringify(b.plan), 'deterministic'); assert.deepEqual(a.attempts, b.attempts);
  assert.ok(a.attempts.length >= 1 && a.attempts.length <= 4 && a.attempts[0].seed === 5);
  const best = Math.max(...a.attempts.map((x) => x.score)); assert.ok(a.critique.score >= best - 1e-9 || a.critique.errors.length < Math.min(...a.attempts.map((x) => x.errors)) + 1, 'the chosen cut is the best of those tried');
  assert.ok(a.critique.refinement.attempts.length === a.attempts.length && typeof a.critique.refinement.note === 'string');
  // a poor pool: two stills only. A new seed cannot invent assets, so the loop stops early and reports it
  const poor = projectManifest(2, { videoShare: 0 }); const r = refineDirection(input(5, poor), { rounds: 6 });
  assert.ok(r.attempts.length <= 3, `stopped after ${r.attempts.length} attempts`); assert.ok(r.critique.refinement.note.length > 0);
  assert.ok(SEED_FIXABLE.has('SLIDESHOW') && !SEED_FIXABLE.has('NO_MUSIC') && !SEED_FIXABLE.has('NO_SFX'), 'inputs problems are not blamed on the seed');
  const early = refineDirection(input(), { rounds: 6, target: 0 }); assert.equal(early.attempts.length, 1, 'a passing first cut ends the loop');
});

test('previewLoop: stops on a pass, re-cuts when the critique is fixable, gives up when it is not, and survives a failed rebuild', async () => {
  const mkCrit = (score, ...codesList) => ({ score, errors: codesList.filter((c) => c.startsWith('E:')).map((c) => ({ code: c.slice(2), severity: 'error' })), warnings: codesList.filter((c) => !c.startsWith('E:')).map((c) => ({ code: c, severity: 'warning' })), info: [] });
  const calls = { render: 0, redirect: [], build: 0 };
  const run = (critiques, { buildOk = true, rendered = true } = {}) => { calls.render = 0; calls.redirect = []; calls.build = 0; let i = 0;
    return previewLoop({ plan: { v: 0 }, baseSeed: 10, rounds: 3, target: 0.88, render: async (p) => (rendered ? { file: `f${calls.render++}`, probe: {} } : null), critique: async () => critiques[Math.min(i++, critiques.length - 1)], redirect: async (seed) => { calls.redirect.push(seed); return { v: seed }; }, build: async () => { calls.build++; return buildOk ? { success: true } : { success: false, error: 'boom' }; } }); };
  const pass = await run([mkCrit(0.95)]); assert.equal(pass.passed, true); assert.equal(calls.render, 1); assert.equal(calls.redirect.length, 0);
  const fix = await run([mkCrit(0.7, 'CUTS_NOT_VISIBLE'), mkCrit(0.93)]); assert.equal(fix.passed, true); assert.deepEqual(calls.redirect, [11]); assert.equal(calls.build, 1); assert.equal(fix.history.length, 2); assert.deepEqual(fix.plan, { v: 11 });
  const stuck = await run([mkCrit(0.7, 'BLACK_FRAMES'), mkCrit(0.7, 'BLACK_FRAMES')]); assert.equal(stuck.passed, false); assert.equal(calls.redirect.length, 0, 'a black frame is not something a new cut fixes: no pointless re-render');
  const never = await run([mkCrit(0.6, 'SLIDESHOW'), mkCrit(0.65, 'SLIDESHOW'), mkCrit(0.62, 'SLIDESHOW')]); assert.equal(never.passed, false); assert.equal(calls.render, 3); assert.equal(never.best.critique.score, 0.65, 'the best attempt is returned, not the last');
  const none = await run([mkCrit(1)], { rendered: false }); assert.equal(none.passed, null); assert.match(none.history[0].note, /nothing to render/);
  const bad = await run([mkCrit(0.6, 'SLIDESHOW')], { buildOk: false }); assert.equal(bad.passed, false); assert.ok(bad.history.some((h) => /rebuild failed: boom/.test(h.note)));
});
