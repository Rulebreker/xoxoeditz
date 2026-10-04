import path from 'node:path';

const EXT = {
  video: ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', 'mxf', 'mpg', 'mpeg', 'wmv', 'mts', 'm2ts', 'r3d', 'braw'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'psd', 'ai', 'svg', 'exr', 'heic', 'tga', 'dpx'],
  audio: ['wav', 'mp3', 'aif', 'aiff', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'wma'],
  font: ['ttf', 'otf', 'ttc', 'woff', 'woff2'],
  subtitle: ['srt', 'vtt', 'ass', 'ssa', 'sbv'],
  project: ['aep', 'aepx', 'prproj', 'drp'],
  template: ['mogrt', 'ffx', 'aet', 'lut', 'cube', '3dl'],
  script: ['txt', 'md', 'rtf', 'fountain'],
  document: ['pdf', 'doc', 'docx', 'json', 'csv', 'xlsx'],
};
const BY_EXT = new Map();
for (const [type, exts] of Object.entries(EXT)) for (const e of exts) BY_EXT.set(e, type);

export const ID_PREFIX = { video: 'VID', image: 'IMG', audio: 'AUD', font: 'FNT', subtitle: 'SUB', project: 'PRJ', template: 'TPL', script: 'DOC', document: 'DOC', other: 'FILE' };
const AUDIO_ROLE_PREFIX = { narration: 'NARR', music: 'MUSIC', sfx: 'SFX', unknown: 'AUD' };

export function typeOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return { ext, type: BY_EXT.get(ext) || 'other' };
}

const TOKENS = {
  narration: /(^|[^a-z])(narrat\w*|voice\s*over|voiceover|vo|voice|speech|dialog\w*|commentary|vocal)([^a-z]|$)/i,
  music: /(^|[^a-z])(music|bgm|score|soundtrack|theme|ambient|underscore|song|track|bed)([^a-z]|$)/i,
  sfx: /(^|[^a-z])(sfx|fx|foley|whoosh\w*|swoosh|impact|riser|hit|boom|stinger|click|beep|glitch|sweep|rumble|transition|pop|ding|thud)([^a-z]|$)/i,
};

/**
 * Infer what an audio file is *for*. Filename/folder hints win; duration is a weak fallback.
 * The result is a suggestion (`confidence`), recorded in the manifest where the user/Claude can override it.
 */
export function inferAudioRole(relPath, durationSec) {
  const name = relPath.replace(/\\/g, '/');
  const folder = path.posix.dirname(name);
  const hits = [];
  for (const role of ['narration', 'sfx', 'music']) {
    if (TOKENS[role].test(path.posix.basename(name, path.posix.extname(name)).replace(/[_\-.]/g, ' '))) hits.push([role, 'filename', 0.85]);
    else if (TOKENS[role].test(folder.replace(/[_\-.\/]/g, ' '))) hits.push([role, 'folder', 0.75]);
  }
  if (hits.length) {
    const [role, why, confidence] = hits[0];
    return { role, confidence, reason: `${why} hint` };
  }
  if (Number.isFinite(durationSec)) {
    if (durationSec <= 5) return { role: 'sfx', confidence: 0.4, reason: 'very short audio' };
    return { role: 'unknown', confidence: 0.2, reason: `no naming hint (duration ${durationSec.toFixed(0)}s)` };
  }
  return { role: 'unknown', confidence: 0.1, reason: 'no hints' };
}

export function assetIdPrefix(type, role) {
  if (type === 'audio') return AUDIO_ROLE_PREFIX[role] || 'AUD';
  return ID_PREFIX[type] || 'FILE';
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'for', 'img', 'image', 'vid', 'video', 'final', 'copy', 'new', 'edit', 'v1', 'v2', 'jpg', 'png', 'mp4', 'mov', 'wav', 'mp3', 'dsc', 'untitled']);

/** Keyword hints from file/folder names, used for semantic matching against the script. */
export function keywordsFor(relPath) {
  const parts = relPath.replace(/\\/g, '/').replace(/\.[^.]+$/, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const words = new Set();
  for (const p of parts) {
    // split camelCase and letter/digit boundaries: "J20Front" -> j, 20, front... keep alnum tokens too
    const pieces = p.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/);
    for (const w of [p, ...pieces]) {
      const lw = w.toLowerCase();
      if (lw.length >= 2 && !/^\d+$/.test(lw) && !STOP.has(lw)) words.add(lw);
    }
  }
  return [...words];
}
