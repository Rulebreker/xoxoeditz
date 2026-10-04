import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY, resolveEffect, describeCapabilities, fx } from '../src/effects/registry.js';
import { findEffect } from '../src/effects/capabilities.js';
import { resolveStyle, guessStyle, pickFont } from '../src/motion/styles.js';
import { mergeHostInfo } from '../src/detect/registry.js';
import { DEFAULT_EFFECTS } from '../src/bridge/mock-ae.js';

const effectsList = (names) => names.map((mn) => ({ matchName: mn, displayName: mn.replace('ADBE ', ''), category: 'x' }));
const capsWith = (names, known = true) => (known ? mergeHostInfo({ effects: { known: false } }, { effects: effectsList(names) }) : { effects: { known: false } });

test('resolver picks the best implementation the machine supports and records skips', () => {
  const full = capsWith(['ADBE Turbulent Displace']);
  const a = resolveEffect('transition.glitch', full);
  assert.equal(a.implementation, 'turbulent_displace');
  assert.equal(a.degraded, false);
  assert.equal(a.resolved.effects['ADBE Turbulent Displace'], 'ADBE Turbulent Displace');

  const none = capsWith([]);
  const b = resolveEffect('transition.glitch', none);
  assert.equal(b.implementation, 'jitter_flash');
  assert.equal(b.degraded, true);
  assert.match(b.skipped[0].reason, /not installed/);

  const unknown = resolveEffect('transition.glitch', capsWith([], false));
  assert.equal(unknown.implementation, 'jitter_flash');
  assert.match(unknown.skipped[0].reason, /unknown/);
});

test('runtime failures can exclude an implementation and fall further', () => {
  const caps = capsWith(['ADBE Turbulent Displace']);
  const r = resolveEffect('transition.glitch', caps, { disallow: ['turbulent_displace', 'jitter_flash'] });
  assert.equal(r.implementation, 'hard_cut');
  assert.equal(r.depth, 2);
});

test('every registered effect always has a requirement-free last resort (nothing can block a project)', () => {
  for (const [id, def] of Object.entries(REGISTRY)) {
    const last = [...def.implementations].sort((a, b) => b.quality - a.quality).at(-1);
    assert.deepEqual(last.requires, {}, `${id} last resort must need nothing`);
    const r = resolveEffect(id, capsWith([]));
    assert.ok(r.implementation, `${id} resolves on a bare machine`);
  }
});

test('unknown transition ids degrade to a dissolve instead of failing', () => {
  const r = resolveEffect('transition.sparkle_unicorn', capsWith([]));
  assert.equal(r.id, 'transition.dissolve');
  assert.equal(r.degraded, true);
  assert.equal(resolveEffect('look.nonexistent', capsWith([])).unavailable, true);
});

test('display-name lookup finds effects whose match names differ from the registry guess', () => {
  const caps = mergeHostInfo({}, { effects: [{ matchName: 'ADBE Real Glow', displayName: 'Glow', category: 'Stylize' }] });
  assert.equal(findEffect(caps, fx('ADBE Glo2', 'Glow')), 'ADBE Real Glow');
  assert.equal(findEffect(caps, fx('ADBE Nope', 'Nope')), null);
});

test('plugin/font requirements are honoured by custom registries', () => {
  const reg = { 'x.y': { category: 'x', description: '', implementations: [
    { id: 'plugin', quality: 1, requires: { plugins: ['Sapphire'] }, build: () => [] },
    { id: 'font', quality: 0.8, requires: { fonts: ['Foo-Bold'] }, build: () => [] },
    { id: 'plain', quality: 0.1, requires: {}, build: () => [] }] } };
  assert.equal(resolveEffect('x.y', { plugins: { aex: [] }, fonts: { postScriptNames: [] } }, { registry: reg }).implementation, 'plain');
  assert.equal(resolveEffect('x.y', { plugins: { aex: ['Sapphire_Blur'] } }, { registry: reg }).implementation, 'plugin');
  assert.equal(resolveEffect('x.y', { plugins: { aex: [] }, fonts: { postScriptNames: ['Foo-Bold'] } }, { registry: reg }).implementation, 'font');
});

test('describeCapabilities lists chains for the doctor/effects command', () => {
  const rows = describeCapabilities(capsWith(DEFAULT_EFFECTS.map((e) => e[0])));
  const glitch = rows.find((r) => r.id === 'transition.glitch');
  assert.deepEqual(glitch.chain, ['turbulent_displace', 'jitter_flash', 'hard_cut']);
  assert.equal(glitch.using, 'turbulent_displace');
});

test('styles: aliases, brief guessing, font fallback against installed fonts', () => {
  assert.equal(resolveStyle('military', {}).name, 'military-documentary');
  assert.equal(guessStyle('Create a cinematic J-20 fighter jet documentary'), 'military-documentary');
  assert.equal(guessStyle('a viral youtube short'), 'fast-youtube');
  assert.equal(guessStyle('hello'), 'cinematic-documentary');
  const caps = { fonts: { postScriptNames: ['ArialMT', 'Arial-BoldMT', 'Georgia-Bold'] } };
  const s = resolveStyle('cinematic-documentary', caps);
  assert.equal(s.fonts.display, 'Georgia-Bold');
  assert.equal(s.fonts.body, 'ArialMT');
  assert.ok(s.fontNotes.length >= 1);
  assert.equal(pickFont(['Nope'], { fonts: { postScriptNames: ['ArialMT'] } }).font, 'ArialMT');
  const custom = resolveStyle({ extends: 'tech-explainer', colors: { accent: '#ff00ff' } }, {});
  assert.equal(custom.colors.accent, '#ff00ff');
  assert.equal(custom.colors.bg, '#0b1020');
});
