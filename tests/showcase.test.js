import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpDir, baseEnv, NO_FAKE_EXE } from './helpers/env.js';
import { hasFfmpeg, makeImage, makeVideo, makeSpeechLike } from './helpers/media.js';
import { createContext } from '../src/app/services.js';
import { runShowcase } from '../src/app/showcase.js';
import { scanAssets } from '../src/assets/scan.js';
import { analyzeNarration } from '../src/narration/analyze.js';
import { curatePlan, heroScore } from '../src/plan/curate.js';
import { validatePlan } from '../src/plan/schema.js';
import { createMockAE } from '../src/bridge/mock-ae.js';
import { testConfig } from './helpers/env.js';

const FAKE_AERENDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'fake-aerender.mjs');
const SCRIPT = 'The Atlas rover landed on a dusty plain in 2021. It reached a top speed of 120 km/h during testing. Engineers in Houston watched every second. Few machines are built to survive this long.';
// ~24 s of "speech" in four phrases separated by pauses
const SPEECH = [[5.2, true], [0.9, false], [5.6, true], [0.8, false], [4.4, true], [0.9, false], [5.0, true]];

function demoAssets(root, { narrationPattern = SPEECH, music = true } = {}) {
  const a = path.join(root, 'assets'); fs.mkdirSync(path.join(a, 'sfx'), { recursive: true });
  makeImage(path.join(a, 'atlas_rover_landscape_4k.jpg'), 3840, 2160, 'orange');
  makeImage(path.join(a, 'dusty_plain.jpg'), 1920, 1080, 'sienna');
  makeImage(path.join(a, 'portrait_engineer.jpg'), 1080, 1920, 'gray');
  makeVideo(path.join(a, 'houston_control_room.mp4'), { dur: 12, w: 1280, h: 720 });
  makeVideo(path.join(a, 'rover_wheels_closeup.mp4'), { dur: 5, w: 1280, h: 720 });
  if (narrationPattern) makeSpeechLike(path.join(a, 'narration.wav'), narrationPattern);
  if (music) makeSpeechLike(path.join(a, 'music_bed.mp3'), [[40, true]]);
  makeSpeechLike(path.join(a, 'sfx', 'whoosh_01.wav'), [[0.8, true]]);
  fs.writeFileSync(path.join(a, 'script.txt'), SCRIPT);
  return a;
}

async function curated(opts = {}, build = {}) {
  const root = tmpDir('xoxo-cur-');
  const assets = demoAssets(root, build);
  const cfg = testConfig({});
  const manifest = await scanAssets(cfg, assets);
  const narration = manifest.assets.some((x) => x.role === 'narration')
    ? await analyzeNarration(cfg, { audio: path.join(assets, 'narration.wav'), script: path.join(assets, 'script.txt') }) : null;
  const plan = curatePlan({ name: 'demo', brief: 'a short documentary about the Atlas rover', manifest, narration, ...opts });
  return { plan, manifest, narration };
}

test('curated director: 20-30 s, contiguous scenes, hero opener/closer, no repeated camera move, restrained transitions', { skip: !hasFfmpeg }, async () => {
  const { plan, manifest, narration } = await curated();
  const total = plan.scenes.at(-1).end;
  assert.ok(total >= 20 && total <= 30, `total ${total}`);
  assert.equal(plan.scenes[0].start, 0);
  plan.scenes.forEach((s, i) => { if (i) assert.equal(s.start, plan.scenes[i - 1].end, 'contiguous'); assert.ok(s.end - s.start >= 3, 'no scene shorter than 3 s'); });
  const v = validatePlan(plan, { manifest, narration });
  assert.deepEqual(v.errors, []);

  const shots = plan.scenes.flatMap((s) => s.clips);
  const hero = [...manifest.assets.filter((a) => a.type !== 'audio' && a.type !== 'script')].sort((a, b) => heroScore(b) - heroScore(a))[0];
  assert.equal(shots[0].asset, hero.id, 'opens on the strongest asset');
  assert.equal(shots[0].motion, 'push_in');
  assert.equal(shots.at(-1).motion === 'pull_out' || manifest.assets.find((a) => a.id === shots.at(-1).asset).type === 'video', true, 'closes with a pull-out (or footage)');
  const stillMoves = shots.filter((c) => c.motion !== 'static').map((c) => c.motion);
  stillMoves.forEach((m, i) => { if (i) assert.notEqual(m, stillMoves[i - 1], 'never the same camera move twice in a row'); });
  const counts = {}; shots.forEach((c) => { counts[c.asset] = (counts[c.asset] || 0) + 1; });
  const pool = manifest.assets.filter((a) => (a.type === 'image' || a.type === 'video') && a.id !== 'IMG_PORTRAIT_ENGINEER');
  assert.ok(Math.max(...Object.values(counts)) - Math.min(...pool.map((a) => counts[a.id] || 0)) <= 1, `fair use of assets: ${JSON.stringify(counts)}`);
  assert.ok(!counts.IMG_PORTRAIT_ENGINEER, 'a portrait photo is not used full-bleed in a landscape frame');
  assert.ok(plan._decisions.some((d) => /Excluded IMG_PORTRAIT_ENGINEER.*lose 68%/.test(d)), 'and the log says why');
  assert.equal(plan.style, 'cinematic-documentary', 'a rover documentary is not a military film');
  const reused = shots.filter((c) => counts[c.asset] > 1 && c.sourceIn !== undefined);
  const byAsset = {}; reused.forEach((c) => { (byAsset[c.asset] ||= []).push(c.sourceIn); });
  for (const [id, ins] of Object.entries(byAsset)) assert.equal(new Set(ins).size, ins.length, `${id} reused with different segments`);

  const distinct = plan.scenes.filter((s) => s.transition && !['dissolve', 'cut'].includes(s.transition.type));
  assert.ok(distinct.length <= 1, 'at most one distinct transition in 25 s');
  assert.equal(plan.scenes[0].transition.type, 'dissolve');
  for (const s of plan.scenes) for (const c of s.clips) if (c.sourceIn !== undefined) assert.ok(c.sourceIn >= 0.3, 'footage in-point skips the first frames');
});

test('curated director: every cut lands on a sentence end / pause, text is sparse and never overlaps', { skip: !hasFfmpeg }, async () => {
  const { plan, narration } = await curated();
  const beats = [...narration.sentences.map((s) => s.end), ...narration.pauses.map((p) => p.at + p.duration / 2), ...narration.speech.map((s) => s.end)];
  const cuts = plan.scenes.slice(1).map((s) => s.start);
  const onBeat = cuts.filter((c) => beats.some((b) => Math.abs(b - c) < 0.06));
  assert.ok(onBeat.length >= cuts.length - 1, `cuts ${cuts} vs beats ${beats.map((b) => b.toFixed(1))}`);
  const gfx = plan.scenes.flatMap((s) => s.graphics.map((g) => ({ ...g, scene: s.id })));
  assert.ok(gfx.length >= 1 && gfx.length <= 3, `sparse text: ${gfx.map((g) => g.kind)}`);
  assert.equal(gfx[0].kind, 'title');
  assert.ok(gfx.some((g) => g.kind === 'stat' && g.value === 120), 'the spoken number became a stat graphic');
  const stat = gfx.find((g) => g.kind === 'stat');
  assert.equal(stat.position, 'upper-left', 'kept clear of the caption zone');
  assert.equal(plan.captions.enabled, true);
  assert.ok(plan._decisions.length > 8, 'every decision is logged with its reason');
  assert.ok(plan._decisions.some((d) => /on a sentence end/.test(d)));
});

test('curated director: music is ducked-in, narration longer than 30 s is trimmed at a pause', { skip: !hasFfmpeg }, async () => {
  const long = [[6, true], [0.9, false], [6, true], [0.9, false], [6, true], [0.9, false], [6, true], [0.9, false], [6, true], [0.9, false], [6, true]]; // ~39.5 s
  const { plan, narration } = await curated({}, { narrationPattern: long });
  assert.ok(narration.duration > 35);
  assert.ok(plan.scenes.at(-1).end <= 30, `trimmed to ${plan.scenes.at(-1).end}`);
  assert.ok(plan.audio.narration.end > 20 && plan.audio.narration.end < plan.scenes.at(-1).end);
  assert.equal(plan.audio.music[0].gainDb, -22);
  assert.equal(plan.audio.music[0].end, plan.scenes.at(-1).end);
  assert.ok(plan._decisions.some((d) => /first .* cut at a natural pause/.test(d)));
});

test('curated director: no narration still yields a valid 20-30 s edit; no visuals is a clear error', { skip: !hasFfmpeg }, async () => {
  const { plan, manifest } = await curated({}, { narrationPattern: null, music: false });
  assert.ok(plan.scenes.at(-1).end >= 20 && plan.scenes.at(-1).end <= 30);
  assert.equal(plan.audio.narration, undefined);
  assert.equal(plan.captions.enabled, false);
  assert.deepEqual(validatePlan(plan, { manifest }).errors, []);
  assert.throws(() => curatePlan({ manifest: { assets: [] } }), /nothing to edit/);
});

test('showcase refuses to run without real After Effects, says so, and writes an honest report', async () => {
  const root = tmpDir('xoxo-sc-');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  const ctx = createContext({ cwd: root, env: baseEnv(), overrides: { transport: 'auto', aePath: path.join(root, 'no', 'AfterFX.exe') } });
  const r = await runShowcase(ctx, 'real-test', {});
  assert.equal(r.success, false);
  assert.match(r.error, /Preflight/);
  const rep = fs.readFileSync(path.join(root, 'projects', 'real-test', 'REAL_EDIT_REPORT.md'), 'utf8');
  assert.match(rep, /NOT PERFORMED/);
  assert.match(rep, /\*\*Overall: FAILED\*\*/);
  assert.ok(!fs.existsSync(path.join(root, 'projects', 'real-test', 'renders', 'final.mp4')));
  assert.ok(!/REAL After Effects\*\* \(/.test(rep), 'never claims a real run');
  const mock = createContext({ cwd: tmpDir(), env: baseEnv(), overrides: { transport: 'mock' } });
  assert.match((await runShowcase(mock, 'real-test', {})).error, /simulator/);
});

test('showcase end to end (SIMULATOR, labelled as such): all deliverables, report content, honest banner', { skip: !hasFfmpeg || NO_FAKE_EXE }, async () => {
  const root = tmpDir('xoxo-sc2-');
  demoAssets(root);
  process.env.FAKE_AERENDER_MAXW = '1280';
  const ctx = createContext({ cwd: root, env: baseEnv(), overrides: { transport: 'mock', aerenderPath: FAKE_AERENDER }, mockAE: createMockAE() });
  const r = await runShowcase(ctx, 'real-test', { allowMock: true, resolution: '720p', brief: 'a short documentary about the Atlas rover', script: path.join(root, 'assets', 'script.txt') });
  assert.equal(r.success, true, r.error);
  const dir = path.join(root, 'projects', 'real-test');
  for (const f of ['real-test.aep', 'edit-plan.json', 'plan.json', 'build-report.json', 'QA_REPORT.json', path.join('renders', 'final.mp4'), 'REAL_EDIT_REPORT.md']) assert.ok(fs.existsSync(path.join(dir, f)), `${f} exists`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'QA_REPORT.json'), 'utf8')).passed, true);
  const rep = fs.readFileSync(path.join(dir, 'REAL_EDIT_REPORT.md'), 'utf8');
  assert.match(rep, /Run type: SIMULATOR - NOT a real After Effects run/);
  for (const h of ['## Pipeline steps', '## Assets', '## Scenes', "### Editorial decisions", '## Effects and animation actually used', '## Fallbacks', '## Audio processing', '## Render settings', '## QA', '## Limitations', '## Files']) assert.ok(rep.includes(h), `report has ${h}`);
  assert.match(rep, /Output file \(ffprobe\): 1280x720, h264/);
  assert.match(rep, /atlas_rover_landscape_4k|ATLAS_ROVER_LANDSCAPE_4K/i);
  assert.match(rep, /ducked -11 dB/);
  assert.match(rep, /simulator run/);
  assert.ok(steps(rep) >= 7);
  function steps(t) { return (t.match(/\| OK \|/g) || []).length; }
});

test('style guessing: whole words only, ties go to cinematic, real keywords still win', async () => {
  const { guessStyle } = await import('../src/motion/styles.js');
  assert.equal(guessStyle('a short documentary about the Atlas rover'), 'cinematic-documentary');
  assert.equal(guessStyle('our objective is to warn people'), 'cinematic-documentary', '"jet"/"war" inside other words do not count');
  assert.equal(guessStyle('a documentary about the J-20 fighter jet'), 'military-documentary');
  assert.equal(guessStyle('viral youtube shorts'), 'fast-youtube');
  assert.equal(guessStyle('luxury automotive commercial'), 'premium-commercial');
});
