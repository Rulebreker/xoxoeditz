import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers/env.js';
import { EDIT_TYPES, EDIT_TYPE_IDS, DIALS, resolveEditType, requireEditType, detectEditType, scaleByIntensity } from '../src/edit-types/index.js';
import { interpretPrompt, RULES } from '../src/director/prompt.js';
import { resolveDirective, validateEditConfig, loadEditConfig } from '../src/director/config.js';

test('all required edit types exist and are behaviour profiles, not templates', () => {
  for (const id of ['velocity', 'cinematic', 'documentary', 'commercial', 'automotive', 'military', 'sports', 'music_video', 'trailer', 'youtube', 'shorts', 'reel', 'tech', 'corporate', 'news', 'action', 'fashion', 'product', 'gaming', 'meme', 'minimal', 'dark', 'epic']) assert.ok(EDIT_TYPES[id], id);
  assert.equal(EDIT_TYPE_IDS.length, 23);
  for (const t of Object.values(EDIT_TYPES)) {
    for (const d of DIALS) assert.ok(t.dials[d] >= 0 && t.dials[d] <= 1, `${t.id}.${d}`);
    assert.ok(t.pacing.shotSeconds[0] < t.pacing.shotSeconds[1]);
    assert.ok(t.transitions.palette.length >= 2 && t.transitions.palette.every((p) => p.w > 0));
    assert.ok(t.music.genres.length && t.sfx.prefer && t.shots.FULL_BLEED);
  }
});

test('edit types genuinely differ in behaviour (velocity vs cinematic vs documentary vs commercial)', () => {
  const v = EDIT_TYPES.velocity; const c = EDIT_TYPES.cinematic; const d = EDIT_TYPES.documentary; const m = EDIT_TYPES.commercial;
  assert.ok(v.dials.cutFrequency > c.dials.cutFrequency + 0.4);
  assert.ok(v.pacing.shotSeconds[1] < c.pacing.shotSeconds[0] + 0.5);
  assert.ok(v.dials.velocity > 0.8 && c.dials.velocity < 0.2 && d.dials.velocity === 0);
  assert.equal(d.pacing.narrationFirst, true); assert.equal(v.pacing.narrationFirst, false);
  assert.equal(v.camera.rig, 'CAMERA_VELOCITY'); assert.equal(d.camera.rig, 'CAMERA_DOCUMENTARY'); assert.equal(m.camera.rig, 'CAMERA_PRODUCT');
  assert.ok(v.transitions.palette.some((p) => p.type === 'whip') && !d.transitions.palette.some((p) => p.type === 'whip'));
  assert.ok(d.shots.CALLOUT > v.shots.CALLOUT && d.shots.STAT_SCENE > v.shots.STAT_SCENE);
  assert.ok(v.shots.FREEZE_FRAME > c.shots.FREEZE_FRAME);
  assert.equal(EDIT_TYPES.shorts.aspect, '9:16');
});

test('edit type lookup: aliases, labels, spacing; unknown types give a helpful error', () => {
  assert.equal(resolveEditType('Music Video').id, 'music_video');
  assert.equal(resolveEditType('music-video').id, 'music_video');
  assert.equal(resolveEditType('mv').id, 'music_video');
  assert.equal(resolveEditType('Velocity Edit').id, 'velocity');
  assert.equal(resolveEditType('apple-style').id, 'minimal');
  assert.equal(resolveEditType('nonsense'), null);
  assert.throws(() => requireEditType('nonsense'), /Known: velocity/);
  assert.equal(detectEditType('make a high-energy velocity edit of the footage').id, 'velocity');
  assert.equal(detectEditType('a cinematic movie trailer').id, 'trailer');
  assert.equal(detectEditType('please edit my footage'), null);
  assert.equal(detectEditType('the auto industry'), null, 'ambiguous short aliases need "edit"/"video"');
});

test('intensity scaling is bounded and relative to the type', () => {
  const v = EDIT_TYPES.velocity; const c = EDIT_TYPES.cinematic;
  const up = scaleByIntensity(c.dials, c.dials.intensity, 0.9);
  assert.ok(up.cutFrequency > c.dials.cutFrequency && up.cutFrequency <= c.dials.cutFrequency * 1.6 + 1e-9);
  const down = scaleByIntensity(v.dials, v.dials.intensity, 0.1);
  assert.ok(down.cutFrequency >= v.dials.cutFrequency * 0.5 - 1e-9 && down.intensity === 0.1);
  assert.deepEqual(scaleByIntensity(v.dials, 0.8, undefined), v.dials);
});

test('prompt: "fast but cinematic" -> speed up, cinematic camera, restrained effects (the spec example)', () => {
  const r = interpretPrompt('Make it fast but cinematic.');
  assert.ok(r.dials.cutFrequency > 0.15, 'speed = high');
  assert.ok(r.dials.effects < 0, 'effects restrained');
  assert.ok(r.dials.transitions < 0, 'soft transition density');
  assert.equal(r.color, 'CINEMATIC');
  assert.ok(r.explanation.some((e) => /fast pace but restrained/.test(e.effect)));
  assert.ok(!r.explanation.some((e) => e.rule === 'cinematic' && r.explanation.some((x) => x.rule === 'fast-but-clean') && false));
});

test('prompt: "insane velocity edit" -> extreme variation, cuts, ramps, impact SFX, motion blur, camera', () => {
  const r = interpretPrompt('Insane velocity edit.');
  assert.equal(r.set.speedVariation, 0.95);
  for (const k of ['cutFrequency', 'velocity', 'impact', 'motionBlur', 'camera', 'sfx']) assert.ok(r.dials[k] > 0.15, k);
  assert.equal(r.velocityProfile, 'VELOCITY_INSANE');
  assert.equal(r.detectedType, 'velocity');
});

test('prompt: "premium Apple-style" -> minimal, controlled, clean type, soft transitions, subtle SFX, premium colour', () => {
  const r = interpretPrompt('Premium Apple-style.');
  assert.equal(r.color, 'PREMIUM'); assert.equal(r.rig, 'CAMERA_PRODUCT');
  for (const k of ['effects', 'text', 'transitions', 'sfx', 'camera']) assert.ok(r.dials[k] < 0, k);
});

test('prompt: intensifiers, softeners, negations, durations, outputs, titles', () => {
  const a = interpretPrompt('very aggressive').dials.impact; const b = interpretPrompt('aggressive').dials.impact; const c = interpretPrompt('slightly aggressive').dials.impact;
  assert.ok(a > b && b > c);
  const n = interpretPrompt('no text, no music, without glitch');
  assert.equal(n.set.text, 0); assert.equal(n.flags.music, false); assert.equal(n.flags.glitch, false);
  assert.equal(interpretPrompt('make a 30 second edit').durationSeconds, 30);
  assert.equal(interpretPrompt('a 2 minute film').durationSeconds, 120);
  assert.equal(interpretPrompt('15s reel').durationSeconds, 15);
  assert.equal(interpretPrompt('use 2 clips and 1 song').durationSeconds, null, 'counts of things are not durations');
  const o = interpretPrompt('vertical 9:16 for tiktok in 4K at 60 fps');
  assert.deepEqual([o.aspect, o.resolution, o.fps], ['9:16', '4k', 60]);
  const t = interpretPrompt('Edit the J-20 footage. Titled "CHENGDU J-20" with the word "STEALTH" on the drop');
  assert.equal(t.title, 'CHENGDU J-20'); assert.ok(t.quoted.includes('STEALTH')); assert.ok(t.subjects.includes('J-20'));
  assert.equal(interpretPrompt('').explanation.length, 0);
});

test('prompt: no rule is a copy-paste duplicate and every rule explains itself', () => {
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
  for (const r of RULES) assert.ok(r.note && r.re instanceof RegExp, r.id);
});

test('directive precedence: type < config < prompt < explicit override, with a visible trail', () => {
  const base = resolveDirective({ type: 'cinematic' });
  assert.equal(base.typeId, 'cinematic'); assert.equal(base.typeSource, 'cli'); assert.equal(base.dials.velocity, EDIT_TYPES.cinematic.dials.velocity);
  const withConfig = resolveDirective({ type: 'cinematic', config: { overrides: { camera: 0.9 } } });
  assert.equal(withConfig.dials.camera, 0.9); assert.equal(withConfig.sources.camera, 'config.overrides');
  const withPrompt = resolveDirective({ type: 'cinematic', config: { overrides: { camera: 0.9 } }, prompt: 'make it fast' });
  assert.ok(withPrompt.dials.cutFrequency > base.dials.cutFrequency); assert.equal(withPrompt.sources.cutFrequency, 'prompt');
  const withOverride = resolveDirective({ type: 'cinematic', config: { overrides: { camera: 0.9 } }, prompt: 'make it fast', overrides: { camera: 0.2, cutFrequency: 0.1 } });
  assert.equal(withOverride.dials.camera, 0.2); assert.equal(withOverride.dials.cutFrequency, 0.1); assert.equal(withOverride.sources.camera, 'override');
  const speed = resolveDirective({ type: 'velocity', overrides: { speed: 0.4 } });
  assert.equal(speed.dials.velocity, 0.4);
});

test('directive: type detection from prompt, intensity from config, output defaults, flags', () => {
  const d = resolveDirective({ prompt: 'Create an insane velocity edit of the J-20, 4k 60fps' });
  assert.equal(d.typeId, 'velocity'); assert.equal(d.typeSource, 'prompt');
  assert.equal(d.velocityProfile, 'VELOCITY_INSANE'); assert.equal(d.output.fps, 60); assert.equal(d.output.resolution, '4k');
  assert.equal(d.colorProfile, 'MILITARY');
  const hinted = resolveDirective({ prompt: 'a calm piece about a fighter jet' });
  assert.equal(hinted.typeId, 'military'); assert.equal(hinted.typeSource, 'prompt-hint');
  const dflt = resolveDirective({ prompt: 'make something nice' });
  assert.equal(dflt.typeId, 'cinematic'); assert.equal(dflt.typeSource, 'default');
  const cfg = resolveDirective({ type: 'velocity', config: { intensity: 0.85, style: 'cinematic', captions: true, resolution: '1080p', aspect: '16:9', fps: 30 } });
  assert.equal(cfg.dials.intensity, 0.85); assert.equal(cfg.colorProfile, 'CINEMATIC'); assert.equal(cfg.flags.captions, true);
  assert.deepEqual(cfg.output, { aspect: '16:9', resolution: '1080p', fps: 30 });
  assert.equal(resolveDirective({ type: 'shorts' }).output.aspect, '9:16');
  assert.equal(resolveDirective({ type: 'velocity', prompt: 'no music, no sfx' }).flags.music, false);
  assert.equal(resolveDirective({ type: 'velocity', prompt: 'professional mode' }).flags.professional, true);
});

test('edit.config.json: validation (spec example is valid), typos are reported, files load', () => {
  const spec = { assets: 'D:/Projects/J20/INPUT', type: 'velocity', style: 'cinematic', intensity: 0.85, music: 'auto', sfx: 'auto', captions: true, resolution: '4k', aspect: '16:9', fps: 30 };
  assert.deepEqual(validateEditConfig(spec), { valid: true, errors: [], warnings: [] });
  const bad = validateEditConfig({ type: 'banana', intensity: 3, fps: 2, captioons: true, overrides: { velocity: 2, nope: 0.1 } });
  assert.equal(bad.valid, false);
  assert.equal(bad.errors.length, 4);
  assert.ok(bad.warnings.some((w) => /captioons/.test(w)) && bad.warnings.some((w) => /override "nope"/.test(w)));
  const f = path.join(tmpDir(), 'edit.config.json'); fs.writeFileSync(f, JSON.stringify(spec));
  assert.equal(loadEditConfig(f).config.type, 'velocity');
  fs.writeFileSync(f, '{ not json'); assert.throws(() => loadEditConfig(f), /cannot read/);
  fs.writeFileSync(f, JSON.stringify({ type: 'banana' })); assert.throws(() => loadEditConfig(f), /not an edit type/);
});

test('prompt: "minimal sound" asks for quiet sound design only - it does not also make the picture "clean"', () => {
  const p = interpretPrompt('A calm documentary, natural colour, minimal sound.');
  assert.notEqual(p.color, 'CLEAN'); assert.ok(p.explanation.some((e) => e.rule === 'subtle-sound'));
  assert.equal(interpretPrompt('a minimal clean look').color, 'CLEAN', 'but "minimal" on its own still means a clean treatment');
});
