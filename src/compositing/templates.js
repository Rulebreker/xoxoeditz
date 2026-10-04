// SHOT TEMPLATES: the compositing vocabulary. A template turns a shot (duration, impacts, subject, assets) into a
// LAYER STACK - plain data describing footage layers (with crop / placement / mask / motion), solids, shapes and the
// text the shot wants. `stackOps` realises a stack as host ops. Templates never pick assets or write plans: the
// Director chooses a template (chooseTemplate) and supplies the assets.
//
//   FULL_BLEED CROP_DETAIL 2_5D PARALLAX CAMERA PIP SPLIT_SCREEN TEXT_SCENE STAT_SCENE CALLOUT HUD_SCENE
//   MAP_SCENE (not implemented - TODO) FREEZE_FRAME IMPACT_SCENE DARK_TITLE END_CARD
//
// Limits worth knowing: masks live in LAYER space, so a masked layer's window moves with the layer. PIP and
// SPLIT_SCREEN panels are therefore placed statically (they slide in, then hold); moving the picture *inside* a
// fixed window would need a precomp per panel (TODO).

import { placeCrop, detailCrop, pipRect, splitRects, rectsOverlap } from './geometry.js';
import { planParallax } from '../camera/parallax.js';
import { buildCameraTrack } from '../camera/track.js';
import { resolveChain } from '../effects/registry.js';
import { makeRng } from '../core/rng.js';
import { snapT } from '../motion/layout.js';

const FULL = { x: 0, y: 0, w: 1, h: 1 };
const reliable = (s) => s && (s.conf ?? 0) >= 0.3 && s.w < 0.9 && s.h < 0.95;
const dims = (a) => (a?.w && a?.h ? { w: a.w, h: a.h } : null);

const footage = (name, asset, o = {}) => ({ kind: 'footage', name, asset: asset.item ?? asset.id, src: dims(asset), crop: null, rect: FULL, motion: [], speed: 'follow', opacity: 100, blur: 0, blend: null, mask: null, ...o });
const solid = (name, color, o = {}) => ({ kind: 'solid', name, color, opacity: 100, ...o });

/** Camera decision for a main layer from the rig (null when the rig is absent). */
function camera(ctx, shot, extra = {}) {
  if (!ctx.rig) return null;
  return ctx.rig.plan({ dur: shot.dur, index: shot.index, hasNext: shot.hasNext, impacts: shot.impacts || [], subject: ctx.asset?.subject, intensity: shot.intensity, role: shot.role, ...extra });
}

export const TEMPLATES = {
  FULL_BLEED: { implemented: true, assets: 1, doc: 'The footage fills the frame; the camera rig decides the move.',
    plan: (shot, ctx) => { const cam = camera(ctx, shot); return { layers: [footage(`${shot.id}_MAIN`, ctx.asset, { motion: cam?.specs || [], maxLift: cam?.maxLift })], camera: cam }; } },

  CAMERA: { implemented: true, assets: 1, doc: 'A shot built around a visible camera move: always a compound move, never static.',
    plan: (shot, ctx) => { const cam = camera(ctx, { ...shot, intensity: Math.max(0.7, shot.intensity ?? 0) }); return { layers: [footage(`${shot.id}_MAIN`, ctx.asset, { motion: cam?.specs || [], maxLift: cam?.maxLift, motionBlur: true })], camera: cam }; } },

  CROP_DETAIL: { implemented: true, assets: 1, needsSubject: true, doc: 'A tight crop of the subject fills the frame, then the camera works the detail.',
    plan: (shot, ctx) => {
      const src = dims(ctx.asset); const crop = detailCrop(ctx.asset.subject, { src: src || ctx.comp, comp: ctx.comp });
      const cam = camera(ctx, shot, { subject: null });
      return { layers: [footage(`${shot.id}_MAIN`, ctx.asset, { crop, motion: cam?.specs || [], maxLift: cam?.maxLift })], camera: cam, notes: [`detail crop ${(crop.w * 100) | 0}% of the frame`] };
    } },

  '2_5D': { implemented: true, assets: 1, needsSubject: true, doc: 'Depth by splitting the picture: soft background + cut-out subject that moves more.',
    plan: (shot, ctx) => parallaxPlan(shot, ctx, { layers: 2, amount: 0.1 }) },

  PARALLAX: { implemented: true, assets: 1, needsSubject: true, doc: 'Three-layer lateral parallax across the shot.',
    plan: (shot, ctx) => parallaxPlan(shot, ctx, { layers: 3, amount: 0.14 }) },

  PIP: { implemented: true, assets: 1, wantsSecond: true, doc: 'Main shot with a framed inset of a second clip that slides in.',
    plan: (shot, ctx) => {
      const main = ctx.asset; const second = ctx.asset2 || main; const notes = [];
      if (!ctx.asset2) notes.push('no second asset: the inset shows a detail crop of the main shot');
      const box = pipRect({ comp: ctx.comp, subject: main.subject, avoid: ctx.avoid || [] });
      const crop = !ctx.asset2 && reliable(main.subject) ? detailCrop(main.subject, { src: dims(main) || ctx.comp, comp: { w: 16, h: 9 }, pad: 1.4 }) : null;
      const cam = camera(ctx, { ...shot, intensity: Math.min(0.4, shot.intensity ?? 0.4) });
      const enterFrom = box.name.endsWith('right') ? 'right' : 'left';
      return { layers: [
        footage(`${shot.id}_MAIN`, main, { motion: cam?.specs || [], maxLift: cam?.maxLift }),
        footage(`${shot.id}_PIP`, second, { role: 'inset', crop, rect: box.rect, mask: { shape: 'rect', feather: 0 }, shadow: true, enter: { from: enterFrom, at: Math.min(0.25, shot.dur * 0.2), d: 0.4 }, speed: 'normal', sourceIn: ctx.asset2 ? 0 : undefined }),
        { kind: 'frame', name: `SHP_${shot.id}_FRAME`, rect: box.rect, color: ctx.accent || '#ffffff', widthPx: Math.max(3, Math.round(ctx.comp.h * 0.003)), enter: { from: enterFrom, at: Math.min(0.25, shot.dur * 0.2), d: 0.4 } },
      ], camera: cam, notes: [...notes, `inset at ${box.name}`], pipRect: box.rect };
    } },

  SPLIT_SCREEN: { implemented: true, assets: 1, wantsSecond: true, doc: 'Two panels side by side, each cropped around its own subject.',
    plan: (shot, ctx) => {
      const [l, r] = splitRects(2, { gutter: 0.006 }); const notes = [];
      const a = ctx.asset; const b = ctx.asset2 || ctx.asset; if (!ctx.asset2) notes.push('no second asset: the right panel is a different crop of the same shot');
      const panelComp = { w: ctx.comp.w * l.w, h: ctx.comp.h };
      const cropOf = (asset, alt) => (reliable(asset.subject) ? detailCrop(asset.subject, { src: dims(asset) || ctx.comp, comp: panelComp, pad: alt ? 2.4 : 1.9, minFrac: 0.5 }) : null);
      const slide = Math.min(0.3, shot.dur * 0.2);
      return { layers: [
        footage(`${shot.id}_LEFT`, a, { role: 'panel', crop: cropOf(a, false), rect: l, mask: { shape: 'rect', feather: 0 }, enter: { from: 'left', at: 0, d: slide }, speed: 'normal' }),
        footage(`${shot.id}_RIGHT`, b, { role: 'panel', crop: cropOf(b, !ctx.asset2), rect: r, mask: { shape: 'rect', feather: 0 }, enter: { from: 'right', at: 0.05, d: slide }, speed: 'normal' }),
        { kind: 'divider', name: `SHP_${shot.id}_DIVIDER`, x: l.w + 0.003, color: ctx.accent || '#ffffff', widthPx: Math.max(2, Math.round(ctx.comp.h * 0.0015)) },
      ], notes };
    } },

  TEXT_SCENE: { implemented: true, assets: 0, needsText: true, doc: 'Type on a dark field (a blurred ghost of the footage if one is supplied).',
    plan: (shot, ctx) => ({ layers: [solid(`${shot.id}_BG`, ctx.bg || '#08090b'), ...(ctx.asset ? [footage(`${shot.id}_GHOST`, ctx.asset, { opacity: 22, blur: 28, speed: 'normal', motion: [{ type: 'DRIFT', amount: 0.05, dir: 20 }], maxLift: 1.2 })] : [])],
      textSlots: [{ kind: ctx.title && shot.dur < 2.2 ? 'KEYWORD' : 'TITLE', text: ctx.title || ctx.text, at: Math.min(0.15, shot.dur * 0.1), dur: Math.max(0.5, shot.dur - 0.3) }] }) },

  STAT_SCENE: { implemented: true, assets: 0, needsStat: true, doc: 'One big number with a label over a dimmed backdrop.',
    plan: (shot, ctx) => ({ layers: [solid(`${shot.id}_BG`, ctx.bg || '#0a0c10'), ...(ctx.asset ? [footage(`${shot.id}_GHOST`, ctx.asset, { opacity: 30, blur: 18, speed: 'normal', motion: [{ type: 'PUSH', amount: 0.06 }], maxLift: 1.2 })] : [])],
      textSlots: [{ kind: 'STAT', text: String(ctx.stat.value), at: 0.1, dur: Math.max(0.6, shot.dur - 0.2) }, ...(ctx.stat.label ? [{ kind: 'LABEL', text: ctx.stat.label, at: 0.35, dur: Math.max(0.5, shot.dur - 0.5), anchor: [0.5, 0.64] }] : [])] }) },

  CALLOUT: { implemented: true, assets: 1, needsSubject: true, needsCallout: true, doc: 'Footage with a label and leader line pointing at the subject.',
    plan: (shot, ctx) => { const cam = camera(ctx, { ...shot, intensity: Math.min(0.5, shot.intensity ?? 0.5) }); const s = ctx.asset.subject; const target = ctx.target || { x: s.x + s.w / 2, y: s.y + s.h / 2 };
      return { layers: [footage(`${shot.id}_MAIN`, ctx.asset, { motion: cam?.specs || [], maxLift: cam?.maxLift })], camera: cam, textSlots: [{ kind: 'CALLOUT', text: ctx.callout, at: Math.min(0.5, shot.dur * 0.25), dur: Math.max(0.6, shot.dur * 0.6), target }] }; } },

  HUD_SCENE: { implemented: true, assets: 1, doc: 'Footage under a thin HUD frame with technical readouts.',
    plan: (shot, ctx) => { const cam = camera(ctx, { ...shot, intensity: Math.min(0.5, shot.intensity ?? 0.5) });
      return { layers: [footage(`${shot.id}_MAIN`, ctx.asset, { motion: cam?.specs || [], maxLift: cam?.maxLift }), { kind: 'hud', name: `SHP_${shot.id}_HUD`, color: ctx.accent || '#7fe7ff', widthPx: Math.max(2, Math.round(ctx.comp.h * 0.0018)), inset: 0.05, arm: 0.04 }], camera: cam,
        textSlots: [{ kind: 'LABEL', text: ctx.label || 'SYS ONLINE', at: 0.1, dur: Math.max(0.5, shot.dur - 0.2) }, { kind: 'HUD', text: ctx.readout || `T+${String(Math.round(shot.start * 10) / 10).padStart(4, '0')}`, at: 0.2, dur: Math.max(0.5, shot.dur - 0.4), anchor: [0.72, 0.9] }] }; } },

  MAP_SCENE: { implemented: false, assets: 0, doc: 'TODO: needs map data / a reliable geo asset pipeline; not implemented, never chosen automatically.',
    plan: () => { throw new Error('MAP_SCENE is not implemented (TODO): it needs map imagery and route data. Choose another template.'); } },

  FREEZE_FRAME: { implemented: true, assets: 1, minDur: 0.9, doc: 'Plays briefly, then holds one frame (never longer than 0.7 s) with a punch-in, then carries on.',
    plan: (shot, ctx) => { const at = Math.min(shot.dur * 0.35, 0.5); const rng = makeRng('freeze', ctx.seed, shot.id);
      return { layers: [footage(`${shot.id}_MAIN`, ctx.asset, { motion: [{ type: 'IMPACT', at, amount: 0.07, dir: rng.pick([90, 270]) }, { type: 'PUSH', at, amount: 0.1, curve: 'ease-out-expo' }], maxLift: 1.3 })],
        velocityHint: { kind: 'freeze', at, hold: Math.min(0.7, Math.max(2 / 24, shot.dur - at - 0.25)) }, overlays: [{ kind: 'flash', at, d: 0.12, peak: 55 }], notes: [`freezes at ${at.toFixed(2)}s into the shot`] }; } },

  IMPACT_SCENE: { implemented: true, assets: 1, minDur: 0.6, doc: 'Build, slow-down, hit: velocity ramp into an impact with shake, flash and a slammed word.',
    plan: (shot, ctx) => { const at = Math.max(0.25, Math.min(shot.dur * 0.55, shot.dur - 0.25)); const rng = makeRng('impact', ctx.seed, shot.id);
      return { layers: [footage(`${shot.id}_MAIN`, ctx.asset, { motion: [{ type: 'PUSH', amount: 0.1, dur: at, curve: 'ease-in-expo' }, { type: 'IMPACT', at, amount: 0.12, dir: rng.pick([90, 270]) }, { type: 'SHAKE', at, dur: Math.min(0.5, shot.dur - at), amount: 0.016, freq: 11, decay: 1.5, seed: rng.int(1, 9999) }], maxLift: 1.4, motionBlur: true })],
        velocityHint: { kind: 'impact', impactAt: at, profile: 'VELOCITY_HARD' }, overlays: [{ kind: 'flash', at, d: 0.14, peak: 70 }], textSlots: ctx.title || ctx.text ? [{ kind: 'KEYWORD', text: ctx.title || ctx.text, at, dur: Math.max(0.4, shot.dur - at - 0.05) }] : [] }; } },

  DARK_TITLE: { implemented: true, assets: 0, needsText: true, doc: 'Near-black field, slow title; a faint ghost of the footage breathes behind it.',
    plan: (shot, ctx) => ({ layers: [solid(`${shot.id}_BG`, '#020203'), ...(ctx.asset ? [footage(`${shot.id}_GHOST`, ctx.asset, { opacity: 14, blur: 22, speed: 'normal', motion: [{ type: 'PUSH', amount: 0.05, curve: 'smootherstep' }], maxLift: 1.2 })] : [])],
      textSlots: [{ kind: 'TITLE', text: ctx.title || ctx.text, at: Math.min(0.4, shot.dur * 0.15), dur: Math.max(0.8, shot.dur - 0.6) }], fadeOut: Math.min(0.6, shot.dur * 0.25) }) },

  END_CARD: { implemented: true, assets: 0, needsText: true, doc: 'Closing card: title, line of support, long hold, fade to black.',
    plan: (shot, ctx) => ({ layers: [solid(`${shot.id}_BG`, ctx.bg || '#050608'), ...(ctx.asset ? [footage(`${shot.id}_GHOST`, ctx.asset, { opacity: 26, blur: 20, speed: 'normal', motion: [{ type: 'DRIFT', amount: 0.04 }], maxLift: 1.2 })] : []), ...(ctx.logo ? [footage(`${shot.id}_LOGO`, ctx.logo, { role: 'logo', rect: { x: 0.4, y: 0.12, w: 0.2, h: 0.12 }, speed: 'normal' })] : [])],
      textSlots: [{ kind: 'END_CARD', text: ctx.title || ctx.text, at: 0.2, dur: Math.max(0.8, shot.dur - 0.6) }, ...(ctx.subtitle ? [{ kind: 'SUBTITLE', text: ctx.subtitle, at: 0.6, dur: Math.max(0.6, shot.dur - 1) }] : [])], fadeOut: Math.min(1, shot.dur * 0.3) }) },
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

function parallaxPlan(shot, ctx, { layers, amount }) {
  const src = dims(ctx.asset) || { w: ctx.comp.w, h: ctx.comp.h };
  const dir = (shot.index ?? 0) % 2 ? 180 : 0;
  const pp = planParallax({ subject: ctx.asset.subject, dur: shot.dur, amount: amount * (0.7 + 0.6 * (shot.intensity ?? 0.5)), layers, dir, comp: ctx.comp, asset: src, t0: 0, fps: ctx.fps || 24, seed: `${ctx.seed}.${shot.id}` });
  const out = pp.layers.map((l) => footage(`${shot.id}_${l.role.toUpperCase()}`, ctx.asset, {
    role: l.role, depth: l.depth, motion: l.specs, blur: l.blur ? Math.round(l.blur * 14) : 0, maxLift: 1.3, speed: 'follow',
    mask: l.mask ? (l.role === 'subject' ? { shape: l.mask.shape, boxSource: l.mask.box, feather: Math.round(l.mask.feather * src.h * 0.5) } : null) : null,
  }));
  return { layers: out, parallax: pp, notes: [pp.summary], fallback: !pp.ok };
}

/** Plan one shot with a named template. Throws for unknown or unimplemented templates and for missing required inputs. */
export function planShot(name, shot, ctx) {
  const t = TEMPLATES[name]; if (!t) throw new Error(`unknown shot template "${name}" (known: ${TEMPLATE_NAMES.join(', ')})`);
  if (!t.implemented) return t.plan(shot, ctx); // throws the explanatory TODO error
  if (t.assets > 0 && !ctx.asset) throw new Error(`${name} needs an asset`);
  if (t.needsSubject && !reliable(ctx.asset?.subject)) throw new Error(`${name} needs a reliably detected subject (confidence ≥ 0.3); use FULL_BLEED or CAMERA for this asset`);
  if (t.needsText && !(ctx.title || ctx.text)) throw new Error(`${name} needs text (ctx.title or ctx.text)`);
  if (t.needsStat && !ctx.stat?.value) throw new Error(`${name} needs a stat value`);
  if (t.needsCallout && !ctx.callout) throw new Error(`${name} needs callout text (ctx.callout): an unlabelled callout is just a line`);
  if (t.minDur && shot.dur < t.minDur) throw new Error(`${name} needs at least ${t.minDur}s (shot is ${shot.dur.toFixed(2)}s)`);
  const p = t.plan(shot, ctx);
  return { template: name, ok: true, layers: p.layers, overlays: p.overlays || [], textSlots: p.textSlots || [], velocityHint: p.velocityHint || null, camera: p.camera || null, notes: p.notes || [], fadeOut: p.fadeOut || 0, pipRect: p.pipRect, parallax: p.parallax, fallback: Boolean(p.fallback) };
}

/**
 * Pick a template for a shot from the edit type's shot weights, filtered by what the inputs allow and by history.
 * Returns { name, scores } - scores explains every candidate (0 = not possible, with the reason).
 */
export function chooseTemplate(shot, ctx, { history = [], rng = makeRng('template', ctx.seed ?? 1, shot.id), force = null } = {}) {
  if (force) return { name: force, scores: { [force]: { weight: 1, reason: 'forced' } } };
  const prof = ctx.editType?.shots || { FULL_BLEED: 1 }; const scores = {};
  const hasSubj = reliable(ctx.asset?.subject); const hasText = Boolean(ctx.title || ctx.text);
  for (const name of TEMPLATE_NAMES) {
    const t = TEMPLATES[name]; let w = prof[name] ?? 0; let why = null;
    if (!t.implemented) { w = 0; why = 'not implemented'; }
    else if (t.assets > 0 && !ctx.asset) { w = 0; why = 'no asset'; }
    else if (t.needsSubject && !hasSubj) { w = 0; why = 'no reliable subject'; }
    else if (t.needsText && !hasText) { w = 0; why = 'no text for this shot'; }
    else if (t.needsStat && !ctx.stat?.value) { w = 0; why = 'no stat'; }
    else if (t.needsCallout && !ctx.callout) { w = 0; why = 'no callout text'; }
    else if (t.minDur && shot.dur < t.minDur) { w = 0; why = `shot shorter than ${t.minDur}s`; }
    else if ((name === 'PIP' || name === 'SPLIT_SCREEN') && shot.dur < 1.5) { w = 0; why = 'too short'; }
    else if ((name === '2_5D' || name === 'PARALLAX') && shot.dur < 1.2) { w = 0; why = 'too short for depth to read'; }
    else if (name === 'END_CARD' && !shot.isLast) { w = 0; why = 'only the last shot'; }
    else if (name === 'DARK_TITLE' && !(shot.isFirst || shot.chapter)) { w = 0; why = 'only first shot or chapter start'; }
    else if (t.wantsSecond && !ctx.asset2) w *= 0.35;
    if (w > 0) {
      if (history[history.length - 1] === name) w *= 0.1; else if (history.slice(-3).includes(name)) w *= 0.5;
      if (shot.role === 'impact' && name === 'IMPACT_SCENE') w *= 3;
      if (shot.role === 'hero' && (name === 'CAMERA' || name === 'FULL_BLEED')) w *= 1.5;
      if (shot.role === 'detail' && name === 'CROP_DETAIL') w *= 2;
    }
    scores[name] = { weight: +w.toFixed(4), ...(why ? { reason: why } : {}) };
  }
  const cands = Object.entries(scores).filter(([, s]) => s.weight > 0).map(([name, s]) => ({ name, w: s.weight }));
  const name = cands.length ? rng.weighted(cands).name : 'FULL_BLEED';
  return { name, scores };
}

/**
 * Realise a planned stack as host ops (ONE alternative; the caller wraps it in a unit). `ctx` = {
 *   comp:{name,w,h}, fps, caps, shot:{start,dur}, seed, remap?: (layerSpec) => ops[] (speed ramps) }
 * Footage layers are placed, masked, blurred and given their camera track; overlays and text slots are NOT
 * included (the caller runs buildTextUnit for text).
 */
export function stackOps(plan, ctx) {
  const { comp, fps = 24, caps = null, shot } = ctx; const t0 = snapT(shot.start, fps); const t1 = snapT(shot.start + shot.dur, fps);
  const ops = []; const names = []; const warnings = []; const tracks = {};
  const at = (rel) => +(t0 + rel).toFixed(4);
  for (const L of plan.layers) {
    names.push(L.name);
    if (L.kind === 'solid') { ops.push(['layers_remove', { comp: comp.name, names: [L.name] }], ['layer_add_solid', { comp: comp.name, name: L.name, color: L.color, start: t0, end: t1, opacity: L.opacity }]); continue; }
    if (L.kind === 'frame') {
      const r = L.rect; ops.push(['layers_remove', { comp: comp.name, names: [L.name] }], ['layer_add_shape', { comp: comp.name, name: L.name, position: [(r.x + r.w / 2) * comp.w, (r.y + r.h / 2) * comp.h], shapes: [{ type: 'rect', size: [r.w * comp.w, r.h * comp.h], stroke: L.color, strokeWidth: L.widthPx }], start: t0, end: t1 }]);
      if (L.enter) ops.push(enterKeys(comp, L, [(r.x + r.w / 2) * comp.w, (r.y + r.h / 2) * comp.h], at, L.enter.from === 'right' ? comp.w * 0.5 : -comp.w * 0.5));
      continue;
    }
    if (L.kind === 'divider') { ops.push(['layers_remove', { comp: comp.name, names: [L.name] }], ['layer_add_shape', { comp: comp.name, name: L.name, position: [L.x * comp.w, comp.h / 2], shapes: [{ type: 'rect', size: [L.widthPx, comp.h], fill: L.color }], start: t0, end: t1 }]); continue; }
    if (L.kind === 'hud') { ops.push(['layers_remove', { comp: comp.name, names: [L.name] }], hudShape(comp, L, t0, t1)); continue; }
    // footage
    const src = L.src; const rect = L.rect || { x: 0, y: 0, w: 1, h: 1 };
    ops.push(['layers_remove', { comp: comp.name, names: [L.name] }]);
    ops.push(['layer_add_footage', { comp: comp.name, item: L.asset, name: L.name, start: t0, end: t1, sourceIn: L.sourceIn ?? 0, speed: 1, opacity: L.opacity, blend: L.blend || undefined, motionBlur: L.motionBlur || undefined }]);
    let placement = null;
    if (src) {
      const crop = L.crop || (L.role === 'subject' ? null : null);
      placement = placeCrop({ src, crop: crop || { x: 0, y: 0, w: 1, h: 1 }, rect, comp });
      ops.push(['set_property', { comp: comp.name, layer: L.name, prop: 'scale', value: [placement.scalePct, placement.scalePct] }], ['set_property', { comp: comp.name, layer: L.name, prop: 'position', value: placement.position }]);
      if (L.mask?.boxSource) { const b = L.mask.boxSource; ops.push(['mask_add', { comp: comp.name, layer: L.name, shape: L.mask.shape || 'ellipse', rect: [b.x * src.w, b.y * src.h, b.w * src.w, b.h * src.h], feather: Math.max(0, L.mask.feather || 0) }]); }
      else if (L.mask && rect !== undefined && (rect.w < 1 || rect.h < 1)) ops.push(['mask_add', { comp: comp.name, layer: L.name, shape: L.mask.shape || 'rect', rect: placement.maskRect, feather: L.mask.feather || 0 }]);
    } else warnings.push(`${L.name}: source size unknown - placed by the host's cover fit, crop/mask skipped`);
    if (L.blur) {
      const chain = resolveChain('vfx.blur', caps).chain;
      if (chain.length) ops.push(...chain[0].build({ comp: comp.name, layer: L.name, amount: L.blur }, chain[0].resolved)); else warnings.push(`${L.name}: no blur effect available`);
    }
    if (ctx.remap && L.speed === 'follow') ops.push(...ctx.remap(L));
    const moves = L.motion && L.motion.length;
    if (moves && placement && src) {
      const tr = buildCameraTrack({ specs: L.motion, comp, asset: src, base: placement.scalePct, center: placement.center, t0, dur: t1 - t0, fps, seed: `${ctx.seed ?? 'stack'}.${L.name}`, maxLift: L.maxLift || 1.35 });
      tracks[L.name] = tr; warnings.push(...tr.warnings.map((w) => `${L.name}: ${w}`));
      ops.push(['keyframes', { comp: comp.name, layer: L.name, prop: 'scale', keys: tr.scale, ease: 'linear' }], ['keyframes', { comp: comp.name, layer: L.name, prop: 'position', keys: tr.position, ease: 'linear' }]);
      if (tr.rotation) ops.push(['keyframes', { comp: comp.name, layer: L.name, prop: 'rotation', keys: tr.rotation, ease: 'linear' }]);
      if (tr.motionBlur) ops.push(['layer_set', { comp: comp.name, layer: L.name, props: { motionBlur: true } }]);
    } else if (L.enter && placement) ops.push(enterKeys(comp, L, placement.position, at, L.enter.from === 'right' ? comp.w * 0.5 : -comp.w * 0.5, placement.scalePct));
  }
  if (plan.fadeOut) { for (const L of plan.layers) if (L.kind === 'footage' || L.kind === 'solid') ops.push(['keyframes', { comp: comp.name, layer: L.name, prop: 'opacity', keys: [{ t: +(t1 - plan.fadeOut).toFixed(4), v: L.opacity ?? 100 }, { t: t1, v: 0 }], ease: 'easeIn' }]); }
  for (const o of plan.overlays || []) if (o.kind === 'flash') {
    const n = `${shot.id || 'SHOT'}_FLASH`; names.push(n);
    ops.push(['layers_remove', { comp: comp.name, names: [n] }], ['layer_add_solid', { comp: comp.name, name: n, color: '#ffffff', start: at(o.at), end: at(o.at + o.d) }], ['layer_set', { comp: comp.name, layer: n, props: { blend: 'add' } }],
      ['keyframes', { comp: comp.name, layer: n, prop: 'opacity', keys: [{ t: at(o.at), v: 0 }, { t: at(o.at + 0.02), v: o.peak }, { t: at(o.at + o.d), v: 0 }], ease: 'linear' }]);
  }
  return { ops, names, warnings, tracks };
}

function enterKeys(comp, L, rest, at, dx, scalePct) {
  const e = L.enter; void scalePct;
  return ['keyframes', { comp: comp.name, layer: L.name, prop: 'position', keys: [{ t: at(e.at), v: [rest[0] + dx, rest[1]] }, { t: at(e.at + e.d), v: rest }], ease: 'easeOut' }];
}

function hudShape(comp, L, t0, t1) {
  const x0 = L.inset * comp.w; const y0 = L.inset * comp.h; const x1 = comp.w - x0; const y1 = comp.h - y0; const a = L.arm * comp.w;
  const poly = (pts) => ({ type: 'polyline', points: pts, stroke: L.color, strokeWidth: L.widthPx });
  return ['layer_add_shape', { comp: comp.name, name: L.name, position: [0, 0], shapes: [poly([[x0, y0 + a], [x0, y0], [x0 + a, y0]]), poly([[x1 - a, y0], [x1, y0], [x1, y0 + a]]), poly([[x0, y1 - a], [x0, y1], [x0 + a, y1]]), poly([[x1 - a, y1], [x1, y1], [x1, y1 - a]])], start: t0, end: t1 }];
}

export { rectsOverlap };
