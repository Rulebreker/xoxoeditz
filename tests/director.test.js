import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir, testConfig } from './helpers/env.js';
import { hasFfmpeg } from './helpers/media.js';
import { generateStarterSfx } from '../src/library/starter.js';
import { scanLibrary } from '../src/library/scan.js';
import { synthTrack } from '../src/audio/synth-music.js';
import { analyzeSamples, virtualBeatMap, gridPoints } from '../src/beat/analyze.js';
import { slotShots, impactsIn, roleFor } from '../src/director/slots.js';
import { AssetAssigner } from '../src/director/assign.js';
import { chooseMusic } from '../src/director/music.js';
import { directTimeline } from '../src/director/direct.js';
import { resolveDirective } from '../src/director/config.js';
import { validateTimeline, normalizeTimeline } from '../src/timeline/plan.js';
import { buildImpactMap, buildFreezeMap, VelocityPlanner } from '../src/velocity/engine.js';
import { VELOCITY_PROFILES } from '../src/velocity/profiles.js';
import { mapDuration, sourceWindow } from '../src/velocity/speedmap.js';
import { makeRng } from '../src/core/rng.js';
import { TEMPLATES } from '../src/compositing/templates.js';

// ---- fixtures -------------------------------------------------------------------------------------------
const NAMES = ['ADBE Motion Blur', 'CC Radial Fast Blur', 'ADBE Exposure2', 'ADBE Wave Warp', 'ADBE Turbulent Displace', 'ADBE Ramp', 'ADBE Linear Wipe', 'ADBE Tint', 'ADBE HUE SATURATION', 'ADBE Brightness & Contrast 2'];
const CAPS = { effects: { known: true, byMatchName: Object.fromEntries(NAMES.map((n) => [n, { displayName: n }])) } };
let hex = 0;
function visual(i, o = {}) {
  const h = (n) => ((n * 2654435761) >>> 0).toString(16).padStart(8, '0') + ((n * 40503) >>> 0).toString(16).padStart(8, '0');
  return { brightness: 0.2 + ((i * 37) % 70) / 100, contrast: 0.1 + ((i * 13) % 25) / 100, colorfulness: ((i * 11) % 50) / 100, hue: (i * 47) % 360, saturation: 0.4, subject: { x: 0.3 + (i % 3) * 0.1, y: 0.25, w: 0.22, h: 0.4, conf: i % 4 === 3 ? 0.1 : 0.6 }, motion: { avg: 0.01 + (i % 5) * 0.02, peak: 0.1, curve: [], bestWindow: { start: 1.5 + (i % 3), duration: 2, motion: 0.05 } }, hash: h(i + hex), tags: [], ...o };
}
function projectManifest(n = 12, { videoShare = 0.75 } = {}) {
  const assets = [];
  for (let i = 0; i < n; i++) {
    const video = i < Math.round(n * videoShare);
    assets.push({ id: `${video ? 'VID' : 'IMG'}_ASSET_${String(i + 1).padStart(2, '0')}`, type: video ? 'video' : 'image', role: 'broll', relPath: `${video ? 'clip' : 'photo'}${i + 1}.${video ? 'mp4' : 'jpg'}`, path: `/x/${i}`, description: i % 3 === 0 ? 'stealth fighter jet on the apron at dawn' : i % 3 === 1 ? 'close detail of canopy and fuselage panel' : 'wide shot of airbase hangars', keywords: [], meta: { width: 3840, height: 2160, duration: video ? 14 + (i % 4) * 4 : 0, fps: 24, hasAudio: false, isStill: !video }, visual: visual(i) });
  }
  return { assets };
}

let libP; const lib = async () => {
  if (libP) return libP;
  libP = (async () => {
    const cfg = testConfig({}); const root = tmpDir(); await generateStarterSfx(cfg, root);
    const m = await scanLibrary(cfg, root);
    m.assets.push({ id: 'LIB_TRACK_TECHNO_128', type: 'music', file: 'MUSIC/TECHNO/track.wav', path: '/lib/track.wav', category: 'MUSIC', subcategory: 'TECHNO', genre: 'TECHNO', bpm: 128, energy: 0.85, intensity: 0.8, duration: 64, tags: ['techno'], recommended_for: ['velocity'] });
    m.assets.push({ id: 'LIB_TRACK_AMBIENT_70', type: 'music', file: 'MUSIC/AMBIENT/t.wav', path: '/lib/t.wav', category: 'MUSIC', subcategory: 'AMBIENT', genre: 'AMBIENT', bpm: 70, energy: 0.2, intensity: 0.2, duration: 80, tags: ['ambient'], recommended_for: ['documentary'] });
    return m;
  })();
  return libP;
};
let realMap; const beatMap = () => realMap ||= analyzeSamples(...(() => { const t = synthTrack({ bpm: 128, seed: 'dir', sampleRate: 22050 }); return [t.samples, t.sampleRate]; })());
const DIRECTIVE = (o = {}) => resolveDirective({ type: o.type || 'velocity', prompt: o.prompt ?? 'Make a velocity edit "J20 STEALTH" 30 seconds, military, aggressive', config: o.config || {}, overrides: o.overrides || {} });
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- rhythm ---------------------------------------------------------------------------------------------
test('slotShots: cuts sit on the beat grid, lengths follow the profile and energy, drops and impacts get cuts on them, reproducible', () => {
  const map = beatMap(); assert.ok(map.drops.length >= 1, 'fixture has a drop');
  const run = (seed, o = {}) => slotShots(map, { duration: 30, shotSeconds: [0.8, 2.6], cutFrequency: 0.8, rng: makeRng(seed), fps: 24, ...o });
  const a = run('x'); assert.equal(a[0].start, 0); assert.equal(a.at(-1).end, 30);
  for (let i = 1; i < a.length; i++) assert.ok(near(a[i].start, a[i - 1].end, 1e-9), 'contiguous');
  const grid = gridPoints(map, 'half'); const onGrid = a.slice(1).filter((s) => grid.some((g) => near(g, s.start, 1 / 24 + 1e-6)));
  assert.ok(onGrid.length / (a.length - 1) >= 0.9, `${onGrid.length}/${a.length - 1} cuts on the grid`);
  const lens = a.map((s) => s.end - s.start); assert.ok(lens.slice(0, -1).every((l) => l >= 0.8 * 0.85 - 0.05 && l <= 2.6 * 1.15 + 0.05), `lengths ${lens.map((x) => x.toFixed(2))}`);
  assert.ok(new Set(lens.map((l) => l.toFixed(2))).size >= 4, 'lengths vary - no metronome');
  const drop = map.drops[0].t; assert.ok(a.some((s) => near(s.start, drop, 1 / 24 + 0.02)), `a cut lands on the drop at ${drop}`);
  assert.deepEqual(run('x'), a); assert.notDeepEqual(run('y').map((s) => s.start), a.map((s) => s.start));
  const calm = run('c', { cutFrequency: 0.1, shotSeconds: [2.5, 6] }); const busy = run('c', { cutFrequency: 0.95, shotSeconds: [2.5, 6] });
  assert.ok(calm.length <= busy.length, 'a lower cut frequency never makes more cuts');
  const withIO = run('io', { introSeconds: 3.4, outroSeconds: 3.6 }); assert.ok(withIO[0].end >= 2.2 && withIO[0].end <= 4.6, `intro ${withIO[0].end}`); assert.ok(30 - withIO.at(-1).start >= 2.4 && 30 - withIO.at(-1).start <= 4.8, `outro ${30 - withIO.at(-1).start}`);
  const v = virtualBeatMap({ bpm: 100, duration: 20 }); const vs = slotShots(v, { duration: 20, shotSeconds: [1.5, 4], cutFrequency: 0.4, rng: makeRng('v') }); assert.ok(vs.length >= 4 && vs.at(-1).end === 20, 'works on a virtual grid');
  assert.deepEqual(impactsIn({ drops: [{ t: 12 }], impacts: [{ t: 12 }, { t: 13.5 }], downbeats: [10, 12, 14] }, 11, 14, { hot: false }), [1, 2.5]);
  assert.ok(impactsIn({ drops: [], impacts: [], downbeats: [10, 12, 14] }, 11, 15, { hot: true }).length === 2);
  assert.equal(roleFor({ energy: 0.5 }, 0, 5), 'intro'); assert.equal(roleFor({ energy: 0.5 }, 4, 5), 'outro'); assert.equal(roleFor({ energy: 0.5, onImpact: true }, 2, 5), 'impact'); assert.equal(roleFor({ energy: 0.8 }, 2, 5), 'detail'); assert.equal(roleFor({ energy: 0.2 }, 2, 5), 'wide');
});

test('speed maps that must hit a beat: the impact lands exactly where asked, freeze holds one frame, durations are exact', () => {
  for (const [pid, dur, at] of [['VELOCITY_HARD', 2, 1.1], ['VELOCITY_INSANE', 1.2, 0.6], ['VELOCITY_CINEMATIC', 4, 2.5], ['VELOCITY_HARD', 0.8, 0.5]]) {
    const prof = VELOCITY_PROFILES[pid]; const m = buildImpactMap({ profile: prof, duration: dur, impactAt: at, rng: makeRng(pid, dur), fps: 24 });
    assert.ok(near(mapDuration(m), dur, 1e-4), `${pid}: map lasts ${mapDuration(m)} not ${dur}`);
    let acc = 0; let freezeAt = null; for (const s of m.segments) { if (s.freeze && freezeAt === null) freezeAt = acc; acc += s.dur; }
    assert.ok(freezeAt !== null && near(freezeAt, Math.min(Math.max(at, Math.min(0.2, dur * 0.3)), dur - Math.min(0.2, dur * 0.3)), 0.02), `${pid}: freeze starts at ${freezeAt}, wanted ${at}`);
    assert.ok(m.segments.every((s) => Math.abs(s.from) <= prof.maxSpeed + 1e-6 && Math.abs(s.to) <= prof.maxSpeed + 1e-6), 'speeds stay inside the profile');
    assert.ok(m.segments.some((s) => s.preImpact) || at < 0.4, 'slows down into the hit'); assert.ok(m.segments.some((s) => s.postImpact) || dur - at < 0.6, 'snaps away after it');
  }
  const f = buildFreezeMap({ duration: 1.5, at: 0.5 }); assert.ok(near(mapDuration(f), 1.5, 1e-6)); assert.ok(near(sourceWindow(f).end, 0.5, 1e-3), 'source stops advancing after the freeze');
  const f2 = buildFreezeMap({ duration: 2, at: 0.5, hold: 0.6 }); assert.ok(near(mapDuration(f2), 2, 1e-6)); assert.ok(near(sourceWindow(f2).end, 0.5 + 0.9, 1e-3), 'a bounded freeze resumes playing: 0.5s + 0.9s of source');
  const vp = new VelocityPlanner({ profileId: 'VELOCITY_HARD', dials: { speedVariation: 0.7 }, rng: makeRng('vp'), fps: 24 });
  const p1 = vp.plan({ duration: 2, clip: { duration: 20, fps: 24 }, hint: { kind: 'impact', impactAt: 1.2 } }); assert.match(p1.patternId, /:impact$/); assert.ok(p1.fits && near(mapDuration(p1.map), 2, 1e-4));
  const p2 = vp.plan({ duration: 2, clip: { duration: 20, fps: 24 }, hint: { kind: 'freeze', at: 0.7 } }); assert.match(p2.patternId, /:freeze$/);
});

// ---- music & assets ---------------------------------------------------------------------------------------
test('chooseMusic: user music beats library, library is scored on genre/tempo/energy/length, explicit and disabled are honoured', async () => {
  const L = await lib(); const dir = DIRECTIVE();
  const pick = chooseMusic({ directive: dir, manifest: { assets: [] }, library: L, duration: 30 });
  assert.equal(pick.source, 'library'); assert.equal(pick.asset.id, 'LIB_TRACK_TECHNO_128'); assert.ok(pick.candidates[0].score > pick.candidates[1].score && pick.reason.includes('genre'));
  const mine = { assets: [{ id: 'MUS_MINE', type: 'audio', role: 'music', relPath: 'mine.mp3', path: '/m/mine.mp3', meta: { duration: 40 } }] };
  assert.equal(chooseMusic({ directive: dir, manifest: mine, library: L, duration: 30 }).asset.id, 'MUS_MINE', 'project music wins');
  assert.equal(chooseMusic({ directive: DIRECTIVE({ type: 'documentary', prompt: 'a calm documentary' }), manifest: { assets: [] }, library: L, duration: 30 }).asset.id, 'LIB_TRACK_AMBIENT_70', 'the type decides');
  const exp = chooseMusic({ directive: DIRECTIVE({ config: { music: 'track.wav' } }), manifest: { assets: [] }, library: L }); assert.equal(exp.asset.id, 'LIB_TRACK_TECHNO_128', 'by file name');
  assert.equal(chooseMusic({ directive: DIRECTIVE({ config: { music: 'C:\\Music\\my song.mp3' } }), manifest: { assets: [] }, library: L }).source, 'explicit');
  assert.equal(chooseMusic({ directive: DIRECTIVE({ config: { music: false } }), manifest: { assets: [] }, library: L }).source, 'none');
  assert.equal(chooseMusic({ directive: dir, manifest: { assets: [] }, library: null }).source, 'none');
});

test('AssetAssigner: the pool is exhausted before reuse, near-duplicates never sit side by side, roles steer the choice, windows do not overlap', () => {
  const m = projectManifest(10); const comp = { w: 3840, h: 2160 };
  const a = new AssetAssigner(m.assets, { rng: makeRng('a'), comp });
  const picks = Array.from({ length: 10 }, (_, i) => a.pick({ id: `S${i}`, role: 'hero', needSeconds: 2 }).id);
  assert.equal(new Set(picks).size, 10, `10 shots from 10 assets used ${new Set(picks).size} distinct`);
  const b = new AssetAssigner(m.assets, { rng: makeRng('b'), comp }); const more = Array.from({ length: 25 }, (_, i) => b.pick({ id: `S${i}`, role: 'hero' }).id);
  const counts = {}; for (const id of more) counts[id] = (counts[id] || 0) + 1; assert.ok(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)) <= 1, `even usage ${JSON.stringify(counts)}`);
  const dup = projectManifest(6); dup.assets[1].visual.hash = dup.assets[0].visual.hash; const d = new AssetAssigner(dup.assets, { rng: makeRng('d'), comp });
  for (let t = 0; t < 12; t++) { const seq = []; const dd = new AssetAssigner(dup.assets, { rng: makeRng('d', t), comp }); for (let i = 0; i < 6; i++) seq.push(dd.pick({ id: `S${i}`, role: 'hero' }).id); for (let i = 1; i < 6; i++) assert.ok(!(seq[i] === dup.assets[1].id && seq[i - 1] === dup.assets[0].id) && !(seq[i] === dup.assets[0].id && seq[i - 1] === dup.assets[1].id), `duplicates adjacent: ${seq}`); }
  void d;
  const roles = projectManifest(8); roles.assets[2].visual.motion.avg = 0.2; roles.assets[2].visual.contrast = 0.5; roles.assets[5].visual.subject = { x: 0.3, y: 0.2, w: 0.3, h: 0.5, conf: 0.95 };
  const best = (role) => { const a = new AssetAssigner(roles.assets, { rng: makeRng('rank'), comp }); return roles.assets.map((x) => ({ id: x.id, s: a.score(x, { id: 's', role }).score })).sort((p, q) => q.s - p.s)[0].id; };
  assert.equal(best('impact'), roles.assets[2].id, 'impact shot ranks the most active clip first'); assert.equal(best('detail'), roles.assets[5].id, 'detail shot ranks the clearest subject first');
  const wins = (role, id) => Array.from({ length: 30 }, (_, i) => new AssetAssigner(roles.assets, { rng: makeRng('pick', i), comp }).pick({ id: 's', role }).id).filter((x) => x === id).length;
  assert.ok(wins('impact', roles.assets[2].id) >= 10 && wins('detail', roles.assets[5].id) >= 10, 'and wins the seeded pick most often, while the choice still varies');
  const kw = new AssetAssigner(roles.assets, { rng: makeRng('k'), comp, keywords: ['fighter', 'jet'] }); assert.match(kw.pick({ id: 's', role: 'hero' }).description, /fighter jet/);
  const win = new AssetAssigner(m.assets, { rng: makeRng('w'), comp }); const vid = m.assets[0]; const ws = []; for (let i = 0; i < 3; i++) ws.push(win.window(vid, { span: 3, handle: 0.2, role: 'hero' }));
  for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) assert.ok(ws[i] + 3 <= ws[j] + 1e-6 || ws[j] + 3 <= ws[i] + 1e-6, `windows overlap: ${ws}`);
  assert.ok(ws.every((w) => w >= 0.2 && w + 3 <= vid.meta.duration), `${ws} within a ${vid.meta.duration}s clip`); assert.equal(win.window(m.assets.find((x) => x.type === 'image'), { span: 3 }), 0);
});

// ---- the whole Director -----------------------------------------------------------------------------------
test('directTimeline (velocity): a valid beat-locked plan with varied camera, speed ramps, SFX, kinetic type, advanced transitions and a compositing scene', { skip: !hasFfmpeg, timeout: 120000 }, async () => {
  const L = await lib(); const manifest = projectManifest(12); const map = beatMap();
  const music = chooseMusic({ directive: DIRECTIVE(), manifest, library: L, duration: 30 });
  const { plan, report } = directTimeline({ directive: DIRECTIVE(), manifest, library: L, beatMap: map, music, caps: CAPS });
  const v = validateTimeline(plan, { manifest, library: L }); assert.deepEqual(v.errors, [], JSON.stringify(v.errors));
  const tl = plan.timeline; assert.equal(tl.duration, 30); assert.equal(tl.shots.length, tl.transitions.length + 1);
  // rhythm
  const grid = gridPoints(map, 'half'); const cuts = tl.shots.slice(1).map((s) => s.start);
  assert.ok(cuts.filter((c) => grid.some((g) => near(g, c, 1 / 24 + 1e-6))).length / cuts.length >= 0.85, 'cuts on the beat grid');
  assert.ok(tl.shots.some((s) => map.drops.some((d) => near(s.start, d.t, 0.05))), 'a shot starts on the drop');
  // structure: intro title + end card
  assert.equal(tl.shots[0].template, 'DARK_TITLE'); assert.equal(tl.shots.at(-1).template, 'END_CARD'); assert.ok(tl.shots[0].text.some((t) => t.text === 'J20 STEALTH'));
  // camera variety
  const moves = tl.shots.map((s) => s.camera?.move).filter(Boolean); const fams = new Set(tl.shots.map((s) => s.camera?.family).filter(Boolean));
  assert.ok(new Set(moves).size >= 3, `camera moves: ${[...new Set(moves)]}`); assert.ok(fams.size >= 3, `families ${[...fams]}`);
  // velocity: several different speed maps, each exactly as long as its shot
  const remaps = tl.shots.flatMap((s) => s.layers.filter((l) => l.remap).map((l) => ({ s, r: l.remap })));
  assert.ok(remaps.length >= 5, `${remaps.length} shots with speed ramps`); assert.ok(new Set(remaps.map((x) => x.r.summary)).size >= 4, 'speed maps differ shot to shot');
  for (const { s, r } of remaps) assert.ok(near(mapDuration(r.map), s.end - s.start, 0.02), `${s.id}: map ${mapDuration(r.map)} vs shot ${s.end - s.start}`);
  // transitions: more than dissolves, at least one advanced
  const types = new Set(tl.transitions.map((t) => t.type)); assert.ok(types.size >= 3, `transitions ${[...types]}`); assert.ok([...types].some((t) => ['whip', 'zoom', 'glitch', 'light', 'distortion', 'motion_blur', 'flash', 'mask', 'luma'].includes(t)), 'an advanced transition');
  // sound: library SFX, aligned, budgeted, includes a riser/impact for the drop
  const ev = plan.audio.sfxEvents; assert.ok(ev.length >= 8, `${ev.length} SFX events`); const byId = new Map(L.assets.map((a) => [a.id, a])); assert.ok(ev.every((e) => e.assetId.startsWith('LIB_') && e.fit.layers[0].gainDb <= -2 && (byId.get(e.assetId).features.rmsDb + e.fit.layers[0].gainDb) < -12), 'every SFX sits well below full scale in the mix');
  assert.ok(ev.some((e) => e.role === 'big_impact' && near(e.at, map.drops[0].t, 0.05)), 'impact on the drop'); assert.ok(ev.some((e) => e.role === 'whip' || e.role === 'transition'));
  assert.ok(ev.length / 30 <= 0.12 + 1.15 * plan.directive.dials.sfx + 1, 'within the SFX budget');
  // text: kinetic title, nothing overlapping
  const texts = tl.shots.flatMap((s) => s.text); assert.ok(texts.some((t) => t.animation === 'kinetic'), 'kinetic type'); assert.ok(texts.length >= 3);
  // compositing beyond full-bleed
  const tpls = new Set(tl.shots.map((s) => s.template)); assert.ok([...tpls].filter((t) => !['FULL_BLEED', 'DARK_TITLE', 'END_CARD'].includes(t)).length >= 2, `templates ${[...tpls]}`);
  assert.ok(tl.shots.some((s) => ['CROP_DETAIL', '2_5D', 'PARALLAX', 'PIP', 'SPLIT_SCREEN'].includes(s.template)), 'a compositing / depth scene');
  // look, music, output
  assert.equal(plan.look.color, 'MILITARY'); assert.equal(plan.audio.music[0].asset, 'LIB_TRACK_TECHNO_128'); assert.equal(plan.output.width, 3840);
  // no asset is reused before the pool is exhausted
  const used = tl.shots.filter((s) => !['DARK_TITLE', 'END_CARD', 'TEXT_SCENE', 'STAT_SCENE'].includes(s.template)).map((s) => s.assets.main); const firstReuse = used.findIndex((a, i) => used.indexOf(a) !== i);
  assert.ok(firstReuse === -1 || firstReuse >= Math.min(10, manifest.assets.length) - 1, `an asset was reused at shot ${firstReuse} before the pool of ${manifest.assets.length} was used (${used})`);
  assert.ok(report.rationale.length === tl.shots.length && report.rationale.every((r) => r.why));
});

test('directTimeline: deterministic per seed, different across seeds, JSON-serialisable, normalisable and re-validatable', { skip: !hasFfmpeg, timeout: 120000 }, async () => {
  const L = await lib(); const manifest = projectManifest(10); const map = beatMap();
  const run = (seed) => directTimeline({ directive: DIRECTIVE({ config: { seed } }), manifest, library: L, beatMap: map, caps: CAPS }).plan;
  const a = run(5); const b = run(5); const c = run(6);
  assert.equal(JSON.stringify(a), JSON.stringify(b)); assert.notEqual(JSON.stringify(a.timeline.shots.map((s) => [s.start, s.template])), JSON.stringify(c.timeline.shots.map((s) => [s.start, s.template])));
  const round = JSON.parse(JSON.stringify(a)); assert.deepEqual(validateTimeline(normalizeTimeline(round), { manifest, library: L }).errors, []);
});

test('directTimeline: edit types behave differently, professional mode is restrained, missing inputs degrade honestly', { skip: !hasFfmpeg, timeout: 180000 }, async () => {
  const L = await lib(); const manifest = projectManifest(12); const caps = CAPS;
  const go = (o, extra = {}) => directTimeline({ directive: DIRECTIVE(o), manifest, library: L, beatMap: virtualBeatMap({ bpm: 90, duration: 40 }), caps, ...extra });
  const vel = go({}); const doc = go({ type: 'documentary', prompt: 'a calm documentary about the airbase "AIRBASE 7"', config: { duration: 30 } });
  assert.ok(vel.plan.timeline.shots.length > doc.plan.timeline.shots.length * 1.5, `velocity ${vel.plan.timeline.shots.length} shots vs documentary ${doc.plan.timeline.shots.length}`);
  const fastShare = (p) => p.timeline.transitions.filter((t) => ['whip', 'zoom', 'glitch', 'flash', 'motion_blur', 'distortion'].includes(t.type)).length / p.timeline.transitions.length;
  assert.ok(fastShare(vel.plan) > fastShare(doc.plan) + 0.15, 'velocity uses punchier transitions'); assert.ok(doc.plan.timeline.shots.every((s) => !s.layers.some((l) => l.remap)), 'documentary has no speed ramps');
  assert.ok(doc.plan.audio.sfxEvents.length < vel.plan.audio.sfxEvents.length, 'documentary has less SFX');
  assert.deepEqual(validateTimeline(doc.plan, { manifest, library: L }).errors, []);
  const pro = go({ config: { professional: true } }); const types = pro.plan.timeline.transitions.map((t) => t.type);
  assert.ok(!types.includes('glitch') && !types.includes('distortion'), `professional avoids glitch: ${types}`); assert.ok(pro.plan.timeline.shots.flatMap((s) => s.text).every((t) => t.animation !== 'glitch_reveal' && t.animation !== 'kinetic'));
  // no library: no SFX, plan still valid
  const nolib = directTimeline({ directive: DIRECTIVE(), manifest, library: null, beatMap: virtualBeatMap({ bpm: 120, duration: 30 }), caps }); assert.equal(nolib.plan.audio.sfxEvents.length, 0); assert.ok(nolib.report.warnings.some((w) => /virtual/.test(w))); assert.equal(nolib.plan.audio.music.length, 0);
  assert.deepEqual(validateTimeline(nolib.plan, { manifest, library: null }).errors, []);
  // no assets: title cards only, with a warning
  const empty = directTimeline({ directive: DIRECTIVE(), manifest: { assets: [] }, library: L, beatMap: virtualBeatMap({ bpm: 120, duration: 20 }), caps, });
  assert.ok(empty.report.warnings.some((w) => /no images or videos/.test(w))); assert.ok(empty.plan.timeline.shots.every((s) => s.layers.length >= 1));
  // images only: no speed maps, still camera moves
  const imgs = directTimeline({ directive: DIRECTIVE(), manifest: projectManifest(8, { videoShare: 0 }), library: L, beatMap: virtualBeatMap({ bpm: 120, duration: 30 }), caps }); assert.ok(imgs.plan.timeline.shots.every((s) => !s.layers.some((l) => l.remap))); assert.ok(imgs.plan.timeline.shots.some((s) => s.camera));
  // vertical output
  const tall = directTimeline({ directive: DIRECTIVE({ config: { aspect: '9:16', resolution: '1080p' } }), manifest, library: L, beatMap: virtualBeatMap({ bpm: 120, duration: 30 }), caps }); assert.ok(tall.plan.output.height > tall.plan.output.width);
  void TEMPLATES;
});
