// EFFECT CAPABILITY SYSTEM
//
// Every visual/audio technique XOXOEDITZ can ask for is an *effect id* with an ordered list of
// implementations (best quality first). Each implementation declares what it requires; the resolver
// picks the best one the machine can actually do and records every step it had to skip, so the
// final report can say exactly which fallbacks were used.
//
//   transition.glitch:  native displacement  ->  jitter + flash  ->  hard cut
//
// The LAST implementation of every effect has no requirements, so a missing plugin never blocks a project.

import { findEffect } from './capabilities.js';
import { fx, T, key as keyOp } from './fx.js';
import { COLOR_LOOK_ENTRIES } from '../color/looks.js';
import { SHOT_TRANSITION_ENTRIES } from '../transitions/entries.js';
import { TEXT_ANIM_ENTRIES } from '../typography/entries.js';

export { fx };

/**
 * Transition builders act on the MASTER comp. ctx = { comp, incoming, outgoing|null, t, d, w, h, fps, ... }.
 * They return ops ([opName, args]) - never touch AE directly.
 */
const key = keyOp;

export const REGISTRY = {
  'transition.dissolve': {
    category: 'transition', description: 'Cross dissolve (incoming layer fades up over the outgoing tail).',
    implementations: [
      { id: 'opacity_fade', quality: 1, requires: {}, build: (c) => [key(c.comp, c.incoming, 'opacity', [T(c.t, 0), T(c.t + c.d, 100)], 'easeInOut')] },
    ],
  },
  'transition.dip_to_black': {
    category: 'transition', description: 'Outgoing fades to black, incoming fades up from black.',
    implementations: [
      { id: 'opacity_dip', quality: 1, requires: {}, build: (c) => [
        ...(c.outgoing ? [key(c.comp, c.outgoing, 'opacity', [T(c.t, 100), T(c.t + c.d / 2, 0)], 'easeIn')] : []),
        key(c.comp, c.incoming, 'opacity', [T(c.t, 0), T(c.t + c.d / 2, 0), T(c.t + c.d, 100)], 'easeOut'),
      ] },
    ],
  },
  'transition.slide': {
    category: 'transition', description: 'Incoming scene slides over the outgoing one.',
    implementations: [
      { id: 'position_slide', quality: 1, requires: {}, build: (c) => [
        key(c.comp, c.incoming, 'position', [T(c.t, [c.w * 1.5, c.h / 2]), T(c.t + c.d, [c.w / 2, c.h / 2])], 'easeOut'),
      ] },
      { id: 'dissolve_instead', quality: 0.3, requires: {}, build: (c) => [key(c.comp, c.incoming, 'opacity', [T(c.t, 0), T(c.t + c.d, 100)], 'easeInOut')] },
    ],
  },
  'transition.zoom_punch': {
    category: 'transition', description: 'Fast push-through: outgoing scales up, incoming settles from oversized.',
    implementations: [
      { id: 'scale_punch', quality: 1, requires: {}, build: (c) => [
        ...(c.outgoing ? [key(c.comp, c.outgoing, 'scale', [T(c.t, [100, 100]), T(c.t + c.d, [135, 135])], 'easeIn')] : []),
        key(c.comp, c.incoming, 'scale', [T(c.t, [118, 118]), T(c.t + c.d, [100, 100])], 'easeOut'),
        key(c.comp, c.incoming, 'opacity', [T(c.t, 0), T(c.t + c.d * 0.6, 100)], 'easeOut'),
      ] },
    ],
  },
  'transition.wipe': {
    category: 'transition', description: 'Outgoing scene is wiped away to reveal the incoming one.',
    implementations: [
      { id: 'linear_wipe', quality: 1, requires: { effects: [fx('ADBE Linear Wipe', 'Linear Wipe')] },
        build: (c, r) => [
          ['layer_move', { comp: c.comp, layer: c.outgoing, to: { before: c.incoming } }],
          ['layer_effect_add', { comp: c.comp, layer: c.outgoing, matchName: r.effects['ADBE Linear Wipe'], name: 'Linear Wipe', tag: 'wipe', params: { 'Wipe Angle': 90, Feather: 40 } }],
          ['effect_param_keys', { comp: c.comp, layer: c.outgoing, effect: 'XOXO:wipe:Linear Wipe', param: 'Transition Completion', keys: [T(c.t, 0), T(c.t + c.d, 100)] }],
        ] },
      { id: 'slide_instead', quality: 0.5, requires: {}, build: (c) => [key(c.comp, c.incoming, 'position', [T(c.t, [c.w * 1.5, c.h / 2]), T(c.t + c.d, [c.w / 2, c.h / 2])], 'easeOut')] },
      { id: 'dissolve_instead', quality: 0.3, requires: {}, build: (c) => [key(c.comp, c.incoming, 'opacity', [T(c.t, 0), T(c.t + c.d, 100)], 'easeInOut')] },
    ],
  },
  'transition.glitch': {
    category: 'transition', description: 'Digital glitch transition.',
    implementations: [
      { id: 'turbulent_displace', quality: 1, requires: { effects: [fx('ADBE Turbulent Displace', 'Turbulent Displace')] },
        build: (c, r) => [
          ['layer_effect_add', { comp: c.comp, layer: c.incoming, matchName: r.effects['ADBE Turbulent Displace'], name: 'Turbulent Displace', tag: 'glitch', params: { Amount: 0, Size: 40 } }],
          ['effect_param_keys', { comp: c.comp, layer: c.incoming, effect: 'XOXO:glitch:Turbulent Displace', param: 'Amount', keys: [T(c.t, 160), T(c.t + c.d * 0.5, 60), T(c.t + c.d, 0)] }],
          key(c.comp, c.incoming, 'opacity', [T(c.t, 0), T(c.t + c.d * 0.25, 100)], 'linear'),
        ] },
      { id: 'jitter_flash', quality: 0.55, requires: {}, build: (c) => [
        ['keyframes', { comp: c.comp, layer: c.incoming, prop: 'position', ease: 'linear',
          keys: [0, 0.2, 0.4, 0.6, 0.8, 1].map((u, i) => ({ t: c.t + c.d * u, v: [c.w / 2 + (i % 2 ? 1 : -1) * c.w * 0.012 * (6 - i), c.h / 2 + (i % 3 - 1) * c.h * 0.006], hold: u < 1 })) }],
        key(c.comp, c.incoming, 'opacity', [T(c.t, 0), T(c.t + 0.04, 100)], 'linear'),
      ] },
      { id: 'hard_cut', quality: 0.1, requires: {}, build: () => [] },
    ],
  },
  'transition.cut': {
    category: 'transition', description: 'Hard cut.',
    implementations: [{ id: 'cut', quality: 1, requires: {}, build: () => [] }],
  },

  // ---- looks (applied to master adjustment layers) ----
  'look.film_grain': {
    category: 'look', description: 'Subtle film grain over the whole picture.',
    implementations: [
      { id: 'add_grain', quality: 1, requires: { effects: [fx('ADBE Add Grain', 'Add Grain')] },
        build: (c, r) => [['layer_effect_add', { comp: c.comp, layer: c.layer, matchName: r.effects['ADBE Add Grain'], tag: 'grain' }]] },
      { id: 'noise', quality: 0.7, requires: { effects: [fx('ADBE Noise', 'Noise')] },
        build: (c, r) => [['layer_effect_add', { comp: c.comp, layer: c.layer, matchName: r.effects['ADBE Noise'], tag: 'grain', params: { 'Amount of Noise': 3 } }]] },
      { id: 'none', quality: 0, requires: {}, build: () => [] },
    ],
  },
  'look.glow': {
    category: 'look', description: 'Soft highlight bloom.',
    implementations: [
      { id: 'glow', quality: 1, requires: { effects: [fx('ADBE Glo2', 'Glow')] },
        build: (c, r) => [['layer_effect_add', { comp: c.comp, layer: c.layer, matchName: r.effects['ADBE Glo2'], tag: 'glow', params: { 'Glow Intensity': 0.35 } }]] },
      { id: 'none', quality: 0, requires: {}, build: () => [] },
    ],
  },
  'look.tint_grade': {
    category: 'look', description: 'Two-tone colour grade (shadows/highlights).',
    implementations: [
      { id: 'tint', quality: 1, requires: { effects: [fx('ADBE Tint', 'Tint')] },
        build: (c, r) => [['layer_effect_add', { comp: c.comp, layer: c.layer, matchName: r.effects['ADBE Tint'], tag: 'grade', params: { 'Map Black To': c.shadow, 'Map White To': c.highlight, 'Amount to Tint': c.amount ?? 22 } }]] },
      { id: 'none', quality: 0, requires: {}, build: () => [] },
    ],
  },
  'look.vignette': {
    category: 'look', description: 'Darkened frame edges.',
    implementations: [
      { id: 'inverted_mask_solid', quality: 1, requires: {}, build: (c) => [
        ['layers_remove', { comp: c.comp, names: [c.layer] }],
        ['layer_add_solid', { comp: c.comp, name: c.layer, color: '#000000', opacity: c.amount ?? 45 }],
        ['mask_add', { comp: c.comp, layer: c.layer, shape: 'ellipse', rect: [c.w * 0.05, c.h * 0.05, c.w * 0.9, c.h * 0.9], inverted: true, feather: Math.round(c.h * 0.35) }],
      ] },
    ],
  },
  'look.letterbox': {
    category: 'look', description: 'Cinematic bars for a wider aspect.',
    implementations: [
      { id: 'shape_bars', quality: 1, requires: {}, build: (c) => [
        ['layers_remove', { comp: c.comp, names: ['SHP_LETTERBOX_TOP', 'SHP_LETTERBOX_BOTTOM'] }],
        ['layer_add_shape', { comp: c.comp, name: 'SHP_LETTERBOX_TOP', position: [c.w / 2, c.barH / 2], shapes: [{ type: 'rect', size: [c.w, c.barH], fill: '#000000' }] }],
        ['layer_add_shape', { comp: c.comp, name: 'SHP_LETTERBOX_BOTTOM', position: [c.w / 2, c.h - c.barH / 2], shapes: [{ type: 'rect', size: [c.w, c.barH], fill: '#000000' }] }],
      ] },
    ],
  },

  // ---- text ----
  'text.reveal': {
    category: 'text', description: 'Text entrance animation.',
    implementations: [
      { id: 'animator', quality: 1, requires: {}, build: (c) => [['text_reveal', { comp: c.comp, layer: c.layer, mode: c.mode || 'fade_up', start: c.t, duration: c.d }]] },
      { id: 'layer_fade_up', quality: 0.6, requires: {}, build: (c) => [
        key(c.comp, c.layer, 'opacity', [T(c.t, 0), T(c.t + c.d, 100)], 'easeOut'),
        key(c.comp, c.layer, 'position', [T(c.t, [c.pos[0], c.pos[1] + c.h * 0.025]), T(c.t + c.d, c.pos)], 'easeOut'),
      ] },
      { id: 'layer_fade', quality: 0.4, requires: {}, build: (c) => [key(c.comp, c.layer, 'opacity', [T(c.t, 0), T(c.t + Math.min(c.d, 0.5), 100)], 'linear')] },
    ],
  },
};

// V4 additions live in their own modules and register here so one resolver serves everything.
Object.assign(REGISTRY, COLOR_LOOK_ENTRIES, SHOT_TRANSITION_ENTRIES, TEXT_ANIM_ENTRIES);

/** Alternative effect chain used when a requested id doesn't exist. */
export function unknownEffectFallback(id) {
  if (id.startsWith('transition.')) return 'transition.dissolve';
  if (id.startsWith('shot.transition.')) return 'shot.transition.dissolve';
  if (id.startsWith('text.anim.')) return 'text.anim.fade';
  return null;
}

/**
 * Every implementation of `id` this machine can run, best first (the executor walks this chain if the
 * best one fails at runtime). Also returns what was skipped and why.
 */
export function resolveChain(id, caps, { registry = REGISTRY } = {}) {
  let def = registry[id]; let useId = id;
  const skipped = [];
  if (!def) {
    skipped.push({ impl: id, reason: 'unknown effect id' });
    const alt = unknownEffectFallback(id);
    if (!alt) return { id, requestedId: id, chain: [], skipped, bestQuality: 0 };
    def = registry[alt]; useId = alt;
  }
  const impls = [...def.implementations].sort((a, b) => b.quality - a.quality);
  const chain = [];
  for (const impl of impls) {
    const resolved = { effects: {} };
    let reason = null;
    for (const e of impl.requires?.effects || []) {
      const mn = findEffect(caps, e);
      if (mn) resolved.effects[e.matchName] = mn;
      else { reason = caps?.effects?.known ? `effect not installed: ${e.displayName || e.matchName}` : `effect availability unknown (After Effects not queried): ${e.displayName || e.matchName}`; break; }
    }
    if (!reason) for (const p of impl.requires?.plugins || []) {
      if (!caps?.plugins?.aex?.some((n) => n.toLowerCase().includes(String(p).toLowerCase()))) { reason = `plugin not installed: ${p}`; break; }
    }
    if (!reason) for (const f of impl.requires?.fonts || []) {
      if (!caps?.fonts?.postScriptNames?.includes(f)) { reason = `font not installed: ${f}`; break; }
    }
    if (reason) skipped.push({ impl: impl.id, reason }); else chain.push({ id: impl.id, quality: impl.quality, build: impl.build, motion: impl.motion, resolved });
  }
  return { id: useId, requestedId: id, chain, skipped, bestQuality: impls[0].quality };
}

/**
 * Resolve an effect id against machine capabilities.
 * @returns {{ id, implementation, build, resolved, quality, depth, skipped: {impl, reason}[], degraded: boolean }}
 */
export function resolveEffect(id, caps, { registry = REGISTRY, disallow = [] } = {}) {
  let def = registry[id];
  const skipped = [];
  let requestedId = id;
  if (!def) {
    const alt = unknownEffectFallback(id);
    skipped.push({ impl: id, reason: 'unknown effect id' });
    if (!alt) return { id, implementation: null, build: null, resolved: {}, quality: 0, depth: 0, skipped, degraded: true, unavailable: true };
    def = registry[alt]; id = alt;
  }
  const impls = [...def.implementations].sort((a, b) => b.quality - a.quality);
  const bestQuality = impls[0].quality;
  for (let i = 0; i < impls.length; i++) {
    const impl = impls[i];
    if (disallow.includes(impl.id)) { skipped.push({ impl: impl.id, reason: 'excluded after runtime failure' }); continue; }
    const resolved = { effects: {} };
    let reason = null;
    for (const e of impl.requires?.effects || []) {
      const mn = findEffect(caps, e);
      if (mn) resolved.effects[e.matchName] = mn;
      else { reason = caps?.effects?.known ? `effect not installed: ${e.displayName || e.matchName}` : `effect availability unknown (After Effects not queried): ${e.displayName || e.matchName}`; break; }
    }
    if (!reason) for (const p of impl.requires?.plugins || []) {
      if (!caps?.plugins?.aex?.some((n) => n.toLowerCase().includes(String(p).toLowerCase()))) { reason = `plugin not installed: ${p}`; break; }
    }
    if (!reason) for (const f of impl.requires?.fonts || []) {
      if (!caps?.fonts?.postScriptNames?.includes(f)) { reason = `font not installed: ${f}`; break; }
    }
    if (reason) { skipped.push({ impl: impl.id, reason }); continue; }
    return { id, requestedId, implementation: impl.id, build: impl.build, motion: impl.motion, resolved, quality: impl.quality, depth: i, skipped, degraded: i > 0 || requestedId !== id || impl.quality < bestQuality };
  }
  return { id, requestedId, implementation: null, build: null, resolved: {}, quality: 0, depth: impls.length, skipped, degraded: true, unavailable: true };
}

/** Table of every registered effect and what this machine would use for it (for `xoxo effects`). */
export function describeCapabilities(caps, registry = REGISTRY) {
  return Object.entries(registry).map(([id, def]) => {
    const r = resolveEffect(id, caps, { registry });
    return {
      id, category: def.category, description: def.description,
      using: r.implementation, quality: r.quality, degraded: r.degraded,
      chain: [...def.implementations].sort((a, b) => b.quality - a.quality).map((i) => i.id),
      skipped: r.skipped,
    };
  });
}
