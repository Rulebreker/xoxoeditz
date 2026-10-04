import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir, baseEnv } from './helpers/env.js';
import { hasFfmpeg, makeImage, makeVideo } from './helpers/media.js';
import { writeTrack } from '../src/audio/synth-music.js';
import { createContext } from '../src/app/services.js';
import { produceVideo, beatsFor, directProject, findEditConfig } from '../src/app/produce.js';
import { createMockAE } from '../src/bridge/mock-ae.js';
import { readJson } from '../src/core/paths.js';
import { validateTimeline } from '../src/timeline/plan.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'xoxo.js');

/** A believable input folder: clips of different lengths, stills, a music track with structure; names that include a space and Unicode. */
function inputFolder(root, { music = true } = {}) {
  const dir = path.join(root, 'IN PUT é'); fs.mkdirSync(dir, { recursive: true });
  const colours = ['darkblue', 'gray', 'darkgreen', 'maroon', 'navy', 'olive'];
  for (let i = 0; i < 6; i++) makeVideo(path.join(dir, `j20 clip ${i + 1}.mp4`), { w: 960, h: 540, dur: 8 + (i % 3), withAudio: i % 2 === 0 });
  for (let i = 0; i < 4; i++) makeImage(path.join(dir, `j20_photo_${i + 1}.jpg`), 1920, 1080, colours[i]);
  if (music) { fs.mkdirSync(path.join(dir, 'audio'), { recursive: true }); writeTrack(path.join(dir, 'audio', 'drive_128bpm_music.wav'), { bpm: 128, seed: 'produce' }); }
  return dir;
}
const ctxFor = (root, extra = {}) => createContext({ cwd: root, env: baseEnv(), overrides: { transport: 'mock', ...extra }, mockAE: createMockAE() });

test('produce (simulator): from a folder + type + prompt to a validated, built, QA-checked plan with an honest report', { skip: !hasFfmpeg, timeout: 600000 }, async () => {
  const root = tmpDir('xoxo-prod-'); const input = inputFolder(root); const out = path.join(root, 'OUT PUT');
  const ctx = ctxFor(root);
  const r = await produceVideo(ctx, { assets: input, type: 'velocity', prompt: 'Make an aggressive velocity edit "J20 STEALTH" for the fighter jet, military look, 24 seconds', output: out, duration: 24, resolution: '720p', starterSfx: true, seed: 3 });
  assert.equal(r.success, true, JSON.stringify(r.data?.edit?.build?.errors || r.error, null, 1));
  const d = r.data; assert.equal(d.simulated, true); assert.equal(d.rendered, false); assert.equal(d.output, null, 'the simulator makes no video and says so');
  const plan = readJson(d.plan); assert.equal(plan.mode, 'timeline'); assert.equal(plan.editType, 'velocity'); assert.equal(plan.timeline.duration, 24);
  assert.equal(plan.audio.music[0].asset.startsWith('MUS_') || plan.audio.music[0].asset.startsWith('NARR') || plan.audio.music[0].asset.length > 0, true);
  assert.equal(plan.beatMap.virtual, false, 'the project music was really analysed'); assert.ok(Math.abs(plan.timeline.bpm - 128) < 2, `bpm ${plan.timeline.bpm}`);
  assert.deepEqual(validateTimeline(plan, { manifest: readJson(path.join(d.projectDir, 'assets.manifest.json')), library: null }).errors.filter((e) => !/library|LIB_/.test(e.message)), []);
  assert.ok(d.beatMap && readJson(d.beatMap).bpm); assert.ok(readJson(d.directorReport).rationale.length === plan.timeline.shots.length);
  assert.equal(d.edit.qa.passed, true, JSON.stringify(d.edit.qa.errors));
  assert.ok(plan.audio.sfxEvents.length > 3, 'starter SFX pack used'); assert.ok(plan.timeline.shots.some((s) => s.layers.some((l) => l.remap)), 'speed ramps');
  const report = fs.readFileSync(d.report, 'utf8'); assert.match(report, /SIMULATED/); assert.match(report, /does \*\*not\*\* prove anything about real After Effects/); assert.match(report, /## Shots/); assert.match(report, /virtual|BPM/);
  assert.ok(fs.existsSync(path.join(out, 'EDIT_REPORT.md')), 'report delivered to --output');
  for (const f of fs.readdirSync(input, { recursive: true })) assert.ok(!String(f).endsWith('.json'), 'the source folder is never written to');
});

test('produce: deterministic for a seed, different for another; re-running is idempotent and incremental; edit.config.json is honoured and CLI wins over it', { skip: !hasFfmpeg, timeout: 900000 }, async () => {
  const root = tmpDir('xoxo-prod-'); const input = inputFolder(root);
  fs.writeFileSync(path.join(input, 'edit.config.json'), JSON.stringify({ type: 'velocity', style: 'military', intensity: 0.9, duration: 18, seed: 11, overrides: { transitions: 0.2 } }));
  assert.equal(findEditConfig(ctxFor(root), input), path.join(input, 'edit.config.json'));
  const ctx = ctxFor(root); const run = (o = {}) => produceVideo(ctx, { assets: input, resolution: '720p', starterSfx: true, name: 'cfg', ...o });
  const a = await run(); assert.equal(a.success, true, a.error); const planA = fs.readFileSync(a.data.plan, 'utf8');
  const plan = JSON.parse(planA); assert.equal(plan.timeline.duration, 18); assert.equal(plan.look.color, 'MILITARY'); assert.equal(plan.directive.dials.transitions, 0.2); assert.equal(plan.directive.sources.transitions, 'config.overrides');
  const b = await run(); assert.equal(b.success, true); assert.equal(fs.readFileSync(b.data.plan, 'utf8'), planA, 'same inputs, same seed -> byte-identical plan');
  assert.equal(b.data.edit.build.transport, 'mock'); assert.ok(b.data.edit.build.errors?.length ? false : true);
  const c = await run({ seed: 12, duration: 20 }); assert.equal(JSON.parse(fs.readFileSync(c.data.plan, 'utf8')).timeline.duration, 20, 'CLI beats the config file'); assert.notEqual(fs.readFileSync(c.data.plan, 'utf8'), planA);
  const bad = path.join(root, 'bad.json'); fs.writeFileSync(bad, JSON.stringify({ intensity: 7 })); await assert.rejects(async () => { const r = await produceVideo(ctx, { assets: input, config: bad }); if (!r.success) throw new Error(r.error); }, /intensity/);
});

test('produce: no music -> virtual grid (flagged); no library -> no SFX (flagged); bad input -> clear errors; explicit music file is imported read-only', { skip: !hasFfmpeg, timeout: 900000 }, async () => {
  const root = tmpDir('xoxo-prod-'); const input = inputFolder(root, { music: false });
  const ctx = ctxFor(root);
  const a = await produceVideo(ctx, { assets: input, type: 'cinematic', prompt: 'a calm cinematic piece about the "AIRBASE"', duration: 16, resolution: '720p', name: 'novirt' });
  assert.equal(a.success, true, a.error); const plan = readJson(a.data.plan); assert.equal(plan.beatMap.virtual, true); assert.equal(plan.audio.sfxEvents.length, 0);
  const rep = fs.readFileSync(a.data.report, 'utf8'); assert.match(rep, /virtual grid/); assert.equal(plan.editType, 'cinematic');
  const missing = await produceVideo(ctx, { assets: path.join(root, 'nope') }); assert.equal(missing.success, false); assert.match(missing.error, /assets folder not found/);
  const noAssets = await produceVideo(ctx, {}); assert.equal(noAssets.success, false); assert.match(noAssets.error, /--assets/);
  const badType = await produceVideo(ctx, { assets: input, type: 'nonsense' }); assert.equal(badType.success, false); assert.match(badType.error, /edit type/i);
  const badQ = await produceVideo(ctx, { assets: input, quality: 'ultra' }); assert.equal(badQ.success, false); assert.match(badQ.error, /quality/);
  const song = path.join(root, 'my song ü.wav'); writeTrack(song, { bpm: 100, seed: 'explicit' }); const before = fs.statSync(song).mtimeMs;
  const e = await produceVideo(ctx, { assets: input, type: 'velocity', duration: 14, resolution: '720p', music: song, name: 'explicit' });
  assert.equal(e.success, true, e.error); const pe = readJson(e.data.plan); assert.ok(pe.audio.music[0].asset.startsWith('MUS_MY_SONG'), pe.audio.music[0].asset); assert.ok(Math.abs(pe.timeline.bpm - 100) < 2); assert.equal(fs.statSync(song).mtimeMs, before);
});

test('beats + direct services: a beat map with sections for any audio file; re-directing changes the cut but keeps the project valid', { skip: !hasFfmpeg, timeout: 600000 }, async () => {
  const root = tmpDir('xoxo-prod-'); const input = inputFolder(root); const ctx = ctxFor(root);
  const b = await beatsFor(ctx, path.join(input, 'audio', 'drive_128bpm_music.wav'), { out: path.join(root, 'beats', 'map.json') });
  assert.equal(b.success, true); assert.ok(Math.abs(b.data.bpm - 128) < 2); assert.ok(b.data.drops.length >= 1 && b.data.sections.length >= 3); assert.ok(readJson(path.join(root, 'beats', 'map.json')).beats.length > 40);
  assert.equal((await beatsFor(ctx, path.join(root, 'missing.wav'))).success, false);
  const p = await produceVideo(ctx, { assets: input, type: 'velocity', duration: 16, resolution: '720p', starterSfx: true, name: 'redirect', render: false, verify: false }); assert.equal(p.success, true, p.error);
  const first = fs.readFileSync(p.data.plan, 'utf8');
  const re = await directProject(ctx, 'redirect', { seed: 99, dryRun: true }); assert.equal(re.success, true, re.error); assert.notEqual(fs.readFileSync(re.data.plan, 'utf8'), first);
  assert.ok(re.data.shots >= 4 && re.data.warnings.every((w) => typeof w === 'string'));
});

test('CLI: `xoxo edit --assets --type --prompt --output --dry-run` runs the whole autonomous path and prints an honest summary', { skip: !hasFfmpeg, timeout: 900000 }, async () => {
  const root = tmpDir('xoxo-prod-'); const input = inputFolder(root); const out = path.join(root, 'OUTPUT');
  const env = { ...baseEnv(), XOXO_ROOT: root, XOXO_TRANSPORT: 'mock' };
  const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8', timeout: 600000 });
  const r = run('edit', '--assets', input, '--type', 'velocity', '--prompt', 'aggressive velocity edit "J20 STEALTH" 14 seconds', '--output', out, '--duration', '14', '--resolution', '720p', '--starter-sfx', '--dry-run');
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /PLANNED \+ SIMULATED/); assert.match(r.stdout, /nothing was rendered/); assert.match(r.stdout, /QA:\s+.*passed/);
  assert.ok(fs.existsSync(path.join(out, 'EDIT_REPORT.md')));
  const j = run('beats', path.join(input, 'audio', 'drive_128bpm_music.wav'), '--json'); const beats = JSON.parse(j.stdout); assert.equal(beats.success, true); assert.ok(Math.abs(beats.data.bpm - 128) < 2);
  const bad = run('edit', '--prompt', 'x'); assert.equal(bad.status, 2); assert.match(bad.stderr, /usage: xoxo edit --assets/);
  const help = run('help'); assert.match(help.stdout, /AUTONOMOUS/); assert.match(help.stdout, /xoxo beats/);
});
