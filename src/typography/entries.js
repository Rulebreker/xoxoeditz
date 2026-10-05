// TEXT ANIMATIONS as effect-registry entries (`text.anim.<name>`): ten ways for a text layer to arrive, each with a
// fallback chain that ends on something every machine can do. An implementation's build(c, r) returns ONLY the
// animation ops for a text layer that already exists (the engine creates the layer inside every alternative so a
// failed alternative can be retried cleanly). Exceptions: `kinetic` creates its own per-word layers.
//
// c = { comp, layer, t (start), d (length of the entrance), out?: {t,d}, pos:[x,y] (px), w, h, size, text, words:[],
//       beats?: [times], style:{font,color,justify,...}, dir (0|180), strength 0..1, seed }

import { fx, T, key } from '../effects/fx.js';
import { curve } from '../motion/curves.js';
import { lerp } from '../motion/curves.js';

const BLUR = fx('ADBE Gaussian Blur 2', 'Gaussian Blur'); const WIPE = fx('ADBE Linear Wipe', 'Linear Wipe'); const DISPLACE = fx('ADBE Turbulent Displace', 'Turbulent Displace');

const fadeIn = (c, a = 0, b = 1) => key(c.comp, c.layer, 'opacity', [T(c.t + c.d * a, 0), T(c.t + c.d * b, 100)], 'easeOut');
const sampled = (c, prop, from, to, curveSpec, n = 6, t0 = c.t, d = c.d) => {
  const f = curve(curveSpec); const keys = [];
  for (let i = 0; i <= n; i++) { const u = i / n; const e = f(u); keys.push(T(+(t0 + d * u).toFixed(4), Array.isArray(from) ? from.map((v, j) => +lerp(v, to[j], e).toFixed(3)) : +lerp(from, to, e).toFixed(3))); }
  return ['keyframes', { comp: c.comp, layer: c.layer, prop, keys, ease: 'linear' }];
};
const slideOffset = (c) => (c.dir === 180 ? -1 : 1) * c.h * 0.045;
// Position moves are RELATIVE to wherever text_fit finally put the layer (offset -> [0,0]), so the entrance always
// settles exactly on the fitted position.
const slideRel = (c, off, n = 6) => { const f = curve('ease-out-expo'); const keys = []; for (let i = 0; i <= n; i++) { const u = i / n; const e = f(u); keys.push(T(+(c.t + c.d * u).toFixed(4), [+(off[0] * (1 - e)).toFixed(3), +(off[1] * (1 - e)).toFixed(3)])); } return ['keyframes', { comp: c.comp, layer: c.layer, prop: 'position', keys, ease: 'linear', relative: true }]; };

/**
 * Exit animation (all animations may use it): fade out over `out.d`. APPENDS to the opacity keys (clear:false) - the
 * old version replaced them, which silently deleted every entrance fade. Keys stay inside the layer's interval.
 */
export function exitOps(c) {
  if (!c.out) return [];
  return [['keyframes', { comp: c.comp, layer: c.layer, prop: 'opacity', keys: [T(c.out.t, 100), T(c.out.t + c.out.d, 0)], ease: 'linear', clear: false }]];
}

/**
 * Extra fallback animations for roles that must never go missing, tried after the animation's own chain and before the
 * plain static layer. TITLE: slide -> mask reveal -> opacity -> position only. END_CARD: fade -> scale -> controlled exit.
 */
export function roleFallbacks(role) {
  if (role === 'TITLE') return [
    { id: 'title_slide', quality: 0.5, build: (c) => [fadeIn(c, 0, 0.7), slideRel(c, [0, slideOffset(c)])] },
    { id: 'title_opacity', quality: 0.3, build: (c) => [fadeIn(c, 0, 1)] },
    { id: 'title_position', quality: 0.2, build: (c) => [slideRel(c, [0, slideOffset(c)])] },
  ];
  if (role === 'END_CARD') return [
    { id: 'end_fade', quality: 0.4, build: (c) => [fadeIn(c, 0, 1)] },
    { id: 'end_scale', quality: 0.3, build: (c) => [fadeIn(c, 0, 0.6), sampled(c, 'scale', [96, 96], [100, 100], 'ease-out')] },
    { id: 'end_controlled_exit', quality: 0.2, build: () => [] }, // static in, the standard exit fade follows
  ];
  return [];
}

const nativeReveal = (mode, unit) => (c) => [['text_reveal', { comp: c.comp, layer: c.layer, mode, start: c.t, duration: c.d, ...(unit ? { unit } : {}), ...(mode === 'tracking_in' ? { tracking: Math.round(40 + 60 * (c.strength ?? 0.5)) } : {}) }]];
const fadeFallback = { id: 'fade_instead', quality: 0.4, requires: {}, build: (c) => [fadeIn(c, 0, 1)] };

export const TEXT_ANIM_ENTRIES = {
  'text.anim.fade': { category: 'text_anim', description: 'Plain fade up.', implementations: [{ id: 'fade', quality: 1, requires: {}, build: (c) => [fadeIn(c)] }] },

  'text.anim.slide': { category: 'text_anim', description: 'Slides a short distance while fading in.', implementations: [
    { id: 'slide', quality: 1, requires: {}, build: (c) => [fadeIn(c, 0, 0.7), slideRel(c, [0, slideOffset(c)])] },
    fadeFallback,
  ] },

  'text.anim.blur_reveal': { category: 'text_anim', description: 'Resolves out of a blur.', implementations: [
    { id: 'gaussian_blur', quality: 1, requires: { effects: [BLUR] }, build: (c, r) => [
      fadeIn(c, 0, 0.6),
      ['layer_effect_add', { comp: c.comp, layer: c.layer, matchName: r.effects[BLUR.matchName], name: 'Blur', tag: 'textblur', params: {} }],
      ['effect_param_keys', { comp: c.comp, layer: c.layer, effect: 'XOXO:textblur:Blur', param: 'Blurriness', keys: [T(c.t, 40), T(c.t + c.d, 0)] }],
    ] },
    { id: 'scale_settle', quality: 0.55, requires: {}, build: (c) => [fadeIn(c, 0, 0.6), sampled(c, 'scale', [108, 108], [100, 100], 'ease-out')] },
    fadeFallback,
  ] },

  'text.anim.mask_reveal': { category: 'text_anim', description: 'Wiped on from one side.', implementations: [
    { id: 'linear_wipe', quality: 1, requires: { effects: [WIPE] }, build: (c, r) => [
      ['layer_effect_add', { comp: c.comp, layer: c.layer, matchName: r.effects[WIPE.matchName], name: 'Wipe', tag: 'textwipe', params: { 'Wipe Angle': c.dir === 180 ? 270 : 90, Feather: Math.round(c.h * 0.012) } }],
      ['effect_param_keys', { comp: c.comp, layer: c.layer, effect: 'XOXO:textwipe:Wipe', param: 'Transition Completion', keys: [T(c.t, 100), T(c.t + c.d, 0)] }],
    ] },
    { id: 'slide', quality: 0.6, requires: {}, build: (c) => [fadeIn(c, 0, 0.7), slideRel(c, [slideOffset(c) * 2, 0])] },
    fadeFallback,
  ] },

  'text.anim.tracking_reveal': { category: 'text_anim', description: 'Letters spread from tight to their final spacing.', implementations: [
    { id: 'tracking_animator', quality: 1, requires: {}, build: (c) => [...nativeReveal('tracking_in')(c), fadeIn(c, 0, 0.5)] },
    { id: 'scale_settle', quality: 0.55, requires: {}, build: (c) => [fadeIn(c, 0, 0.6), sampled(c, 'scale', [104, 104], [100, 100], 'ease-out')] },
    fadeFallback,
  ] },

  'text.anim.word_reveal': { category: 'text_anim', description: 'Words arrive one after another.', implementations: [
    { id: 'word_animator', quality: 1, requires: {}, build: nativeReveal('fade_up', 'words') },
    { id: 'char_animator', quality: 0.8, requires: {}, build: nativeReveal('fade_up') },
    fadeFallback,
  ] },

  'text.anim.character_reveal': { category: 'text_anim', description: 'Typewriter, letter by letter.', implementations: [
    { id: 'typewriter', quality: 1, requires: {}, build: nativeReveal('typewriter') },
    { id: 'char_fade_up', quality: 0.7, requires: {}, build: nativeReveal('fade_up') },
    fadeFallback,
  ] },

  'text.anim.scale_punch': { category: 'text_anim', description: 'Slams in oversized and settles with a small overshoot.', implementations: [
    { id: 'overshoot_scale', quality: 1, requires: {}, build: (c) => [key(c.comp, c.layer, 'opacity', [T(c.t, 0), T(c.t + Math.min(0.08, c.d * 0.25), 100)], 'linear'), sampled(c, 'scale', [150, 150], [100, 100], 'overshoot:0.18', 8)] },
    fadeFallback,
  ] },

  // one text layer per word, replacing each other at the same spot on the beats (rapid serial presentation)
  'text.anim.kinetic': { category: 'text_anim', description: 'Words flash in one at a time on the beat, each with a punch.', implementations: [
    { id: 'word_by_word', quality: 1, requires: {}, kinetic: true, build: (c) => {
      const words = c.words?.length ? c.words : String(c.text).split(/\s+/).filter(Boolean);
      const total = c.hold ?? c.d; const slots = (c.beats && c.beats.length >= words.length ? c.beats.slice(0, words.length) : words.map((_, i) => c.t + (total * i) / words.length));
      const end = c.t + total; const ops = [['layer_set', { comp: c.comp, layer: c.layer, props: { enabled: false } }]];
      words.forEach((w, i) => {
        const name = `${c.layer}_w${i + 1}`; const t0 = slots[i]; const t1 = i + 1 < words.length ? slots[i + 1] : end;
        ops.push(['layer_add_text', { comp: c.comp, name, text: w, size: c.size, font: c.style?.font, color: c.style?.color, justify: 'center', caps: c.style?.allCaps ? 'upper' : undefined, tracking: c.style?.tracking, position: c.pos, start: t0, end: Math.min(end, Math.max(t1, t0 + 0.12)), role: c.role, mark: { k: 'text', role: c.role, id: name, shot: c.shot } }]);
        if (c.fit) ops.push(['text_fit', { comp: c.comp, layer: name, ...c.fit, hAlign: 'center', maxLines: 1, at: Math.min(end - 0.01, t0 + 0.05) }]);
        ops.push(['keyframes', { comp: c.comp, layer: name, prop: 'scale', keys: [0, 0.2, 0.55, 1].map((u, j) => T(+(t0 + 0.14 * u).toFixed(4), [[135, 135], [96, 96], [102, 102], [100, 100]][j])), ease: 'linear' }]);
      });
      return ops;
    } },
    { id: 'word_animator', quality: 0.7, requires: {}, build: nativeReveal('fade_up', 'words') },
    fadeFallback,
  ] },

  'text.anim.glitch_reveal': { category: 'text_anim', description: 'Flickers and tears in, then locks.', implementations: [
    { id: 'displace_flicker', quality: 1, requires: { effects: [DISPLACE] }, build: (c, r) => [
      ...flicker(c),
      ['layer_effect_add', { comp: c.comp, layer: c.layer, matchName: r.effects[DISPLACE.matchName], name: 'Tear', tag: 'textglitch', params: { Size: 30 } }],
      ['effect_param_keys', { comp: c.comp, layer: c.layer, effect: 'XOXO:textglitch:Tear', param: 'Amount', keys: [T(c.t, 120), T(c.t + c.d * 0.7, 40), T(c.t + c.d, 0)] }],
    ] },
    { id: 'jitter_flicker', quality: 0.6, requires: {}, build: (c) => flicker(c) },
    fadeFallback,
  ] },
};

function flicker(c) {
  const j = c.w * 0.012; // jitter offsets are relative to the fitted position, ending on [0, 0]
  const u = [0, 0.15, 0.3, 0.45, 0.6, 0.8, 1];
  return [
    ['keyframes', { comp: c.comp, layer: c.layer, prop: 'opacity', ease: 'linear', keys: u.map((x, i) => ({ t: +(c.t + c.d * x).toFixed(4), v: [0, 100, 20, 100, 55, 100, 100][i], hold: x < 1 })) }],
    ['keyframes', { comp: c.comp, layer: c.layer, prop: 'position', ease: 'linear', relative: true, keys: u.map((x, i) => ({ t: +(c.t + c.d * x).toFixed(4), v: i === u.length - 1 ? [0, 0] : [(i % 2 ? j : -j) * (6 - i) / 3, ((i % 3) - 1) * j * 0.4], hold: x < 1 })) }],
  ];
}
