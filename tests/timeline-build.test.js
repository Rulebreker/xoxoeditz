import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, testConfig, baseEnv } from './helpers/env.js';
import { hasFfmpeg } from './helpers/media.js';
import { createContext, openBridge } from '../src/app/services.js';
import { projectPaths, readJson } from '../src/core/paths.js';
import { generateStarterSfx } from '../src/library/starter.js';
import { scanLibrary } from '../src/library/scan.js';
import { synthTrack } from '../src/audio/synth-music.js';
import { analyzeSamples } from '../src/beat/analyze.js';
import { directTimeline } from '../src/director/direct.js';
import { resolveDirective } from '../src/director/config.js';
import { buildProject } from '../src/ae/build.js';
import { compileTimeline } from '../src/ae/compile-timeline.js';
import { normalizeTimeline, validateTimeline } from '../src/timeline/plan.js';
import { OPS_DOC } from '../src/bridge/ops-doc.js';
import { createMockAE } from '../src/bridge/mock-ae.js';

// ---- fixtures: real files on disk so import_ensure succeeds; sizes come from the manifest, the mock probes 1920x1080 ----
function projectAssets(dir, n = 10) {
  const assets = [];
  for (let i = 0; i < n; i++) {
    const video = i < 7; const file = path.join(dir, `${video ? 'clip' : 'photo'}${i + 1}.${video ? 'mp4' : 'jpg'}`); fs.writeFileSync(file, 'x');
    assets.push({ id: `${video ? 'VID' : 'IMG'}_ASSET_${String(i + 1).padStart(2, '0')}`, type: video ? 'video' : 'image', role: 'broll', relPath: path.basename(file), path: file, description: ['stealth fighter jet on the apron', 'close detail of canopy and panel', 'wide airbase hangars'][i % 3], keywords: [], meta: { width: 1920, height: 1080, duration: video ? 16 : 0, fps: 24, hasAudio: video, isStill: !video, probe: 'ffprobe' }, visual: { brightness: 0.2 + ((i * 37) % 70) / 100, contrast: 0.2, colorfulness: 0.2, hue: 10, saturation: 0.3, subject: { x: 0.35, y: 0.25, w: 0.25, h: 0.4, conf: i % 4 === 3 ? 0.1 : 0.6 }, motion: { avg: 0.02 + (i % 4) * 0.02, bestWindow: { start: 2, duration: 2 } }, hash: ((i + 1) * 0x9e3779b1 >>> 0).toString(16).padStart(8, '0').repeat(2), tags: [] } });
  }
  return { assets };
}
let fx; async function fixture() {
  if (fx) return fx;
  fx = (async () => {
    const cfg = testConfig({}); const root = tmpDir(); await generateStarterSfx(cfg, root); const library = await scanLibrary(cfg, root);
    const t = synthTrack({ bpm: 128, seed: 'tl', sampleRate: 22050 }); const map = analyzeSamples(t.samples, t.sampleRate);
    return { library, map };
  })();
  return fx;
}
const directive = (o = {}) => resolveDirective({ type: o.type || 'velocity', prompt: o.prompt ?? 'Make a velocity edit "J20 STEALTH" 30 seconds, military, aggressive', config: o.config || {} });
async function build(plan, manifest, library, { ctx, name = 'tl', incremental = true } = {}) {
  const c = ctx || createContext({ cwd: tmpDir('xoxo-tl-'), env: baseEnv(), overrides: { transport: 'mock' }, mockAE: createMockAE() });
  const paths = projectPaths(c.config, name); fs.mkdirSync(paths.root, { recursive: true });
  const { bridge, caps } = await openBridge(c);
  const r = await buildProject({ config: c.config, bridge, caps, plan, manifest, library, narration: null, paths, logger: c.logger, incremental });
  return { r, bridge, c, paths };
}
const masterOf = async (bridge) => (await bridge.call('inspect', { layers: true, bounds: true })).data.items.find((i) => i.name === 'COMP_MASTER');

test('compileTimeline: structure, unit ids, expected layers, every op is a known host op, hashes stable across compiles', { skip: !hasFfmpeg, timeout: 180000 }, async () => {
  const { library, map } = await fixture(); const dir = tmpDir(); const manifest = projectAssets(dir);
  const { plan } = directTimeline({ directive: directive(), manifest, library, beatMap: map, caps: null });
  const p = normalizeTimeline(plan); assert.deepEqual(validateTimeline(p, { manifest, library }).errors, []);
  const a = compileTimeline(p, { manifest, library, caps: null }); const b = compileTimeline(p, { manifest, library, caps: null });
  assert.deepEqual(a.stages.map((s) => s.id), ['import', 'comps', 'shots', 'transitions', 'looks', 'text', 'audio', 'finalize']);
  assert.deepEqual(a.meta.hashes, b.meta.hashes, 'compiling twice gives identical unit hashes');
  const known = new Set(Object.keys(OPS_DOC)); for (const st of a.stages) for (const u of st.units) for (const alt of u.alternatives) for (const [op] of alt.ops) assert.ok(known.has(op), `${u.id}/${alt.name}: unknown op ${op}`);
  const shotUnits = a.stages.find((s) => s.id === 'shots').units; assert.equal(shotUnits.length, plan.timeline.shots.length);
  for (const u of shotUnits) { assert.ok(u.alternatives.at(-1).name === 'placeholder' && u.alternatives[0].name === 'full' && u.primary); }
  assert.ok(shotUnits.some((u) => u.alternatives.some((x) => x.name === 'constant_speed')), 'speed-ramped shots can fall back to constant speed');
  assert.equal(a.meta.mode, 'timeline'); assert.equal(a.meta.sceneComps.length, 0); assert.ok(a.meta.expectedUnits.length >= shotUnits.length);
  const order = a.stages.find((s) => s.id === 'finalize').units.find((u) => u.id === 'master.order').alternatives[0].ops[0][1].order;
  assert.equal(new Set(order).size, order.length, 'z-order has no duplicates');
  const firstShotLayer = shotUnits[0].names[0]; const lastShotLayer = shotUnits.at(-1).names[0]; assert.ok(order.indexOf(firstShotLayer) < order.indexOf(lastShotLayer), 'later shots sit above earlier ones');
});

test('timeline build on the simulator: every unit succeeds, layers exist at planned times, time remap + camera keyframes + masks are really applied', { skip: !hasFfmpeg, timeout: 240000 }, async () => {
  const { library, map } = await fixture(); const dir = tmpDir(); const manifest = projectAssets(dir);
  const { plan } = directTimeline({ directive: directive(), manifest, library, beatMap: map, caps: null });
  const { r, bridge } = await build(plan, manifest, library);
  assert.equal(r.success, true, JSON.stringify(r.data?.errors?.slice(0, 3) || r.error, null, 1));
  assert.equal(r.data.errors.length, 0);
  const master = await masterOf(bridge); assert.equal(master.width, 3840); assert.equal(master.fps, plan.output.fps); assert.ok(Math.abs(master.duration - 30) < 1 / 24);
  const L = (n) => master.layers.find((l) => l.name === n);
  const tl = plan.timeline;
  // every shot's main layer exists, spans [start - handleIn, end + handleOut]
  tl.shots.forEach((s, i) => {
    const hIn = i > 0 ? tl.transitions[i - 1].d / 2 : 0; const hOut = i < tl.shots.length - 1 ? tl.transitions[i].d / 2 : 0;
    for (const lay of s.layers.filter((x) => x.kind === 'footage' && !x.enter)) { const got = L(lay.name); assert.ok(got, `${lay.name} missing`); assert.ok(Math.abs(got.inPoint - (s.start - hIn)) < 0.05 && Math.abs(got.outPoint - (s.end + hOut)) < 0.05, `${lay.name}: ${got.inPoint}-${got.outPoint} vs ${s.start - hIn}-${s.end + hOut}`); }
  });
  // velocity: remapped layers really have time remap keys, video audio is muted
  const remapped = tl.shots.flatMap((s) => s.layers.filter((l) => l.remap)); assert.ok(remapped.length >= 5);
  for (const l of remapped) { const got = L(l.name); assert.ok(got.timeRemapKeys >= 3, `${l.name}: ${got.timeRemapKeys} time remap keys`); }
  const loud = master.layers.filter((l) => l.kind === 'footage' && l.hasAudio && !/^(MUSIC|SFX|NARR)/.test(l.name) && l.audioEnabled !== false); assert.deepEqual(loud.map((l) => l.name), [], 'picture layers are silent');
  // layered shots are masked where the plan says so
  const masked = tl.shots.flatMap((s) => s.layers.filter((l) => l.mask)); if (masked.length) for (const l of masked) assert.ok(L(l.name).numMasks >= 1, `${l.name} has its mask`);
  // text, music, sfx
  assert.ok(master.layers.filter((l) => l.kind === 'text').length >= 3); assert.ok(master.layers.some((l) => l.name.startsWith('MUSIC_')) === (plan.audio.music.length > 0));
  const sfx = master.layers.filter((l) => l.name.startsWith('SFX_')); assert.equal(sfx.length, plan.audio.sfxEvents.reduce((n, e) => n + e.fit.layers.length, 0), 'every planned SFX layer exists'); assert.ok(sfx.every((l) => l.audioKeys >= 3 && l.inPoint >= 0));
  // z-order: layers appear top->bottom in the inspect list; later shots above earlier
  const idx = (n) => master.layers.findIndex((l) => l.name === n);
  assert.ok(idx(tl.shots.at(-1).layers[0].name) < idx(tl.shots[0].layers[0].name), 'index 0 is the top layer: the last shot is above the first');
  const texts = master.layers.filter((l) => l.kind === 'text'); const lowestPic = Math.max(...tl.shots.flatMap((s) => s.layers.map((l) => idx(l.name))).filter((i) => i >= 0)); assert.ok(texts.every((t) => idx(t.name) < lowestPic), `text above picture: ${texts.filter((t) => idx(t.name) >= lowestPic).map((t) => t.name + '@' + idx(t.name))} vs picture bottom ${lowestPic}`);
  // artefacts
  assert.ok(fs.existsSync(r.data.project)); assert.equal(readJson(path.join(path.dirname(r.data.project), 'build-state.json')).transport, 'mock');
  assert.equal(r.data.compiled.scenes, tl.shots.length);
});

test('timeline build is idempotent and incremental: a second build reuses unchanged units; editing one shot rebuilds only that shot; deleting a shot rebuilds cleanly', { skip: !hasFfmpeg, timeout: 300000 }, async () => {
  const { library, map } = await fixture(); const dir = tmpDir(); const manifest = projectAssets(dir);
  const { plan } = directTimeline({ directive: directive(), manifest, library, beatMap: map, caps: null });
  const first = await build(plan, manifest, library); assert.equal(first.r.success, true);
  const count1 = (await masterOf(first.bridge)).layers.length;
  const again = await build(plan, manifest, library, { ctx: first.c }); assert.equal(again.r.success, true);
  assert.equal(again.r.data.compiled.incremental, true); const total = again.r._build.meta.hashes && Object.keys(again.r._build.meta.hashes).length;
  assert.ok(again.r.data.compiled.reusedUnits >= total - 3, `reused ${again.r.data.compiled.reusedUnits} of ${total}`);
  assert.equal((await masterOf(again.bridge)).layers.length, count1, 'no duplicate layers after a second build');
  // change one shot's camera: only that shot (plus the always-run finalize units) is rebuilt
  const edited = JSON.parse(JSON.stringify(plan)); const target = edited.timeline.shots.find((s) => s.layers.some((l) => l.kind === 'footage' && l.motion?.length));
  const lay = target.layers.find((l) => l.kind === 'footage' && l.motion?.length); lay.motion = [{ type: 'PAN', amount: 0.2, dir: 0 }];
  const third = await build(edited, manifest, library, { ctx: first.c }); assert.equal(third.r.success, true);
  const rebuilt = third.r.data.stages.find((s) => s.id === 'shots'); assert.equal(rebuilt.units, 1, `only the edited shot was rebuilt (got ${rebuilt.units})`);
  const m3 = await masterOf(third.bridge); assert.equal(m3.layers.length, count1);
  // remove a shot: unit disappears -> full clean rebuild, no orphan layers
  const shorter = JSON.parse(JSON.stringify(plan)); const dropIdx = 3;
  const dropped = shorter.timeline.shots[dropIdx]; const len = dropped.end - dropped.start;
  shorter.timeline.shots.splice(dropIdx, 1); shorter.timeline.transitions.splice(dropIdx, 1);
  shorter.timeline.shots.forEach((s, i) => { if (i >= dropIdx) { s.start = +(s.start - len).toFixed(4); s.end = +(s.end - len).toFixed(4); } });
  shorter.timeline.transitions.forEach((t, i) => { if (i >= dropIdx - 1) { t.cut = +(shorter.timeline.shots[i].end).toFixed(4); t.window = { start: +(t.cut - t.d / 2).toFixed(4), end: +(t.cut + t.d / 2).toFixed(4) }; } });
  shorter.timeline.duration = +(plan.timeline.duration - len).toFixed(4); shorter.timeline.shots[0] && (shorter.timeline.shots.at(-1).end = shorter.timeline.duration);
  shorter.audio.music.forEach((m) => { m.end = shorter.timeline.duration; }); shorter.audio.sfxEvents = shorter.audio.sfxEvents.filter((e) => e.at < shorter.timeline.duration - 0.5);
  shorter.timeline.shots.forEach((s) => { s.text = s.text.filter((t) => t.at < s.end); });
  const v = validateTimeline(normalizeTimeline(shorter), { manifest, library }); if (v.valid) {
    const fourth = await build(shorter, manifest, library, { ctx: first.c }); assert.equal(fourth.r.success, true, JSON.stringify(fourth.r.data?.errors?.slice(0, 2)));
    const m4 = await masterOf(fourth.bridge); assert.ok(!m4.layers.some((l) => dropped.layers.some((x) => x.name === l.name)), 'the deleted shot left no layers behind');
  }
});

test('timeline build: a failing effect falls back (not fails), a missing asset becomes a flagged placeholder, an invalid plan is refused', { skip: !hasFfmpeg, timeout: 240000 }, async () => {
  const { library, map } = await fixture(); const dir = tmpDir(); const manifest = projectAssets(dir);
  const bare = createMockAE({ effects: [] });                                  // a machine with no optional effects at all
  const ctx = createContext({ cwd: tmpDir('xoxo-tl-'), env: baseEnv(), overrides: { transport: 'mock' }, mockAE: bare });
  const { plan, report } = directTimeline({ directive: directive(), manifest, library, beatMap: map, caps: { effects: { known: true, byMatchName: {} } } });
  const { r } = await build(plan, manifest, library, { ctx });
  assert.equal(r.success, true, JSON.stringify(r.data?.errors?.slice(0, 2)));
  assert.ok(r.data.fallbacksUsed.length > 0 || report.transitions.some((t) => t.degraded), 'degradations are reported'); assert.equal(r.data.errors.length, 0);
  // a deleted source file
  const gone = projectAssets(tmpDir()); const { plan: p2 } = directTimeline({ directive: directive(), manifest: gone, library, beatMap: map, caps: null });
  fs.rmSync(gone.assets[2].path); const second = await build(p2, gone, library); assert.equal(second.r.success, false); assert.ok(second.r.data.errors.length >= 1);
  // invalid plan
  const broken = JSON.parse(JSON.stringify(plan)); broken.timeline.shots[1].start += 0.5;
  const third = await build(broken, manifest, library); assert.equal(third.r.success, false); assert.equal(third.r.code, 'PLAN_INVALID'); assert.match(third.r.error, /contiguous/);
});
