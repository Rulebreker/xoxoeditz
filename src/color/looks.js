// COLOR ENGINE: nine named looks, each an effect id `color.<NAME>` with a fallback chain.
//   full stack (tint + saturation + brightness/contrast)  ->  tint only  ->  contrast only  ->  none
// A look is DATA (tint colours, saturation, contrast, brightness at full strength); `lookParams` scales it by the
// edit's colour dial so a documentary at 0.3 and a commercial at 0.8 share the same palette at different strength.
// Everything uses classic, long-stable After Effects effects (no third-party plugins).
//
// NOTE: effect and parameter names below are standard AE ones but have only been exercised against the simulator;
// `xoxo selftest` / the benchmark runner is what proves them on a real installation.

import { fx, T } from '../effects/fx.js';

export const LOOKS = {
  CINEMATIC:   { doc: 'Teal shadows, warm highlights, slightly crushed contrast.', shadow: '#0b2a33', highlight: '#f2d9b8', tint: 24, sat: -6, contrast: 10, brightness: -2 },
  MILITARY:    { doc: 'Olive and khaki, desaturated, gritty contrast.', shadow: '#1c2212', highlight: '#d6d8b4', tint: 28, sat: -28, contrast: 16, brightness: -3 },
  AUTOMOTIVE:  { doc: 'Cool steel shadows, clean bright highlights, strong contrast.', shadow: '#09111b', highlight: '#e8eef6', tint: 18, sat: 4, contrast: 20, brightness: 0 },
  TECH:        { doc: 'Cyan-blue, clean and cold.', shadow: '#03131f', highlight: '#cfe8ff', tint: 26, sat: -2, contrast: 8, brightness: 2 },
  DARK:        { doc: 'Deep blacks, low key, heavy contrast.', shadow: '#000000', highlight: '#c9c9c9', tint: 14, sat: -14, contrast: 26, brightness: -12 },
  VIBRANT:     { doc: 'Saturated, punchy, bright.', shadow: '#10101c', highlight: '#fff1dc', tint: 8, sat: 32, contrast: 10, brightness: 2 },
  DOCUMENTARY: { doc: 'Natural, a touch warm, slightly desaturated.', shadow: '#15130f', highlight: '#f6ecda', tint: 8, sat: -8, contrast: 4, brightness: 0 },
  CLEAN:       { doc: 'Bright and neutral for corporate/explainer work.', shadow: '#101214', highlight: '#ffffff', tint: 0, sat: 4, contrast: 4, brightness: 6 },
  PREMIUM:     { doc: 'Soft warm highlights, controlled saturation, gentle contrast.', shadow: '#12100e', highlight: '#f7e6cf', tint: 16, sat: -6, contrast: 9, brightness: 1 },
};
export const LOOK_NAMES = Object.keys(LOOKS);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Look values at a strength 0..1 (0.5 = the nominal look; 1 = about 1.6x; 0 = untouched). */
export function lookParams(name, strength = 0.5) {
  const L = LOOKS[name]; if (!L) throw new Error(`unknown colour look "${name}" (known: ${LOOK_NAMES.join(', ')})`);
  const k = clamp(strength, 0, 1) * 2 * 0.8; // 0.5 -> 0.8x, 1 -> 1.6x
  return { shadow: L.shadow, highlight: L.highlight, tint: Math.round(clamp(L.tint * k, 0, 70)), sat: Math.round(clamp(L.sat * k, -60, 60)), contrast: Math.round(clamp(L.contrast * k, -40, 45)), brightness: Math.round(clamp(L.brightness * k, -30, 30)) };
}

const TINT = fx('ADBE Tint', 'Tint'); const HUESAT = fx('ADBE HUE SATURATION', 'Hue/Saturation'); const BC = fx('ADBE Brightness & Contrast 2', 'Brightness & Contrast');

const tintOp = (c, r, p) => ['layer_effect_add', { comp: c.comp, layer: c.layer, matchName: r.effects[TINT.matchName], name: 'Tint', tag: 'grade', params: { 'Map Black To': p.shadow, 'Map White To': p.highlight, 'Amount to Tint': p.tint } }];
const satOp = (c, r, p) => ['layer_effect_add', { comp: c.comp, layer: c.layer, matchName: r.effects[HUESAT.matchName], name: 'Saturation', tag: 'grade', params: { 'Master Saturation': p.sat } }];
const bcOp = (c, r, p) => ['layer_effect_add', { comp: c.comp, layer: c.layer, matchName: r.effects[BC.matchName], name: 'Contrast', tag: 'grade', params: { Brightness: p.brightness, Contrast: p.contrast } }];
const P = (name, c) => lookParams(name, c.strength ?? 0.5);

const entry = (name) => ({
  category: 'color', description: `${name} colour look: ${LOOKS[name].doc}`,
  implementations: [
    { id: 'grade_full', quality: 1, requires: { effects: [TINT, HUESAT, BC] }, build: (c, r) => { const p = P(name, c); return [tintOp(c, r, p), satOp(c, r, p), bcOp(c, r, p)]; } },
    { id: 'grade_tint', quality: 0.65, requires: { effects: [TINT] }, build: (c, r) => [tintOp(c, r, P(name, c))] },
    { id: 'grade_contrast', quality: 0.4, requires: { effects: [BC] }, build: (c, r) => [bcOp(c, r, P(name, c))] },
    { id: 'none', quality: 0, requires: {}, build: () => [] },
  ],
});

export const COLOR_LOOK_ENTRIES = Object.fromEntries(LOOK_NAMES.map((n) => [`color.${n}`, entry(n)]));
export const colorEffectId = (profile) => `color.${String(profile || 'CINEMATIC').toUpperCase()}`;
void T;
