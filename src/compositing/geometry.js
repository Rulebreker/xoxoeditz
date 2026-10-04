// Placement maths for compositing. All inputs/outputs are plain numbers so the tests can verify them exactly.
//   comp {w,h}  pixels          src {w,h}  source pixels
//   crop {x,y,w,h} fractions of the SOURCE frame      rect {x,y,w,h} fractions of the COMP frame

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Where must a footage layer sit so that the `crop` region of the source is fully visible inside `rect` of the comp?
 * The visible window is clamped to stay inside the source, so no placement ever shows past the picture's edge -
 * the crop is shifted (and `clamped` says so) rather than exposing emptiness.
 * Returns { scalePct, position:[x,y] (layer centre, comp px), window:{x,y,w,h} (source px), maskRect:[l,t,w,h] (layer space = source px), center:{x,y} (picture centre offset from the comp centre, comp fractions), clamped }
 */
export function placeCrop({ src, crop = { x: 0, y: 0, w: 1, h: 1 }, rect = { x: 0, y: 0, w: 1, h: 1 }, comp }) {
  const Dw = rect.w * comp.w; const Dh = rect.h * comp.h;
  const rw = Math.max(1, crop.w * src.w); const rh = Math.max(1, crop.h * src.h);
  // Scale so the WHOLE crop region is visible and the destination is filled: the window grows past the crop in one
  // dimension (using neighbouring pixels), and never needs more than the source has.
  const s = Math.max(Math.min(Dw / rw, Dh / rh), Dw / src.w, Dh / src.h);
  const winW = Dw / s; const winH = Dh / s;                      // the part of the source that ends up visible (>= the crop unless the source is too small)
  let cx = (crop.x + crop.w / 2) * src.w; let cy = (crop.y + crop.h / 2) * src.h;
  const ox = cx; const oy = cy;
  cx = clamp(cx, winW / 2, src.w - winW / 2); cy = clamp(cy, winH / 2, src.h - winH / 2);
  const destCx = (rect.x + rect.w / 2) * comp.w; const destCy = (rect.y + rect.h / 2) * comp.h;
  const position = [destCx - (cx - src.w / 2) * s, destCy - (cy - src.h / 2) * s];
  return {
    scalePct: s * 100, position,
    window: { x: cx - winW / 2, y: cy - winH / 2, w: winW, h: winH },
    maskRect: [cx - winW / 2, cy - winH / 2, winW, winH],
    center: { x: (position[0] - comp.w / 2) / comp.w, y: (position[1] - comp.h / 2) / comp.h },
    clamped: Math.abs(ox - cx) > 0.5 || Math.abs(oy - cy) > 0.5,
  };
}

/** Where does a point of the source (fractions) land in the comp (fractions) for a given placement? */
export function sourceToComp(p, placement, src, comp) {
  const s = placement.scalePct / 100;
  return { x: (placement.position[0] + (p.x * src.w - src.w / 2) * s) / comp.w, y: (placement.position[1] + (p.y * src.h - src.h / 2) * s) / comp.h };
}

/** A crop of the source around a subject box, `pad` times the subject, at the comp's aspect ratio, kept inside the frame. */
export function detailCrop(subject, { src, comp, pad = 1.7, minFrac = 0.4 }) {
  const aspect = (comp.w / comp.h) / (src.w / src.h);        // crop width/height in source-fraction terms
  const sw = subject.w * pad; const sh = subject.h * pad;
  let h = Math.max(sh, sw / aspect, minFrac); let w = h * aspect;
  if (w > 1) { w = 1; h = w / aspect; } if (h > 1) { h = 1; w = h * aspect; }
  const cx = clamp(subject.x + subject.w / 2, w / 2, 1 - w / 2); const cy = clamp(subject.y + subject.h / 2, h / 2, 1 - h / 2);
  return { x: +(cx - w / 2).toFixed(4), y: +(cy - h / 2).toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4) };
}

export const rectsOverlap = (a, b, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

/** Inset rectangle (comp fractions) for a picture-in-picture: the corner least covering the subject and the given keep-clear rects. */
export function pipRect({ size = 0.3, margin = 0.04, aspect = 16 / 9, comp, subject = null, avoid = [] }) {
  const w = size; const h = (size * comp.w) / aspect / comp.h;
  const corners = { 'bottom-right': { x: 1 - margin - w, y: 1 - margin - h }, 'top-right': { x: 1 - margin - w, y: margin }, 'bottom-left': { x: margin, y: 1 - margin - h }, 'top-left': { x: margin, y: margin } };
  let best = null;
  for (const [name, p] of Object.entries(corners)) {
    const r = { ...p, w, h }; let cost = 0;
    if (subject) cost += overlapArea(r, subject) * 4;
    for (const a of avoid) cost += overlapArea(r, a) * 6;
    if (name === 'top-left') cost += 0.002; if (name.startsWith('top')) cost += 0.001; // mild preference for the conventional corners
    if (!best || cost < best.cost) best = { name, rect: r, cost };
  }
  return best;
}
function overlapArea(a, b) { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x); const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 ? (w * h) / (a.w * a.h) : 0; }

/** Equal panels separated by a gutter: n columns (or rows) as comp-fraction rects. */
export function splitRects(n = 2, { gutter = 0.006, vertical = true } = {}) {
  const out = []; const each = (1 - gutter * (n - 1)) / n;
  for (let i = 0; i < n; i++) { const o = i * (each + gutter); out.push(vertical ? { x: o, y: 0, w: each, h: 1 } : { x: 0, y: o, w: 1, h: each }); }
  return out;
}
