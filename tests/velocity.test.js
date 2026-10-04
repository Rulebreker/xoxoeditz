import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers/env.js';
import { curve, cubicBezier, CURVE_NAMES, EASINGS } from '../src/motion/curves.js';
import { makeRng } from '../src/core/rng.js';
import { VELOCITY_PROFILES, VELOCITY_PROFILE_IDS, profileForDials } from '../src/velocity/profiles.js';
import { speedAt, positionTable, posAt, sourceWindow, fitToSource, toTimeRemapKeys, progressCurve, mapDuration } from '../src/velocity/speedmap.js';
import { VelocityPlanner, buildSpeedMap, describeMap } from '../src/velocity/engine.js';
import { createMockAE } from '../src/bridge/mock-ae.js';

const seg = (dur, from, to, c = 'linear', extra = {}) => ({ dur, from, to, curve: c, ...extra });

test('curves: endpoints, monotonic easings, overshoot/anticipation/elastic/spring/impact behave as named', () => {
  for (const n of Object.keys(EASINGS)) {
    const f = curve(n);
    assert.ok(Math.abs(f(0)) < 1e-9 && Math.abs(f(1) - 1) < 1e-9, `${n} endpoints`);
    let prev = -1; for (let i = 0; i <= 100; i++) { const v = f(i / 100); assert.ok(v >= prev - 1e-9, `${n} monotonic`); prev = v; }
  }
  assert.ok(Math.max(...Array.from({ length: 101 }, (_, i) => curve('overshoot:0.15')(i / 100))) > 1.05, 'overshoots');
  assert.ok(Math.min(...Array.from({ length: 101 }, (_, i) => curve('anticipation:0.15')(i / 100))) < -0.02, 'pulls back first');
  assert.ok(Array.from({ length: 101 }, (_, i) => curve('elastic')(i / 100)).some((v) => v > 1.01), 'elastic rings');
  assert.ok(Math.abs(curve('spring')(1) - 1) < 1e-9);
  assert.ok(curve('impact')(0.18) > 1, 'impact snaps past the target then settles');
  assert.ok(Math.abs(curve('impact')(1) - 1) < 0.02);
  assert.ok(Math.abs(cubicBezier(0.25, 0.1, 0.25, 1)(0.5) - 0.8024) < 0.01, 'matches CSS "ease"');
  assert.ok(curve('bezier:0.2,0.8,0.2,1')(0.3) > 0.3);
  assert.ok(Math.abs(curve({ type: 'custom', points: [[0, 0], [0.5, 0.2], [1, 1]] })(0.25) - 0.1) < 1e-9);
  assert.ok(curve('ease-in-expo')(0.5) < 0.05 && curve('ease-out-expo')(0.5) > 0.95, 'exponential-like ramps');
  assert.throws(() => curve('ease-sideways'), /unknown curve/);
  assert.ok(CURVE_NAMES.length >= 18);
});

test('speed map integration: constant, linear ramp, freeze, reverse, window', () => {
  const t = (m, x) => posAt(positionTable(m), x);
  assert.ok(Math.abs(t({ segments: [seg(3, 2, 2)] }, 3) - 6) < 1e-6, '2x for 3s consumes 6s');
  assert.ok(Math.abs(t({ segments: [seg(2, 1, 3)] }, 2) - 4) < 0.01, 'linear 1x->3x over 2s consumes 4s');
  const frozen = { segments: [seg(1, 1, 1), seg(0.5, 0, 0, 'linear', { freeze: true }), seg(1, 1, 1)] };
  assert.ok(Math.abs(t(frozen, 1.5) - t(frozen, 1)) < 1e-6, 'freeze holds the frame');
  const rewind = { segments: [seg(1, 1, 1), seg(0.3, -1.5, -1.5), seg(1, 1, 1)] };
  assert.ok(t(rewind, 1.3) < t(rewind, 1) - 0.4, 'reverse moves backwards');
  const deep = { segments: [seg(1, 1, 1), seg(0.8, -2, -2), seg(1, 1, 1)] };
  const w = sourceWindow(deep); assert.ok(w.min < -0.5, 'the window reaches back before the first frame'); assert.ok(Math.abs(w.span - (w.max - w.min)) < 1e-9 && w.span > w.end + 0.5);
  assert.ok(Math.abs(speedAt({ segments: [seg(2, 1, 3)] }, 1) - 2) < 1e-6);
  const slowFast = { segments: [seg(1, 1, 1), seg(1, 1, 4, 'ease-in-expo')] };
  assert.ok(speedAt(slowFast, 1.5) < 2.5, 'expo ramp stays slow early in the ramp');
});

test('fitToSource preserves shape, refuses absurd slow-downs; time-remap keys are monotonic, in range, handled', () => {
  const m = { segments: [seg(1, 2, 2), seg(1, 2, 4, 'ease-out-expo')] };
  const fit = fitToSource(m, 3);
  assert.ok(fit.fits && fit.window.span <= 3.0001 && Math.abs(fit.k - 3 / sourceWindow(m).span) < 1e-6);
  assert.equal(fitToSource(m, 0.5, { minK: 0.45 }).fits, false);
  assert.equal(fitToSource(m, 100).k, 1);

  const { keys, clamped } = toTimeRemapKeys(fit.map, { fps: 24, srcStart: 1, clipDuration: 10, handleIn: 0.2, handleOut: 0.2 });
  assert.equal(keys[0].t, -0.2); assert.equal(keys.at(-1).t, 2.2);
  keys.forEach((k, i) => { if (i) { assert.ok(k.t > keys[i - 1].t, 'time strictly increasing'); assert.ok(k.src >= keys[i - 1].src - 1e-6, 'forward map never goes backwards'); } assert.ok(k.src >= 0 && k.src <= 10); });
  assert.equal(clamped, false);
  assert.ok(keys.length > 8 && keys.length < 60, `ramp sampled sparsely but densely enough (${keys.length})`);
  const tight = toTimeRemapKeys(m, { fps: 24, srcStart: 0, clipDuration: 2 });
  assert.equal(tight.clamped, true, 'positions beyond the clip are clamped and reported');
  const p = progressCurve({ segments: [seg(1, 0.5, 0.5), seg(1, 2, 2)] });
  assert.ok(p(0) === 0 && Math.abs(p(1) - 1) < 1e-9 && p(0.5) < 0.25, 'progress curve is slow then fast');
});

test('profiles: 11 exist; maps respect each profile\'s speed range', () => {
  assert.deepEqual(VELOCITY_PROFILE_IDS.sort(), ['VELOCITY_CAR', 'VELOCITY_CINEMATIC', 'VELOCITY_EDM', 'VELOCITY_HARD', 'VELOCITY_INSANE', 'VELOCITY_MEDIUM', 'VELOCITY_MILITARY', 'VELOCITY_PHONK', 'VELOCITY_SOFT', 'VELOCITY_SPORT', 'VELOCITY_TRAP'].sort());
  for (const id of VELOCITY_PROFILE_IDS) {
    const p = VELOCITY_PROFILES[id]; const rng = makeRng('range', id);
    for (let i = 0; i < 60; i++) {
      const want = rng.range(1, 3);
      const map = buildSpeedMap({ profile: p, pattern: rng.pick(p.patterns), duration: want, rng, fps: 24, shape: 1 });
      assert.ok(Math.abs(mapDuration(map) - want) < 1e-4, `${id}: map length ${mapDuration(map)} == slot ${want}`);
      for (const s of map.segments) if (!s.freeze && !s.reverse && !s.preImpact && !s.postImpact) for (const v of [s.from, s.to]) assert.ok(v >= p.minSpeed - 1e-6 && v <= p.maxSpeed + 1e-6, `${id} speed ${v} within [${p.minSpeed},${p.maxSpeed}]`);
    }
  }
});

test('HARD profile matches the spec shape: slow -> normal -> fast -> slow -> impact -> fast; impact has slowdown before and acceleration after', () => {
  const p = VELOCITY_PROFILES.VELOCITY_HARD;
  const map = buildSpeedMap({ profile: p, pattern: [0.35, 1, 2.5, 0.5, 'impact', 1.5], duration: 3, rng: makeRng('spec'), fps: 24, shape: 1, allowReverse: false });
  const plateaus = map.segments.filter((s) => Math.abs(s.from - s.to) < 1e-6 && !s.freeze).map((s) => s.from);
  assert.ok(plateaus[0] < 0.5 && plateaus.some((v) => v > 2) && plateaus.at(-1) > 1.2, `shape ${plateaus.map((v) => v.toFixed(2))}`);
  const fi = map.segments.findIndex((s) => s.freeze);
  assert.ok(fi > 0, 'there is an impact freeze');
  assert.ok(map.segments[fi - 1].to < map.segments[fi - 1].from, 'pre-impact slowdown');
  assert.ok(map.segments[fi + 1].from === 0 || map.segments[fi + 1].from < map.segments[fi + 1].to, 'post-impact acceleration from the freeze');
  assert.equal(map.impacts.length, 1);
  assert.ok(map.impacts[0] > 0.5 && map.impacts[0] < 2.8);
});

test('controlled variation: never the same pattern/curve twice in a row, many distinct maps, reproducible by seed', () => {
  const run = (seed) => { const pl = new VelocityPlanner({ profileId: 'VELOCITY_HARD', dials: { speedVariation: 0.8 }, rng: makeRng(seed), fps: 24 }); const out = []; for (let i = 0; i < 30; i++) out.push(pl.plan({ duration: 1.6, clip: { duration: 20 } })); return { out, pl }; };
  const a = run('s1'); const b = run('s1'); const c = run('s2');
  const pats = a.out.map((x) => x.patternId);
  pats.forEach((x, i) => { if (i) assert.notEqual(x, pats[i - 1], 'consecutive patterns differ'); });
  assert.ok(new Set(pats).size >= 3);
  assert.ok(new Set(a.pl.history.curves).size >= 3, `distinct curves ${[...new Set(a.pl.history.curves)]}`);
  assert.ok(new Set(a.pl.history.maps).size >= 28, 'practically every shot gets its own map');
  assert.deepEqual(a.pl.history.maps, b.pl.history.maps, 'same seed -> same edit');
  assert.notDeepEqual(a.pl.history.maps, c.pl.history.maps, 'different seed -> different edit');
  const curves = a.pl.history.curves; let repeats = 0; curves.forEach((x, i) => { if (i && x === curves[i - 1]) repeats++; });
  assert.ok(repeats <= curves.length * 0.1, `few consecutive repeated curves (${repeats}/${curves.length})`);
});

test('planner fits the source window inside the clip, with handles, and flags clips that are too short', () => {
  const pl = new VelocityPlanner({ profileId: 'VELOCITY_INSANE', dials: { speedVariation: 1 }, rng: makeRng('fit'), fps: 24 });
  for (let i = 0; i < 25; i++) {
    const clipDur = 4 + (i % 5);
    const r = pl.plan({ duration: 1.5, clip: { duration: clipDur }, handleIn: 0.15, handleOut: 0.15 });
    const lo = r.sourceIn + r.window.min - 0.15 * 1.5 * 0; const hi = r.sourceIn + r.window.max;
    assert.ok(lo >= -1e-6 && hi <= clipDur + 1e-6, `window ${lo.toFixed(2)}..${hi.toFixed(2)} inside 0..${clipDur}`);
    const { keys } = pl.keysFor(r, { srcClipDuration: clipDur, handleIn: 0.15, handleOut: 0.15 });
    assert.ok(keys.every((k) => k.src >= 0 && k.src <= clipDur));
  }
  const tiny = new VelocityPlanner({ profileId: 'VELOCITY_HARD', dials: { speedVariation: 1 }, rng: makeRng('tiny'), fps: 24 }).plan({ duration: 3, clip: { duration: 1 } });
  assert.equal(tiny.fits, false); assert.match(tiny.notes[0], /prefer a longer clip/);
});

test('profile character: INSANE varies far more than SOFT; dials pick sensible profiles', () => {
  const spread = (id) => { const pl = new VelocityPlanner({ profileId: id, dials: { speedVariation: 0.9 }, rng: makeRng('spread', id), fps: 24 }); let lo = 9; let hi = 0; let imp = 0; for (let i = 0; i < 40; i++) { const r = pl.plan({ duration: 2, clip: { duration: 30 } }); imp += r.map.impacts.length; for (const s of r.map.segments) if (!s.freeze && !s.reverse) { lo = Math.min(lo, s.from, s.to); hi = Math.max(hi, s.from, s.to); } } return { lo, hi, imp }; };
  const soft = spread('VELOCITY_SOFT'); const insane = spread('VELOCITY_INSANE');
  assert.ok(insane.hi - insane.lo > (soft.hi - soft.lo) * 2.5, `insane ${insane.lo.toFixed(2)}-${insane.hi.toFixed(2)} vs soft ${soft.lo.toFixed(2)}-${soft.hi.toFixed(2)}`);
  assert.ok(insane.imp > soft.imp);
  assert.equal(profileForDials({ velocity: 0.05, speedVariation: 0.1, cutFrequency: 0.1 }), 'VELOCITY_SOFT');
  assert.equal(profileForDials({ velocity: 0.95, speedVariation: 0.95, cutFrequency: 0.9 }), 'VELOCITY_INSANE');
  assert.equal(profileForDials({}, 'VELOCITY_PHONK'), 'VELOCITY_PHONK');
  assert.throws(() => new VelocityPlanner({ profileId: 'VELOCITY_NOPE', rng: makeRng(1) }), /unknown velocity profile/);
  const low = new VelocityPlanner({ profileId: 'VELOCITY_HARD', dials: { speedVariation: 0.1 }, rng: makeRng('lowvar'), fps: 24 });
  const lowMaps = Array.from({ length: 10 }, () => low.plan({ duration: 2, clip: { duration: 30 } }));
  const lowMax = Math.max(...lowMaps.flatMap((r) => r.map.segments.filter((s) => !s.freeze).map((s) => Math.max(s.from, s.to))));
  assert.ok(lowMax < 1.9, `low speedVariation keeps HARD gentle (max ${lowMax.toFixed(2)}x)`);
});

test('host time_remap (simulator): keys land on the layer, source time follows the integral; stills refused', () => {
  const mock = createMockAE();
  const dir = tmpDir(); fs.writeFileSync(path.join(dir, 'c.mp4'), 'x'); fs.writeFileSync(path.join(dir, 'p.jpg'), 'x');
  const call = (op, args) => mock.call({ id: 't', op, args });
  call('import_ensure', { path: path.join(dir, 'c.mp4'), name: 'VID_C' }); call('import_ensure', { path: path.join(dir, 'p.jpg'), name: 'IMG_P' });
  call('comp_ensure', { name: 'M', width: 1920, height: 1080, fps: 24, duration: 10 });
  call('layer_add_footage', { comp: 'M', item: 'VID_C', name: 'SHOT_1', start: 2, end: 4 });
  const map = { segments: [seg(0.5, 1, 1), seg(0.5, 1, 3, 'ease-in-out'), seg(1, 3, 3)] };
  const { keys } = toTimeRemapKeys(map, { fps: 24, srcStart: 2, clipDuration: 10 });
  const komp = keys.map((k) => ({ t: 2 + k.t, src: k.src }));
  const r = call('time_remap', { comp: 'M', layer: 'SHOT_1', keys: komp, start: 2, end: 4, frameBlend: 'pixel', motionBlur: true });
  assert.equal(r.success, true, r.error); assert.equal(r.data.numKeys, keys.length); assert.deepEqual(r.data.warnings, []);
  const layer = mock.app.project._items.find((i) => i.name === 'M').layer('SHOT_1');
  const tr = layer.property('ADBE Time Remapping');
  const tb = positionTable(map);
  for (const x of [0, 0.25, 0.5, 0.75, 1, 1.5, 1.9]) assert.ok(Math.abs(tr.valueAtTime(2 + x) - (2 + posAt(tb, x))) < 0.06, `source time at +${x}s`);
  assert.equal(layer.frameBlendingType, 4014); assert.equal(layer.motionBlur, true);
  assert.equal(layer.outPoint, 4);
  const still = call('layer_add_footage', { comp: 'M', item: 'IMG_P', name: 'STILL', start: 0, end: 2 });
  assert.equal(still.success, true);
  const bad = call('time_remap', { comp: 'M', layer: 'STILL', keys: [{ t: 0, src: 0 }] });
  assert.equal(bad.success, false); assert.equal(bad.code, 'UNSUPPORTED');
  const ins = call('inspect', {}).data.items.find((i) => i.name === 'M').layers.find((l) => l.name === 'SHOT_1');
  assert.equal(ins.timeRemapKeys, keys.length);
  const ro = call('layers_reorder', { comp: 'M', order: ['SHOT_1', 'STILL', 'GHOST'] });
  assert.deepEqual(ro.data, { moved: 2, missing: ['GHOST'] });
  assert.equal(mock.app.project._items.find((i) => i.name === 'M')._layers[0].name, 'STILL', 'last in the list ends on top');
});
