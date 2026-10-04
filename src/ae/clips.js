import { snapT } from '../motion/layout.js';

const k = (t, v) => ({ t, v });

/** Scale (percent) at which an asset exactly covers / fits the comp. */
export function fitScale(asset, comp, fit = 'cover') {
  const aw = asset?.meta?.width; const ah = asset?.meta?.height;
  if (!aw || !ah) return null;
  const sx = comp.w / aw; const sy = comp.h / ah;
  const s = fit === 'cover' ? Math.max(sx, sy) : fit === 'contain' ? Math.min(sx, sy) : 1;
  return s * 100;
}

/**
 * Camera move for a clip as keyframes. Overscan is added so moves never reveal black edges:
 * pans scale up slightly and travel within the extra pixels.
 */
export function cameraMove(motion, base, comp, t0, t1, amount) {
  const cx = comp.w / 2; const cy = comp.h / 2;
  const s = (m) => [base * m, base * m];
  const ease = 'easeInOut';
  const a = amount;
  switch (motion) {
    case 'push_in': return { scale: [k(t0, s(1)), k(t1, s(1 + a))], position: null, ease };
    case 'pull_out': return { scale: [k(t0, s(1 + a)), k(t1, s(1))], position: null, ease };
    case 'pan_left': return { scale: [k(t0, s(1 + a * 1.2))], position: [k(t0, [cx + comp.w * a * 0.5, cy]), k(t1, [cx - comp.w * a * 0.5, cy])], ease };
    case 'pan_right': return { scale: [k(t0, s(1 + a * 1.2))], position: [k(t0, [cx - comp.w * a * 0.5, cy]), k(t1, [cx + comp.w * a * 0.5, cy])], ease };
    case 'pan_up': return { scale: [k(t0, s(1 + a * 1.2))], position: [k(t0, [cx, cy + comp.h * a * 0.5]), k(t1, [cx, cy - comp.h * a * 0.5])], ease };
    case 'pan_down': return { scale: [k(t0, s(1 + a * 1.2))], position: [k(t0, [cx, cy - comp.h * a * 0.5]), k(t1, [cx, cy + comp.h * a * 0.5])], ease };
    case 'drift': return { scale: [k(t0, s(1 + a * 0.7))], position: [k(t0, [cx - comp.w * a * 0.3, cy - comp.h * a * 0.15]), k(t1, [cx + comp.w * a * 0.3, cy + comp.h * a * 0.15])], ease };
    default: return null;
  }
}

/**
 * Build the unit for one clip. `tail` extends the last clip of a scene through the outgoing-transition overlap.
 */
export function buildClipUnit(clip, ctx) {
  const { comp, fps, asset, layerName, sceneId, idx, tail } = ctx;
  const t0 = snapT(clip.start, fps); const t1 = snapT(clip.end, fps);
  const extend = ctx.isLast && tail > 0 && Math.abs(clip.end - ctx.sceneLen) < 1 / fps + 1e-6;
  const end = extend ? t1 + tail : t1;
  const warnings = [];
  const isVideo = asset?.type === 'video';
  if (extend && isVideo && asset.meta?.duration && clip.sourceIn + (end - t0) * clip.speed > asset.meta.duration + 0.05) {
    warnings.push(`${layerName}: source too short to cover the ${tail.toFixed(2)}s transition overlap`);
  }
  const base = fitScale(asset, { w: comp.w, h: comp.h }, clip.fit);
  const ops = [
    ['layers_remove', { comp: comp.name, names: [layerName] }],
    ['layer_add_footage', { comp: comp.name, item: clip.asset, name: layerName, start: t0, end, sourceIn: clip.sourceIn, speed: clip.speed, fit: clip.fit === 'none' ? undefined : clip.fit }],
  ];
  if (isVideo && asset.meta?.hasAudio && !clip.keepAudio) ops.push(['layer_set', { comp: comp.name, layer: layerName, props: { audioEnabled: false } }]);
  if (clip.opacity !== undefined) ops.push(['set_property', { comp: comp.name, layer: layerName, prop: 'opacity', value: clip.opacity }]);
  const moving = clip.motion && clip.motion !== 'static';
  const mv = moving && base ? cameraMove(clip.motion, base, comp, t0, t1, ctx.amount) : null;
  if (moving && !base) warnings.push(`${layerName}: source size unknown, camera move "${clip.motion}" skipped`);
  if (mv) {
    ops.push(['keyframes', { comp: comp.name, layer: layerName, prop: 'scale', keys: mv.scale, ease: mv.ease }]);
    if (mv.position) ops.push(['keyframes', { comp: comp.name, layer: layerName, prop: 'position', keys: mv.position, ease: mv.ease }]);
  }
  if (clip.fadeIn) ops.push(['keyframes', { comp: comp.name, layer: layerName, prop: 'opacity', keys: [k(t0, 0), k(t0 + clip.fadeIn, 100)], ease: 'linear' }]);
  if (clip.fadeOut) ops.push(['keyframes', { comp: comp.name, layer: layerName, prop: 'opacity', keys: [k(t1 - clip.fadeOut, 100), k(t1, 0)], ease: 'linear', clear: !clip.fadeIn }]);

  // Placeholder alternative: a visible slate so a bad asset can't leave a hole in the timeline (QA flags it).
  const placeholder = [
    ['layers_remove', { comp: comp.name, names: [layerName], prefix: true }],
    ['layer_add_solid', { comp: comp.name, name: layerName, color: '#3a0d0d', start: t0, end }],
    ['layer_add_text', { comp: comp.name, name: `${layerName}_MISSING`, text: `MISSING: ${clip.asset}`, size: Math.round(comp.h * 0.04), color: '#ff6a6a', start: t0, end }],
  ];
  return {
    id: `${sceneId}.clip.${idx}`, label: `${sceneId} clip ${clip.asset}`, names: [layerName],
    alternatives: [{ name: 'footage', quality: 1, ops }, { name: 'placeholder', quality: 0.05, ops: placeholder }],
    warnings,
  };
}
