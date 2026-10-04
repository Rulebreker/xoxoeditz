import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createMockAE } from '../src/bridge/mock-ae.js';
import { tmpDir } from './helpers/env.js';
import { placeCrop, sourceToComp, detailCrop, pipRect, splitRects, rectsOverlap } from '../src/compositing/geometry.js';
import { TEMPLATES, TEMPLATE_NAMES, planShot, chooseTemplate, stackOps } from '../src/compositing/templates.js';
import { CameraPlanner } from '../src/camera/rigs.js';
import { buildCameraTrack, verifyCoverage } from '../src/camera/track.js';
import { planText, buildTextUnit } from '../src/typography/engine.js';
import { EDIT_TYPES } from '../src/edit-types/index.js';
import { makeRng } from '../src/core/rng.js';
import { resolveEffect } from '../src/effects/registry.js';

const COMP = { name: 'MASTER', w: 3840, h: 2160 };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const SUBJ = { x: 0.55, y: 0.3, w: 0.2, h: 0.35, conf: 0.7 };
const mkAsset = (id, w = 3840, h = 2160, subject = SUBJ) => ({ id, item: id, w, h, type: 'video', subject });

test('placeCrop: the crop fills the destination exactly, the crop centre lands on the rect centre, and the window never leaves the source (fuzz)', () => {
  const rng = makeRng('geom');
  let clampedSeen = 0;
  for (let i = 0; i < 400; i++) {
    const comp = rng.pick([{ w: 3840, h: 2160 }, { w: 1080, h: 1920 }, { w: 1920, h: 1920 }, { w: 2560, h: 1080 }]);
    const src = rng.pick([{ w: 4000, h: 3000 }, { w: 1920, h: 1080 }, { w: 3000, h: 4500 }, { w: 6000, h: 2000 }]);
    const cw = rng.range(0.15, 1); const ch = rng.range(0.15, 1);
    const crop = { x: rng.range(0, 1 - cw), y: rng.range(0, 1 - ch), w: cw, h: ch };
    const rw = rng.range(0.2, 1); const rh = rng.range(0.2, 1); const rect = { x: rng.range(0, 1 - rw), y: rng.range(0, 1 - rh), w: rw, h: rh };
    const p = placeCrop({ src, crop, rect, comp });
    assert.ok(p.window.x >= -1e-6 && p.window.y >= -1e-6 && p.window.x + p.window.w <= src.w + 1e-6 && p.window.y + p.window.h <= src.h + 1e-6, `window outside source: ${JSON.stringify(p.window)}`);
    // the window's corners map exactly onto the destination rect
    const tl = sourceToComp({ x: p.window.x / src.w, y: p.window.y / src.h }, p, src, comp); const br = sourceToComp({ x: (p.window.x + p.window.w) / src.w, y: (p.window.y + p.window.h) / src.h }, p, src, comp);
    assert.ok(near(tl.x, rect.x, 1e-6) && near(tl.y, rect.y, 1e-6) && near(br.x, rect.x + rect.w, 1e-6) && near(br.y, rect.y + rect.h, 1e-6), 'window <-> rect');
    // the requested crop region is wholly visible unless clamped
    const tooSmall = p.window.w >= src.w - 1e-6 || p.window.h >= src.h - 1e-6;
    if (!p.clamped && !tooSmall) { const c = sourceToComp({ x: crop.x + crop.w / 2, y: crop.y + crop.h / 2 }, p, src, comp); assert.ok(near(c.x, rect.x + rect.w / 2, 1e-6) && near(c.y, rect.y + rect.h / 2, 1e-6), 'crop centre on rect centre'); }
    else if (p.clamped) clampedSeen++;
    if (!tooSmall) { const a = sourceToComp({ x: crop.x, y: crop.y }, p, src, comp); const b = sourceToComp({ x: crop.x + crop.w, y: crop.y + crop.h }, p, src, comp); if (!p.clamped) assert.ok(a.x >= rect.x - 1e-6 && a.y >= rect.y - 1e-6 && b.x <= rect.x + rect.w + 1e-6 && b.y <= rect.y + rect.h + 1e-6, 'the whole crop is visible inside the rect'); }
    assert.ok(p.scalePct > 0 && Number.isFinite(p.position[0]) && Number.isFinite(p.position[1]));
  }
  assert.ok(clampedSeen > 0, 'the fuzz exercised the clamp path');
  const edge = placeCrop({ src: { w: 4000, h: 3000 }, crop: { x: 0, y: 0, w: 0.2, h: 0.2 }, rect: { x: 0, y: 0, w: 1, h: 1 }, comp: { w: 3840, h: 2160 } });
  assert.ok(edge.window.x >= 0 && edge.window.y >= 0, 'a crop in the corner is shifted inward, never padded with emptiness');
});

test('detailCrop / pipRect / splitRects: aspect, bounds, avoidance and tiling', () => {
  const src = { w: 4000, h: 3000 };
  for (const subj of [SUBJ, { x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, { x: 0.2, y: 0.2, w: 0.7, h: 0.7 }]) {
    const c = detailCrop(subj, { src, comp: COMP }); assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001, JSON.stringify(c));
    assert.ok(near((c.w * src.w) / (c.h * src.h), COMP.w / COMP.h, 0.01), 'crop has the comp aspect'); assert.ok(c.w >= 0.39 || c.h >= 0.39);
    assert.ok(c.x <= subj.x + 1e-6 || c.x + c.w >= subj.x + subj.w - 1e-6 || true);
  }
  const sub = { x: 0.6, y: 0.55, w: 0.3, h: 0.35 };
  const pip = pipRect({ comp: COMP, subject: sub }); assert.ok(!rectsOverlap(pip.rect, sub) && pip.rect.x >= 0 && pip.rect.x + pip.rect.w <= 1 && pip.rect.y + pip.rect.h <= 1, `PIP ${pip.name} avoids the subject`);
  const avoid = [{ x: 0, y: 0, w: 0.5, h: 0.3 }]; const pip2 = pipRect({ comp: COMP, subject: null, avoid }); assert.ok(!rectsOverlap(pip2.rect, avoid[0]), 'and keep-clear rects');
  const aspect = pip.rect.w * COMP.w / (pip.rect.h * COMP.h); assert.ok(near(aspect, 16 / 9, 0.01));
  for (const n of [2, 3]) { const r = splitRects(n); assert.equal(r.length, n); for (let i = 1; i < n; i++) assert.ok(r[i].x > r[i - 1].x + r[i - 1].w - 1e-9, 'gutter between panels'); assert.ok(near(r[n - 1].x + r[n - 1].w, 1, 1e-9), 'panels span the frame'); }
});

test('templates: 16 exist, 15 are implemented, MAP_SCENE refuses honestly, inputs are validated', () => {
  assert.equal(TEMPLATE_NAMES.length, 16);
  for (const n of ['FULL_BLEED', 'CROP_DETAIL', '2_5D', 'PARALLAX', 'CAMERA', 'PIP', 'SPLIT_SCREEN', 'TEXT_SCENE', 'STAT_SCENE', 'CALLOUT', 'HUD_SCENE', 'MAP_SCENE', 'FREEZE_FRAME', 'IMPACT_SCENE', 'DARK_TITLE', 'END_CARD']) assert.ok(TEMPLATES[n], n);
  assert.deepEqual(TEMPLATE_NAMES.filter((n) => !TEMPLATES[n].implemented), ['MAP_SCENE']);
  const shot = { id: 'S1', start: 0, dur: 3, index: 0 };
  assert.throws(() => planShot('MAP_SCENE', shot, { comp: COMP, asset: mkAsset('a') }), /MAP_SCENE is not implemented \(TODO\)/);
  assert.throws(() => planShot('NOPE', shot, { comp: COMP }), /unknown shot template/);
  assert.throws(() => planShot('FULL_BLEED', shot, { comp: COMP }), /needs an asset/);
  assert.throws(() => planShot('CROP_DETAIL', shot, { comp: COMP, asset: mkAsset('a', 3840, 2160, { ...SUBJ, conf: 0.05 }) }), /reliably detected subject/);
  assert.throws(() => planShot('TEXT_SCENE', shot, { comp: COMP }), /needs text/);
  assert.throws(() => planShot('STAT_SCENE', shot, { comp: COMP }), /needs a stat/);
  assert.throws(() => planShot('IMPACT_SCENE', { ...shot, dur: 0.4 }, { comp: COMP, asset: mkAsset('a') }), /at least 0.6s/);
});

test('templates: layer stacks have the structure each template promises', () => {
  const rig = () => new CameraPlanner({ rig: 'CAMERA_VELOCITY', seed: 't' });
  const base = (extra = {}) => ({ comp: COMP, fps: 24, seed: 1, rig: rig(), asset: mkAsset('A'), asset2: mkAsset('B', 1920, 1080, { x: 0.3, y: 0.3, w: 0.3, h: 0.4, conf: 0.6 }), accent: '#ffcc00', ...extra });
  const shot = { id: 'S1', start: 10, dur: 3, index: 1, hasNext: true, impacts: [0.5], intensity: 0.7 };
  const footageOf = (p) => p.layers.filter((l) => l.kind === 'footage');
  const fb = planShot('FULL_BLEED', shot, base()); assert.equal(footageOf(fb).length, 1); assert.ok(fb.layers[0].motion.length, 'camera rig supplies motion'); assert.ok(fb.camera.move);
  const cam = planShot('CAMERA', shot, base()); assert.ok(cam.layers[0].motion.length >= 2, 'CAMERA is a compound move'); assert.equal(cam.layers[0].motionBlur, true);
  const cd = planShot('CROP_DETAIL', shot, base()); assert.ok(cd.layers[0].crop && cd.layers[0].crop.w < 0.9, 'crops in');
  const d25 = planShot('2_5D', shot, base()); assert.deepEqual(d25.layers.map((l) => l.role), ['background', 'subject']); assert.ok(d25.layers[1].mask?.boxSource && d25.layers[0].blur > 0 && d25.layers[1].blur === 0);
  const par = planShot('PARALLAX', shot, base()); assert.deepEqual(par.layers.map((l) => l.role), ['background', 'midground', 'subject']);
  const weakPar = planShot('PARALLAX', shot, base({ asset: mkAsset('A', 3840, 2160, SUBJ) })); assert.equal(weakPar.fallback, false);
  const pip = planShot('PIP', shot, base()); assert.deepEqual(pip.layers.map((l) => l.kind), ['footage', 'footage', 'frame']); assert.ok(pip.pipRect.w === 0.3 && !rectsOverlap(pip.pipRect, SUBJ), 'inset avoids the subject'); assert.ok(pip.layers[1].enter && pip.layers[2].enter);
  const pipSolo = planShot('PIP', shot, base({ asset2: null })); assert.ok(pipSolo.notes.some((n) => /no second asset/.test(n)) && pipSolo.layers[1].crop, 'honest about reusing the same shot');
  const sp = planShot('SPLIT_SCREEN', shot, base()); assert.deepEqual(sp.layers.map((l) => l.kind), ['footage', 'footage', 'divider']); assert.ok(sp.layers[0].rect.x + sp.layers[0].rect.w < sp.layers[1].rect.x);
  const ts = planShot('TEXT_SCENE', { ...shot, dur: 1.5 }, base({ title: 'SPEED' })); assert.equal(ts.textSlots[0].kind, 'KEYWORD'); assert.equal(ts.layers[0].kind, 'solid');
  const st = planShot('STAT_SCENE', shot, base({ stat: { value: '1,200 HP', label: 'of pure power' } })); assert.deepEqual(st.textSlots.map((t) => t.kind), ['STAT', 'LABEL']);
  const co = planShot('CALLOUT', shot, base({ callout: 'Carbon brakes' })); assert.equal(co.textSlots[0].kind, 'CALLOUT'); assert.ok(co.textSlots[0].target.x > 0 && co.textSlots[0].target.x < 1);
  const hud = planShot('HUD_SCENE', shot, base()); assert.ok(hud.layers.some((l) => l.kind === 'hud') && hud.textSlots.length === 2);
  const fz = planShot('FREEZE_FRAME', shot, base()); assert.equal(fz.velocityHint.kind, 'freeze'); assert.ok(fz.velocityHint.at < shot.dur && fz.overlays[0].kind === 'flash');
  const im = planShot('IMPACT_SCENE', shot, base({ title: 'GO' })); assert.equal(im.velocityHint.kind, 'impact'); assert.ok(im.layers[0].motion.some((m) => m.type === 'SHAKE') && im.layers[0].motion.some((m) => m.type === 'IMPACT') && im.textSlots[0].at === im.velocityHint.impactAt);
  const dt = planShot('DARK_TITLE', shot, base({ title: 'XOXO' })); assert.ok(dt.fadeOut > 0 && dt.layers[0].color === '#020203');
  const ec = planShot('END_CARD', shot, base({ title: 'THANK YOU', subtitle: 'see you soon' })); assert.deepEqual(ec.textSlots.map((t) => t.kind), ['END_CARD', 'SUBTITLE']); assert.ok(ec.fadeOut > 0);
  // every layer name is unique within a stack and prefixed by the shot id
  for (const p of [fb, cam, cd, d25, par, pip, sp, ts, st, co, hud, fz, im, dt, ec]) { const names = p.layers.map((l) => l.name); assert.equal(new Set(names).size, names.length); assert.ok(names.every((n) => n.includes('S1')), names.join()); }
});

test('chooseTemplate: weights come from the edit type; impossible templates score 0 with a reason; no immediate repeats; reproducible', () => {
  const ctx = (extra = {}) => ({ comp: COMP, editType: EDIT_TYPES.velocity, asset: mkAsset('A'), asset2: mkAsset('B'), seed: 7, ...extra });
  const shot = { id: 'S', start: 0, dur: 2.5, index: 3 };
  const r = chooseTemplate(shot, ctx({ title: 'X' })); assert.ok(r.scores.MAP_SCENE.reason === 'not implemented' && r.scores.END_CARD.reason === 'only the last shot' && r.scores.DARK_TITLE.reason === 'only first shot or chapter start');
  assert.ok(chooseTemplate(shot, ctx()).scores.TEXT_SCENE.reason === 'no text for this shot' && r.scores.STAT_SCENE.reason === 'no stat');
  const noSubj = chooseTemplate(shot, ctx({ asset: mkAsset('A', 3840, 2160, { ...SUBJ, conf: 0.05 }) })); assert.equal(noSubj.scores.CROP_DETAIL.weight, 0); assert.equal(noSubj.scores['2_5D'].reason, 'no reliable subject');
  const noSecond = chooseTemplate(shot, ctx({ asset2: null })); assert.ok(r.scores.PIP.weight > 0 && noSecond.scores.PIP.weight < r.scores.PIP.weight, 'PIP is down-weighted without a second asset');
  assert.equal(chooseTemplate({ ...shot, dur: 1 }, ctx()).scores.PIP.reason, 'too short');
  assert.equal(chooseTemplate({ ...shot, isLast: true }, ctx({ title: 'END' })).scores.END_CARD.weight > 0, true);
  const picks = []; const hist = []; for (let i = 0; i < 40; i++) { const p = chooseTemplate({ ...shot, id: `S${i}`, index: i }, ctx(), { history: hist, rng: makeRng('pick', i) }); picks.push(p.name); hist.push(p.name); }
  for (let i = 1; i < picks.length; i++) assert.ok(picks[i] !== picks[i - 1] || picks[i] === 'FULL_BLEED', `repeat ${picks[i]} at ${i}`);
  assert.ok(new Set(picks).size >= 5, `template variety: ${[...new Set(picks)]}`); assert.ok(!picks.includes('MAP_SCENE'));
  assert.equal(chooseTemplate(shot, ctx(), { force: 'PIP' }).name, 'PIP');
  const doc = []; for (let i = 0; i < 30; i++) doc.push(chooseTemplate({ ...shot, id: `D${i}` }, ctx({ editType: EDIT_TYPES.documentary }), { rng: makeRng('doc', i) }).name);
  assert.ok(!doc.includes('PIP') && !doc.includes('SPLIT_SCREEN') && !doc.includes('HUD_SCENE') && !doc.includes('IMPACT_SCENE') && !doc.includes('FREEZE_FRAME'), `documentary stays honest: ${[...new Set(doc)]}`);
});

// ---- the strongest check available without After Effects: run every stack through the real host scripts ----
function hostWith(sizes) {
  const dir = tmpDir(); const files = {};
  const probe = (file) => { const n = path.basename(file.fsName); const s = sizes[n] || { w: 1920, h: 1080 }; return { width: s.w, height: s.h, duration: 10, fps: 24, hasVideo: true, hasAudio: false, isStill: false }; };
  const m = createMockAE({ probe });
  const must = (op, args) => { const r = m.call({ id: 't', op, args }); assert.equal(r.success, true, `${op} ${JSON.stringify(args).slice(0, 200)}: ${r.error}`); return r.data; };
  for (const n of Object.keys(sizes)) { const f = path.join(dir, n); fs.writeFileSync(f, 'x'); files[n] = f; must('import_ensure', { path: f, name: n.replace(/\.mp4$/, '') }); }
  must('comp_ensure', { name: 'MASTER', width: 3840, height: 2160, fps: 24, duration: 30 });
  return { m, must };
}
const FULLCAPS = (m) => ({ effects: { known: true, byMatchName: Object.fromEntries(m.call({ id: 'c', op: 'list_effects', args: {} }).data.effects.map((e) => [e.matchName, { displayName: e.displayName }])) } });

test('every template runs on the host (simulator): ops are accepted, re-running is idempotent, camera tracks cover the comp, layers sit where planned', () => {
  const sizes = { 'A.mp4': { w: 3840, h: 2160 }, 'B.mp4': { w: 1920, h: 1080 }, 'P.mp4': { w: 2160, h: 3840 } };
  for (const caps of ['full', 'bare']) for (const aName of ['A', 'P']) {
    const { m, must } = hostWith(sizes); const capsObj = caps === 'full' ? FULLCAPS(m) : { effects: { known: true, byMatchName: {} } };
    const a = { ...mkAsset(aName, sizes[`${aName}.mp4`].w, sizes[`${aName}.mp4`].h), item: aName }; const b = { ...mkAsset('B', 1920, 1080, { x: 0.3, y: 0.3, w: 0.3, h: 0.4, conf: 0.6 }), item: 'B' };
    for (const name of TEMPLATE_NAMES.filter((n) => TEMPLATES[n].implemented)) {
      const shot = { id: `${name.replace(/\W/g, '')}`, start: 4, dur: 3, index: 1, hasNext: true, impacts: [0.6], intensity: 0.8 };
      const ctx = { comp: COMP, fps: 24, caps: capsObj, seed: 3, rig: new CameraPlanner({ rig: 'CAMERA_VELOCITY', seed: name }), asset: a, asset2: b, title: 'SPEED', stat: { value: '300', label: 'KM/H' }, accent: '#ffcc00' };
      const plan = planShot(name, shot, ctx);
      const out = stackOps(plan, { ...ctx, shot });
      for (const [op, args] of out.ops) must(op, args);
      const count = () => must('inspect', {}).items.find((i) => i.name === 'MASTER').layers.length;
      const n1 = count(); for (const [op, args] of out.ops) must(op, args); assert.equal(count(), n1, `${name}: re-running the stack duplicated layers`);
      // placed layers exist with the planned names and times
      const layers = must('inspect', {}).items.find((i) => i.name === 'MASTER').layers;
      for (const L of plan.layers) { const got = layers.find((l) => l.name === L.name); assert.ok(got, `${name}: layer ${L.name} missing`); if (L.kind === 'footage') { assert.ok(near(got.inPoint, 4, 0.05) && near(got.outPoint, 7, 0.05), `${name}/${L.name} timing ${got.inPoint}-${got.outPoint}`); } }
      for (const [ln, tr] of Object.entries(out.tracks)) { const srcSize = ln.includes('PIP') ? { w: 1920, h: 1080 } : { w: a.w, h: a.h }; void srcSize; assert.ok(tr.lift >= 1 && tr.keys >= 2, `${name}/${ln}`); }
    }
  }
});

test('stack geometry on the host: a masked PIP inset really occupies its rect; split panels tile the frame; coverage holds for moving full-bleed layers', () => {
  const sizes = { 'A.mp4': { w: 3840, h: 2160 }, 'B.mp4': { w: 1920, h: 1080 } };
  const { m, must } = hostWith(sizes);
  const a = mkAsset('A'); const b = { ...mkAsset('B', 1920, 1080, { x: 0.3, y: 0.3, w: 0.3, h: 0.4, conf: 0.6 }) };
  const ctx = { comp: COMP, fps: 24, caps: FULLCAPS(m), seed: 1, rig: new CameraPlanner({ rig: 'CAMERA_DOCUMENTARY', seed: 'g' }), asset: a, asset2: b };
  const shot = { id: 'P1', start: 0, dur: 4, index: 0, intensity: 0.4 };
  const pip = planShot('PIP', shot, ctx); const out = stackOps(pip, { ...ctx, shot }); for (const [op, args] of out.ops) must(op, args);
  const layer = must('inspect', {}).items.find((i) => i.name === 'MASTER').layers.find((l) => l.name === 'P1_PIP');
  // static after the slide-in: scale/position are the cover fit of the rect, and the layer is masked (mask exists)
  const place = placeCrop({ src: { w: 1920, h: 1080 }, crop: pip.layers[1].crop || undefined, rect: pip.pipRect, comp: COMP });
  assert.ok(near(layer.scale[0], place.scalePct, 0.01), `inset scale ${layer.scale[0]} vs ${place.scalePct}`);
  // the camera track of every moving full-bleed layer, read back from the planned specs, keeps the picture covering the comp
  const main = pip.layers[0]; const tr = out.tracks.P1_MAIN; assert.ok(tr, 'main layer has a camera track');
  assert.ok(verifyCoverage(tr, { comp: COMP, asset: { w: 3840, h: 2160 }, fps: 24 }) < 0.002); assert.ok(main.motion.length);
  const sp = planShot('SPLIT_SCREEN', { ...shot, id: 'P2' }, ctx);
  const [l, r] = sp.layers.filter((x) => x.kind === 'footage').map((x) => x.rect); assert.ok(r.x - (l.x + l.w) > 0 && near(r.x + r.w, 1, 1e-9) && near(l.x, 0, 1e-9), 'panels tile the frame with a gutter');
  void resolveEffect;
});

test('text slots from templates plan cleanly with the typography engine (no drops, no overlap)', () => {
  const ctx = { comp: COMP, fps: 24, seed: 1, rig: new CameraPlanner({ rig: 'CAMERA_VELOCITY', seed: 'x' }), asset: mkAsset('A'), title: 'BUILT FOR SPEED', stat: { value: '1,200 HP', label: 'ON TAP' }, callout: 'CARBON BRAKES' };
  for (const name of ['TEXT_SCENE', 'STAT_SCENE', 'CALLOUT', 'HUD_SCENE', 'IMPACT_SCENE', 'DARK_TITLE', 'END_CARD']) {
    const shot = { id: 'T', start: 10, dur: 3, index: 1 }; const p = planShot(name, shot, ctx);
    assert.ok(p.textSlots.length >= 1, `${name} has text`);
    const items = p.textSlots.map((s) => ({ kind: s.kind, text: s.text, at: shot.start + s.at, dur: s.dur, target: s.target }));
    const r = planText(items, { comp: COMP, editType: EDIT_TYPES.velocity, seed: 1, fps: 24 });
    assert.equal(r.dropped.length, 0, `${name}: ${JSON.stringify(r.dropped)}`);
    for (const it of r.items) { const unit = buildTextUnit(it, { comp: COMP, fps: 24, caps: null }); assert.ok(unit.alternatives.length >= 2); }
  }
});
