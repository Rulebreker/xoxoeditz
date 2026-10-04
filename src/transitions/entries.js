// SHOT-LEVEL TRANSITIONS as effect-registry entries (`shot.transition.<type>`), each with an ordered fallback chain
// whose last link needs nothing. Unlike the scene transitions in registry.js (which keyframe layer transforms
// directly), these are built for the TIMELINE model where every shot's position/scale/rotation belongs to ONE camera
// track. An implementation therefore has two halves:
//   motion(c) -> { outgoing: [primitive specs], incoming: [...] }   shot-relative camera moves (composed into the track)
//   build(c, r) -> ops                                               opacity, overlays, effects, mattes
//
// Context `c`: { comp, id, incoming, outgoing, t, d, outAt, inAt, w, h, fps, dir, strength, overlayAsset? }
//   t/d      master-time start and length of the transition window (centred on the cut, both layers cover it)
//   outAt    window start measured from the OUTGOING layer's own start; inAt the same for the incoming layer
// All times are seconds. Effects named here are classic AE effects; they are only exercised against the simulator
// until `xoxo selftest` / the benchmark runner has run on a real machine.

import { fx, T, key } from '../effects/fx.js';

const DIRBLUR = fx('ADBE Motion Blur', 'Directional Blur'); const RADIAL = fx('CC Radial Fast Blur', 'CC Radial Fast Blur');
const EXPOSURE = fx('ADBE Exposure2', 'Exposure'); const WAVE = fx('ADBE Wave Warp', 'Wave Warp'); const DISPLACE = fx('ADBE Turbulent Displace', 'Turbulent Displace');
const RAMP = fx('ADBE Ramp', 'Gradient Ramp'); const WIPE = fx('ADBE Linear Wipe', 'Linear Wipe');

const nm = (c, s) => `FX_${c.id}_${s}`;
const fade = (c, layer, from, to, a = 0, b = 1, ease = 'linear') => key(c.comp, layer, 'opacity', [T(c.t + c.d * a, from), T(c.t + c.d * b, to)], ease);
const solid = (c, name, color, blend, keys) => [
  ['layers_remove', { comp: c.comp, names: [name] }],
  ['layer_add_solid', { comp: c.comp, name, color, start: c.t, end: c.t + c.d, blend }],
  key(c.comp, name, 'opacity', keys, 'linear'),
];
const dissolveOps = (c, ease = 'easeInOut') => [key(c.comp, c.incoming, 'opacity', [T(c.t, 0), T(c.t + c.d, 100)], ease)];
const effectKeys = (c, layer, matchName, name, tag, param, keys, params = {}) => [
  ['layer_effect_add', { comp: c.comp, layer, matchName, name, tag, params }],
  ['effect_param_keys', { comp: c.comp, layer, effect: `XOXO:${tag}:${name}`, param, keys }],
];
const motionBlurOn = (c) => [['layer_set', { comp: c.comp, layer: c.incoming, props: { motionBlur: true } }], ...(c.outgoing ? [['layer_set', { comp: c.comp, layer: c.outgoing, props: { motionBlur: true } }]] : [])];
const dir = (c) => c.dir ?? 0;
const half = (c) => c.d / 2;
const none = () => ({ outgoing: [], incoming: [] });
const dissolveInstead = { id: 'dissolve_instead', quality: 0.3, requires: {}, motion: none, build: (c) => dissolveOps(c) };

// --- motion halves, shared by the effect and no-effect variants of a transition ---
const whipMotion = (c) => ({
  outgoing: [{ type: 'WHIP', mode: 'out', at: c.outAt, dur: half(c), amount: 0.45 + 0.25 * (c.strength ?? 0.5), dir: dir(c), curve: 'ease-in-expo' }],
  incoming: [{ type: 'WHIP', mode: 'in', at: c.inAt + half(c), dur: half(c), amount: 0.45 + 0.25 * (c.strength ?? 0.5), dir: dir(c), curve: 'ease-out-expo' }],
});
const whipOpacity = (c) => [...(c.outgoing ? [fade(c, c.outgoing, 100, 0, 0.45, 0.55)] : []), fade(c, c.incoming, 0, 100, 0.45, 0.55)];
const zoomMotion = (c) => ({
  outgoing: [{ type: 'PUSH', at: c.outAt, dur: c.d * 0.6, amount: 0.32, curve: 'ease-in-expo' }],
  incoming: [{ type: 'REVEAL', at: c.inAt + c.d * 0.35, dur: c.d * 0.65, amount: 0.26, curve: 'ease-out-expo' }],
});
const zoomOpacity = (c) => [...(c.outgoing ? [fade(c, c.outgoing, 100, 0, 0.5, 1)] : []), fade(c, c.incoming, 0, 100, 0.3, 0.6)];
const pushMotion = (c) => ({
  outgoing: [{ type: 'WHIP', mode: 'out', at: c.outAt, dur: c.d, amount: 1, dir: dir(c), curve: 'ease-in-out-expo' }],
  incoming: [{ type: 'WHIP', mode: 'in', at: c.inAt, dur: c.d, amount: 1, dir: dir(c), curve: 'ease-in-out-expo' }],
});
const shakeBoth = (c, amt, freq) => ({
  outgoing: [{ type: 'SHAKE', at: c.outAt + c.d * 0.2, dur: c.d * 0.8, amount: amt, freq, decay: 0, seed: 11 }],
  incoming: [{ type: 'SHAKE', at: c.inAt, dur: c.d * 0.8, amount: amt, freq, decay: 1, seed: 23 }],
});

const E = (description, implementations, meta = {}) => ({ category: 'shot_transition', description, implementations, ...meta });

export const SHOT_TRANSITION_ENTRIES = {
  'shot.transition.cut': E('Hard cut.', [{ id: 'cut', quality: 1, requires: {}, motion: none, build: () => [] }]),

  'shot.transition.dissolve': E('Cross dissolve.', [{ id: 'opacity_fade', quality: 1, requires: {}, motion: none, build: (c) => dissolveOps(c) }]),

  'shot.transition.whip': E('Whip pan: the outgoing shot whips away, the incoming whips in; the swap is hidden in the blur.', [
    { id: 'whip_directional_blur', quality: 1, requires: { effects: [DIRBLUR] }, motion: whipMotion, build: (c, r) => [
      ...whipOpacity(c), ...motionBlurOn(c),
      ...(c.outgoing ? effectKeys(c, c.outgoing, r.effects[DIRBLUR.matchName], 'Directional Blur', 'whipblur', 'Blur Length', [T(c.t, 0), T(c.t + half(c), Math.round(c.w * 0.07))], { Direction: dir(c) }) : []),
      ...effectKeys(c, c.incoming, r.effects[DIRBLUR.matchName], 'Directional Blur', 'whipblur', 'Blur Length', [T(c.t + half(c), Math.round(c.w * 0.07)), T(c.t + c.d, 0)], { Direction: dir(c) }),
    ] },
    { id: 'whip_layer_motion_blur', quality: 0.75, requires: {}, motion: whipMotion, build: (c) => [...whipOpacity(c), ...motionBlurOn(c)] },
    dissolveInstead,
  ], { wantsMotionBlur: true }),

  'shot.transition.zoom': E('Zoom punch-through: the outgoing shot pushes in hard, the incoming settles from oversized.', [
    { id: 'zoom_radial_blur', quality: 1, requires: { effects: [RADIAL] }, motion: zoomMotion, build: (c, r) => [
      ...zoomOpacity(c), ...motionBlurOn(c),
      ...(c.outgoing ? effectKeys(c, c.outgoing, r.effects[RADIAL.matchName], 'Radial Blur', 'zoomblur', 'Amount', [T(c.t, 0), T(c.t + c.d * 0.55, 60)], { Type: 2 }) : []),
      ...effectKeys(c, c.incoming, r.effects[RADIAL.matchName], 'Radial Blur', 'zoomblur', 'Amount', [T(c.t + c.d * 0.35, 55), T(c.t + c.d, 0)], { Type: 2 }),
    ] },
    { id: 'zoom_scale_only', quality: 0.8, requires: {}, motion: zoomMotion, build: (c) => [...zoomOpacity(c), ...motionBlurOn(c)] },
    dissolveInstead,
  ], { wantsMotionBlur: true }),

  'shot.transition.push': E('Push: the incoming shot slides in and shoves the outgoing one off.', [
    { id: 'push_slide', quality: 1, requires: {}, motion: pushMotion, build: (c) => motionBlurOn(c) },
    dissolveInstead,
  ], { wantsMotionBlur: true }),

  'shot.transition.pull': E('Pull-through: a soft, slow cousin of the zoom with no blur - the incoming shot relaxes from slightly oversized.', [
    { id: 'pull_soft', quality: 1, requires: {}, motion: (c) => ({ outgoing: [{ type: 'PUSH', at: c.outAt, dur: c.d, amount: 0.07, curve: 'ease-in' }], incoming: [{ type: 'REVEAL', at: c.inAt, dur: c.d, amount: 0.18, curve: 'ease-out-expo' }] }), build: (c) => dissolveOps(c, 'easeOut') },
    dissolveInstead,
  ]),

  'shot.transition.light': E('Light: a warm bloom washes over the cut.', [
    { id: 'light_ramp_glow', quality: 1, requires: { effects: [RAMP] }, motion: none, build: (c, r) => [
      ...solid(c, nm(c, 'LIGHT'), '#ffcf8a', 'add', [T(c.t, 0), T(c.t + c.d * 0.5, 85), T(c.t + c.d, 0)]),
      ['layer_effect_add', { comp: c.comp, layer: nm(c, 'LIGHT'), matchName: r.effects[RAMP.matchName], name: 'Gradient Ramp', tag: 'light', params: { 'Start Color': '#fff2d0', 'End Color': '#c46a14', 'Ramp Shape': 2 } }],
      fade(c, c.incoming, 0, 100, 0.3, 0.6),
    ] },
    { id: 'light_warm_flash', quality: 0.6, requires: {}, motion: none, build: (c) => [...solid(c, nm(c, 'LIGHT'), '#ffd9a0', 'add', [T(c.t, 0), T(c.t + c.d * 0.5, 70), T(c.t + c.d, 0)]), fade(c, c.incoming, 0, 100, 0.3, 0.6)] },
    dissolveInstead,
  ]),

  'shot.transition.light_leak': E('Light leak: a supplied light-leak overlay clip screens over the cut (needs an overlay asset).', [
    { id: 'leak_overlay', quality: 1, requires: {}, motion: none, build: (c) => c.overlayAsset ? [
      ['layers_remove', { comp: c.comp, names: [nm(c, 'LEAK')] }],
      ['layer_add_footage', { comp: c.comp, item: c.overlayAsset, name: nm(c, 'LEAK'), start: c.t, end: c.t + c.d, blend: 'screen' }],
      key(c.comp, nm(c, 'LEAK'), 'opacity', [T(c.t, 0), T(c.t + c.d * 0.4, 100), T(c.t + c.d, 0)], 'linear'),
      fade(c, c.incoming, 0, 100, 0.3, 0.6),
    ] : [...solid(c, nm(c, 'LIGHT'), '#ffd9a0', 'add', [T(c.t, 0), T(c.t + c.d * 0.5, 60), T(c.t + c.d, 0)]), fade(c, c.incoming, 0, 100, 0.3, 0.6)] },
    dissolveInstead,
  ]),

  'shot.transition.mask': E('Mask wipe: a feathered edge sweeps across and reveals the incoming shot.', [
    // the incoming shot sits ABOVE the outgoing one, so the wipe is applied to it and runs from fully wiped (100) to revealed (0)
    { id: 'linear_wipe', quality: 1, requires: { effects: [WIPE] }, motion: none, build: (c, r) => [
      ['layer_effect_add', { comp: c.comp, layer: c.incoming, matchName: r.effects[WIPE.matchName], name: 'Linear Wipe', tag: 'wipe', params: { 'Wipe Angle': (dir(c) + 270) % 360, Feather: Math.round(c.h * 0.06) } }],
      ['effect_param_keys', { comp: c.comp, layer: c.incoming, effect: 'XOXO:wipe:Linear Wipe', param: 'Transition Completion', keys: [T(c.t, 100), T(c.t + c.d, 0)] }],
    ] },
    { id: 'matte_slide', quality: 0.8, requires: {}, motion: none, build: (c) => [
      ['layers_remove', { comp: c.comp, names: [nm(c, 'MATTE')] }],
      ['layer_add_solid', { comp: c.comp, name: nm(c, 'MATTE'), color: '#ffffff', start: c.t, end: c.t + c.d }],
      ['mask_add', { comp: c.comp, layer: nm(c, 'MATTE'), rect: [0, 0, c.w, c.h], shape: 'rect', feather: Math.round(c.h * 0.05) }],
      key(c.comp, nm(c, 'MATTE'), 'position', [T(c.t, [-c.w / 2, c.h / 2]), T(c.t + c.d, [c.w / 2, c.h / 2])], 'easeInOut'),
      ['layer_move', { comp: c.comp, layer: nm(c, 'MATTE'), to: { before: c.incoming } }],
      ['track_matte', { comp: c.comp, layer: c.incoming, matte: nm(c, 'MATTE'), type: 'alpha' }],
    ] },
    { id: 'push_instead', quality: 0.5, requires: {}, motion: pushMotion, build: () => [] },
    dissolveInstead,
  ]),

  'shot.transition.luma': E('Brightness dissolve: the incoming shot burns in from over-exposed (a luma-style dissolve, not a matte wipe).', [
    { id: 'exposure_dissolve', quality: 1, requires: { effects: [EXPOSURE] }, motion: none, build: (c, r) => [
      fade(c, c.incoming, 0, 100, 0, 0.5, 'easeOut'),
      ...effectKeys(c, c.incoming, r.effects[EXPOSURE.matchName], 'Exposure', 'luma', 'Exposure', [T(c.t, 3.5), T(c.t + c.d, 0)]),
    ] },
    { id: 'ease_in_expo_dissolve', quality: 0.5, requires: {}, motion: none, build: (c) => dissolveOps(c, 'easeIn') },
    dissolveInstead,
  ]),

  'shot.transition.flash': E('Flash cut: a white flash covers a hard cut.', [
    { id: 'white_flash', quality: 1, requires: {}, motion: none, build: (c) => [
      ...solid(c, nm(c, 'FLASH'), '#ffffff', 'add', [T(c.t, 0), T(c.t + c.d * 0.3, 100), T(c.t + c.d, 0)]),
      key(c.comp, c.incoming, 'opacity', [T(c.t, 0), T(c.t + c.d * 0.28, 0), T(c.t + c.d * 0.34, 100)], 'linear'),
    ] },
    dissolveInstead,
  ]),

  'shot.transition.glitch': E('Glitch: both shots shake and tear while the swap happens under displacement.', [
    { id: 'glitch_displace', quality: 1, requires: { effects: [DISPLACE] }, motion: (c) => shakeBoth(c, 0.03, 14), build: (c, r) => [
      key(c.comp, c.incoming, 'opacity', [T(c.t, 0), T(c.t + c.d * 0.45, 0), T(c.t + c.d * 0.5, 100)], 'linear'),
      ...(c.outgoing ? [key(c.comp, c.outgoing, 'opacity', [T(c.t + c.d * 0.45, 100), T(c.t + c.d * 0.5, 0)], 'linear')] : []),
      ...effectKeys(c, c.incoming, r.effects[DISPLACE.matchName], 'Turbulent Displace', 'glitch', 'Amount', [T(c.t + c.d * 0.45, 140), T(c.t + c.d, 0)], { Size: 40 }),
      ...(c.outgoing ? effectKeys(c, c.outgoing, r.effects[DISPLACE.matchName], 'Turbulent Displace', 'glitch', 'Amount', [T(c.t, 0), T(c.t + c.d * 0.5, 160)], { Size: 40 }) : []),
    ] },
    { id: 'glitch_jitter_flash', quality: 0.55, requires: {}, motion: (c) => shakeBoth(c, 0.035, 16), build: (c) => [
      key(c.comp, c.incoming, 'opacity', [T(c.t, 0), T(c.t + c.d * 0.45, 0), T(c.t + c.d * 0.5, 100)], 'linear'),
      ...(c.outgoing ? [key(c.comp, c.outgoing, 'opacity', [T(c.t + c.d * 0.45, 100), T(c.t + c.d * 0.5, 0)], 'linear')] : []),
      ...solid(c, nm(c, 'GLFLASH'), '#ffffff', 'add', [T(c.t + c.d * 0.4, 0), T(c.t + c.d * 0.5, 55), T(c.t + c.d * 0.6, 0)]),
    ] },
    { id: 'hard_cut', quality: 0.1, requires: {}, motion: none, build: (c) => [key(c.comp, c.incoming, 'opacity', [T(c.t, 0), T(c.t + 0.04, 100)], 'linear')] },
  ]),

  'shot.transition.distortion': E('Distortion: a wave warp ripples through the zoom.', [
    { id: 'wave_warp_zoom', quality: 1, requires: { effects: [WAVE] }, motion: zoomMotion, build: (c, r) => [
      ...zoomOpacity(c),
      ...(c.outgoing ? effectKeys(c, c.outgoing, r.effects[WAVE.matchName], 'Wave Warp', 'warp', 'Wave Height', [T(c.t, 0), T(c.t + c.d * 0.55, 60)], { 'Wave Width': 180 }) : []),
      ...effectKeys(c, c.incoming, r.effects[WAVE.matchName], 'Wave Warp', 'warp', 'Wave Height', [T(c.t + c.d * 0.35, 55), T(c.t + c.d, 0)], { 'Wave Width': 180 }),
    ] },
    { id: 'zoom_instead', quality: 0.5, requires: {}, motion: zoomMotion, build: (c) => zoomOpacity(c) },
    dissolveInstead,
  ]),

  'shot.transition.motion_blur': E('Swish: a fast, heavily blurred slide between shots.', [
    { id: 'swish_directional_blur', quality: 1, requires: { effects: [DIRBLUR] }, motion: (c) => ({ outgoing: [{ type: 'WHIP', mode: 'out', at: c.outAt, dur: c.d, amount: 0.7, dir: dir(c), curve: 'ease-in-out-expo' }], incoming: [{ type: 'WHIP', mode: 'in', at: c.inAt, dur: c.d, amount: 0.7, dir: dir(c), curve: 'ease-in-out-expo' }] }), build: (c, r) => [
      ...motionBlurOn(c),
      ...(c.outgoing ? effectKeys(c, c.outgoing, r.effects[DIRBLUR.matchName], 'Directional Blur', 'swish', 'Blur Length', [T(c.t, 0), T(c.t + half(c), Math.round(c.w * 0.1)), T(c.t + c.d, Math.round(c.w * 0.1))], { Direction: dir(c) }) : []),
      ...effectKeys(c, c.incoming, r.effects[DIRBLUR.matchName], 'Directional Blur', 'swish', 'Blur Length', [T(c.t, Math.round(c.w * 0.1)), T(c.t + half(c), Math.round(c.w * 0.1)), T(c.t + c.d, 0)], { Direction: dir(c) }),
      ...(c.outgoing ? [fade(c, c.outgoing, 100, 0, 0.5, 0.6)] : []),
    ] },
    { id: 'swish_layer_motion_blur', quality: 0.7, requires: {}, motion: (c) => ({ outgoing: [{ type: 'WHIP', mode: 'out', at: c.outAt, dur: c.d, amount: 0.7, dir: dir(c), curve: 'ease-in-out-expo' }], incoming: [{ type: 'WHIP', mode: 'in', at: c.inAt, dur: c.d, amount: 0.7, dir: dir(c), curve: 'ease-in-out-expo' }] }), build: (c) => motionBlurOn(c) },
    dissolveInstead,
  ], { wantsMotionBlur: true }),
};

/** Planner-facing facts about each transition type. */
export const TRANSITION_META = {
  cut:         { effectId: 'shot.transition.cut',         family: 'cut',    sfx: null,              minShot: 0,   motionHeavy: false, maxFrac: 0 },
  dissolve:    { effectId: 'shot.transition.dissolve',    family: 'soft',   sfx: 'soft_transition', minShot: 1.2, motionHeavy: false, maxFrac: 0.45 },
  whip:        { effectId: 'shot.transition.whip',        family: 'motion', sfx: 'whip',            minShot: 0.7, motionHeavy: true,  maxFrac: 0.5 },
  zoom:        { effectId: 'shot.transition.zoom',        family: 'motion', sfx: 'transition',      minShot: 0.8, motionHeavy: true,  maxFrac: 0.5 },
  push:        { effectId: 'shot.transition.push',        family: 'motion', sfx: 'transition',      minShot: 0.8, motionHeavy: true,  maxFrac: 0.5 },
  pull:        { effectId: 'shot.transition.pull',        family: 'soft',   sfx: 'soft_transition', minShot: 1.5, motionHeavy: false, maxFrac: 0.45 },
  light:       { effectId: 'shot.transition.light',       family: 'light',  sfx: 'soft_transition', minShot: 1.2, motionHeavy: false, maxFrac: 0.5 },
  light_leak:  { effectId: 'shot.transition.light_leak',  family: 'light',  sfx: 'soft_transition', minShot: 1.2, motionHeavy: false, maxFrac: 0.5 },
  mask:        { effectId: 'shot.transition.mask',        family: 'wipe',   sfx: 'transition',      minShot: 1.0, motionHeavy: false, maxFrac: 0.5 },
  luma:        { effectId: 'shot.transition.luma',        family: 'light',  sfx: 'soft_transition', minShot: 1.2, motionHeavy: false, maxFrac: 0.5 },
  flash:       { effectId: 'shot.transition.flash',       family: 'flash',  sfx: 'hit',             minShot: 0.4, motionHeavy: false, maxFrac: 0.4 },
  glitch:      { effectId: 'shot.transition.glitch',      family: 'digital',sfx: 'glitch',          minShot: 0.7, motionHeavy: true,  maxFrac: 0.5 },
  distortion:  { effectId: 'shot.transition.distortion', family: 'digital', sfx: 'glitch',          minShot: 0.8, motionHeavy: true,  maxFrac: 0.5 },
  motion_blur: { effectId: 'shot.transition.motion_blur', family: 'motion', sfx: 'whip',            minShot: 0.7, motionHeavy: true,  maxFrac: 0.5 },
};
export const TRANSITION_TYPES = Object.keys(TRANSITION_META);
