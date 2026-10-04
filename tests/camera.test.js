import test from 'node:test';
import assert from 'node:assert/strict';
import { PRIMITIVES, PRIMITIVE_NAMES, sampleMotion, frameTimes, requiredCover, simplify, resolvePrimitive } from '../src/motion/primitives.js';
import { buildCameraTrack, verifyCoverage } from '../src/camera/track.js';
import { RIGS, RIG_NAMES, CameraPlanner, getRig, LEGACY } from '../src/camera/rigs.js';
import { planParallax, paddedSubject } from '../src/camera/parallax.js';
import { EDIT_TYPES } from '../src/edit-types/index.js';

const COMP = { w: 3840, h: 2160 }; const SRC = { w: 3840, h: 2160 }; const FPS = 24;
const at = (specs, t, dur = 2) => sampleMotion(specs, [t], { shotDur: dur })[0];

test('primitives: every primitive is defined, deterministic and starts/ends where it says', () => {
  assert.equal(PRIMITIVE_NAMES.length, 14);
  for (const n of ['PUSH', 'PULL', 'DRIFT', 'ORBIT', 'PAN', 'TILT', 'WHIP', 'SHAKE', 'BOUNCE', 'IMPACT', 'REVEAL', 'FOLLOW', 'TRACK', 'PARALLAX']) assert.ok(PRIMITIVES[n], n);
  const p0 = at([{ type: 'PUSH', amount: 0.2 }], 0); const p1 = at([{ type: 'PUSH', amount: 0.2 }], 2);
  assert.equal(p0.s, 1); assert.ok(Math.abs(p1.s - 1.2) < 1e-9);
  const pl0 = at([{ type: 'PULL', amount: 0.2 }], 0); const pl1 = at([{ type: 'PULL', amount: 0.2 }], 2);
  assert.ok(Math.abs(pl0.s - 1.2) < 1e-9 && pl1.s === 1);
  const pan = [at([{ type: 'PAN', amount: 0.1, dir: 0 }], 0), at([{ type: 'PAN', amount: 0.1, dir: 0 }], 2)];
  assert.ok(pan[0].x > 0 && pan[1].x < 0, 'camera right = picture slides left');
  const specs = [{ type: 'SHAKE', amount: 0.01, freq: 10, seed: 5 }]; const a = sampleMotion(specs, frameTimes(1, FPS), { shotDur: 1 }); const b = sampleMotion(specs, frameTimes(1, FPS), { shotDur: 1 });
  assert.deepEqual(a, b, 'shake is seeded, never random per call');
  const c = sampleMotion([{ type: 'SHAKE', amount: 0.01, freq: 10, seed: 6 }], frameTimes(1, FPS), { shotDur: 1 });
  assert.notDeepEqual(a.map((q) => q.x), c.map((q) => q.x), 'a different seed gives a different shake');
  assert.throws(() => resolvePrimitive({ type: 'PUHS' }, 1), /unknown motion primitive "PUHS"/);
});

test('primitives: decaying shake and impacts die out; whip arrives and settles; focus keeps the focus point fixed', () => {
  const sh = sampleMotion([{ type: 'SHAKE', amount: 0.02, decay: 1, dur: 0.5 }], frameTimes(1, 48), { shotDur: 1 });
  const early = Math.max(...sh.filter((q) => q.t < 0.15).map((q) => Math.abs(q.x))); const late = Math.max(...sh.filter((q) => q.t > 0.45).map((q) => Math.abs(q.x)));
  assert.ok(early > 0.004 && late < early * 0.2, `decay ${early} -> ${late}`); assert.equal(sh[sh.length - 1].x, 0, 'nothing after the shake window');
  const im = sampleMotion([{ type: 'IMPACT', at: 0.5, amount: 0.08 }], frameTimes(1.5, 48), { shotDur: 1.5 });
  assert.equal(im.find((q) => q.t < 0.49).s, 1, 'no punch before the beat'); assert.ok(im.find((q) => Math.abs(q.t - 0.5) < 0.011).s > 1.07, 'instant punch on the beat'); assert.ok(im[im.length - 1].s < 1.001, 'settled');
  const wi = sampleMotion([{ type: 'WHIP', mode: 'in', dur: 0.2, amount: 0.5, dir: 0 }], [0, 0.1, 0.2, 1], { shotDur: 1 });
  assert.ok(wi[0].x > 0.45 && wi[2].x < 0.001 && wi[3].x === 0 && wi[1].x < wi[0].x * 0.5, 'whip-in: starts off-axis, most of the travel in the first half (expo)');
  const focus = { x: 0.8, y: 0.3 }; const q = at([{ type: 'PUSH', amount: 0.3, focus }], 2);
  // a point at the focus keeps its screen position: focus_offset*s + translation == focus_offset
  assert.ok(Math.abs((focus.x - 0.5) * q.s + q.x - (focus.x - 0.5)) < 1e-9 && Math.abs((focus.y - 0.5) * q.s + q.y - (focus.y - 0.5)) < 1e-9);
  const fo = at([{ type: 'FOLLOW', amount: 0.1, subject: { x: 0.7, y: 0.5 }, strength: 0.6 }], 2);
  assert.ok(fo.x < 0 && Math.abs(fo.x - -0.12) < 1e-9, 'subject on the right -> picture slides left to centre it');
  const path = [{ t: 0, x: 0.3, y: 0.5 }, { t: 2, x: 0.7, y: 0.5 }]; const tr = sampleMotion([{ type: 'TRACK', path, amount: 0.05 }], [0, 1, 2], { shotDur: 2 });
  assert.ok(tr[0].x > 0 && tr[2].x < 0 && tr[0].x > tr[1].x && tr[1].x > tr[2].x, 'tracking follows the subject across the frame');
});

test('composition: primitives stack into ONE track - offsets add, scales multiply', () => {
  const t = 1; const solo = (s) => at([s], t, 2);
  const stack = at([{ type: 'PUSH', amount: 0.1 }, { type: 'PAN', amount: 0.1 }, { type: 'PUSH', amount: 0.2 }], t, 2);
  assert.ok(Math.abs(stack.s - solo({ type: 'PUSH', amount: 0.1 }).s * solo({ type: 'PUSH', amount: 0.2 }).s) < 1e-12);
  assert.ok(Math.abs(stack.x - solo({ type: 'PAN', amount: 0.1 }).x) < 1e-12);
});

test('track: the picture ALWAYS covers the comp, whatever the stack (fuzz over primitives, sizes and aspects)', () => {
  const cases = [
    [{ type: 'PAN', amount: 0.3, dir: 0 }], [{ type: 'TILT', amount: 0.3 }], [{ type: 'DRIFT', amount: 0.3, dir: 45 }], [{ type: 'ORBIT', amount: 0.2, roll: 4 }],
    [{ type: 'SHAKE', amount: 0.05, roll: 60 }], [{ type: 'IMPACT', at: 0.3, amount: 0.2, roll: 3 }], [{ type: 'WHIP', mode: 'out', at: 1.7, dur: 0.3, amount: 0.8 }],
    [{ type: 'PUSH', amount: 0.3 }, { type: 'SHAKE', amount: 0.03 }, { type: 'WHIP', mode: 'in', dur: 0.2, amount: 0.6 }],
  ];
  const geos = [[COMP, SRC], [COMP, { w: 1920, h: 1080 }], [{ w: 1080, h: 1920 }, { w: 3840, h: 2160 }], [{ w: 1920, h: 1080 }, { w: 3000, h: 3000 }], [{ w: 1920, h: 1080 }, { w: 1600, h: 1200 }]];
  for (const specs of cases) for (const [comp, asset] of geos) {
    const tr = buildCameraTrack({ specs, comp, asset, dur: 2, fps: FPS, maxLift: 1.3 });
    assert.ok(tr.lift <= 1.3 * 1.01 + 0.0001 || tr.amplitude < 1, `${specs[0].type} lift ${tr.lift}`);
    const worst = verifyCoverage(tr, { comp, asset, fps: FPS });
    assert.ok(worst < 0.002, `${specs.map((s) => s.type)} ${comp.w}x${comp.h} <- ${asset.w}x${asset.h}: uncovered ${worst}`);
  }
});

test('track: amplitude is reduced to respect the overscan cap and says so; small moves are untouched; keys stay few', () => {
  const big = buildCameraTrack({ specs: [{ type: 'WHIP', mode: 'in', dur: 0.2, amount: 0.9 }], comp: COMP, asset: SRC, dur: 1.5, fps: FPS, maxLift: 1.15 });
  assert.ok(big.amplitude < 0.5 && big.lift <= 1.16 && big.warnings.some((w) => /amplitude reduced/.test(w)));
  const small = buildCameraTrack({ specs: [{ type: 'PUSH', amount: 0.08 }], comp: COMP, asset: SRC, dur: 3, fps: FPS });
  assert.equal(small.amplitude, 1); assert.equal(small.lift, 1.002); assert.deepEqual(small.warnings, []);
  assert.ok(small.keys <= 14, `an eased push needs few keys (${small.keys})`); assert.equal(small.rotation, null, 'no rotation track when there is no roll');
  const busy = buildCameraTrack({ specs: [{ type: 'SHAKE', amount: 0.02, freq: 12, roll: 40 }], comp: COMP, asset: SRC, dur: 6, fps: FPS, maxKeys: 40, maxLift: 1.5 });
  assert.ok(busy.keys <= 40 && busy.rotation, `${busy.keys} keys`);
  // times are absolute and ascending; values are AE units (percent, pixels)
  const t = buildCameraTrack({ specs: [{ type: 'PUSH', amount: 0.1 }, { type: 'PAN', amount: 0.05 }], comp: COMP, asset: SRC, t0: 10, dur: 2, fps: FPS });
  assert.equal(t.scale[0].t, 10); assert.equal(t.scale[t.scale.length - 1].t, 12); assert.ok(t.scale[0].v[0] >= 100 && t.position[0].v[0] > 1000);
  for (let i = 1; i < t.scale.length; i++) assert.ok(t.scale[i].t > t.scale[i - 1].t);
});

test('track: source size drives overscan and resolution warnings; motion-blur is recommended only for fast moves', () => {
  const unknown = buildCameraTrack({ specs: [{ type: 'PAN', amount: 0.1 }], comp: COMP, asset: null, dur: 2, fps: FPS });
  assert.ok(unknown.warnings.some((w) => /source size unknown/.test(w)));
  const soft = buildCameraTrack({ specs: [{ type: 'PUSH', amount: 0.4 }], comp: COMP, asset: { w: 1280, h: 720 }, dur: 2, fps: FPS });
  assert.ok(soft.upscale > 1.5 && soft.warnings.some((w) => /magnified/.test(w)));
  const sharp = buildCameraTrack({ specs: [{ type: 'PUSH', amount: 0.4 }], comp: { w: 1920, h: 1080 }, asset: SRC, dur: 2, fps: FPS });
  assert.ok(sharp.upscale < 1, '4K source into a 1080p comp has headroom for a 40% push');
  assert.equal(buildCameraTrack({ specs: [{ type: 'DRIFT', amount: 0.05 }], comp: COMP, asset: SRC, dur: 4, fps: FPS }).motionBlur, false);
  assert.equal(buildCameraTrack({ specs: [{ type: 'WHIP', mode: 'in', dur: 0.18, amount: 0.4 }], comp: COMP, asset: SRC, dur: 1, fps: FPS, maxLift: 1.5 }).motionBlur, true);
});

test('rigs: five rigs exist, every edit-type camera rig resolves, and every move builds valid primitives', () => {
  assert.deepEqual(RIG_NAMES.sort(), ['CAMERA_ACTION', 'CAMERA_CINEMATIC', 'CAMERA_DOCUMENTARY', 'CAMERA_PRODUCT', 'CAMERA_VELOCITY']);
  for (const [id, t] of Object.entries(EDIT_TYPES)) assert.doesNotThrow(() => getRig(t.camera.rig), `edit type ${id} -> ${t.camera?.rig}`);
  assert.throws(() => getRig('CAMERA_NOPE'), /unknown camera rig/);
  const subject = { x: 0.55, y: 0.3, w: 0.2, h: 0.35, conf: 0.6 };
  for (const rigId of RIG_NAMES) {
    const planner = new CameraPlanner({ rig: rigId, seed: 'valid', avoid: 0 });
    for (let i = 0; i < 40; i++) {
      const shot = { dur: 0.8 + (i % 7) * 0.7, hasNext: i % 3 !== 0, impacts: i % 2 ? [0.3, 0.45, 0.9] : [], subject: i % 4 ? subject : null, intensity: (i % 5) / 4, isPortrait: i % 6 === 0, index: i };
      const p = planner.plan(shot);
      assert.ok(p.specs.length, `${rigId}/${p.move} produced no motion`);
      for (const s of p.specs) { assert.doesNotThrow(() => resolvePrimitive(s, shot.dur), `${rigId}/${p.move}/${s.type}`); assert.ok(s.amount === undefined || (s.amount >= 0 && s.amount <= 1.5), `${p.move} amount ${s.amount}`); }
      const tr = buildCameraTrack({ specs: p.specs, comp: COMP, asset: SRC, dur: shot.dur, fps: FPS, maxLift: p.maxLift });
      assert.ok(verifyCoverage(tr, { comp: COMP, asset: SRC, fps: FPS }) < 0.002, `${rigId}/${p.move} dur ${shot.dur}`);
    }
  }
});

test('rigs: a run of shots varies - no back-to-back repeats, several families, alternating direction; reproducible per seed', () => {
  const run = (rig, seed, n = 14) => { const p = new CameraPlanner({ rig, seed, intensity: 0.7 }); return Array.from({ length: n }, (_, i) => p.plan({ dur: 1.2 + (i % 4) * 0.6, index: i, hasNext: true, impacts: i % 2 ? [0.4] : [], subject: { x: 0.4, y: 0.3, w: 0.2, h: 0.3, conf: 0.5 } })); };
  for (const rig of RIG_NAMES) {
    const plans = run(rig, 'v'); const names = plans.map((p) => p.move);
    for (let i = 1; i < names.length; i++) assert.notEqual(names[i], names[i - 1], `${rig}: "${names[i]}" repeated at ${i}`);
    assert.ok(new Set(names).size >= 4, `${rig}: ${new Set(names).size} distinct moves in 14 shots (${names})`);
    assert.ok(new Set(plans.map((p) => p.family)).size >= 3, `${rig}: families ${[...new Set(plans.map((p) => p.family))]}`);
    assert.deepEqual(run(rig, 'v').map((p) => p.move), names, 'same seed, same camera plan');
  }
  assert.notDeepEqual(run('CAMERA_VELOCITY', 'a').map((p) => p.move), run('CAMERA_VELOCITY', 'b').map((p) => p.move), 'a different seed gives a different plan');
  const signs = run('CAMERA_CINEMATIC', 's').map((p) => p.sign); assert.ok(signs.every((s, i) => !i || s !== signs[i - 1]), 'direction alternates');
});

test('rigs: personalities differ - velocity is bigger and faster than documentary; documentary and product never shake; beat impacts become camera hits', () => {
  const avg = (rig) => { const p = new CameraPlanner({ rig, seed: 'amt', intensity: 0.6 }); const a = Array.from({ length: 10 }, () => p.plan({ dur: 2 }).amount); return a.reduce((x, y) => x + y) / a.length; };
  assert.ok(avg('CAMERA_VELOCITY') > avg('CAMERA_DOCUMENTARY') * 1.8 && avg('CAMERA_ACTION') > avg('CAMERA_CINEMATIC') * 1.8);
  for (const rig of ['CAMERA_DOCUMENTARY', 'CAMERA_PRODUCT']) { const p = new CameraPlanner({ rig, seed: 'calm' }); for (let i = 0; i < 30; i++) assert.ok(!p.plan({ dur: 3, intensity: 1, index: i, impacts: [] }).specs.some((s) => s.type === 'SHAKE' || s.type === 'WHIP'), rig); }
  const hits = new CameraPlanner({ rig: 'CAMERA_VELOCITY', seed: 'h', intensity: 0.8 }).plan({ dur: 3, impacts: [0.5, 0.6, 1.5, 2, 2.4] }).specs.filter((s) => s.tag === 'beat');
  assert.ok(hits.length >= 2 && hits.length <= 3, `${hits.length} hits`); assert.ok(hits.every((h, i) => !i || h.at - hits[i - 1].at >= 0.25), 'hits are spaced');
  assert.ok(hits.every((h) => h.at >= 0 && h.at < 3));
  const calm = new CameraPlanner({ rig: 'CAMERA_DOCUMENTARY', seed: 'h' }).plan({ dur: 3, impacts: [0.5, 1.5] }).specs.filter((s) => s.tag === 'beat');
  assert.ok(calm.every((c) => c.amount < hits[0].amount), 'documentary hits are gentler than velocity hits');
});

test('rigs: subject-aware framing; explicit overrides always win; no whip on the first shot', () => {
  const subj = { x: 0.6, y: 0.2, w: 0.2, h: 0.3, conf: 0.8 };
  const follow = new CameraPlanner({ rig: 'CAMERA_DOCUMENTARY', seed: 'f' }); const picks = Array.from({ length: 12 }, (_, i) => follow.plan({ dur: 4, subject: subj, index: i }).move);
  assert.ok(picks.includes('follow'), 'a documentary shot with a clear subject follows it'); assert.ok(!new CameraPlanner({ rig: 'CAMERA_DOCUMENTARY', seed: 'f' }).plan({ dur: 4, subject: null, index: 0 }).move.includes('follow'));
  const ov = new CameraPlanner({ rig: 'CAMERA_VELOCITY', seed: 'o' }).plan({ dur: 2, motion: 'pan_left', impacts: [0.5] });
  assert.equal(ov.move, 'pan_left'); assert.deepEqual(ov.specs.map((s) => s.type), ['PAN'], 'override is exactly what was asked - no extras');
  assert.deepEqual(Object.keys(LEGACY).sort(), ['drift', 'pan_down', 'pan_left', 'pan_right', 'pan_up', 'pull_out', 'push_in', 'static']);
  for (let s = 0; s < 20; s++) assert.notEqual(new CameraPlanner({ rig: 'CAMERA_VELOCITY', seed: `w${s}` }).plan({ dur: 2, index: 0 }).move, 'whip-in');
});

test('2.5D: a reliable subject gives a layered stack where nearer layers move more; coverage holds per layer; weak subjects fall back honestly', () => {
  const subject = { x: 0.35, y: 0.25, w: 0.25, h: 0.45, conf: 0.7 };
  const p = planParallax({ subject, dur: 3, amount: 0.12, comp: COMP, asset: SRC, fps: FPS });
  assert.equal(p.mode, '2.5d'); assert.deepEqual(p.layers.map((l) => l.role), ['background', 'midground', 'subject']);
  const travel = (l) => { const xs = l.track.position.map((k) => k.v[0]); return Math.max(...xs) - Math.min(...xs); };
  assert.ok(travel(p.layers[2]) > travel(p.layers[1]) && travel(p.layers[1]) > travel(p.layers[0]), 'depth ordering: subject > midground > background');
  assert.ok(p.layers[0].blur > p.layers[2].blur); assert.equal(p.layers[0].mask, null);
  const m = p.layers[2].mask; assert.equal(m.shape, 'ellipse'); assert.ok(m.box.x <= subject.x && m.box.x + m.box.w >= subject.x + subject.w, 'cut-out contains the subject'); assert.ok(m.feather > 0);
  for (const l of p.layers) assert.ok(verifyCoverage(l.track, { comp: COMP, asset: SRC, fps: FPS }) < 0.002, l.role);
  const two = planParallax({ subject, dur: 3, layers: 2, comp: COMP, asset: SRC }); assert.deepEqual(two.layers.map((l) => l.role), ['background', 'subject']);
  const weak = planParallax({ subject: { ...subject, conf: 0.1 }, dur: 3, comp: COMP, asset: SRC }); assert.equal(weak.ok, false); assert.equal(weak.mode, 'fallback'); assert.equal(weak.layers.length, 1); assert.match(weak.reason, /confidence/);
  assert.equal(planParallax({ subject: { x: 0, y: 0, w: 0.98, h: 0.98, conf: 0.9 }, dur: 2, comp: COMP }).ok, false, 'a subject that is the whole frame cannot be cut out');
  assert.equal(planParallax({ subject: null, dur: 2, comp: COMP }).ok, false);
  const b = paddedSubject({ x: 0.02, y: 0.9, w: 0.1, h: 0.1 }); assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, 'padding never leaves the frame');
});

test('simplify: keeps the extremes and stays within tolerance of the original curve', () => {
  const s = frameTimes(2, 48).map((t) => ({ t, x: Math.sin(t * 3) * 0.05, y: 0, ls: 0, r: 0 }));
  const k = simplify(s, { x: 0.0005, y: 1, ls: 1, r: 1 });
  assert.ok(k.length < s.length / 2 && k[0] === s[0] && k[k.length - 1] === s[s.length - 1]);
  for (const q of s) { let i = 1; while (k[i].t < q.t) i++; const a = k[i - 1]; const b = k[i]; const f = (q.t - a.t) / (b.t - a.t); assert.ok(Math.abs(q.x - (a.x + (b.x - a.x) * f)) <= 0.0005 * 1.001); }
});
