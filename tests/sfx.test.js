import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, testConfig } from './helpers/env.js';
import { hasFfmpeg } from './helpers/media.js';
import { generateStarterSfx } from '../src/library/starter.js';
import { scanLibrary } from '../src/library/scan.js';
import { expandQuery, searchLibrary, pick, ROLE_QUERY, categoriesForRole } from '../src/sfx/search.js';
import { planSfxFit, layeringFor, thinEvents, makeFitVersion, finalLevelDb, BASE_GAIN_DB } from '../src/sfx/fit.js';
import { EDIT_TYPES } from '../src/edit-types/index.js';
import { makeRng } from '../src/core/rng.js';
import { probeFile } from '../src/assets/probe.js';

let lib; let cfg;
async function library() {
  if (lib) return lib;
  cfg = testConfig({}); const root = tmpDir();
  await generateStarterSfx(cfg, root);
  lib = await scanLibrary(cfg, root);
  return lib;
}
const names = (rs) => rs.map((r) => path.basename(r.asset.file, '.wav'));

test('query expansion: the spec phrases map to the spec terms; synonyms get lower weight', () => {
  const fast = expandQuery('fast transition');
  for (const t of ['whoosh', 'fast', 'transition']) assert.ok(fast.get(t) >= 1.2, t);
  assert.ok(fast.get('swoosh') < fast.get('whoosh'), 'synonym weighs less than the primary term');
  const imp = expandQuery('impact'); for (const t of ['impact', 'hit', 'cinematic']) assert.ok(imp.has(t), t);
  const ui = expandQuery('technical UI'); for (const t of ['digital', 'click', 'ui', 'electronic']) assert.ok(ui.has(t), t);
  const cam = expandQuery('camera punch'); for (const t of ['camera', 'movement', 'hit']) assert.ok(cam.has(t), t);
  assert.ok(expandQuery({ terms: { riser: 2 } }).get('riser') === 2);
  assert.equal(expandQuery('').size, 0);
});

test('searching the library: the four spec examples find the right family of sounds', { skip: !hasFfmpeg }, async () => {
  const m = await library();
  const t = searchLibrary(m, 'fast transition'); assert.match(names(t)[0], /^fast_whoosh/, `fast transition -> ${names(t)}`);
  assert.ok(!names(t).slice(0, 2).includes('slow_whoosh_01'), 'a slow whoosh is not the second-best "fast transition"');
  const i = searchLibrary(m, 'impact'); assert.ok(['IMPACT', 'HIT', 'BOOM'].includes(i[0].asset.subcategory), `impact -> ${names(i)}`);
  const u = searchLibrary(m, 'technical UI'); assert.ok(u.slice(0, 3).every((r) => ['UI', 'DIGITAL', 'CLICK', 'TICK'].includes(r.asset.subcategory)), `technical UI -> ${names(u)}`);
  const c = searchLibrary(m, 'camera punch'); assert.ok(names(c).slice(0, 2).some((n) => /punch_hit|camera_shutter/.test(n)), `camera punch -> ${names(c)}`);
  const r = searchLibrary(m, 'riser'); assert.ok(['RISER', 'REVERSE', 'SWELL'].includes(r[0].asset.subcategory), `riser -> ${names(r)}`);
  const g = searchLibrary(m, 'glitch'); assert.equal(g[0].asset.subcategory, 'GLITCH');
  assert.ok(t[0].reasons.matched.length >= 2 && t[0].reasons.text > 0.2, `results explain themselves: ${JSON.stringify(t[0].reasons)}`);
});

test('context shapes the choice: edit-type affinity, energy, duration, preferred categories', { skip: !hasFfmpeg }, async () => {
  const m = await library();
  const vel = searchLibrary(m, 'transition', { editType: 'velocity', preferSubs: EDIT_TYPES.velocity.sfx.prefer.transition });
  const cin = searchLibrary(m, 'transition', { editType: 'cinematic', preferSubs: EDIT_TYPES.cinematic.sfx.prefer.transition });
  assert.equal(vel[0].asset.subcategory, 'WHOOSH'); assert.equal(cin[0].asset.subcategory, 'SWOOSH');
  // energy matching is isolated on a hand-built manifest so the test measures the scoring, not the starter sounds
  const mk = (id, energy) => ({ id, file: `${id}.wav`, type: 'sfx', subcategory: 'WHOOSH', tags: ['whoosh', 'transition'], energy, intensity: 0.5, duration: 0.6 });
  const synth = { assets: [mk('a_calm', 0.1), mk('b_mid', 0.5), mk('c_wild', 0.95)] };
  assert.equal(searchLibrary(synth, 'whoosh', { energy: 0.95 })[0].asset.id, 'c_wild');
  assert.equal(searchLibrary(synth, 'whoosh', { energy: 0.1 })[0].asset.id, 'a_calm');
  const short = searchLibrary(m, 'hit', { duration: 0.3 }); const long = searchLibrary(m, 'boom', { duration: 2.2 });
  assert.ok(short[0].asset.duration < 1, `0.3 s event -> ${names(short)[0]}`); assert.ok(long[0].asset.duration > 1.5, `2.2 s event -> ${names(long)[0]}`);
  assert.deepEqual(names(searchLibrary(m, 'fast transition')), names(searchLibrary(m, 'fast transition')), 'deterministic');
  assert.ok(!names(searchLibrary(m, 'impact', { exclude: [searchLibrary(m, 'impact')[0].asset.id] })).includes(names(searchLibrary(m, 'impact'))[0]));
  assert.deepEqual(searchLibrary(m, 'zzz qqq'), [], 'nonsense finds nothing rather than something random');
});

test('diversity: repeated requests rotate through suitable sounds instead of repeating one', { skip: !hasFfmpeg }, async () => {
  const m = await library(); const usage = {}; const chosen = [];
  for (let i = 0; i < 8; i++) { const r = pick(searchLibrary(m, 'fast transition', { usage }), {}); usage[r.asset.id] = (usage[r.asset.id] || 0) + 1; chosen.push(r.asset.id); }
  assert.ok(new Set(chosen).size >= 3, `${new Set(chosen).size} distinct sounds over 8 transitions`);
  const maxRun = chosen.reduce((m2, id, i) => (i && id === chosen[i - 1] ? m2 + 1 : m2), 0); assert.ok(maxRun <= 3);
  const a = pick(searchLibrary(m, 'impact'), { rng: makeRng('x') }); const b = pick(searchLibrary(m, 'impact'), { rng: makeRng('x') });
  assert.equal(a.asset.id, b.asset.id, 'seeded choice is reproducible');
  const mem = searchLibrary(m, 'impact', { memory: { [searchLibrary(m, 'impact')[1].asset.id]: 1 } });
  assert.ok(mem[0].score >= searchLibrary(m, 'impact')[0].score - 0.1, 'memory nudges, never overrides relevance');
  assert.ok(ROLE_QUERY.transition && categoriesForRole(EDIT_TYPES.velocity, 'transition').includes('WHOOSH'));
});

test('fit: the transient lands on the event; risers END on it; heads are trimmed instead of starting before 0', { skip: !hasFfmpeg }, async () => {
  const m = await library(); const by = (n) => m.assets.find((a) => a.file.endsWith(`${n}.wav`));
  const imp = by('cinematic_impact_01'); const fit = planSfxFit(imp, { at: 10, role: 'impact' }, { sfxDial: 0.5 });
  assert.ok(Math.abs(fit.alignedPeak - 10) < 1e-3, 'the measured peak sits exactly on the event');
  assert.ok(fit.start <= 10 && fit.start >= 9.9);
  const whoosh = by('fast_whoosh_01'); const wf = planSfxFit(whoosh, { at: 5, role: 'transition' });
  assert.ok(Math.abs(wf.alignedPeak - 5) < 1e-3 && wf.start < 5 - 0.05, 'whoosh peak (mid-sound) is on the cut, so it starts BEFORE it');
  const riser = by('noise_riser_01'); const rf = planSfxFit(riser, { at: 8, role: 'riser' });
  assert.equal(rf.align, 'end'); assert.ok(Math.abs(rf.end - 8) < 1e-3, 'riser ends on the drop'); assert.ok(rf.layers[0].fadeIn > 0.3);
  const early = planSfxFit(riser, { at: 1.2, role: 'riser' });
  assert.equal(early.start, 0); assert.ok(early.layers[0].sourceIn > 1.5, 'head cut so it still ends on the event'); assert.ok(early.notes.some((n) => /head trimmed/.test(n)));
  const amb = by('room_tone_01'); const af = planSfxFit(amb, { at: 2, role: 'ambience', maxLength: 3 });
  assert.equal(af.layers[0].sourceOut, 3); assert.ok(af.notes.some((n) => /trimmed/.test(n))); assert.ok(af.layers[0].fadeOut >= 0.5);
  for (const f of [fit, wf, rf, af]) { assert.ok(f.layers[0].gainDb <= -2 && f.layers[0].gainDb >= -40); assert.ok(f.layers[0].fadeOut >= 0.03 && f.layers[0].fadeIn > 0); }
});

test('fit: level is normalised by measured loudness and ordered by role; stretch is limited; layering and thinning keep the mix clean', { skip: !hasFfmpeg }, async () => {
  const m = await library(); const by = (n) => m.assets.find((a) => a.file.endsWith(`${n}.wav`));
  // compare where each sound ends up in the mix (measured RMS + planned gain), not the raw gain: quiet files get boosted
  const lvl = (n, role) => { const a = by(n); return finalLevelDb(a, planSfxFit(a, { at: 3, role })); };
  assert.ok(lvl('cinematic_impact_01', 'impact') > lvl('fast_whoosh_01', 'transition') - 2, 'impacts sit above whooshes');
  assert.ok(lvl('ui_blip_01', 'ui') < lvl('cinematic_impact_01', 'impact') - 6, 'UI blips sit well below impacts');
  assert.ok(lvl('room_tone_01', 'ambience') < lvl('cinematic_impact_01', 'impact') - 6);
  for (const a of m.assets) { const f = planSfxFit(a, { at: 3, role: 'impact' }); assert.ok(a.features.peakDb + f.layers[0].gainDb <= -3 + 0.05, `${a.file} peak stays below -3 dBFS`); }
  assert.ok(planSfxFit(by('fast_whoosh_01'), { at: 3, role: 'transition' }, { sfxDial: 1 }).layers[0].gainDb > planSfxFit(by('fast_whoosh_01'), { at: 3, role: 'transition' }, { sfxDial: 0 }).layers[0].gainDb);
  const s1 = planSfxFit(by('fast_whoosh_01'), { at: 3, role: 'transition', targetLength: 0.62 }, { allowStretch: true }); const s2 = planSfxFit(by('fast_whoosh_01'), { at: 3, role: 'transition', targetLength: 3 }, { allowStretch: true });
  assert.ok(s1.layers[0].stretch !== 1 && Math.abs(s1.layers[0].stretch - 1) <= 0.08); assert.equal(s2.layers[0].stretch, 1, 'never stretches far (pitch!)');
  assert.deepEqual(layeringFor('impact', 0.9, 1), []);
  assert.equal(layeringFor('impact', 0.9, 2)[0].role, 'drop'); assert.ok(layeringFor('impact', 0.9, 3).length === 2); assert.deepEqual(layeringFor('impact', 0.3, 3), []);
  const mk = (at, db) => ({ at, layers: [{ gainDb: db }] });
  const thin = thinEvents([mk(1, -10), mk(1.02, -12), mk(1.04, -8), mk(2, -9)], { window: 0.08, max: 2 });
  assert.equal(thin.length, 3); assert.ok(thin.some((p) => p.layers[0].gainDb === -8) && !thin.some((p) => p.layers[0].gainDb === -12), 'weakest dropped');
  assert.ok(BASE_GAIN_DB.big_impact > BASE_GAIN_DB.transition && BASE_GAIN_DB.ambience < BASE_GAIN_DB.ui);
});

test('fit version: a trimmed + faded copy is written with the right length; the original is untouched', { skip: !hasFfmpeg }, async () => {
  const m = await library(); const amb = m.assets.find((a) => a.file.endsWith('room_tone_01.wav'));
  const before = fs.statSync(amb.path).mtimeMs;
  const fit = planSfxFit(amb, { at: 2, role: 'ambience', maxLength: 2.5 });
  const out = await makeFitVersion(cfg, amb, fit, path.join(tmpDir(), 'fit cache'));
  const meta = await probeFile(out, 'audio', cfg);
  assert.ok(Math.abs(meta.duration - 2.5) < 0.1, `fit length ${meta.duration}`);
  assert.equal(fs.statSync(amb.path).mtimeMs, before);
  assert.equal(await makeFitVersion(cfg, amb, fit, path.dirname(out)), out, 'cached on the second call');
});

test('CLI: xoxo library search ranks the starter pack and explains its picks', { skip: !hasFfmpeg }, async () => {
  const { spawnSync } = await import('node:child_process');
  const { baseEnv } = await import('./helpers/env.js');
  const root = tmpDir(); const ws = tmpDir(); const env = { ...baseEnv(), XOXOEDITZ_ASSETS: root, XOXO_WORKSPACE: ws };
  const bin = path.resolve('bin/xoxo.js'); const x = (...a) => spawnSync(process.execPath, [bin, ...a, '--json'], { env, encoding: 'utf8' });
  assert.equal(JSON.parse(x('library', 'starter').stdout).success, true);
  assert.equal(JSON.parse(x('library', 'scan').stdout).success, true);
  const r = JSON.parse(x('library', 'search', 'fast', 'transition').stdout);
  assert.equal(r.success, true); assert.match(r.data.results[0].file, /fast_whoosh/); assert.ok(r.data.results[0].reasons.matched.length);
});
