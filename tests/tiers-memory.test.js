import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir, baseEnv, testConfig } from './helpers/env.js';
import { hasFfmpeg, makeImage, makeVideo } from './helpers/media.js';
import { CAPS, projectManifest, library, beatMap, directive } from './helpers/fixtures.js';
import { directTimeline } from '../src/director/direct.js';
import { scalePlanForOutput, deriveTierPlan, tierName, tierOf, baseName, TIERS, promoteProject } from '../src/app/tiers.js';
import { validateTimeline, normalizeTimeline } from '../src/timeline/plan.js';
import { loadMemory, saveMemory, memoryBias, rate, recordRun, resetMemory, memoryEnabled } from '../src/memory/index.js';
import { writeTrack } from '../src/audio/synth-music.js';
import { createContext } from '../src/app/services.js';
import { produceVideo } from '../src/app/produce.js';
import { critiqueProject, memoryCommand } from '../src/app/creative.js';
import { createMockAE } from '../src/bridge/mock-ae.js';
import { readJson } from '../src/core/paths.js';
import { buildProject } from '../src/ae/build.js';
import { openBridge } from '../src/app/services.js';
import { projectPaths } from '../src/core/paths.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'xoxo.js');
const clone = (x) => JSON.parse(JSON.stringify(x));
async function plan4k(seed = 5) {
  const L = await library(); const manifest = projectManifest(12);
  const { plan } = directTimeline({ directive: directive({ config: { seed } }), manifest, library: L, beatMap: beatMap(), caps: CAPS });
  return { plan, manifest, L };
}

test('tiers: names round-trip, draft/preview/final differ in cost, and the scaled plan is still a valid, fitting plan', { skip: !hasFfmpeg, timeout: 120000 }, async () => {
  assert.equal(tierName('J20 Edit', 'draft'), 'J20_Edit-draft'); assert.equal(tierName('J20 Edit', 'final'), 'J20_Edit'); assert.equal(tierOf('x-preview'), 'preview'); assert.equal(baseName('x-draft'), 'x'); assert.deepEqual(Object.keys(TIERS), ['draft', 'preview', 'final']);
  const { plan, manifest, L } = await plan4k(); assert.equal(plan.output.height, 2160);
  const draft = deriveTierPlan(plan, 'draft'); const prev = deriveTierPlan(plan, 'preview'); const fin = deriveTierPlan(plan, 'final');
  assert.equal(draft.output.height, 480); assert.equal(prev.output.height, 720); assert.equal(fin.output.height, 2160); assert.equal(draft.output.width % 2, 0);
  assert.equal(draft.look.grain, 0); assert.equal(draft.look.letterbox, false); assert.ok(prev.look.grain === plan.look.grain && prev.look.vignette === plan.look.vignette, 'preview keeps the look');
  assert.ok(draft.timeline.shots.flatMap((s) => s.layers).filter((l) => l.remap).every((l) => l.remap.frameBlend === 'none'), 'draft skips frame blending');
  for (const t of [draft, prev, fin]) { const v = validateTimeline(normalizeTimeline(t), { manifest, library: L }); assert.deepEqual(v.errors, [], t.quality); }
  // editorial content is identical across tiers
  const sig = (p) => JSON.stringify(p.timeline.shots.map((s) => [s.id, s.start, s.end, s.template, s.assets.main, s.camera?.move, s.layers.map((l) => l.remap?.summary)])); assert.equal(sig(draft), sig(plan)); assert.equal(sig(prev), sig(plan));
  assert.equal(JSON.stringify(draft.audio.sfxEvents), JSON.stringify(plan.audio.sfxEvents)); assert.equal(JSON.stringify(draft.timeline.transitions), JSON.stringify(plan.timeline.transitions));
  // pixel values scale with the frame, and text still fits its (smaller) frame
  const k = 480 / 2160; const t0 = plan.timeline.shots.flatMap((s) => s.text)[0]; const td = draft.timeline.shots.flatMap((s) => s.text)[0];
  assert.ok(Math.abs(td.layout.size - Math.round(t0.layout.size * k)) <= 1 && Math.abs(td.layout.position[0] - t0.layout.position[0] * k) < 0.02);
  for (const s of draft.timeline.shots) for (const t of s.text) { assert.ok(t.layout.rect.x >= 0 && t.layout.rect.x + t.layout.rect.w <= draft.output.width, `${t.text} fits the draft frame`); }
  assert.throws(() => scalePlanForOutput(plan, 1000, 1000), /aspect ratio/); assert.throws(() => deriveTierPlan(plan, 'ultra'), /unknown tier/);
  assert.equal(JSON.stringify(plan).includes('"quality":"draft"'), false, 'deriving never mutates the source plan');
});

test('promote: an approved preview becomes a final project with the same decisions at full resolution - and it builds', { skip: !hasFfmpeg, timeout: 600000 }, async () => {
  const root = tmpDir('xoxo-tier-'); const input = path.join(root, 'in'); fs.mkdirSync(path.join(input, 'audio'), { recursive: true });
  for (let i = 0; i < 6; i++) makeVideo(path.join(input, `clip${i + 1}.mp4`), { w: 640, h: 360, dur: 9, withAudio: false });
  for (let i = 0; i < 3; i++) makeImage(path.join(input, `photo${i + 1}.jpg`), 1280, 720, ['navy', 'gray', 'olive'][i]);
  writeTrack(path.join(input, 'audio', 'track_music.wav'), { bpm: 120, seed: 'tier' });
  const ctx = createContext({ cwd: root, env: baseEnv(), overrides: { transport: 'mock' }, mockAE: createMockAE() });
  const r = await produceVideo(ctx, { assets: input, type: 'velocity', prompt: 'velocity edit "TIERS"', duration: 14, quality: 'preview', name: 'demo', starterSfx: true, seed: 4 });
  assert.equal(r.success, true, r.error); assert.equal(r.data.project, 'demo-preview'); assert.equal(readJson(r.data.plan).output.height, 720);
  const pr = await promoteProject(ctx, 'demo-preview', { to: 'final', finalResolution: '1080p' }); assert.equal(pr.success, true, pr.error);
  assert.equal(pr.data.to, 'demo'); assert.equal(pr.data.output, '1920x1080');
  const finalPlan = readJson(projectPaths(ctx.config, 'demo').plan); const prevPlan = readJson(r.data.plan);
  assert.equal(JSON.stringify(finalPlan.timeline.shots.map((s) => [s.start, s.end, s.template, s.assets.main])), JSON.stringify(prevPlan.timeline.shots.map((s) => [s.start, s.end, s.template, s.assets.main])), 'same cut');
  assert.equal(finalPlan.output.height, 1080); for (const f of ['manifest', 'beatMap', 'libraryUsed']) assert.ok(fs.existsSync(projectPaths(ctx.config, 'demo')[f]), f);
  assert.equal(readJson(projectPaths(ctx.config, 'demo').state).promotedFrom, 'demo-preview');
  const e = await (await import('../src/app/services.js')).editProject(ctx, 'demo'); assert.equal(e.success, true, JSON.stringify(e.data?.qa?.errors || e.error));
  assert.equal((await promoteProject(ctx, 'nope', {})).success, false); assert.equal((await promoteProject(ctx, 'demo', { to: 'ultra' })).success, false);
});

test('memory: ratings and recent use bias future choices, are bounded, store no paths, and can be turned off', { timeout: 60000 }, () => {
  const cfg = testConfig({}); const dir = tmpDir(); cfg.memoryFile = path.join(dir, 'sub', 'memory.json');
  const m = loadMemory(cfg); assert.deepEqual(m.runs, []); rate(m, ['LIB_A', 'VID_X'], 1); rate(m, ['LIB_B'], -1);
  assert.ok(m.ratings.LIB_A > 0.5 && m.ratings.LIB_B < -0.5); rate(m, ['LIB_A'], 1); rate(m, ['LIB_A'], 1); assert.ok(m.ratings.LIB_A <= 1, 'bounded');
  saveMemory(cfg, m); assert.ok(fs.existsSync(cfg.memoryFile)); const back = loadMemory(cfg); assert.equal(back.ratings.LIB_B, m.ratings.LIB_B);
  const b = memoryBias(back); assert.ok(b.sfx.LIB_A > 0 && b.sfx.LIB_B < 0 && b.assets.VID_X > 0, 'LIB_ ids bias sounds, others bias clips');
  const plan = { timeline: { shots: [{ template: 'FULL_BLEED', layers: [{ kind: 'footage', asset: 'VID_X' }] }] }, audio: { sfxEvents: [{ assetId: 'LIB_A' }] } };
  for (let i = 0; i < 3; i++) recordRun(back, { project: `p${i}`, type: 'velocity', seed: i, score: 0.8, plan });
  const b2 = memoryBias(back); assert.ok(b2.sfx.LIB_A < b.sfx.LIB_A, 'a sound used in the last runs is nudged down'); assert.ok(back.usage.LIB_A === 3);
  for (let i = 0; i < 60; i++) recordRun(back, { project: `p${i}`, type: 'x', seed: i, score: 1, plan }); assert.ok(back.runs.length <= 40, 'history is trimmed');
  assert.ok(!JSON.stringify(back).includes('/x/') && !JSON.stringify(back).includes(dir), 'no paths in memory');
  assert.equal(memoryEnabled(cfg, {}, {}), true); assert.equal(memoryEnabled(cfg, { memory: false }, {}), false); assert.equal(memoryEnabled(cfg, {}, { XOXO_MEMORY: '0' }), false); assert.equal(memoryEnabled({ ...cfg, memory: false }, {}, {}), false);
  assert.equal(resetMemory(cfg), true); assert.deepEqual(loadMemory(cfg).ratings, {});
  fs.writeFileSync(cfg.memoryFile, '{ not json'); assert.deepEqual(loadMemory(cfg).runs, [], 'a corrupt memory file is ignored, not fatal');
});

test('memory steers the Director: a disliked sound is chosen less, a liked clip more - without ever overriding relevance', { skip: !hasFfmpeg, timeout: 240000 }, async () => {
  const L = await library(); const manifest = projectManifest(12); const base = (seed, memory) => directTimeline({ directive: directive({ config: { seed } }), manifest, library: L, beatMap: beatMap(), caps: CAPS, memory }).plan;
  const count = (plan, id) => plan.audio.sfxEvents.filter((e) => e.assetId === id).length;
  const first = base(1, null); const popular = Object.entries(first.audio.sfxEvents.reduce((a, e) => ({ ...a, [e.assetId]: (a[e.assetId] || 0) + 1 }), {})).sort((x, y) => y[1] - x[1])[0][0];
  let neutral = 0; let biased = 0; for (let s = 1; s <= 6; s++) { neutral += count(base(s, null), popular); biased += count(base(s, { sfx: { [popular]: -1 }, assets: {} }), popular); }
  assert.ok(biased < neutral, `a disliked sound is used less (${biased} vs ${neutral})`);
  const aid = manifest.assets[3].id; let n0 = 0; let n1 = 0; const uses = (p) => p.timeline.shots.filter((s) => s.assets.main === aid).length;
  for (let s = 1; s <= 8; s++) { n0 += uses(base(s, null)); n1 += uses(base(s, { sfx: {}, assets: { [aid]: 1 } })); } assert.ok(n1 >= n0, `a liked clip is used at least as much (${n1} vs ${n0})`);
});

test('services + CLI: critique writes CREATIVE_QA.json, memory commands work, produce honours memory:false and records otherwise', { skip: !hasFfmpeg, timeout: 900000 }, async () => {
  const root = tmpDir('xoxo-cq-'); const input = path.join(root, 'in'); fs.mkdirSync(path.join(input, 'audio'), { recursive: true });
  for (let i = 0; i < 6; i++) makeVideo(path.join(input, `clip${i + 1}.mp4`), { w: 640, h: 360, dur: 9, withAudio: false });
  for (let i = 0; i < 3; i++) makeImage(path.join(input, `photo${i + 1}.jpg`), 1280, 720, ['navy', 'gray', 'olive'][i]);
  writeTrack(path.join(input, 'audio', 'track_music.wav'), { bpm: 128, seed: 'cq' });
  const ctx = createContext({ cwd: root, env: baseEnv(), overrides: { transport: 'mock' }, mockAE: createMockAE() });
  const r = await produceVideo(ctx, { assets: input, type: 'velocity', prompt: 'velocity edit "CQ"', duration: 14, resolution: '720p', name: 'cq', starterSfx: true, seed: 2, remember: true });
  assert.equal(r.success, true, r.error); assert.ok(r.data.creativeQa && readJson(r.data.creativeQa).level === 'plan'); assert.ok(r.data.creative.score > 0);
  assert.match(fs.readFileSync(r.data.report, 'utf8'), /## Creative QA \(plan\)/);
  const mem = loadMemory(ctx.config); assert.equal(mem.runs.length, 1); assert.equal(mem.runs[0].project, 'cq');
  const c = await critiqueProject(ctx, 'cq'); assert.equal(c.success, true, c.error); assert.ok(c.data.score > 0 && Object.keys(c.data.categories).length >= 8); assert.ok(fs.existsSync(c.data.file));
  assert.equal((await critiqueProject(ctx, 'cq', { file: path.join(root, 'nope.mp4') })).success, false);
  // opt-out: a project config with memory:false is not recorded
  fs.writeFileSync(path.join(input, 'edit.config.json'), JSON.stringify({ memory: false, type: 'velocity', duration: 12, seed: 3 }));
  const before = loadMemory(ctx.config).runs.length; const off = await produceVideo(ctx, { assets: input, name: 'cq-off', resolution: '720p', starterSfx: true, remember: true }); assert.equal(off.success, true, off.error); assert.equal(loadMemory(ctx.config).runs.length, before, 'memory:false means nothing is recorded');
  // memory command
  const like = await memoryCommand(ctx, 'like', ['LIB_X']); assert.equal(like.success, true); assert.ok(like.data.rated[0].rating > 0);
  assert.equal((await memoryCommand(ctx, 'like', [])).success, false); const show = await memoryCommand(ctx, 'show'); assert.ok(show.data.runs >= 1 && show.data.ratings.LIB_X > 0);
  // CLI
  const env = { ...baseEnv(), XOXO_ROOT: root, XOXO_TRANSPORT: 'mock' }; const run = (...a) => spawnSync(process.execPath, [BIN, ...a], { env, encoding: 'utf8', timeout: 300000 });
  const cr = run('critique', 'cq'); assert.equal(cr.status, 0, cr.stderr + cr.stdout); assert.match(cr.stdout, /CREATIVE QA (PASSED|FAILED)/); assert.match(cr.stdout, /rhythm/);
  const mm = run('memory', 'show'); assert.equal(mm.status, 0); assert.match(mm.stdout, /memory on/);
  const dis = run('memory', 'dislike', 'LIB_X', '--json'); assert.equal(JSON.parse(dis.stdout).data.rated[0].rating < 0.5, true);
  const pro = run('promote', 'cq', '--to', 'preview', '--json'); assert.equal(JSON.parse(pro.stdout).success, true); assert.ok(fs.existsSync(projectPaths(ctx.config, 'cq-preview').plan));
  const rs = run('memory', 'reset'); assert.equal(rs.status, 0); assert.equal(loadMemory(ctx.config).runs.length, 0);
  void buildProject; void openBridge;
});
