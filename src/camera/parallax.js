// CROP-BASED 2.5D / PARALLAX. With only a flat photo or frame, depth is faked by stacking copies of the SAME
// footage: a background (whole frame, slightly softened, moves little) and a foreground cut-out around the
// detected subject (feathered mask, moves more and pushes harder). The result is data - a layer stack with masks and
// motion primitives - which the timeline compiler turns into layers. If no reliable subject was found the plan says
// so and falls back to a plain single-layer move instead of cutting a random rectangle out of the picture.

import { buildCameraTrack } from './track.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Pad the subject box so the cut-out includes its surroundings, and keep it inside the frame. */
export function paddedSubject(subject, pad = 0.14) {
  const w = clamp(subject.w + pad * 2, 0.2, 1); const h = clamp(subject.h + pad * 2, 0.2, 1);
  const x = clamp(subject.x - pad, 0, 1 - w); const y = clamp(subject.y - pad, 0, 1 - h);
  return { x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4) };
}

/**
 * @param {object} o { subject, dur, amount (0.06..0.2), layers (2|3), dir (deg), comp, asset, t0, fps, seed, minConf }
 * @returns {{ ok, mode: '2.5d'|'fallback', reason?, layers: [{role, depth, mask|null, blur, specs, track}], summary }}
 */
export function planParallax({ subject, dur, amount = 0.1, layers = 3, dir = 0, comp, asset = null, t0 = 0, fps = 24, seed = 'parallax', minConf = 0.3 }) {
  const reliable = subject && subject.conf >= minConf && subject.w < 0.9 && subject.h < 0.95;
  const mk = (role, depth, extra) => {
    const specs = [{ type: 'PARALLAX', amount, depth, dir, curve: 'ease-in-out' }];
    const track = buildCameraTrack({ specs, comp, asset, t0, dur, fps, seed: `${seed}.${role}`, maxLift: 1.3 });
    return { role, depth, specs, track, blur: 0, mask: null, ...extra };
  };
  if (!reliable) {
    const only = mk('single', 0.7, {});
    return { ok: false, mode: 'fallback', reason: subject ? `subject confidence ${subject.conf} too low or subject fills the frame` : 'no subject analysis available', layers: [only], summary: 'single-layer drift (no reliable subject for a 2.5D split)' };
  }
  const box = paddedSubject(subject);
  const stack = [mk('background', 0.3, { blur: 0.8 })];
  if (layers >= 3) stack.push(mk('midground', 0.6, { mask: { shape: 'rect', box: { x: 0, y: 0, w: 1, h: 1 }, feather: 0, note: 'full frame between background and subject' }, blur: 0.25 }));
  stack.push(mk('subject', 1.0, { mask: { shape: 'ellipse', box, feather: Math.round(Math.min(box.w, box.h) * 100 * 0.18) / 100, invert: false }, blur: 0 }));
  // the midground adds nothing visual in a flat stack unless it is separated; keep it only for 3-layer requests
  return { ok: true, mode: '2.5d', layers: stack, subjectBox: box, summary: `${stack.length}-layer parallax: ${stack.map((l) => `${l.role}(${l.depth})`).join(' / ')}` };
}
