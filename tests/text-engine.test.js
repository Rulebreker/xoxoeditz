// TEXT / TIMELINE ENGINE regression suite (real-After-Effects bug report: text layers piling up, text wider than the
// comp, "allCaps is a readOnly attribute", missing title/end card, weak QA repair, naive TEXT_OVERLAP).
// Everything here runs on the simulator, whose TextDocument.allCaps is read-only by default (After Effects 2026).
// That proves the LOGIC; the real-AE behaviour needs `xoxo selftest` / a real run (see docs/TROUBLESHOOTING.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createMockAE } from '../src/bridge/mock-ae.js';
import { Bridge } from '../src/bridge/client.js';
import { MockTransport } from '../src/bridge/transports/mock.js';
import { planText, buildTextUnit, layoutText, captionZone, safeBox, textMayCoexist, TEXT_KIND_NAMES } from '../src/typography/engine.js';
import { EDIT_TYPES } from '../src/edit-types/index.js';
import { MASTER } from '../src/ae/compile.js';
import { executeBuild } from '../src/ae/executor.js';
import { textCheck, timelineCheck } from '../src/qa/checks.js';
import { repairIssues, issueKey } from '../src/qa/repair.js';
import { runVerify } from '../src/app/services.js';
import { validateTimeline, normalizeTimeline } from '../src/timeline/plan.js';
import { tmpDir, testConfig } from './helpers/env.js';

const must = (m, op, args) => { const r = m.call({ id: 't', op, args }); assert.equal(r.success, true, `${op} ${JSON.stringify(args).slice(0, 200)}: ${r.error}`); return r.data; };
const runOps = (m, ops) => { for (const [op, args] of ops) must(m, op, args); };
const FPS = 24;

/** Plan + build text items into a fresh simulated master comp, the way a real build does (unit alternative 0). */
function scene({ w = 1920, h = 1080, items, captions = false, shots = null, mock = createMockAE(), editType = EDIT_TYPES.velocity, animations = ['fade', 'slide', 'scale_punch', 'mask_reveal'], duration = 60, seed = 1 }) {
  const comp = { name: MASTER, w, h };
  must(mock, 'comp_ensure', { name: MASTER, width: w, height: h, fps: FPS, duration });
  const et = animations ? { ...editType, typography: { ...editType.typography, animations } } : editType;
  const planned = planText(items, { comp, editType: et, seed, fps: FPS, shots, avoid: captions ? [captionZone(comp)] : [] });
  const units = planned.items.map((e) => buildTextUnit(e, { comp, fps: FPS, caps: null, style: { font: 'ArialMT', color: '#ffffff', stroke: '#000000', strokeWidth: 2 }, beats: [] }));
  for (const u of units) runOps(mock, u.alternatives[0].ops);
  const meta = { textLayers: planned.items.map((e, i) => ({ name: e.id, role: e.kind, id: e.id, shotId: e.shotId, start: e.start, end: e.end, required: e.required, children: units[i].names.filter((n) => n !== e.id && /^TXT_/.test(n)) })), unitNames: Object.fromEntries(units.map((u) => [u.id, u.names])) };
  const inspect = () => must(mock, 'inspect', {});
  const qa = (ins = inspect()) => textCheck({ plan: { output: { width: w, height: h, fps: FPS }, style: 'cinematic-documentary' }, inspect: ins, build: { meta }, caps: null });
  const layers = () => inspect().items.find((i) => i.name === MASTER).layers.filter((l) => l.kind === 'text');
  return { m: mock, planned, units, meta, inspect, qa, layers, comp };
}
const errors = (issues) => issues.filter((i) => i.severity === 'error');
const codes = (issues) => issues.map((i) => i.code);
const inSafe = (b, w, h) => { const s = safeBox({ w, h }); return b.left >= s.left - 1 && b.top >= s.top - 1 && b.left + b.width <= s.right + 1 && b.top + b.height <= s.bottom + 1; };

// ---- Bug 1: text layer explosion ---------------------------------------------------------------------------------

test('ten sequential text units: each is visible only in its own interval, none overlap, ids are role-based, no extra layers', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ kind: 'KEYWORD', text: ['SPEED', 'POWER', 'FOCUS', 'DRIVE', 'FORCE', 'BLADE', 'SHARP', 'RAPID', 'STEEL', 'APEX'][i], at: 1 + i * 1.5, dur: 1.0, shotId: `S${String(i + 1).padStart(2, '0')}` }));
  const s = scene({ items });
  assert.equal(s.planned.dropped.length, 0, JSON.stringify(s.planned.dropped)); assert.equal(s.planned.items.length, 10);
  assert.deepEqual(s.planned.items.map((e) => e.id), Array.from({ length: 10 }, (_, i) => `TXT_KEYWORD_${String(i + 1).padStart(2, '0')}`), 'deterministic role-based ids in time order, never derived from the text');
  const L = s.layers(); assert.equal(L.length, 10, `exactly the planned layers: ${L.map((l) => l.name)}`);
  const sorted = [...L].sort((a, b) => a.inPoint - b.inPoint);
  for (let i = 0; i < sorted.length - 1; i++) assert.ok(sorted[i].outPoint <= sorted[i + 1].inPoint + 1e-6, `${sorted[i].name} (${sorted[i].inPoint}-${sorted[i].outPoint}) overlaps ${sorted[i + 1].name} (${sorted[i + 1].inPoint})`);
  for (const e of s.planned.items) { const l = L.find((x) => x.name === e.id); assert.ok(Math.abs(l.inPoint - e.start) < 1e-6 && Math.abs(l.outPoint - e.end) < 1e-6, `${e.id}: layer interval equals the planned start/end`); assert.equal(l.mark.role, 'KEYWORD'); assert.equal(l.mark.k, 'text'); }
  assert.deepEqual(codes(s.qa()).filter((c) => /OVERLAP|UNEXPECTED|TIMING|KEYFRAMES/.test(c)), []);
});

test('overlapping text units: independent headlines are never visible together unless explicitly requested; QA calls an accidental pile-up an ERROR', () => {
  const items = [{ kind: 'TITLE', text: 'ONE', at: 1, dur: 3 }, { kind: 'TITLE', text: 'TWO', at: 2, dur: 3 }, { kind: 'KEYWORD', text: 'THREE', at: 2.5, dur: 1 }, { kind: 'END_CARD', text: 'FOUR', at: 3, dur: 2 }];
  const s = scene({ items });
  assert.equal(s.planned.items.length, 1, 'only the first headline survives'); assert.equal(s.planned.dropped.length, 3);
  assert.ok(s.planned.dropped.every((d) => /already on screen/.test(d.reason)));
  // explicit request keeps both
  const both = scene({ items: [{ kind: 'TITLE', text: 'ONE', at: 1, dur: 3 }, { kind: 'TITLE', text: 'TWO', at: 2, dur: 3, allowOverlap: true }] });
  assert.equal(both.planned.items.length, 2);
  // the raw plan is refused by validation
  const plan = { version: 2, mode: 'timeline', title: 't', output: { width: 1920, height: 1080, fps: 24 }, timeline: { duration: 10, shots: [{ id: 'S01', start: 0, end: 5, template: 'SLATE', layers: [{ kind: 'solid', name: 'BG' }], text: [{ kind: 'TITLE', text: 'ONE', at: 1, dur: 2.5 }, { kind: 'TITLE', text: 'TWO', at: 2, dur: 2 }] }, { id: 'S02', start: 5, end: 10, template: 'SLATE', layers: [{ kind: 'solid', name: 'BG2' }], text: [] }], transitions: [{ type: 'cut', d: 0 }] }, audio: {}, look: {} };
  const v = validateTimeline(plan); assert.ok(v.errors.some((e) => /unintentional text overlap/.test(e.message)), JSON.stringify(v.errors));
  plan.timeline.shots[0].text[1].allowOverlap = true; assert.ok(!validateTimeline(plan).errors.some((e) => /unintentional text overlap/.test(e.message)));
  // QA on a project where two shot titles ended up visible together (what the real report showed)
  const m = createMockAE(); must(m, 'comp_ensure', { name: MASTER, width: 1920, height: 1080, fps: FPS, duration: 20 });
  for (const [n, role, a, b] of [['TXT_TITLE_01', 'TITLE', 0, 8], ['TXT_TITLE_02', 'TITLE', 2, 10]]) must(m, 'layer_add_text', { comp: MASTER, name: n, text: n, size: 90, start: a, end: b, role, position: [960, 540] });
  const issues = textCheck({ plan: { output: { width: 1920, height: 1080, fps: 24 }, style: 'cinematic-documentary' }, inspect: must(m, 'inspect', {}), build: { meta: { textLayers: [{ name: 'TXT_TITLE_01', role: 'TITLE', start: 0, end: 8 }, { name: 'TXT_TITLE_02', role: 'TITLE', start: 2, end: 10 }], unitNames: {} } }, caps: null });
  const ov = issues.find((i) => i.code === 'TEXT_OVERLAP'); assert.ok(ov && ov.severity === 'error', 'overlap of two TITLE texts is an error, not a warning');
});

test('role rules: allowed combinations vs unintentional ones (title/lower third/HUD/caption coexist; two titles, title+end card, title+keyword do not)', () => {
  for (const [a, b] of [['TITLE', 'SUBTITLE'], ['TITLE', 'LOWER_THIRD'], ['TITLE', 'CAPTION'], ['TITLE', 'HUD'], ['LOWER_THIRD', 'CAPTION'], ['CALLOUT', 'HUD'], ['END_CARD', 'SUBTITLE'], ['KEYWORD', 'CAPTION']]) assert.ok(textMayCoexist(a, b), `${a}+${b} may coexist`);
  for (const [a, b] of [['TITLE', 'TITLE'], ['TITLE', 'END_CARD'], ['TITLE', 'KEYWORD'], ['KEYWORD', 'KEYWORD'], ['STAT', 'TITLE'], ['SUBTITLE', 'SUBTITLE'], ['CAPTION', 'CAPTION'], ['LOWER_THIRD', 'LOWER_THIRD']]) assert.ok(!textMayCoexist(a, b), `${a}+${b} may not`);
  for (const r of TEXT_KIND_NAMES) assert.equal(typeof textMayCoexist(r, 'TITLE'), 'boolean');
});

// ---- Bug 3: allCaps read-only (After Effects 2026) -----------------------------------------------------------------

test('uppercase title: the STRING is upper-cased; allCaps is never written', () => {
  const s = scene({ items: [{ kind: 'TITLE', text: 'the future of speed', at: 1, dur: 3 }] });
  const l = s.layers()[0]; assert.equal(l.text, 'THE FUTURE OF SPEED'); assert.ok(!/[a-z]/.test(l.text));
  const ops = JSON.stringify(s.units[0].alternatives.map((a) => a.ops)); assert.ok(!/"allCaps"/.test(ops), 'the compiled ops no longer carry allCaps');
  const m = createMockAE(); must(m, 'comp_ensure', { name: 'C', width: 1920, height: 1080, fps: 24, duration: 5 });
  must(m, 'layer_add_text', { comp: 'C', name: 'LOWER', text: 'quiet words', allCaps: true, size: 60 });
  assert.equal(must(m, 'inspect', {}).items.find((i) => i.name === 'C').layers[0].text, 'QUIET WORDS', 'the legacy allCaps flag now means "upper-case the string"');
});

test('allCaps read-only compatibility (AE 2026): assigning it throws on the simulator exactly like the real host; layer_add_text still works on both generations', () => {
  const m2026 = createMockAE(); // read-only by default
  must(m2026, 'comp_ensure', { name: 'C', width: 1280, height: 720, fps: 24, duration: 5 });
  const probe = m2026.run(`(function(){ var c = XOXO.getComp('C'); var l = c.layers.addText('x'); var p = l.property('ADBE Text Properties').property('ADBE Text Document'); var td = p.value; try { td.allCaps = true; return 'writable'; } catch (e) { return e.message; } })()`);
  assert.match(probe, /Unable to set "allCaps"\. It is a readOnly attribute\./, 'the simulator reproduces the AE 2026 failure');
  for (const mock of [m2026, createMockAE({ legacyAllCaps: true })]) {
    must(mock, 'comp_ensure', { name: 'D', width: 1280, height: 720, fps: 24, duration: 5 });
    const r = must(mock, 'layer_add_text', { comp: 'D', name: 'TXT_TITLE_01', text: 'brand new', allCaps: true, caps: 'upper', size: 80, start: 0, end: 3 });
    assert.equal(r.name, 'TXT_TITLE_01'); assert.equal(r.warnings.length, 0);
  }
  // TITLE and END_CARD get created end to end on the 2026-style host (the original report lost both)
  const s = scene({ items: [{ kind: 'TITLE', text: 'j20 stealth', at: 0.5, dur: 3, required: true, shotId: 'S01' }, { kind: 'END_CARD', text: 'thank you', at: 20, dur: 3, required: true, shotId: 'S09' }] });
  assert.deepEqual(s.layers().map((l) => l.name).sort(), ['TXT_END_01', 'TXT_TITLE_01']); assert.deepEqual(errors(s.qa()), []);
});

test('text creation is atomic: a failure after the layer exists removes it - no orphan layers named after their text, whatever alternative failed', () => {
  const m = createMockAE(); must(m, 'comp_ensure', { name: 'C', width: 1920, height: 1080, fps: 24, duration: 10 });
  const before = must(m, 'inspect', {}).items.find((i) => i.name === 'C').numLayers;
  for (const bad of [{ color: 'not-a-colour' }, { justify: 'left', position: 'broken', color: '#zz' }]) {
    const r = m.call({ id: 'x', op: 'layer_add_text', args: { comp: 'C', name: 'TXT_KEYWORD_01', text: 'J-29', size: 80, start: 1, end: 2, ...bad } });
    assert.equal(r.success, false);
  }
  assert.equal(must(m, 'inspect', {}).items.find((i) => i.name === 'C').numLayers, before, 'nothing was left behind by the failed attempts');
  // a successful layer carries identity from the first moment: name, interval, ownership mark
  const ok = must(m, 'layer_add_text', { comp: 'C', name: 'TXT_KEYWORD_01', text: 'J-29', size: 80, start: 1, end: 2, role: 'KEYWORD' });
  assert.equal(ok.inPoint, 1); assert.equal(ok.outPoint, 2);
  const L = must(m, 'inspect', {}).items.find((i) => i.name === 'C').layers; assert.equal(L.length, before + 1); assert.equal(L[0].mark.role, 'KEYWORD');
  // re-creating the same id replaces the layer instead of stacking "_2"
  must(m, 'layer_add_text', { comp: 'C', name: 'TXT_KEYWORD_01', text: 'J-29', size: 80, start: 1, end: 2, role: 'KEYWORD' });
  assert.deepEqual(must(m, 'inspect', {}).items.find((i) => i.name === 'C').layers.map((l) => l.name), ['TXT_KEYWORD_01']);
});

// ---- Bug 2: text too large / layout engine -------------------------------------------------------------------------

for (const [w, h, label] of [[1280, 720, '1280x720'], [1920, 1080, '1920x1080'], [3840, 2160, '3840x2160'], [1080, 1920, '1080x1920 (9:16)'], [1080, 1080, '1080x1080 (1:1)'], [1080, 1350, '1080x1350 (4:5)'], [3840, 1608, '3840x1608 (2.39:1)']]) {
  test(`layout ${label}: title, subtitle, lower third, HUD, end card, keyword are measured inside the safe area (5% L/R, 8% top, 10% bottom) with no errors`, () => {
    const items = [
      { kind: 'TITLE', text: 'THE FUTURE OF SPEED', at: 1, dur: 3, required: true },
      { kind: 'SUBTITLE', text: 'Built for the road less travelled', at: 1.5, dur: 2.5 },
      { kind: 'LOWER_THIRD', text: 'Jordan Reyes, test pilot', at: 1.2, dur: 2.5 },
      { kind: 'HUD', text: 'ALT 4210 FT', at: 1.2, dur: 2.5 },
      { kind: 'KEYWORD', text: 'VELOCITY', at: 6, dur: 1 },
      { kind: 'STAT', text: '1,200 HP', at: 9, dur: 2 },
      { kind: 'END_CARD', text: 'See you on the road', at: 14, dur: 3, required: true },
    ];
    const s = scene({ w, h, items });
    assert.equal(s.planned.items.length, items.length, JSON.stringify(s.planned.dropped));
    for (const l of s.layers()) { assert.ok(l.bounds, `${l.name} was measured`); assert.ok(inSafe(l.bounds, w, h), `${label} ${l.name} ${JSON.stringify(l.bounds)} leaves the safe area`); }
    assert.deepEqual(errors(s.qa()).map((i) => `${i.code} ${i.layer}`), []);
  });
}

test('layout: long, short and multi-line titles - wrap first, shrink only when needed, short titles keep their premium size', () => {
  const W = 1920; const H = 1080;
  const short = scene({ w: W, h: H, items: [{ kind: 'TITLE', text: 'GO', at: 1, dur: 3 }] });
  const nominal = Math.round(H * 0.085);
  assert.equal(short.layers()[0].fontSize, nominal, 'a short title is not shrunk'); assert.deepEqual(errors(short.qa()), []);
  const long = scene({ w: W, h: H, items: [{ kind: 'TITLE', text: 'An exceptionally long headline that keeps going and going and going', at: 1, dur: 3 }] });
  const l = long.layers()[0]; assert.ok(l.text.split('\r').length >= 2, `wrapped onto ${l.text.split('\r').length} lines`); assert.ok(inSafe(l.bounds, W, H)); assert.deepEqual(errors(long.qa()), []);
  assert.ok(l.fontSize >= nominal * 0.55, 'wrapping came before extreme scaling');
  const multi = scene({ w: W, h: H, items: [{ kind: 'TITLE', text: 'LINE ONE\nLINE TWO', at: 1, dur: 3 }] });
  assert.ok(inSafe(multi.layers()[0].bounds, W, H)); assert.deepEqual(errors(multi.qa()), []);
  const lay = layoutText('TITLE', 'GO', { w: W, h: H }); assert.equal(lay.size, lay.nominalSize); assert.ok(lay.fit.box.left >= W * 0.05 - 1 && lay.fit.box.bottom <= H * 0.9 + 1);
});

test('measured fit: text far too big for the frame is wrapped / shrunk by the HOST using real bounds, never by layer scale; position stays animatable', () => {
  const m = createMockAE(); must(m, 'comp_ensure', { name: 'C', width: 1280, height: 720, fps: 24, duration: 8 });
  must(m, 'layer_add_text', { comp: 'C', name: 'BIG', text: 'EXTRAORDINARY SPEED RECORDS', size: 190, start: 0, end: 6, justify: 'center', position: [640, 360] });
  const before = must(m, 'inspect', {}).items[0].layers[0].bounds; assert.ok(before.width > 1280, `reproduces the report: ${Math.round(before.width)}px wide in a 1280px comp`);
  const fit = must(m, 'text_fit', { comp: 'C', layer: 'BIG', box: { left: 64, top: 58, right: 1216, bottom: 648 }, ref: [640, 360], hAlign: 'center', vAlign: 'center', maxLines: 3 });
  assert.equal(fit.fits, true, JSON.stringify(fit)); assert.ok(fit.lines >= 2 && fit.lines <= 3);
  const after = must(m, 'inspect', {}).items[0].layers[0]; assert.ok(inSafe(after.bounds, 1280, 720)); assert.deepEqual(after.scale, [100, 100], 'layer scale untouched');
  // an animated (keyed) position is shifted along with its keys instead of throwing
  must(m, 'keyframes', { comp: 'C', layer: 'BIG', prop: 'position', keys: [{ t: 0, v: [100, 300] }, { t: 1, v: [100, 340] }] });
  const fit2 = must(m, 'text_fit', { comp: 'C', layer: 'BIG', box: { left: 64, top: 58, right: 1216, bottom: 648 }, ref: [640, 360], hAlign: 'center', vAlign: 'center' });
  assert.equal(fit2.fits, true);
});

test('QA measures at REST time: an entrance scale-punch (150% on its first key) does not make a fitted title look "too large"', () => {
  const s = scene({ w: 1920, h: 1080, animations: ['scale_punch'], items: [{ kind: 'TITLE', text: 'THE FUTURE OF SPEED', at: 1, dur: 3, animation: 'scale_punch' }] });
  const l = s.layers()[0]; assert.ok(l.restTime > l.inPoint + 0.1 && l.restTime < l.outPoint, `rest ${l.restTime}`);
  assert.ok(inSafe(l.bounds, 1920, 1080)); assert.deepEqual(codes(s.qa()).filter((c) => c.startsWith('TEXT_OUT') || c === 'TEXT_OUTSIDE_SAFE'), []);
  assert.ok(l.keyRange[0] >= l.inPoint - 1e-6 && l.keyRange[1] <= l.outPoint + 1e-6, 'animation keys stay inside the visible interval');
});

// ---- combinations ------------------------------------------------------------------------------------------------

test('title + lower third / caption / HUD / subtitle coexist cleanly; title + end card never share a moment; title keeps out of the caption band', () => {
  for (const second of [{ kind: 'LOWER_THIRD', text: 'Jordan Reyes' }, { kind: 'HUD', text: 'ALT 4210 FT' }, { kind: 'SUBTITLE', text: 'a quiet line below' }]) {
    const s = scene({ items: [{ kind: 'TITLE', text: 'BUILT FOR SPEED', at: 1, dur: 3, required: true }, { ...second, at: 1.2, dur: 2.5 }] });
    assert.equal(s.planned.items.length, 2, `${second.kind}: ${JSON.stringify(s.planned.dropped)}`); assert.deepEqual(errors(s.qa()).map((i) => `${i.code} ${i.layer}`), [], second.kind);
  }
  // captions on: the title keeps clear of the caption band and a burned-in caption sits beneath it
  const cap = scene({ captions: true, items: [{ kind: 'TITLE', text: 'BUILT FOR SPEED', at: 1, dur: 3, required: true }] });
  const zone = captionZone(cap.comp); const tl = cap.layers()[0].bounds; assert.ok(tl.top + tl.height <= zone.y + 1, 'title is above the caption band');
  must(cap.m, 'layer_add_text', { comp: MASTER, name: 'CAP_0001', text: 'This is the narration line', size: Math.round(1080 * 0.04), position: [960, Math.round(1080 * 0.9)], start: 1, end: 4, role: 'CAPTION', mark: { k: 'text', role: 'CAPTION', id: 'CAP_0001' } });
  const issues = textCheck({ plan: { output: { width: 1920, height: 1080, fps: 24 }, style: 'cinematic-documentary' }, inspect: cap.inspect(), build: { meta: { textLayers: [...cap.meta.textLayers, { name: 'CAP_0001', role: 'CAPTION', start: 1, end: 4 }], unitNames: cap.meta.unitNames } }, caps: null });
  assert.deepEqual(errors(issues).map((i) => `${i.code} ${i.layer}`), []);
  // title + end card in the same moment: the optional one gives way, the required ones are both kept when they are apart
  const clash = scene({ items: [{ kind: 'TITLE', text: 'ONE', at: 1, dur: 3, required: true }, { kind: 'END_CARD', text: 'TWO', at: 2, dur: 3, required: true }] });
  assert.ok(clash.planned.dropped.length === 0 || clash.planned.items.length >= 1);
  const apart = scene({ items: [{ kind: 'TITLE', text: 'ONE', at: 1, dur: 3, required: true }, { kind: 'END_CARD', text: 'TWO', at: 20, dur: 3, required: true }] });
  assert.equal(apart.planned.items.length, 2); assert.deepEqual(errors(apart.qa()), []);
  // a required title wins a collision against optional text
  const win = scene({ items: [{ kind: 'KEYWORD', text: 'NOISE', at: 1, dur: 2 }, { kind: 'TITLE', text: 'THE TITLE', at: 1.5, dur: 3, required: true }] });
  assert.deepEqual(win.planned.items.map((e) => e.kind), ['TITLE']);
});

test('every animation keeps its keyframes inside the visible interval; the exit fade no longer deletes the entrance', () => {
  for (const anim of ['fade', 'slide', 'blur_reveal', 'mask_reveal', 'tracking_reveal', 'word_reveal', 'character_reveal', 'scale_punch', 'kinetic', 'glitch_reveal']) {
    const s = scene({ items: [{ kind: 'TITLE', text: 'ONE TWO THREE', at: 2, dur: 2.5, animation: anim }], animations: [anim] });
    for (const l of s.layers()) { if (l.keyRange) assert.ok(l.keyRange[0] >= l.inPoint - 1e-3 && l.keyRange[1] <= l.outPoint + 1e-3, `${anim}/${l.name}: keys ${l.keyRange} vs ${l.inPoint}-${l.outPoint}`); assert.ok(l.inPoint >= 2 - 1e-3 && l.outPoint <= 4.5 + 1e-3); }
    assert.deepEqual(errors(s.qa()).map((i) => i.code), [], anim);
  }
  const f = scene({ items: [{ kind: 'TITLE', text: 'FADING IN', at: 2, dur: 2.5, animation: 'fade' }], animations: ['fade'] });
  const op = f.m.run(`(function(){ var c = XOXO.getComp('${MASTER}'); var p = c.layer('TXT_TITLE_01').property('ADBE Transform Group').property('ADBE Opacity'); var k = []; for (var i = 1; i <= p.numKeys; i++) k.push(p.keyTime(i) + ':' + p.keyValue(i)); return k.join(','); })()`);
  assert.equal(op.split(',').length, 4, `entrance (2 keys) and exit (2 keys) both exist: ${op}`);
});

// ---- Bug 1/4: rebuild, stale layers, required units -----------------------------------------------------------------

test('rebuild after a previous FAILED text generation: orphan layers named after their text and stale generated layers are pruned, expected ones kept', () => {
  const s = scene({ items: [{ kind: 'TITLE', text: 'THE TITLE', at: 1, dur: 3, required: true, shotId: 'S01' }, { kind: 'KEYWORD', text: 'SPEED', at: 6, dur: 1, shotId: 'S02' }] });
  // what the real run left behind: ten full-length text layers named after their content, plus a layer of a deleted unit
  for (let i = 20; i <= 29; i++) s.m.run(`XOXO.getComp('${MASTER}').layers.addText('J-${i}')`);
  must(s.m, 'layer_add_text', { comp: MASTER, name: 'TXT_KEYWORD_09', text: 'REMOVED', size: 80, start: 3, end: 4, role: 'KEYWORD' });
  must(s.m, 'layer_add_shape', { comp: MASTER, name: 'SHP_LOWER_09_BAR', shapes: [{ type: 'rect', size: [100, 4], fill: '#fff' }], start: 3, end: 4, mark: { k: 'textdecor', id: 'x' } });
  assert.equal(s.layers().length, 2 + 10 + 1);
  const dirty = s.qa(); assert.equal(dirty.filter((i) => i.code === 'TEXT_UNEXPECTED').length, 11, 'QA sees every stale / orphan layer as an error');
  const keep = [...new Set(Object.values(s.meta.unitNames).flat())];
  const pr = must(s.m, 'layers_prune', { comp: MASTER, keep, kinds: ['text', 'textdecor'], orphans: true });
  assert.equal(pr.count, 12, JSON.stringify(pr.removed));
  assert.deepEqual(s.layers().map((l) => l.name).sort(), ['TXT_KEYWORD_01', 'TXT_TITLE_01']);
  assert.deepEqual(s.qa().filter((i) => i.code === 'TEXT_UNEXPECTED'), []);
  // a user's own text layer (not auto-named, not marked) is never touched
  must(s.m, 'layer_add_solid', { comp: MASTER, name: 'BG' }); s.m.run(`(function(){ var c = XOXO.getComp('${MASTER}'); var l = c.layers.addText('Notes to self'); l.name = 'My notes'; })()`);
  must(s.m, 'layers_prune', { comp: MASTER, keep, kinds: ['text', 'textdecor'], orphans: true });
  assert.ok(s.layers().some((l) => l.name === 'My notes'), 'user layers survive');
});

test('required TITLE / END_CARD are never silently dropped: they survive every failing animation (down to a plain static layer) and fail the build loudly if even that fails', async () => {
  const entries = planText([{ kind: 'TITLE', text: 'J20 STEALTH', at: 0.5, dur: 3, required: true, shotId: 'S01', animation: 'scale_punch' }, { kind: 'END_CARD', text: 'THANK YOU', at: 20, dur: 3, required: true, shotId: 'S09', animation: 'fade' }, { kind: 'KEYWORD', text: 'EXTRA', at: 8, dur: 1, shotId: 'S03' }], { comp: { name: MASTER, w: 1920, h: 1080 }, editType: EDIT_TYPES.velocity, seed: 1, fps: FPS }).items;
  const mkBuild = () => ({ stages: [{ id: 'text', label: 'text', units: entries.map((e) => { const u = buildTextUnit(e, { comp: { name: MASTER, w: 1920, h: 1080 }, fps: FPS, caps: null }); return { ...u, primary: u.names[0] }; }) }], meta: { warnings: [], resolutions: [] } });
  // sabotage the HOST ops (the executor sends whole units as one batch, so the failure has to happen inside After Effects' side)
  const sabotage = (failing) => { const mock = createMockAE(); must(mock, 'comp_ensure', { name: MASTER, width: 1920, height: 1080, fps: FPS, duration: 30 }); mock.context.__failing = failing; mock.run(`(function(){ var failing = __failing; var keep = {}; for (var k in XOXO.ops) { if (!XOXO.ops.hasOwnProperty(k)) continue; (function(name, fn){ XOXO.ops[name] = function(a){ if (failing(name, a)) throw XOXO.err('sabotaged ' + name, 'EFFECT_UNAVAILABLE', true); return fn(a); }; })(k, XOXO.ops[k]); } })()`); return mock; };
  const run = async (mock, build) => executeBuild(new Bridge(new MockTransport({ mock }), { config: testConfig({}) }), build, {});
  // every animation op fails -> the plain alternative still creates the layers
  const noAnim = sabotage((op) => ['keyframes', 'text_reveal', 'layer_effect_add', 'effect_param_keys'].includes(op));
  const r1 = await run(noAnim, mkBuild()); assert.equal(r1.success, true, JSON.stringify(r1.errors));
  const names = must(noAnim, 'inspect', {}).items.find((i) => i.name === MASTER).layers.map((l) => l.name);
  for (const n of ['TXT_TITLE_01', 'TXT_END_01', 'TXT_KEYWORD_01']) assert.ok(names.includes(n), `${n} exists even though every animation failed: ${names}`);
  // text creation itself fails for the title: a REQUIRED unit fails the build, an optional one is reported as dropped
  const noTitle = sabotage((op, a) => op === 'layer_add_text' && (a.name === 'TXT_TITLE_01' || a.name === 'TXT_KEYWORD_01'));
  const r2 = await run(noTitle, mkBuild());
  assert.equal(r2.success, false, 'a required title that cannot be created fails the build'); assert.ok(r2.errors.some((e) => /TITLE/.test(e.label)), JSON.stringify(r2.errors));
  assert.ok(r2.degraded.some((d) => /KEYWORD/.test(d.label)), 'the optional keyword is merely reported as dropped'); assert.ok(!r2.errors.some((e) => /KEYWORD/.test(e.label)));
  // the failed attempts left no orphan layers
  assert.ok(!must(noTitle, 'inspect', {}).items.find((i) => i.name === MASTER).layers.some((l) => /STEALTH|EXTRA/.test(l.name)));
});

// ---- Bug 5: verified repair --------------------------------------------------------------------------------------------

function verifyFixture(s, { w = 1920, h = 1080 } = {}) {
  const dir = tmpDir('xoxo-verify-'); const cfg = testConfig({});
  const bridge = new Bridge(new MockTransport({ mock: s.m }), { config: cfg });
  const plan = { mode: 'timeline', output: { width: w, height: h, fps: FPS }, style: 'cinematic-documentary', audio: { music: [], narration: null, sfxEvents: [] }, timeline: { duration: 60 }, captions: {}, look: {} };
  const build = { stages: [], meta: { ...s.meta, fps: FPS, sceneComps: [], shotLayers: [], expectedUnits: [], assetsUsed: [] } };
  const prj = { narration: null, paths: { qa: path.join(dir, 'QA_REPORT.json'), aep: path.join(dir, 'p.aep') } };
  const ctx = { config: cfg, logger: { info() {}, warn() {}, error() {}, debug() {} } };
  return { ctx, bridge, plan, build, prj };
}
const runVerifyOn = (s, extra = {}) => { const f = verifyFixture(s, extra); must(s.m, 'project_save', { path: f.prj.paths.aep.replace(/\\/g, '/') }); return runVerify(f.ctx, { bridge: f.bridge, caps: {}, prj: f.prj, plan: { ...f.plan, timeline: { ...f.plan.timeline, duration: 60 } }, build: f.build, manifest: { assets: [] }, report: null, repair: true, outputPath: path.join(path.dirname(f.prj.paths.qa), 'x.mp4'), dryRun: true, ...extra.verify }); };

test('verified repair: check -> repair -> re-inspect -> check again; a repair counts only when re-inspection proves the problem gone', async () => {
  const s = scene({ animations: ['fade'], items: [{ kind: 'TITLE', text: 'THE FUTURE OF SPEED', at: 1, dur: 3, required: true, animation: 'fade' }] });
  // knock the title out of frame (the report: left -78 px) and add a stale layer
  must(s.m, 'set_property', { comp: MASTER, layer: 'TXT_TITLE_01', prop: 'position', value: [-300, 540] });
  s.m.run(`XOXO.getComp('${MASTER}').layers.addText('J-21')`);
  assert.ok(codes(s.qa()).includes('TEXT_OUT_OF_FRAME') && codes(s.qa()).includes('TEXT_UNEXPECTED'));
  const r = await runVerifyOn(s);
  assert.equal(r.data.passed, true, JSON.stringify(r.data.errors.map((e) => e.code + ' ' + e.message)));
  const rep = r.data.repairs; assert.ok(rep.length >= 2 && rep.every((x) => x.success && x.verified), JSON.stringify(rep));
  assert.ok(rep.some((x) => x.code === 'TEXT_OUT_OF_FRAME' && /text_fit/.test(x.action))); assert.ok(rep.some((x) => x.code === 'TEXT_UNEXPECTED' && /prune/.test(x.action)));
  assert.deepEqual(s.layers().map((l) => l.name), ['TXT_TITLE_01']); assert.ok(inSafe(s.layers()[0].bounds, 1920, 1080));
});

test('verified repair: an applied-but-ineffective repair is NOT reported as success - it escalates, stays unverified and QA keeps failing', async () => {
  const s = scene({ animations: ['fade'], items: [{ kind: 'TITLE', text: 'THE FUTURE OF SPEED', at: 1, dur: 3, required: true, animation: 'fade' }] });
  must(s.m, 'set_property', { comp: MASTER, layer: 'TXT_TITLE_01', prop: 'position', value: [-300, 540] });
  const inner = s.m.call.bind(s.m); const calls = [];
  s.m.call = (req) => { if (req.op === 'text_fit') { calls.push(req.args); return { id: req.id, operation: 'text_fit', success: true, data: { fits: true } }; } return inner(req); }; // lies: claims success, changes nothing
  const r = await runVerifyOn(s);
  assert.equal(r.success, false, 'QA still fails because the text is still out of frame'); assert.ok(r.data.errors.some((e) => e.code === 'TEXT_OUT_OF_FRAME'));
  const fit = r.data.repairs.filter((x) => x.code === 'TEXT_OUT_OF_FRAME');
  assert.ok(fit.length >= 2, `retried with a stronger strategy (${fit.map((x) => x.action)})`); assert.ok(fit.every((x) => x.verified === false), 'none is verified');
  assert.ok(fit.some((x) => /rebuild-unit/.test(x.action)) || calls.length >= 2); assert.ok(r.data.warnings.some((w) => w.code === 'REPAIR_NOT_VERIFIED'));
});

// ---- Bug 4/6: the Director's plan ------------------------------------------------------------------------------------

test('timeline normalisation: every text item gets explicit start/end/duration, role, sceneId/shotId and a deterministic id, clamped into its shot', () => {
  const plan = { version: 2, mode: 'timeline', title: 't', output: { width: 1920, height: 1080, fps: 24 }, timeline: { duration: 10, shots: [{ id: 'S01', start: 0, end: 5, template: 'SLATE', layers: [{ kind: 'solid', name: 'BG' }], text: [{ kind: 'TITLE', text: 'HELLO', at: 1 }, { kind: 'KEYWORD', text: 'GO', at: 4.9, dur: 3 }] }, { id: 'S02', start: 5, end: 10, template: 'SLATE', layers: [{ kind: 'solid', name: 'BG2' }], text: [{ kind: 'END_CARD', text: 'BYE', at: 6, dur: 2, required: true }] }], transitions: [{ type: 'cut', d: 0 }] }, audio: {}, look: {} };
  const n = normalizeTimeline(plan); const [t, k] = n.timeline.shots[0].text; const e = n.timeline.shots[1].text[0];
  for (const x of [t, k, e]) { assert.ok(Number.isFinite(x.start) && Number.isFinite(x.end) && Math.abs(x.duration - (x.end - x.start)) < 1e-6); assert.ok(x.layout); }
  assert.equal(t.id, 'TXT_TITLE_01'); assert.equal(k.id, 'TXT_KEYWORD_01'); assert.equal(e.id, 'TXT_END_01'); assert.equal(t.shotId, 'S01'); assert.equal(e.sceneId, 'S02'); assert.equal(e.required, true);
  assert.ok(k.end <= 5 + 1e-6, 'a keyword that ran past its shot is clamped to the shot'); assert.deepEqual(normalizeTimeline(n).timeline.shots.map((s) => s.text.map((x) => x.id)), n.timeline.shots.map((s) => s.text.map((x) => x.id)), 'idempotent');
  const raw = validateTimeline(plan); assert.ok(raw.errors.some((x) => /runs until/.test(x.message)), 'the raw plan is flagged: text must be visible only inside its own shot');
});

test('TEXT_TIMING and unexpected-layer checks name the exact layer; timeline "missing layer" stays an error for required units', () => {
  const s = scene({ items: [{ kind: 'TITLE', text: 'THE TITLE', at: 1, dur: 3, required: true }] });
  must(s.m, 'layer_set', { comp: MASTER, layer: 'TXT_TITLE_01', props: { outPoint: 40 } });
  const t = s.qa().find((i) => i.code === 'TEXT_TIMING'); assert.ok(t && t.severity === 'error' && t.layer === 'TXT_TITLE_01', 'a title that outlives its interval is an error');
  const tl = timelineCheck({ plan: { mode: 'timeline', output: { width: 1920, height: 1080, fps: 24 }, timeline: { duration: 60 }, audio: { music: [] } }, narration: null, inspect: s.inspect(), build: { meta: { fps: 24, sceneComps: [], shotLayers: [], expectedUnits: [{ stage: 'text', comp: MASTER, layer: 'TXT_END_01', optional: false }] } } });
  assert.ok(tl.some((i) => i.code === 'MISSING_LAYER' && i.severity === 'error' && i.layer === 'TXT_END_01'));
});
