import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createMockAE } from '../src/bridge/mock-ae.js';
import { lintAll, lintSource } from '../scripts/lint-jsx.js';
import { tmpDir } from './helpers/env.js';

const call = (m, op, args = {}) => m.call({ id: 't', op, args });
const must = (m, op, args) => { const r = call(m, op, args); assert.equal(r.success, true, `${op}: ${r.error}`); return r.data; };

test('host scripts are ES3-clean', () => {
  assert.deepEqual(lintAll(), []);
  assert.ok(lintSource('x', 'const a = () => 1;').length >= 2, 'lint catches ES6');
  assert.ok(lintSource('x', 'var a = [1].map(function(x){return x;});').length === 1, 'lint catches Array.map');
});

test('JSON polyfill round-trips and refuses to eval', () => {
  const m = createMockAE();
  m.context.__s = JSON.stringify({ a: [1, 2.5, 'x\n"q"', null, true], b: { c: 'é' } });
  const out = m.run('JSON.stringify(JSON.parse(__s))');
  assert.deepEqual(JSON.parse(out), JSON.parse(m.context.__s));
  assert.throws(() => m.run('JSON.parse("{\\"a\\": alert(1)}")'), /JSON parse error/);
});

test('ping reports host + file-access preference', () => {
  const d = must(createMockAE(), 'ping');
  assert.equal(d.xoxo, '0.1.0');
  assert.equal(d.scriptsMayWriteFiles, true);
  assert.equal(must(createMockAE({ allowFileAccess: false }), 'ping').scriptsMayWriteFiles, false);
});

test('unknown ops fail with a structured, non-recoverable error', () => {
  const r = call(createMockAE(), 'definitely_not_an_op');
  assert.equal(r.success, false);
  assert.equal(r.code, 'UNKNOWN_OP');
  assert.equal(r.recoverable, false);
});

test('raw_eval is gated off unless explicitly flagged', () => {
  const m = createMockAE();
  assert.equal(call(m, 'raw_eval', { code: '1+1' }).code, 'DISABLED');
  const r = m.call({ id: 'x', op: 'raw_eval', args: { code: '1+1' }, flags: { rawEval: true } });
  assert.equal(r.success, true);
});

test('project, folders, comps are idempotent', () => {
  const m = createMockAE();
  assert.equal(must(m, 'folder_ensure', { path: '01_FOOTAGE/Stills' }).created, true);
  assert.equal(must(m, 'folder_ensure', { path: '01_FOOTAGE/Stills' }).created, false);
  const c = { name: 'COMP_MASTER', width: 3840, height: 2160, fps: 24, duration: 30, folder: '02_COMPS' };
  assert.equal(must(m, 'comp_ensure', c).created, true);
  const again = must(m, 'comp_ensure', { ...c, duration: 45 });
  assert.equal(again.created, false);
  assert.equal(again.duration, 45);
  assert.equal(must(m, 'project_info').comps.length, 1);
});

test('import_ensure reuses items and rejects missing files', () => {
  const m = createMockAE();
  const dir = tmpDir();
  const f = path.join(dir, 'j20_front.jpg');
  fs.writeFileSync(f, 'x');
  const a = must(m, 'import_ensure', { path: f, name: 'IMG_J20_FRONT', folder: '01_FOOTAGE' });
  const b = must(m, 'import_ensure', { path: f, name: 'IMG_J20_FRONT', folder: '01_FOOTAGE' });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.isStill, true);
  const miss = call(m, 'import_ensure', { path: path.join(dir, 'nope.jpg') });
  assert.equal(miss.success, false);
  assert.equal(miss.code, 'FILE_NOT_FOUND');
  assert.equal(miss.recoverable, false);
});

test('footage layers: cover-fit, source in-point and speed map to AE timing semantics', () => {
  const m = createMockAE();
  const dir = tmpDir();
  const f = path.join(dir, 'clip.mp4'); fs.writeFileSync(f, 'x');
  must(m, 'import_ensure', { path: f, name: 'VID_CLIP' });
  must(m, 'comp_ensure', { name: 'C', width: 3840, height: 2160, fps: 24, duration: 20 });
  const l = must(m, 'layer_add_footage', { comp: 'C', item: 'VID_CLIP', name: 'VID_CLIP_S01', start: 5, end: 8, sourceIn: 2, fit: 'cover' });
  assert.equal(l.inPoint, 5);
  assert.equal(l.outPoint, 8);
  assert.equal(l.baseScale, 200); // 1920x1080 source covering 3840x2160
  const layer = m.app.project._items.find((i) => i.name === 'C').layer('VID_CLIP_S01');
  assert.equal(layer.startTime, 3); // source time 2 sits at comp time 5
  const fast = must(m, 'layer_add_footage', { comp: 'C', item: 'VID_CLIP', name: 'VID_CLIP_S02', start: 0, end: 2, speed: 2 });
  assert.equal(fast.name, 'VID_CLIP_S02');
  assert.equal(m.app.project._items.find((i) => i.name === 'C').layer('VID_CLIP_S02').stretch, 50);
});

test('text, shapes, keyframes with easing, expressions and effects', () => {
  const m = createMockAE();
  must(m, 'comp_ensure', { name: 'C', width: 1920, height: 1080, fps: 24, duration: 10 });
  must(m, 'layer_add_text', { comp: 'C', name: 'TXT_TITLE', text: 'HELLO', size: 120, color: '#ffcc00', font: 'Arial-BoldMT', position: [960, 540] });
  const k = must(m, 'keyframes', { comp: 'C', layer: 'TXT_TITLE', prop: 'opacity', keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }], ease: 'easeOut' });
  assert.equal(k.numKeys, 2);
  assert.deepEqual(k.warnings, []);
  must(m, 'keyframes', { comp: 'C', layer: 'TXT_TITLE', prop: 'position', keys: [{ t: 0, v: [960, 600] }, { t: 1, v: [960, 540] }], ease: 'easeInOut' });
  must(m, 'text_reveal', { comp: 'C', layer: 'TXT_TITLE', mode: 'typewriter', start: 0, duration: 1 });
  must(m, 'expression', { comp: 'C', layer: 'TXT_TITLE', prop: 'rotation', expression: 'wiggle(1, 2)' });
  const bad = call(m, 'expression', { comp: 'C', layer: 'TXT_TITLE', prop: 'rotation', expression: 'wiggle((1, 2' });
  assert.equal(bad.code, 'EXPRESSION_ERROR');
  must(m, 'layer_add_shape', { comp: 'C', name: 'SHP_BAR', shapes: [{ type: 'rect', size: [400, 8], fill: '#ff0000' }, { type: 'line', points: [[0, 0], [300, 0]], stroke: '#fff', trim: true }] });
  must(m, 'layer_effect_add', { comp: 'C', layer: 'TXT_TITLE', matchName: 'ADBE Gaussian Blur 2', params: { Blurriness: 12 }, tag: 'fx1' });
  assert.equal(call(m, 'layer_effect_add', { comp: 'C', layer: 'TXT_TITLE', matchName: 'ADBE Nope' }).code, 'EFFECT_UNAVAILABLE');
  assert.equal(must(m, 'effects_remove_tag', { comp: 'C', layer: 'TXT_TITLE', tag: 'fx1' }).removed, 1);
  const ins = must(m, 'inspect', {});
  const comp = ins.items.find((i) => i.name === 'C');
  assert.equal(comp.layers.length, 2);
  const txt = comp.layers.find((l) => l.name === 'TXT_TITLE');
  assert.equal(txt.text, 'HELLO');
  assert.ok(txt.bounds && txt.bounds.width > 0);
});

test('batch units: a failing unit does not stop later units', () => {
  const m = createMockAE();
  const r = must(m, 'batch', {
    units: [
      { id: 'u1', ops: [{ op: 'comp_ensure', args: { name: 'C', width: 100, height: 100, fps: 24, duration: 1 } }] },
      { id: 'u2', ops: [{ op: 'layer_add_text', args: { comp: 'NOPE', name: 'x', text: 'x' } }, { op: 'ping', args: {} }] },
      { id: 'u3', ops: [{ op: 'folder_ensure', args: { path: 'A' } }] },
    ],
  });
  assert.equal(r.allSucceeded, false);
  assert.deepEqual(r.units.map((u) => u.success), [true, false, true]);
  assert.equal(r.units[1].failedIndex, 0);
  assert.equal(r.units[1].results.length, 1, 'ops after a failure in the same unit are skipped');
});

test('render queue: templates, add, list', () => {
  const m = createMockAE();
  must(m, 'comp_ensure', { name: 'COMP_MASTER', width: 1920, height: 1080, fps: 24, duration: 5 });
  const t = must(m, 'rq_templates');
  assert.ok(t.outputModules.includes('Lossless'));
  const out = path.join(tmpDir(), 'o.mov');
  const add = must(m, 'rq_add', { comp: 'COMP_MASTER', output: out, outputModule: 'Lossless', renderSettings: 'Best Settings' });
  assert.deepEqual(add.warnings, []);
  assert.equal(must(m, 'rq_list').items.length, 1);
  const bad = must(m, 'rq_add', { comp: 'COMP_MASTER', output: out, outputModule: 'No Such Template' });
  assert.equal(bad.warnings.length, 1);
});
