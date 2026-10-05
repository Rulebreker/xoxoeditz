import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAE } from '../src/bridge/mock-ae.js';
import { TEXT_KINDS, TEXT_KIND_NAMES, layoutText, planText, buildTextUnit, charWidth } from '../src/typography/engine.js';
import { REGISTRY, resolveEffect } from '../src/effects/registry.js';
import { EDIT_TYPES } from '../src/edit-types/index.js';
import { OPS_DOC } from '../src/bridge/ops-doc.js';
import { resolveChain } from '../src/effects/registry.js';
import { TRANSITION_META, TRANSITION_TYPES } from '../src/transitions/entries.js';
import { planTransitions, transitionAlternatives } from '../src/transitions/engine.js';
import { colorEffectId, LOOK_NAMES } from '../src/color/looks.js';

const COMP = { name: 'MASTER', w: 3840, h: 2160 };
// capabilities exactly as the simulator reports them
function mockCaps(m) {
  const r = m.call({ id: 'caps', op: 'list_effects', args: {} });
  const byMatchName = {}; for (const e of r.data.effects) byMatchName[e.matchName] = { displayName: e.displayName };
  return { effects: { known: true, byMatchName } };
}
const must = (m, op, args) => { const r = m.call({ id: 't', op, args }); assert.equal(r.success, true, `${op} ${JSON.stringify(args).slice(0, 160)}: ${r.error}`); return r.data; };
function freshComp() {
  const m = createMockAE(); must(m, 'comp_ensure', { name: 'MASTER', width: 3840, height: 2160, fps: 24, duration: 40 });
  return m;
}
const compLayers = (m) => must(m, 'inspect', {}).items.find((i) => i.name === 'MASTER').layers;
const runOps = (m, ops) => { for (const [op, args] of ops) must(m, op, args); };

test('layout: every kind fits the safe area at nominal size; long text shrinks and wraps; absurd text is flagged, never silently clipped', () => {
  const samples = { TITLE: 'THE FUTURE OF SPEED', SUBTITLE: 'Built for the road less travelled', LOWER_THIRD: 'Jordan Reyes', KEYWORD: 'VELOCITY', STAT: '1,200 HP', CALLOUT: 'Carbon brakes', LABEL: 'SYS ONLINE', HUD: 'ALT 4210 FT', END_CARD: 'See you on the road' };
  for (const kind of TEXT_KIND_NAMES) { const l = layoutText(kind, samples[kind], COMP); assert.ok(l.fits, `${kind}: ${l.warnings}`); assert.equal(l.scaled, false, `${kind} shrank`); assert.ok(l.rect.x >= 0 && l.rect.x + l.rect.w <= COMP.w); }
  const long = layoutText('TITLE', 'An exceptionally long headline that keeps going and going', COMP);
  assert.ok(long.fits && long.lines >= 2 && long.warnings.some((w) => /long/.test(w)));
  const huge = layoutText('KEYWORD', 'SUPERCALIFRAGILISTICEXPIALIDOCIOUSNESS', COMP);
  assert.ok(huge.scaled && huge.size < huge.nominalSize && (huge.fits || huge.warnings.some((w) => /even at|outside/.test(w))), 'oversized text shrinks or says why not');
  const edge = layoutText('LOWER_THIRD', 'Jordan Reyes', COMP, { anchor: [0.92, 0.84] }); assert.ok(edge.fits === false && edge.warnings.length, 'a left-justified line anchored at the right edge cannot fit');
  assert.throws(() => layoutText('BANNER', 'x', COMP), /unknown text kind/);
  assert.equal(layoutText('TITLE', 'hello world', COMP).text, 'HELLO WORLD', 'case rule applied');
  const small = layoutText('TITLE', 'HELLO', { w: 1080, h: 1920 }); assert.equal(small.size, Math.round(1920 * TEXT_KINDS.TITLE.size)); assert.ok(small.rect.x >= 0 && small.rect.x + small.rect.w <= 1080, 'portrait frames use the same rules');
  assert.ok(charWidth('HUD', 'i') === charWidth('HUD', 'W') && charWidth('TITLE', 'W') > charWidth('TITLE', 'i'), 'mono is fixed-width, proportional is not');
});

test('plan: animations come from the edit type, never repeat three times, vary, fit, and are reproducible', () => {
  const items = Array.from({ length: 16 }, (_, i) => ({ kind: i % 3 === 0 ? 'KEYWORD' : 'TITLE', text: ['SPEED', 'POWER', 'PRECISION', 'CONTROL'][i % 4], at: i * 3 }));
  const run = (type, seed) => planText(items, { comp: COMP, editType: EDIT_TYPES[type], seed, fps: 24 });
  const a = run('velocity', 's'); assert.equal(a.dropped.length, 0, JSON.stringify(a.dropped));
  const allowed = new Set([...EDIT_TYPES.velocity.typography.animations, 'fade', 'slide', 'scale_punch']);
  for (const it of a.items) assert.ok(allowed.has(it.animation), `${it.animation} not suited to velocity`);
  const anims = a.items.map((i) => i.animation);
  for (let i = 2; i < anims.length; i++) assert.ok(!(anims[i] === anims[i - 1] && anims[i] === anims[i - 2]), `3x ${anims[i]}`);
  assert.ok(new Set(anims).size >= 3, `${new Set(anims).size} different animations: ${[...new Set(anims)]}`);
  assert.deepEqual(run('velocity', 's').items.map((i) => i.animation), anims); assert.notDeepEqual(run('velocity', 'z').items.map((i) => i.animation), anims);
  const doc = run('documentary', 's').items.map((i) => i.animation); assert.ok(!doc.includes('glitch_reveal') && !doc.includes('kinetic'), `documentary: ${doc}`);
  for (const it of a.items) { assert.ok(it.layout.fits); assert.ok(Number.isInteger(it.at * 24 + 1e-9) || Math.abs(it.at * 24 - Math.round(it.at * 24)) < 1e-6, 'on the frame grid'); assert.ok(it.animDur >= 2 / 24); }
  const fast = planText([{ kind: 'TITLE', text: 'HI', at: 0 }], { comp: COMP, editType: { ...EDIT_TYPES.velocity, typography: { animations: ['scale_punch'] } }, dials: { intensity: 1 }, seed: 1 }).items[0];
  const slow = planText([{ kind: 'TITLE', text: 'HI', at: 0 }], { comp: COMP, editType: { ...EDIT_TYPES.velocity, typography: { animations: ['scale_punch'] } }, dials: { intensity: 0 }, seed: 1 }).items[0];
  assert.ok(fast.animDur < slow.animDur && fast.dur < slow.dur, 'high intensity = snappier and shorter');
  const snapped = planText([{ kind: 'KEYWORD', text: 'GO', at: 1.03 }], { comp: COMP, editType: EDIT_TYPES.velocity, snap: () => 1.0, seed: 1, fps: 24 }).items[0]; assert.ok(Math.abs(snapped.at - 1) < 1 / 24);
});

test('plan: texts never cover each other - they move to another anchor, or are dropped with a reason', () => {
  const r = planText([{ kind: 'TITLE', text: 'ONE', at: 0, dur: 3 }, { kind: 'TITLE', text: 'TWO', at: 0.5, dur: 3 }, { kind: 'TITLE', text: 'THREE', at: 1, dur: 3 }], { comp: COMP, editType: EDIT_TYPES.cinematic, seed: 1 });
  const alive = r.items; assert.ok(alive.length >= 1 && alive.length + r.dropped.length === 3);
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
    const a = alive[i]; const b = alive[j]; const overlapT = a.at < b.at + b.dur && b.at < a.at + a.dur;
    if (overlapT) { const A = a.layout.rect; const B = b.layout.rect; assert.ok(!(A.x < B.x + B.w && A.x + A.w > B.x && A.y < B.y + B.h && A.y + A.h > B.y), `${a.text} overlaps ${b.text}`); }
  }
  assert.ok(r.dropped.every((d) => d.reason), 'every drop has a reason');
  assert.equal(planText([{ kind: 'NOPE', text: 'x', at: 0 }], { comp: COMP, editType: EDIT_TYPES.velocity }).dropped[0].reason.includes('unknown text kind'), true);
  const co = planText([{ kind: 'CALLOUT', text: 'Carbon brakes', at: 1, target: { x: 0.8, y: 0.6 } }], { comp: COMP, editType: EDIT_TYPES.automotive, seed: 1 }).items[0];
  assert.ok(co.layout.position[0] < 0.8 * COMP.w, 'a callout for a subject on the right sits to its left'); assert.ok(co.target);
});

test('every text animation resolves everywhere and builds ops the host accepts (simulator), with and without effects', () => {
  const ANIMS = Object.keys(REGISTRY).filter((k) => k.startsWith('text.anim.')).map((k) => k.slice(10));
  assert.equal(ANIMS.length, 10); for (const a of ['fade', 'slide', 'blur_reveal', 'mask_reveal', 'tracking_reveal', 'word_reveal', 'character_reveal', 'scale_punch', 'kinetic', 'glitch_reveal']) assert.ok(ANIMS.includes(a), a);
  const known = new Set(Object.keys(OPS_DOC));
  const m0 = createMockAE(); const full = mockCaps(m0); const bare = { effects: { known: true, byMatchName: {} } };
  for (const caps of [full, bare, null]) for (const animation of ANIMS) {
    const entry = planText([{ kind: 'TITLE', text: 'ONE TWO THREE', at: 2 }], { comp: COMP, editType: { ...EDIT_TYPES.velocity, typography: { animations: [animation] } }, seed: 1 }).items[0] || { id: 'X', kind: 'TITLE', text: 'ONE TWO THREE', animation, at: 2, dur: 2, animDur: 0.5, outDur: 0.25, layout: layoutText('TITLE', 'ONE TWO THREE', COMP) };
    entry.animation = animation;
    const unit = buildTextUnit(entry, { comp: COMP, fps: 24, caps, style: { font: 'ArialMT', color: '#ffffff' }, beats: [2, 2.4, 2.8] });
    assert.ok(unit.alternatives.length >= 2 && unit.alternatives.at(-1).name === 'plain', `${animation}: has a plain last resort`);
    for (const alt of unit.alternatives) {
      for (const [op] of alt.ops) assert.ok(known.has(op), `${animation}/${alt.name}: unknown op ${op}`);
      const m = freshComp(); runOps(m, alt.ops);   // the host itself must accept every alternative, from a clean comp
      runOps(m, alt.ops);                            // and re-running is idempotent (no duplicate layers)
      const layers = compLayers(m).map((l) => l.name);
      assert.equal(new Set(layers).size, layers.length, `${animation}/${alt.name}: duplicate layer names ${layers}`);
      const lname = String(entry.id).startsWith('TXT_') ? entry.id : `TXT_${entry.id}`; assert.ok(layers.includes(lname), `${animation}/${alt.name}: text layer exists`);
    }
  }
  const bareUnit = buildTextUnit({ id: 'B', kind: 'TITLE', text: 'HELLO', animation: 'blur_reveal', at: 0, dur: 2, animDur: 0.5, outDur: 0.25, layout: layoutText('TITLE', 'HELLO', COMP) }, { comp: COMP, caps: bare });
  assert.deepEqual(bareUnit.alternatives.map((a) => a.name), ['scale_settle', 'fade_instead', 'title_slide', 'title_opacity', 'title_position', 'plain'], 'without Gaussian Blur the chain degrades in order, then the TITLE role fallbacks, then a plain static layer');
});

test('kinetic type: one layer per word on the beats, replacing each other at the same spot; base layer is hidden', () => {
  const entry = planText([{ kind: 'TITLE', text: 'BUILT FOR SPEED', at: 4, dur: 2 }], { comp: COMP, editType: { ...EDIT_TYPES.velocity, typography: { animations: ['kinetic'] } }, seed: 1 }).items[0];
  const unit = buildTextUnit(entry, { comp: COMP, caps: null, beats: [4.0, 4.5, 5.0, 5.5] });
  const ops = unit.alternatives[0].ops; const words = ops.filter(([n, a]) => n === 'layer_add_text' && /_w\d$/.test(a.name));
  assert.equal(words.length, 3); assert.deepEqual(words.map(([, a]) => a.text), ['BUILT', 'FOR', 'SPEED']);
  assert.deepEqual(words.map(([, a]) => a.start), [4, 4.5, 5]); assert.ok(words.every(([, a]) => a.position[0] === entry.layout.position[0]), 'all words share one position');
  assert.ok(words[0][1].end <= words[1][1].start + 1e-9 || words[0][1].end === words[1][1].start, 'each word ends when the next begins');
  assert.ok(ops.some(([n, a]) => n === 'layer_set' && a.props.enabled === false), 'the full-text base layer is hidden');
  const m = freshComp(); runOps(m, ops); runOps(m, ops);
  assert.equal(compLayers(m).filter((l) => /_w\d$/.test(l.name)).length, 3, 'idempotent');
});

test('decor: lower-thirds get an accent bar, callouts a leader line and dot - all named, intentional shapes', () => {
  const lt = planText([{ kind: 'LOWER_THIRD', text: 'Jordan Reyes', at: 1 }], { comp: COMP, editType: EDIT_TYPES.documentary, seed: 1 }).items[0];
  const u1 = buildTextUnit(lt, { comp: COMP, accent: '#ffcc00' }); const shapes = u1.alternatives[0].ops.filter(([n]) => n === 'layer_add_shape');
  assert.equal(shapes.length, 1); assert.match(shapes[0][1].name, /^SHP_.*_BAR$/);
  const co = planText([{ kind: 'CALLOUT', text: 'Carbon brakes', at: 1, target: { x: 0.7, y: 0.6 } }], { comp: COMP, editType: EDIT_TYPES.automotive, seed: 1 }).items[0];
  const u2 = buildTextUnit(co, { comp: COMP }); assert.deepEqual(u2.alternatives[0].ops.filter(([n]) => n === 'layer_add_shape').map(([, a]) => a.name.replace(/^SHP_[^_]+_?\w*?_/, '')), ['LEADER', 'DOT']);
  for (const u of [u1, u2]) for (const alt of u.alternatives) { const m = freshComp(); runOps(m, alt.ops); }
  assert.ok(u2.names.some((n) => n.endsWith('_LEADER')) && u2.names.some((n) => n.endsWith('_DOT')), 'unit lists every layer it owns for idempotent removal');
});

test('shot transitions and colour looks: every alternative the registry can produce is accepted by the host (simulator)', () => {
  const m0 = createMockAE(); const full = mockCaps(m0); const bare = { effects: { known: true, byMatchName: {} } };
  const mk = () => { const m = freshComp(); must(m, 'layer_add_solid', { comp: 'MASTER', name: 'A', color: '#aa0000', start: 0, end: 6 }); must(m, 'layer_add_solid', { comp: 'MASTER', name: 'B', color: '#0000aa', start: 5, end: 12 }); return m; };
  let ran = 0;
  for (const caps of [full, bare]) for (const type of TRANSITION_TYPES) for (const withOut of [true, false]) {
    if (type === 'light_leak') continue; // needs a real overlay asset: covered in the planner test
    const e = planTransitions([{ id: 'A', start: 0, end: 5.25 }, { id: 'B', start: 5.25, end: 12 }], { editType: EDIT_TYPES.velocity, caps, seed: 1, force: { 0: type }, fps: 24, bpm: 128 })[0];
    e.d = type === 'cut' ? 0 : 0.5; e.window = { start: 5, end: 5.5 }; e.outAt = 5;
    for (const alt of transitionAlternatives(e, caps, { comp: 'MASTER', incoming: 'B', outgoing: withOut ? 'A' : null, w: 3840, h: 2160, fps: 24 })) { const m = mk(); runOps(m, alt.ops); ran++; }
  }
  assert.ok(ran > 60, `${ran} transition alternatives exercised`);
  for (const caps of [full, bare]) for (const name of LOOK_NAMES) for (const impl of resolveChain(colorEffectId(name), caps).chain) {
    const m = mk(); must(m, 'layer_add_adjustment', { comp: 'MASTER', name: 'ADJ_GRADE', start: 0, end: 12 });
    runOps(m, impl.build({ comp: 'MASTER', layer: 'ADJ_GRADE', strength: 0.6 }, impl.resolved)); ran++;
  }
  assert.ok(ran > 100);
  assert.equal(resolveEffect('shot.transition.whip', full).implementation, 'whip_directional_blur', 'the simulator advertises the effects, so the full-quality variants run in dry-runs');
  void TRANSITION_META;
});
