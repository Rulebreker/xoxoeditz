import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir, baseEnv, testConfig } from './helpers/env.js';
import { hasFfmpeg } from './helpers/media.js';
import { createContext } from '../src/app/services.js';
import { createMockAE } from '../src/bridge/mock-ae.js';
import { readJson, projectPaths } from '../src/core/paths.js';
import { SPECS, COMMON, BENCHMARK_IDS } from '../src/benchmark/specs.js';
import { makeBenchmarkInputs } from '../src/benchmark/media.js';
import { runBenchmark, judge } from '../src/benchmark/run.js';
import { critiquePlan } from '../src/creative-qa/index.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'xoxo.js');
const root = tmpDir('xoxo-bench-'); // shared: each benchmark's inputs are generated once for the whole file
const ctx = createContext({ cwd: root, env: baseEnv(), overrides: { transport: 'mock' }, mockAE: createMockAE() });

test('benchmark inputs: self-contained, deterministic, cached, and the library of specs is complete', { skip: !hasFfmpeg, timeout: 300000 }, async () => {
  assert.deepEqual(BENCHMARK_IDS, ['velocity', 'cinematic', 'documentary', 'commercial']);
  for (const id of BENCHMARK_IDS) { const s = SPECS[id]; assert.ok(s.prompt && s.config.type === s.type && s.criteria.length >= 7 && s.media.clips >= 8, id); assert.equal(new Set([...COMMON, ...s.criteria].map((c) => c.id)).size, COMMON.length + s.criteria.length, `${id}: criterion ids are unique`); }
  const dir = path.join(tmpDir('xoxo-bench-in-'), 'in');
  const a = await makeBenchmarkInputs(testConfig({}), dir, { ...SPECS.documentary, media: { clips: 2, stills: 1, bpm: 80, seed: 3 } }); assert.equal(a.reused, false);
  const files = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => !f.startsWith('.')); assert.ok(files.includes('clip_01.mp4') && files.includes('still_01.jpg') && files.includes('edit.config.json') && files.some((f) => /music_80bpm\.wav$/.test(f)), files.join());
  const stamp = fs.statSync(path.join(dir, 'clip_01.mp4')).mtimeMs; const b = await makeBenchmarkInputs(testConfig({}), dir, { ...SPECS.documentary, media: { clips: 2, stills: 1, bpm: 80, seed: 3 } }); assert.equal(b.reused, true); assert.equal(fs.statSync(path.join(dir, 'clip_01.mp4')).mtimeMs, stamp);
  const c = await makeBenchmarkInputs(testConfig({}), dir, { ...SPECS.documentary, media: { clips: 3, stills: 1, bpm: 80, seed: 3 } }); assert.equal(c.reused, false, 'a changed spec regenerates');
});

test('benchmark: velocity passes its whole checklist on the simulator, never claims a render, and leaves the sources alone', { skip: !hasFfmpeg, timeout: 900000 }, async () => {
  const out = path.join(root, 'bench out');
  const r = await runBenchmark(ctx, 'velocity', { dryRun: true, output: out });
  assert.equal(r.success, true, JSON.stringify(r.data?.results?.filter((x) => x.status === 'fail') || r.error, null, 1));
  const d = r.data; assert.equal(d.passed, true); assert.equal(d.simulated, true); assert.equal(d.failCount, 0); assert.equal(d.project, 'benchmark-velocity');
  const by = Object.fromEntries(d.results.map((x) => [x.id, x]));
  for (const id of ['camera_moves', 'speed_ramps', 'sfx', 'beat_sync', 'kinetic_type', 'advanced_transition', 'compositing', 'depth_camera', 'colour', 'intro_outro', 'no_slideshow', 'qa_passed', 'creative_no_errors', 'unique_layers']) assert.equal(by[id].status, 'pass', `${id}: ${by[id].detail}`);
  assert.equal(by.rendered.status, 'skipped'); assert.equal(by.render_qa.status, 'skipped'); assert.match(by.rendered.detail, /simulator/);
  const md = fs.readFileSync(d.report, 'utf8'); assert.match(md, /SIMULATED RUN/); assert.match(md, /no video was rendered|\*\*not\*\* prove/); assert.match(md, /## Shot list/); assert.ok(fs.existsSync(path.join(out, 'BENCHMARK_REPORT_velocity.md')));
  const p = projectPaths(ctx.config, 'benchmark-velocity'); for (const f of ['plan', 'aep', 'creativeQa', 'beatMap', 'directorReport']) assert.ok(fs.existsSync(p[f]) || f === 'aep', f);
  assert.ok(fs.existsSync(path.join(p.root, 'benchmark.json')) && fs.existsSync(path.join(p.root, 'EDIT_REPORT.md')));
  assert.equal(readJson(path.join(p.root, 'benchmark.json')).simulated, true);
  // deterministic: a second run is byte-identical in its plan
  const before = fs.readFileSync(p.plan, 'utf8'); const again = await runBenchmark(ctx, 'velocity', { dryRun: true }); assert.equal(again.success, true); assert.equal(fs.readFileSync(p.plan, 'utf8'), before);
  const reseed = await runBenchmark(ctx, 'velocity', { dryRun: true, seed: 99 }); assert.equal(reseed.success, true, JSON.stringify(reseed.data?.results?.filter((x) => x.status === 'fail'))); assert.notEqual(fs.readFileSync(p.plan, 'utf8'), before, 'another seed is another cut that still passes');
});

test('benchmark: cinematic, documentary and commercial each pass their own, different, checklist', { skip: !hasFfmpeg, timeout: 1800000 }, async () => {
  for (const id of ['cinematic', 'documentary', 'commercial']) {
    const r = await runBenchmark(ctx, id, { dryRun: true });
    assert.equal(r.success, true, `${id}: ${JSON.stringify(r.data?.results?.filter((x) => x.status === 'fail') || r.error, null, 1)}`);
    assert.equal(r.data.failCount, 0, id); assert.ok(r.data.passCount >= 12, `${id}: ${r.data.passCount} criteria passed`);
    const plan = readJson(r.data.plan); assert.equal(plan.editType, id);
  }
  // the types really are different edits
  const sig = (id) => { const p = readJson(projectPaths(ctx.config, `benchmark-${id}`).plan); return { shots: p.timeline.shots.length, ramps: p.timeline.shots.filter((s) => s.layers.some((l) => l.remap)).length, bpm: Math.round(p.timeline.bpm), look: p.look.color, sfx: p.audio.sfxEvents.length }; };
  const v = sig('velocity'); const c = sig('cinematic'); const d = sig('documentary'); const m = sig('commercial');
  assert.ok(v.shots >= c.shots * 2 && v.shots >= d.shots * 1.5 && v.ramps >= 5 && d.ramps === 0 && v.sfx > d.sfx * 2, JSON.stringify({ v, c, d, m }));
  assert.deepEqual([v.look, c.look, d.look, m.look], ['MILITARY', 'CINEMATIC', 'DOCUMENTARY', 'PREMIUM']);
});

test('the checklists are not vacuous: a documentary fails the velocity checklist, a velocity edit fails the documentary one, and the render criteria are honest', { skip: !hasFfmpeg, timeout: 900000 }, async () => {
  const env = (id) => { const p = projectPaths(ctx.config, `benchmark-${id}`); const plan = readJson(p.plan); const creative = readJson(p.creativeQa); return { plan, creative, simulated: true, edit: { qa: { passed: true, summary: 'ok' }, build: { success: true, errors: [] } }, builtUnits: ['look.color'], validation: { valid: true, errors: [] }, sourceUntouched: true, render: null }; };
  const asVel = judge(SPECS.velocity, env('documentary')).filter((r) => r.status === 'fail').map((r) => r.id);
  for (const id of ['speed_ramps', 'pace', 'kinetic_type', 'sfx']) assert.ok(asVel.includes(id), `a documentary must fail "${id}" (failed: ${asVel})`);
  const asDoc = judge(SPECS.documentary, env('velocity')).filter((r) => r.status === 'fail').map((r) => r.id);
  for (const id of ['no_ramps', 'calm_pace', 'minimal_sound']) assert.ok(asDoc.includes(id), `a velocity edit must fail "${id}" (failed: ${asDoc})`);
  const asCom = judge(SPECS.commercial, env('velocity')).filter((r) => r.status === 'fail').map((r) => r.id); assert.ok(asCom.includes('professional') || asCom.includes('product_camera') || asCom.includes('colour'), `commercial vs velocity: ${asCom}`);
  // render criteria: skipped when simulated, pass/fail when real
  const real = (render, creative = { renderChecked: true, errors: [], warnings: [], score: 0.9 }) => ({ ...env('velocity'), simulated: false, render, creative });
  const status = (e) => Object.fromEntries(judge(SPECS.velocity, e).map((r) => [r.id, r.status]));
  assert.equal(status(env('velocity')).rendered, 'skipped');
  assert.equal(status(real({ success: true, data: { output: '/x.mp4' } })).rendered, 'pass'); assert.equal(status(real({ success: true, data: { output: '/x.mp4' } })).render_qa, 'pass');
  assert.equal(status(real({ success: false, error: 'aerender failed' })).rendered, 'fail'); assert.equal(status(real(null)).rendered, 'fail');
  assert.equal(status(real({ success: true, data: { output: '/x.mp4' } }, { renderChecked: true, errors: [{ code: 'BLACK_FRAMES' }], warnings: [], score: 0.7 })).render_qa, 'fail', 'black frames in a real render fail the benchmark');
  // a crashing criterion fails rather than passing silently
  const crash = judge({ criteria: [{ id: 'x', label: 'x', check: () => { throw new Error('boom'); } }] }, env('velocity')).find((r) => r.id === 'x'); assert.equal(crash.status, 'fail'); assert.match(crash.detail, /boom/);
  void critiquePlan;
});

test('CLI: xoxo benchmark documents itself, rejects unknown names, and runs with --dry-run', { skip: !hasFfmpeg, timeout: 900000 }, async () => {
  const env = { ...baseEnv(), XOXO_ROOT: tmpDir('xoxo-bench-cli-'), XOXO_TRANSPORT: 'mock' };
  const run = (...a) => spawnSync(process.execPath, [BIN, ...a], { env, encoding: 'utf8', timeout: 800000 });
  assert.match(run('help').stdout, /xoxo benchmark <velocity\|cinematic\|documentary\|commercial\|all>/);
  const none = run('benchmark'); assert.equal(none.status, 2); assert.match(none.stderr, /usage: xoxo benchmark/);
  const bad = run('benchmark', 'nonsense', '--dry-run'); assert.equal(bad.status, 1); assert.match(bad.stdout + bad.stderr, /unknown benchmark "nonsense"/);
  const ok = run('benchmark', 'documentary', '--dry-run'); assert.equal(ok.status, 0, ok.stderr + ok.stdout); assert.match(ok.stdout, /PASSED/); assert.match(ok.stdout, /\[simulator\]/); assert.match(ok.stdout, /BENCHMARK_REPORT\.md/);
  const j = run('benchmark', 'documentary', '--dry-run', '--json'); const parsed = JSON.parse(j.stdout); assert.equal(parsed.success, true); assert.equal(parsed.data.simulated, true);
});
