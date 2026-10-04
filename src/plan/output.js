// Output spec parsing: "4K", "1080p", "vertical", "square", "cinematic", "2.39:1" ... -> exact pixels.

const HEIGHTS = { '480p': 480, '720p': 720, hd: 1080, '1080p': 1080, fhd: 1080, '1440p': 1440, '2k': 1440, '2160p': 2160, '4k': 2160, uhd: 2160, '8k': 4320 };
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

export function parseAspect(a) {
  if (!a) return null;
  const s = String(a).toLowerCase().trim();
  if (['vertical', 'portrait', 'tiktok', 'reels', 'shorts'].includes(s)) return 9 / 16;
  if (['square'].includes(s)) return 1;
  if (['cinematic', 'cinemascope', 'scope', 'anamorphic'].includes(s)) return 2.39;
  const m = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[1]) / Number(m[2]);
  return null;
}

/**
 * @param {{width?, height?, resolution?, aspect?, fps?}} o
 * `resolution` names the quality tier (4K = 2160 lines on the 16:9 baseline). Explicit width/height win.
 */
export function resolveOutput(o = {}) {
  const notes = [];
  if (o.width && o.height) return { width: even(o.width), height: even(o.height), fps: o.fps || 24, notes };
  const tier = HEIGHTS[String(o.resolution || '4k').toLowerCase()] || (Number(o.resolution) > 100 ? Number(o.resolution) : null);
  if (!tier) notes.push(`unrecognised resolution "${o.resolution}", using 4K`);
  const h16 = tier || 2160;
  const w16 = even((h16 * 16) / 9);
  const ratio = parseAspect(o.aspect) ?? 16 / 9;
  let width; let height;
  if (Math.abs(ratio - 16 / 9) < 0.01) { width = w16; height = h16; }
  else if (ratio < 1) { width = h16; height = even(h16 / ratio); }          // vertical: short side = tier
  else if (ratio === 1) { width = h16; height = h16; }
  else { width = w16; height = even(w16 / ratio); }                          // wider than 16:9: keep width
  return { width, height, fps: o.fps || 24, notes };
}
