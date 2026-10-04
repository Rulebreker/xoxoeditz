import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers/env.js';
import { hasFfmpeg, makeAssetFolder } from './helpers/media.js';
import { createContext, newProject, scanProject, analyzeProjectNarration, scaffoldProjectPlan, validateProjectPlan, editProject, verifyProject, renderProjectCmd, statusProject, detect } from '../src/app/services.js';
import { createMockAE } from '../src/bridge/mock-ae.js';
import { readJson } from '../src/core/paths.js';

const FAKE_AERENDER = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'helpers', 'fake-aerender.mjs');
const SCRIPT = 'The Chengdu J-20 is a fifth generation stealth fighter. It can reach Mach 2.0 at altitude. The jet entered service in 2017, with a range of 2,000 km. Few aircraft combine stealth and speed this way.';

async function project({ effects, resolution = '720p', transport = 'mock' } = {}) {
  const root = tmpDir('xoxo-e2e-');
  const assets = makeAssetFolder(path.join(root, 'assets'));
  fs.writeFileSync(path.join(assets, 'script.txt'), SCRIPT);
  process.env.FAKE_AERENDER_MAXW = '1280';
  const ctx = createContext({ cwd: root, env: {}, overrides: { transport, aerenderPath: FAKE_AERENDER }, mockAE: effects ? createMockAE({ effects }) : createMockAE() });
  const must = (r) => { assert.equal(r.success, true, `${r.operation}: ${r.error}`); return r.data; };
  must(await newProject(ctx, 'j20', { assets }));
  must(await scanProject(ctx, 'j20'));
  must(await analyzeProjectNarration(ctx, 'j20', { script: path.join(assets, 'script.txt') }));
  must(await scaffoldProjectPlan(ctx, 'j20', { title: 'CHENGDU J-20', brief: 'A cinematic, serious military documentary about the J-20 fighter jet', resolution }));
  return { ctx, root, assets, must };
}

test('full pipeline on the simulator: scan -> narration -> plan -> edit -> QA -> status', { skip: !hasFfmpeg }, async () => {
  const { ctx, must } = await project();
  const plan = readJson(path.join(ctx.config.projectsDir, 'j20', 'plan.json'));
  assert.equal(plan.style, 'military-documentary');
  assert.ok(plan.scenes.length >= 1);
  assert.equal(plan.output.resolution, '720p');
  assert.equal(plan.scenes[0].graphics[0].kind, 'title');
  assert.ok(plan.scenes.flatMap((s) => s.graphics).some((g) => g.kind === 'stat'), 'Mach 2.0 became a stat graphic');
  assert.ok(plan.audio.narration);
  assert.equal(plan.captions.enabled, true);
  must(await validateProjectPlan(ctx, 'j20'));

  const edit = await editProject(ctx, 'j20');
  assert.equal(edit.success, true, JSON.stringify(edit.data?.qa?.errors || edit.error, null, 1));
  assert.equal(edit.data.build.success, true);
  assert.equal(edit.data.qa.passed, true);
  assert.ok(fs.existsSync(path.join(ctx.config.projectsDir, 'j20', 'j20.aep')), 'project saved');
  assert.ok(fs.readdirSync(path.join(ctx.config.projectsDir, 'j20', 'versions')).length >= 1, 'versioned checkpoint');
  const qa = readJson(path.join(ctx.config.projectsDir, 'j20', 'QA_REPORT.json'));
  assert.equal(qa.passed, true);
  assert.deepEqual(Object.keys(qa.checks), ['PROJECT_CHECK', 'ASSET_CHECK', 'TIMELINE_CHECK', 'TEXT_CHECK', 'AUDIO_CHECK', 'EFFECT_CHECK', 'COMPOSITION_CHECK', 'RENDER_CHECK']);

  // what actually exists inside the (simulated) After Effects
  const ins = (await (async () => { const { openBridge } = await import('../src/app/services.js'); const { bridge } = await openBridge(ctx); return bridge.call('inspect', {}); })()).data;
  const names = ins.items.filter((i) => i.type === 'comp').map((c) => c.name);
  assert.ok(names.includes('COMP_MASTER') && names.includes('COMP_SCENE_01'));
  const master = ins.items.find((i) => i.name === 'COMP_MASTER');
  assert.equal(master.width, 1280); assert.equal(master.height, 720);
  assert.ok(master.layers.some((l) => l.name === 'NARR_MAIN'));
  const music = master.layers.find((l) => l.name.startsWith('MUSIC_'));
  assert.ok(music, 'music bed placed');
  assert.ok(music.audioKeys > 2, 'music is ducked under narration with level keyframes');
  assert.ok(master.layers.some((l) => /^CAP_0001$/.test(l.name)), 'captions built');
  assert.ok(master.layers.some((l) => l.name.startsWith('SFX_GEN_')), 'SFX synthesized when none match');
  const sc1 = ins.items.find((i) => i.name === 'COMP_SCENE_01');
  assert.ok(sc1.layers.some((l) => l.name === 'TXT_TITLE_1'));
  assert.ok(sc1.layers.some((l) => l.kind === 'footage'));

  // idempotent: building again does not duplicate anything
  const before = ins.items.filter((i) => i.type === 'comp').map((c) => [c.name, c.numLayers]);
  const again = await editProject(ctx, 'j20');
  assert.equal(again.success, true, again.error);
  const { openBridge } = await import('../src/app/services.js');
  const ins2 = (await (await openBridge(ctx)).bridge.call('inspect', {})).data;
  assert.deepEqual(ins2.items.filter((i) => i.type === 'comp').map((c) => [c.name, c.numLayers]), before);
  const footage = ins2.items.filter((i) => i.type === 'footage').map((i) => i.name);
  assert.ok(footage.length >= 3);
  assert.equal(new Set(footage).size, footage.length, 'every asset imported exactly once');

  const st = must(await statusProject(ctx, 'j20'));
  assert.equal(st.next.startsWith('xoxo render'), true);
});

test('missing effects fall back (never block) and the report says so', { skip: !hasFfmpeg }, async () => {
  const { ctx, must } = await project({ effects: [] });
  // force fancy transitions + looks
  const pp = path.join(ctx.config.projectsDir, 'j20', 'plan.json');
  const plan = readJson(pp);
  plan.scenes.forEach((s, i) => { if (i > 0) s.transition = { type: i % 2 ? 'glitch' : 'wipe', duration: 0.6 }; });
  plan.look = { grain: true, glow: true, grade: 20 };
  fs.writeFileSync(pp, JSON.stringify(plan));
  const edit = await editProject(ctx, 'j20');
  assert.equal(edit.success, true, JSON.stringify(edit.data?.qa?.errors || edit.error));
  const fb = edit.data.build.fallbacksUsed.map((f) => `${f.effect}:${f.using}`);
  if (plan.scenes.length > 1) assert.ok(fb.some((f) => f.startsWith('transition.glitch:jitter_flash') || f.startsWith('transition.wipe:slide_instead')), fb.join(','));
  assert.ok(fb.some((f) => f.startsWith('look.film_grain:none')));
  const qa = readJson(path.join(ctx.config.projectsDir, 'j20', 'QA_REPORT.json'));
  assert.ok(qa.fallbacks_used.length >= 2);
  assert.ok(qa.checks.EFFECT_CHECK.issues.length >= 2);
});

test('missing asset -> placeholder, QA blocks, plan error is actionable', { skip: !hasFfmpeg }, async () => {
  const { ctx, assets } = await project();
  const pp = path.join(ctx.config.projectsDir, 'j20', 'plan.json');
  const plan = readJson(pp);
  plan.scenes[0].clips[0].asset = 'IMG_DOES_NOT_EXIST';
  fs.writeFileSync(pp, JSON.stringify(plan));
  const bad = await validateProjectPlan(ctx, 'j20');
  assert.equal(bad.success, false);
  assert.match(bad.data.errors[0].message, /unknown asset "IMG_DOES_NOT_EXIST"/);
  const refused = await editProject(ctx, 'j20');
  assert.equal(refused.success, false);
  assert.match(refused.error, /plan is invalid/);

  // asset exists in the manifest but vanished from disk after scanning
  plan.scenes[0].clips[0].asset = 'IMG_MAP_CHINA';
  fs.writeFileSync(pp, JSON.stringify(plan));
  fs.unlinkSync(path.join(assets, 'images', 'map_china.jpg'));
  const r = await editProject(ctx, 'j20');
  assert.equal(r.success, false);
  const qa = readJson(path.join(ctx.config.projectsDir, 'j20', 'QA_REPORT.json'));
  assert.ok(qa.errors.some((e) => e.code === 'PLACEHOLDER_PRESENT' || e.code === 'ASSET_FILE_MISSING'), JSON.stringify(qa.errors.map((e) => e.code)));
  const rr = await renderProjectCmd(ctx, 'j20', {});
  assert.equal(rr.success, false);
  assert.equal(rr.code, 'QA_FAILED');
});

test('QA auto-repair: text pushed out of frame is moved back and the audio duck is restored', { skip: !hasFfmpeg }, async () => {
  const { ctx } = await project();
  const first = await editProject(ctx, 'j20');
  assert.equal(first.success, true, first.error);
  const { openBridge } = await import('../src/app/services.js');
  const { bridge } = await openBridge(ctx);
  // sabotage the project like a careless human would
  assert.equal((await bridge.call('set_property', { comp: 'COMP_SCENE_01', layer: 'TXT_TITLE_1', prop: 'position', value: [-400, 100] })).success, true);
  assert.equal((await bridge.call('keys_clear', { comp: 'COMP_MASTER', layer: 'NARR_MAIN', prop: 'audioLevels' })).success, true);
  const music = (await bridge.call('inspect', {})).data.items.find((i) => i.name === 'COMP_MASTER').layers.find((l) => l.name.startsWith('MUSIC_'));
  if (music) await bridge.call('keys_clear', { comp: 'COMP_MASTER', layer: music.name, prop: 'audioLevels' });
  const v = await verifyProject(ctx, 'j20');
  assert.equal(v.success, true, JSON.stringify(v.data?.errors || v.error));
  const actions = v.data.repairs.map((r) => r.code);
  assert.ok(actions.includes('TEXT_OUT_OF_FRAME'), actions.join());
  if (music) assert.ok(actions.includes('AUDIO_NOT_DUCKED'), actions.join());
  assert.ok(v.data.repairs.every((r) => r.success));
});

test('render with aerender + FFmpeg transcode, then verification of the real file', { skip: !hasFfmpeg }, async () => {
  const { ctx } = await project();
  assert.equal((await editProject(ctx, 'j20')).success, true);
  const preview = await renderProjectCmd(ctx, 'j20', { preview: true, range: '1:3' });
  assert.equal(preview.success, true, preview.error + JSON.stringify(preview.data?.verification));
  assert.match(preview.data.strategy, /aerender\+ffmpeg/);
  assert.ok(fs.existsSync(preview.data.output));
  assert.ok(preview.data.frames.length >= 1, 'preview frames extracted for visual review');

  const full = await renderProjectCmd(ctx, 'j20', {});
  assert.equal(full.success, true, full.error);
  const v = full.data.verification;
  assert.equal(v.passed, true, JSON.stringify(v.checks));
  assert.equal(v.probe.width, 1280); assert.equal(v.probe.height, 720);
  assert.equal(v.probe.videoCodec, 'h264'); assert.equal(v.probe.hasAudio, true);
  assert.ok(Math.abs(v.probe.duration - readJson(path.join(ctx.config.projectsDir, 'j20', 'plan.json')).scenes.at(-1).end) < 1);

  process.env.FAKE_AERENDER_FAIL = '1';
  const bad = await renderProjectCmd(ctx, 'j20', {});
  delete process.env.FAKE_AERENDER_FAIL;
  assert.equal(bad.success, false);
  assert.match(bad.error, /aerender failed/);
});

test('dry-run never touches the real project file', { skip: !hasFfmpeg }, async () => {
  const { ctx } = await project();
  const r = await editProject(ctx, 'j20', { dryRun: true });
  assert.equal(r.success, true, r.error);
  assert.equal(r.data.dryRun, true);
  assert.equal(fs.existsSync(path.join(ctx.config.projectsDir, 'j20', 'j20.aep')), false);
  assert.ok(fs.existsSync(path.join(ctx.config.projectsDir, 'j20', 'dryrun')));
});

test('detect works on this machine and reports honestly', async () => {
  const ctx = createContext({ cwd: tmpDir(), env: {}, overrides: { transport: 'mock' } });
  const r = await detect(ctx);
  assert.equal(r.success, true);
  const c = r.data.capabilities;
  assert.equal(typeof c.after_effects, 'boolean');
  assert.equal(c.node, true);
  assert.ok(c.os.platform);
});
