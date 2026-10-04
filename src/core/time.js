export const snap = (t, fps) => Math.round(t * fps) / fps;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export function timecode(seconds, fps = 24) {
  const total = Math.max(0, Math.round(seconds * fps));
  const f = total % Math.round(fps);
  const s = Math.floor(total / Math.round(fps));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}:${String(f).padStart(2, '0')}`;
}

export function dbToLinear(db) { return 10 ** (db / 20); }
