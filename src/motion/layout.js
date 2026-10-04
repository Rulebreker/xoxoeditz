// Resolution-independent layout. All sizes derive from frame height; margins keep text title-safe.

export const safeMargin = (w, h) => Math.round(Math.min(w, h) * 0.07);

export function anchorFor(position, w, h) {
  const m = safeMargin(w, h);
  const cx = w / 2; const cy = h / 2;
  const map = {
    center: { pos: [cx, cy], justify: 'center' },
    'top-center': { pos: [cx, m + h * 0.06], justify: 'center' },
    'bottom-center': { pos: [cx, h - m - h * 0.04], justify: 'center' },
    'lower-left': { pos: [m, h - m - h * 0.12], justify: 'left' },
    'lower-right': { pos: [w - m, h - m - h * 0.12], justify: 'right' },
    'upper-left': { pos: [m, m + h * 0.08], justify: 'left' },
    'upper-right': { pos: [w - m, m + h * 0.08], justify: 'right' },
    'left-center': { pos: [m, cy], justify: 'left' },
    'right-center': { pos: [w - m, cy], justify: 'right' },
  };
  return map[position] || map.center;
}

export const norm = (pt, w, h) => [Math.round(pt.x * w), Math.round(pt.y * h)];

export function applyCase(text, style) {
  return style === 'upper' ? String(text).toUpperCase() : String(text);
}

export const snapT = (t, fps) => Math.round(t * fps) / fps;
