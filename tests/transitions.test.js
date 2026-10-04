import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY, resolveEffect, resolveChain, describeCapabilities } from '../src/effects/registry.js';
import { TRANSITION_META, TRANSITION_TYPES, SHOT_TRANSITION_ENTRIES } from '../src/transitions/entries.js';
import { planTransitions, transitionQuality, transitionAlternatives } from '../src/transitions/engine.js';
import { LOOKS, LOOK_NAMES, lookParams, colorEffectId } from '../src/color/looks.js';
import { OPS_DOC } from '../src/bridge/ops-doc.js';
import { EDIT_TYPES } from '../src/edit-types/index.js';
import { STYLE_ALIASES } from '../src/director/config.js';
import { resolvePrimitive } from '../src/motion/primitives.js';

const NAMES = ['ADBE Motion Blur', 'CC Radial Fast Blur', 'ADBE Exposure2', 'ADBE Wave Warp', 'ADBE Turbulent Displace', 'ADBE Ramp', 'ADBE Linear Wipe', 'ADBE Tint', 'ADBE HUE SATURATION', 'ADBE Brightness & Contrast 2'];
const FULL = { effects: { known: true, byMatchName: Object.fromEntries(NAMES.map((n) => [n, { displayName: n }])) } };
const BARE = { effects: { known: true, byMatchName: {} } };
const UNKNOWN = { effects: { known: false, byMatchName: {} } };
const mkShots = (n, len = 2) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, start: i * len, end: (i + 1) * len }));
const ctx = (extra = {}) => ({ comp: 'MASTER', id: 'T01', incoming: 'B', outgoing: 'A', t: 5, d: 0.5, outAt: 1.75, inAt: 0, w: 3840, h: 2160, fps: 24, dir: 0, strength: 0.5, ...extra });

test('every shot transition resolves on any machine - the last link in each chain needs nothing', () => {
  for (const type of TRANSITION_TYPES) {
    const id = TRANSITION_META[type].effectId;
    assert.ok(REGISTRY[id], `${type}: ${id} registered`);
    const last = [...REGISTRY[id].implementations].sort((a, b) => b.quality - a.quality).pop();
    assert.deepEqual(last.requires, {}, `${type}: last implementation "${last.id}" must need nothing`);
    for (const [label, caps] of [['full', FULL], ['bare', BARE], ['unknown', UNKNOWN], ['none', null]]) {
      const r = resolveEffect(id, caps); assert.ok(!r.unavailable && r.build, `${type} on ${label}`);
    }
  }
  assert.equal(describeCapabilities(FULL).filter((d) => d.id.startsWith('shot.transition.')).length, TRANSITION_TYPES.length);
});

test('capability fallbacks are honest: full -> effect version, bare -> no-effect version (flagged degraded), cut never degrades', () => {
  const whipFull = resolveEffect('shot.transition.whip', FULL); const whipBare = resolveEffect('shot.transition.whip', BARE);
  assert.equal(whipFull.implementation, 'whip_directional_blur'); assert.equal(whipFull.degraded, false);
  assert.equal(whipBare.implementation, 'whip_layer_motion_blur'); assert.equal(whipBare.degraded, true); assert.ok(whipBare.skipped.some((s) => /Directional Blur/.test(s.reason)));
  assert.equal(resolveEffect('shot.transition.mask', BARE).implementation, 'matte_slide');
  assert.equal(resolveEffect('shot.transition.glitch', BARE).implementation, 'glitch_jitter_flash');
  assert.equal(resolveEffect('shot.transition.cut', null).degraded, false);
  assert.equal(resolveEffect('shot.transition.nope', FULL).id, 'shot.transition.dissolve', 'an unknown shot transition falls back to a dissolve');
  assert.ok(transitionQuality('whip', FULL) > transitionQuality('whip', BARE) && transitionQuality('cut', null) === 1);
});

test('every implementation builds valid ops: known host ops only, real layer names, numeric times inside the window, motion that resolves', () => {
  const known = new Set(Object.keys(OPS_DOC));
  for (const type of TRANSITION_TYPES) {
    for (const caps of [FULL, BARE]) {
      for (const impl of resolveChain(TRANSITION_META[type].effectId, caps).chain) {
        for (const withOut of [true, false]) {
          const c = ctx(withOut ? { overlayAsset: 'leak.mp4' } : { outgoing: null, overlayAsset: null });
          const ops = impl.build(c, impl.resolved);
          for (const [name, args] of ops) {
            assert.ok(known.has(name), `${type}/${impl.id}: unknown op "${name}"`); assert.equal(args.comp, 'MASTER');
            if (args.layer) assert.ok(args.layer === 'A' || args.layer === 'B' || args.layer.startsWith('FX_T01_'), `${type}/${impl.id}: layer ${args.layer}`);
            if (!withOut) assert.notEqual(args.layer, 'A', `${type}/${impl.id} touches a missing outgoing layer`);
            for (const k of args.keys || []) { assert.ok(Number.isFinite(k.t) && k.t >= 5 - 1e-9 && k.t <= 5.5 + 1e-9, `${type}/${impl.id}: key time ${k.t} outside the transition window`); }
          }
          const m = impl.motion(c); for (const s of [...m.outgoing, ...m.incoming]) assert.doesNotThrow(() => resolvePrimitive(s, 3), `${type}/${impl.id}/${s.type}`);
          assert.ok(Array.isArray(m.outgoing) && Array.isArray(m.incoming));
        }
      }
    }
  }
});

test('motion transitions pair up: whips/pushes move the two shots in opposite senses and finish exactly at the window end', () => {
  const c = ctx({ d: 0.4, outAt: 1.8, inAt: 0 });
  for (const id of ['shot.transition.whip', 'shot.transition.push', 'shot.transition.motion_blur']) {
    const m = resolveChain(id, FULL).chain[0].motion(c);
    assert.ok(m.outgoing.length && m.incoming.length, id);
    const o = m.outgoing[0]; const i = m.incoming[0];
    assert.equal(o.mode, 'out'); assert.equal(i.mode, 'in'); assert.equal(o.dir, i.dir);
    // whip: the outgoing shot is gone by mid-window; push / swish: both shots travel through the whole window together
    const outEnd = id.includes('whip') ? c.outAt + c.d / 2 : c.outAt + c.d;
    assert.ok(Math.abs(o.at + o.dur - outEnd) < 1e-9, `${id}: outgoing finishes at ${outEnd}, not ${o.at + o.dur}`);
    assert.ok(Math.abs(i.at + i.dur - (c.inAt + c.d)) < 1e-9, `${id}: incoming settles at the window end`);
  }
  const push = resolveChain('shot.transition.push', FULL).chain[0].motion(c);
  assert.equal(push.outgoing[0].amount, 1); assert.equal(push.incoming[0].amount, 1);
});

test('planner: respects the palette, never repeats, alternates direction, is reproducible, and varies with the seed', () => {
  const shots = mkShots(25, 2);
  const run = (seed, type = 'velocity') => planTransitions(shots, { editType: EDIT_TYPES[type], caps: FULL, seed, bpm: 128, fps: 24 });
  const a = run('a'); assert.equal(a.length, 24);
  const palette = new Set(EDIT_TYPES.velocity.transitions.palette.map((p) => p.type));
  for (const e of a) assert.ok(palette.has(e.type), `${e.type} is not in the velocity palette`);
  const types = a.map((e) => e.type); const nonCut = a.filter((e) => e.type !== 'cut');
  for (let i = 2; i < a.length; i++) assert.ok(!(types[i] !== 'cut' && types[i] === types[i - 1] && types[i] === types[i - 2]), `3x ${types[i]} in a row`);
  assert.ok(new Set(nonCut.map((e) => e.type)).size >= 3, `distinct transitions: ${[...new Set(types)]}`);
  assert.ok(types.filter((t) => t === 'cut').length >= 2 && nonCut.length >= 8, 'velocity mixes hard cuts and transitions');
  assert.deepEqual(run('a').map((e) => e.type), types, 'same seed -> same plan'); assert.notDeepEqual(run('b').map((e) => e.type), types);
  assert.deepEqual(a.map((e) => e.dir).slice(0, 4), [0, 180, 0, 180]);
  // shot-relative clocks: shot 0 starts at 0, so its window starts at (cut - d/2); later shots started d/2 earlier
  assert.ok(Math.abs(a[0].outAt - (a[0].window.start - 0)) < 1e-3); assert.ok(Math.abs(a[1].outAt - (a[1].window.start - (shots[1].start - a[0].d / 2))) < 1e-3);
  const doc = planTransitions(shots, { editType: EDIT_TYPES.documentary, caps: FULL, seed: 'a', bpm: 90 });
  assert.ok(doc.filter((e) => e.type === 'dissolve' || e.type === 'cut').length >= doc.length * 0.7, 'documentary is dissolves and cuts');
  assert.ok(doc.filter((e) => ['whip', 'glitch', 'zoom'].includes(e.type)).length === 0, 'no whips in a documentary');
});

test('planner: lengths follow the tempo, are frame-snapped, fit inside short shots, and windows are centred on the cut', () => {
  const fast = planTransitions(mkShots(12, 2), { editType: EDIT_TYPES.velocity, caps: FULL, seed: 'd', bpm: 150, fps: 24 }).filter((e) => e.type !== 'cut');
  const slow = planTransitions(mkShots(12, 2), { editType: EDIT_TYPES.velocity, caps: FULL, seed: 'd', bpm: 75, fps: 24 }).filter((e) => e.type !== 'cut');
  const avg = (l) => l.reduce((x, e) => x + e.d, 0) / l.length;
  assert.ok(avg(slow) > avg(fast) * 1.5, `slower tempo -> longer transitions (${avg(slow)} vs ${avg(fast)})`);
  for (const e of fast.concat(slow)) { assert.ok(Math.abs(e.d * 24 - Math.round(e.d * 24)) < 1e-6, `${e.d} is frame-snapped`); assert.ok(e.d >= 3 / 24 - 1e-9); assert.ok(Math.abs((e.window.start + e.window.end) / 2 - e.cut) < 1e-3); }
  const tiny = planTransitions(mkShots(8, 0.5), { editType: EDIT_TYPES.velocity, caps: FULL, seed: 'e', bpm: 100, fps: 24 });
  for (const e of tiny) assert.ok(e.d <= 0.5 * 0.5 + 1e-9, `${e.type} d=${e.d} must fit a 0.5 s shot`);
  assert.ok(tiny.every((e) => e.type === 'cut' || TRANSITION_META[e.type].minShot <= 0.5), 'transitions that need long shots are not used on 0.5 s shots');
});

test('planner: chapter changes get a distinct transition; capabilities steer the choice; forced types win; noTransitions means cuts', () => {
  const shots = mkShots(10, 3);
  const ch = planTransitions(shots, { editType: EDIT_TYPES.cinematic, caps: FULL, seed: 'c', bpm: 80, chapters: [3, 6] });
  for (const i of [3, 6]) { assert.notEqual(ch[i].type, 'cut'); assert.ok(ch[i].notes.includes('chapter change')); }
  const bare = planTransitions(mkShots(40, 2), { editType: EDIT_TYPES.velocity, caps: BARE, seed: 'q', bpm: 128 });
  const full = planTransitions(mkShots(40, 2), { editType: EDIT_TYPES.velocity, caps: FULL, seed: 'q', bpm: 128 });
  const q = (l) => l.filter((e) => e.type !== 'cut').reduce((x, e) => x + e.quality, 0) / l.filter((e) => e.type !== 'cut').length;
  assert.ok(q(full) > q(bare), `full machine averages better implementations (${q(full)} vs ${q(bare)})`);
  assert.ok(bare.filter((e) => e.degraded).every((e) => e.notes.some((n) => /running as/.test(n))), 'every degraded transition says so');
  const forced = planTransitions(mkShots(4, 2), { editType: EDIT_TYPES.velocity, caps: FULL, seed: 'f', force: { 1: 'glitch' } }); assert.equal(forced[1].type, 'glitch');
  assert.ok(planTransitions(mkShots(6, 2), { editType: EDIT_TYPES.velocity, caps: FULL, noTransitions: true }).every((e) => e.type === 'cut' && e.d === 0 && e.motion.outgoing.length === 0));
  const leak = planTransitions(mkShots(60, 3), { editType: EDIT_TYPES.cinematic, caps: FULL, seed: 'l', bpm: 80, overlayAssets: ['leak.mp4'], chapters: [] });
  assert.ok(leak.some((e) => e.type === 'light_leak' && e.overlayAsset === 'leak.mp4'), 'a supplied light-leak overlay is used');
});

test('planner output wires into ops: alternatives are ordered best-first and the cut has none', () => {
  const shots = mkShots(6, 2); const plan = planTransitions(shots, { editType: EDIT_TYPES.velocity, caps: FULL, seed: 'ops', bpm: 128, force: { 0: 'whip', 1: 'cut', 2: 'flash' } });
  const alt = transitionAlternatives(plan[0], FULL, { comp: 'MASTER', incoming: 'B', outgoing: 'A', w: 3840, h: 2160, fps: 24 });
  assert.ok(alt.length >= 2 && alt[0].quality > alt[1].quality && alt[0].ops.length > 0 && alt.at(-1).name === 'dissolve_instead');
  assert.deepEqual(transitionAlternatives(plan[1], FULL, { comp: 'MASTER', incoming: 'B', outgoing: 'A' }), [{ name: 'cut', quality: 1, ops: [] }]);
  const flash = transitionAlternatives(plan[2], FULL, { comp: 'MASTER', incoming: 'B', outgoing: 'A', w: 3840, h: 2160, fps: 24 });
  assert.ok(flash[0].ops.some(([n, a]) => n === 'layer_add_solid' && a.blend === 'add'));
  assert.ok(plan[0].sfx.role === 'whip' && plan[2].sfx.role === 'hit', 'each transition names the SFX role the sound designer should look for');
});

test('colour engine: nine looks, every edit-type and style alias resolves, fallbacks degrade to nothing, strength scales the look', () => {
  assert.equal(LOOK_NAMES.length, 9);
  for (const n of ['CINEMATIC', 'MILITARY', 'AUTOMOTIVE', 'TECH', 'DARK', 'VIBRANT', 'DOCUMENTARY', 'CLEAN', 'PREMIUM']) assert.ok(LOOKS[n] && REGISTRY[colorEffectId(n)], n);
  for (const [id, t] of Object.entries(EDIT_TYPES)) assert.ok(REGISTRY[colorEffectId(t.color)], `edit type ${id} -> colour ${t.color}`);
  for (const [alias, id] of Object.entries(STYLE_ALIASES)) assert.ok(REGISTRY[colorEffectId(id)], `style alias ${alias} -> ${id}`);
  const full = resolveEffect('color.MILITARY', FULL); const bare = resolveEffect('color.MILITARY', BARE);
  assert.equal(full.implementation, 'grade_full'); assert.equal(bare.implementation, 'none'); assert.equal(bare.degraded, true);
  const ops = full.build({ comp: 'MASTER', layer: 'ADJ_GRADE', strength: 0.5 }, full.resolved); assert.equal(ops.length, 3);
  assert.ok(ops.every(([n, a]) => n === 'layer_effect_add' && a.tag === 'grade' && a.layer === 'ADJ_GRADE'));
  assert.deepEqual(resolveEffect('color.MILITARY', { effects: { known: true, byMatchName: { 'ADBE Tint': {} } } }).implementation, 'grade_tint');
  const lo = lookParams('VIBRANT', 0.2); const hi = lookParams('VIBRANT', 0.9); assert.ok(hi.sat > lo.sat && lo.sat > 0); assert.equal(lookParams('VIBRANT', 0).sat, 0);
  assert.ok(lookParams('MILITARY', 0.6).sat < 0 && lookParams('DARK', 0.6).brightness < 0 && lookParams('CLEAN', 0.6).brightness > 0);
  assert.throws(() => lookParams('SEPIA'), /unknown colour look/);
  assert.ok(new Set(LOOK_NAMES.map((n) => `${LOOKS[n].shadow}|${LOOKS[n].highlight}|${LOOKS[n].sat}`)).size === 9, 'looks are visibly distinct, not copies');
});
void SHOT_TRANSITION_ENTRIES;
