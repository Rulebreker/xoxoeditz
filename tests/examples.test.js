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
