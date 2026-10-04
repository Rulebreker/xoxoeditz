import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers/env.js';
import { hasFfmpeg, makeAssetFolder } from './helpers/media.js';
import { createContext, newProject, scanProject, editProject } from '../src/app/services.js';
import { validatePlan } from '../src/plan/schema.js';
import { resolveOutput } from '../src/plan/output.js';

test('output spec: resolutions, aspects, explicit sizes', () => {
  assert.deepEqual(pick(resolveOutput({})), [3840, 2160, 24]);
  assert.deepEqual(pick(resolveOutput({ resolution: '1080p' })), [1920, 1080, 24]);
  assert.deepEqual(pick(resolveOutput({ resolution: '1440p', fps: 30 })), [2560, 1440, 30]);
  assert.deepEqual(pick(resolveOutput({ resolution: '4k', aspect: '9:16' })), [2160, 3840, 24]);
  assert.deepEqual(pick(resolveOutput({ resolution: '1080p', aspect: 'vertical' })), [1080, 1920, 24]);
  assert.deepEqual(pick(resolveOutput({ resolution: '1080p', aspect: 'square' })), [1080, 1080, 24]);
  assert.deepEqual(pick(resolveOutput({ resolution: '4k', aspect: '2.39:1' })), [3840, 1606, 24]);
  assert.deepEqual(pick(resolveOutput({ width: 1000, height: 1001 })), [1000, 1002, 24]);
  assert.ok(resolveOutput({ resolution: 'banana' }).notes.length);
  function pick(o) { return [o.width, o.height, o.fps]; }
});

test('examples/plan.example.json is valid for the standard test assets and builds', { skip: !hasFfmpeg }, async () => {
  const root = tmpDir('xoxo-ex-');
  const assets = makeAssetFolder(path.join(root, 'assets'));
  const ctx = createContext({ cwd: root, env: {}, overrides: { transport: 'mock' } });
  await newProject(ctx, 'ex', { assets });
  const scan = await scanProject(ctx, 'ex');
  assert.equal(scan.success, true);
  const plan = JSON.parse(fs.readFileSync(path.resolve('examples/plan.example.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(ctx.config.projectsDir, 'ex', 'assets.manifest.json'), 'utf8'));
  const v = validatePlan(plan, { manifest });
  assert.deepEqual(v.errors, []);
  fs.writeFileSync(path.join(ctx.config.projectsDir, 'ex', 'plan.json'), JSON.stringify(plan));
  const r = await editProject(ctx, 'ex', { dryRun: true });
  assert.equal(r.success, true, JSON.stringify(r.data?.qa?.errors || r.error));
  assert.equal(r.data.build.errors.length, 0);
});

test('validator gives actionable errors', () => {
  const bad = { title: 'x', scenes: [
    { id: 'S01', start: 0, end: 5, clips: [{ asset: 'A', start: 0, end: 9, motion: 'spin' }], graphics: [{ kind: 'stat' }, { kind: 'map' }, { kind: 'sparkle' }] },
    { id: 'S01', start: 4, end: 10 }] };
  const v = validatePlan(bad, {});
  const msgs = v.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
  assert.match(msgs, /clip ends at 9s but scene is 5\.00s/);
  assert.match(msgs, /unknown motion "spin"/);
  assert.match(msgs, /stat needs a numeric "value"/);
  assert.match(msgs, /unknown graphic kind "sparkle"/);
  assert.match(msgs, /duplicate scene id S01/);
  assert.match(msgs, /overlaps previous scene/);
  assert.ok(v.warnings.some((w) => /not implemented/.test(w.message)));
  assert.equal(validatePlan(null).valid, false);
});

test('advanced ops: validated, comp substitution, runs idempotently in the build', { skip: !hasFfmpeg }, async () => {
  const { validatePlan: vp } = await import('../src/plan/schema.js');
  const bad = vp({ title: 't', scenes: [{ id: 'S01', start: 0, end: 5, advanced: [{ ops: [{ op: 'raw_eval', args: {} }, { op: 'nope', args: {} }] }, { ops: [] }] }] }, {});
  assert.equal(bad.errors.length, 3);
  const root = tmpDir('xoxo-adv-');
  const assets = makeAssetFolder(path.join(root, 'assets'));
  const ctx = createContext({ cwd: root, env: {}, overrides: { transport: 'mock' } });
  await newProject(ctx, 'adv', { assets }); await scanProject(ctx, 'adv');
  const plan = JSON.parse(fs.readFileSync(path.resolve('examples/plan.example.json'), 'utf8'));
  plan.scenes[0].advanced = [{ label: '3D camera', ops: [
    { op: 'layers_remove', args: { names: ['CAM_MAIN'] } },
    { op: 'layer_add_camera', args: { name: 'CAM_MAIN' } },
    { op: 'set_property', args: { layer: 'IMG_J20_FRONT', prop: 'opacity', value: 80 } },
    { op: 'layer_set', args: { layer: 'IMG_J20_FRONT', props: { blend: 'screen', threeD: true } } }] }];
  plan.advanced = [{ ops: [{ op: 'marker_add', args: { comp: '$MASTER', time: 1, comment: 'hello' } }] }];
  fs.writeFileSync(path.join(ctx.config.projectsDir, 'adv', 'plan.json'), JSON.stringify(plan));
  const r1 = await editProject(ctx, 'adv');
  assert.equal(r1.success, true, JSON.stringify(r1.data?.build?.errors || r1.error));
  const { openBridge } = await import('../src/app/services.js');
  const inspect = async () => (await (await openBridge(ctx)).bridge.call('inspect', {})).data.items.find((i) => i.name === 'COMP_SCENE_01');
  const a = await inspect();
  assert.equal(a.layers.filter((l) => l.name === 'CAM_MAIN').length, 1);
  assert.equal(a.layers.find((l) => l.name === 'IMG_J20_FRONT').threeD, true);
  await editProject(ctx, 'adv');
  const b = await inspect();
  assert.equal(b.layers.filter((l) => l.name === 'CAM_MAIN').length, 1, 'rebuild does not duplicate the camera');
});

test('install manifest records and removes what is written outside the repo', async () => {
  const { installBridge } = await import('../src/bridge/install.js');
  const { readInstallManifest, uninstallAll } = await import('../src/core/install-manifest.js');
  const { testConfig } = await import('./helpers/env.js');
  const cfg = testConfig();
  const startupDir = tmpDir('ae-startup-');
  const r = installBridge(cfg, { install: { startupDir }, startup: true });
  assert.equal(r.startup.ok, true);
  assert.equal(readInstallManifest(cfg).entries.length, 1);
  assert.ok(fs.existsSync(r.startup.file));
  const u = uninstallAll(cfg);
  assert.deepEqual(u.removed, [r.startup.file]);
  assert.equal(fs.existsSync(r.startup.file), false);
  assert.equal(readInstallManifest(cfg).entries.length, 0);
});
