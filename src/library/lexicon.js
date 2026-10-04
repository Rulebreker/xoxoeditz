// Vocabulary shared by library tagging and semantic search: top-level folders, per-subcategory priors,
// synonym groups. Everything here is data: extend it to teach XOXOEDITZ new sounds or styles.

export const TOP_LEVEL = {
  SFX: 'sfx', MUSIC: 'music', OVERLAYS: 'overlay', GRAPHICS: 'graphic', FONTS: 'font', LUTS: 'lut',
  PRESETS: 'preset', TRANSITIONS: 'transition', TEXTURES: 'texture', AE_TEMPLATES: 'template',
};

export const SUBCATEGORIES = {
  SFX: ['WHOOSH', 'IMPACT', 'RISER', 'HIT', 'SWOOSH', 'CAMERA', 'TRANSITION', 'GLITCH', 'DIGITAL', 'UI', 'BOOM', 'SUB', 'TENSION', 'AMBIENCE', 'WEAPON', 'MECHANICAL', 'VEHICLE', 'FOOTSTEP', 'CLICK', 'TICK', 'REVERSE', 'SWELL'],
  MUSIC: ['CINEMATIC', 'ACTION', 'DOCUMENTARY', 'TECHNO', 'CORPORATE', 'DARK', 'EPIC', 'PHONK', 'HIP_HOP', 'AMBIENT'],
  OVERLAYS: ['FILM', 'LIGHT', 'DUST', 'SMOKE', 'FIRE', 'PARTICLES', 'ENERGY', 'GLITCH'],
  GRAPHICS: ['HUD', 'GRIDS', 'TARGETING', 'TECH', 'ARROWS', 'CALLOUTS', 'LOWER_THIRDS'],
};

const E = (energy, rec, extra = {}) => ({ energy, recommended_for: rec, ...extra });

/** Prior knowledge per SFX sub-category: how strong it is, what edit types want it, which transition it suits. */
export const SFX_PRIORS = {
  WHOOSH: E(0.62, ['velocity', 'action', 'trailer', 'whip', 'sports', 'youtube', 'shorts'], { transition: 'whip', tags: ['whoosh', 'transition', 'movement'] }),
  SWOOSH: E(0.5, ['cinematic', 'commercial', 'automotive', 'product', 'fashion'], { transition: 'push', tags: ['swoosh', 'smooth', 'transition', 'movement'] }),
  IMPACT: E(0.9, ['velocity', 'action', 'trailer', 'cinematic', 'military', 'epic', 'sports'], { transition: 'flash', tags: ['impact', 'hit', 'cinematic'] }),
  HIT: E(0.82, ['velocity', 'action', 'trailer', 'sports', 'meme', 'gaming'], { transition: 'flash', tags: ['hit', 'impact', 'punch'] }),
  BOOM: E(0.95, ['trailer', 'action', 'military', 'epic', 'velocity'], { transition: 'flash', tags: ['boom', 'impact', 'low', 'big'] }),
  SUB: E(0.75, ['trailer', 'cinematic', 'dark', 'epic', 'military', 'velocity'], { tags: ['sub', 'bass', 'low', 'drop'] }),
  RISER: E(0.7, ['trailer', 'velocity', 'epic', 'techno', 'action', 'music video'], { transition: 'zoom', tags: ['riser', 'build', 'tension', 'rise'] }),
  SWELL: E(0.5, ['cinematic', 'epic', 'trailer', 'documentary', 'dark'], { tags: ['swell', 'build', 'atmosphere'] }),
  REVERSE: E(0.5, ['trailer', 'cinematic', 'velocity', 'music video'], { transition: 'zoom', tags: ['reverse', 'reversed', 'build'] }),
  CAMERA: E(0.5, ['cinematic', 'documentary', 'commercial', 'automotive', 'product'], { transition: 'push', tags: ['camera', 'movement', 'shutter'] }),
  TRANSITION: E(0.6, ['velocity', 'youtube', 'shorts', 'reel', 'tech', 'commercial'], { transition: 'whip', tags: ['transition'] }),
  GLITCH: E(0.75, ['tech', 'gaming', 'music video', 'velocity', 'meme', 'youtube'], { transition: 'glitch', tags: ['glitch', 'digital', 'distortion', 'electronic'] }),
  DIGITAL: E(0.4, ['tech', 'corporate', 'documentary', 'gaming', 'news'], { tags: ['digital', 'electronic', 'tech'] }),
  UI: E(0.3, ['tech', 'corporate', 'documentary', 'news', 'product'], { tags: ['ui', 'interface', 'digital', 'click', 'electronic'] }),
  CLICK: E(0.25, ['tech', 'corporate', 'minimal', 'product'], { tags: ['click', 'ui', 'digital'] }),
  TICK: E(0.25, ['tech', 'documentary', 'news', 'corporate'], { tags: ['tick', 'click', 'ui', 'counter'] }),
  TENSION: E(0.45, ['military', 'trailer', 'dark', 'documentary', 'cinematic'], { tags: ['tension', 'dark', 'drone', 'suspense'] }),
  AMBIENCE: E(0.15, ['documentary', 'cinematic', 'ambient', 'dark'], { tags: ['ambience', 'atmosphere', 'bed'] }),
  WEAPON: E(0.85, ['military', 'action', 'gaming', 'trailer'], { tags: ['weapon', 'military', 'gun'] }),
  MECHANICAL: E(0.5, ['automotive', 'military', 'tech', 'product', 'documentary'], { tags: ['mechanical', 'machine', 'engine'] }),
  VEHICLE: E(0.6, ['automotive', 'sports', 'military', 'action'], { tags: ['vehicle', 'engine', 'motor', 'car'] }),
  FOOTSTEP: E(0.25, ['documentary', 'military', 'cinematic'], { tags: ['footstep', 'foley', 'steps'] }),
};

export const MUSIC_PRIORS = {
  CINEMATIC: E(0.5, ['cinematic', 'documentary', 'commercial', 'trailer'], { genre: 'cinematic' }),
  ACTION: E(0.85, ['velocity', 'action', 'trailer', 'sports', 'military'], { genre: 'action' }),
  DOCUMENTARY: E(0.35, ['documentary', 'news', 'corporate', 'military'], { genre: 'documentary' }),
  TECHNO: E(0.85, ['velocity', 'tech', 'music video', 'gaming', 'youtube'], { genre: 'techno' }),
  CORPORATE: E(0.45, ['corporate', 'commercial', 'product', 'tech'], { genre: 'corporate' }),
  DARK: E(0.55, ['military', 'dark', 'trailer', 'cinematic', 'gaming'], { genre: 'dark' }),
  EPIC: E(0.8, ['trailer', 'epic', 'military', 'cinematic', 'sports'], { genre: 'epic' }),
  PHONK: E(0.8, ['velocity', 'automotive', 'meme', 'music video', 'sports', 'gaming'], { genre: 'phonk' }),
  HIP_HOP: E(0.7, ['music video', 'fashion', 'sports', 'youtube', 'reel'], { genre: 'hip-hop' }),
  AMBIENT: E(0.15, ['documentary', 'minimal', 'product', 'cinematic'], { genre: 'ambient' }),
};

export const OVERLAY_PRIORS = {
  FILM: E(0.3, ['cinematic', 'documentary', 'military'], { blend: 'screen' }),
  LIGHT: E(0.5, ['cinematic', 'commercial', 'automotive', 'fashion', 'velocity'], { blend: 'screen' }),
  DUST: E(0.2, ['cinematic', 'documentary', 'military'], { blend: 'screen' }),
  SMOKE: E(0.4, ['military', 'cinematic', 'action', 'dark'], { blend: 'screen' }),
  FIRE: E(0.8, ['action', 'military', 'trailer'], { blend: 'screen' }),
  PARTICLES: E(0.4, ['cinematic', 'tech', 'commercial'], { blend: 'screen' }),
  ENERGY: E(0.7, ['tech', 'gaming', 'velocity', 'action'], { blend: 'screen' }),
  GLITCH: E(0.75, ['tech', 'gaming', 'velocity', 'meme'], { blend: 'screen' }),
};

/** Words that mean (roughly) the same thing. Search expands every query term through these groups. */
export const SYNONYM_GROUPS = [
  ['whoosh', 'swoosh', 'swish', 'sweep', 'pass', 'passby', 'whip', 'airy'],
  ['impact', 'hit', 'slam', 'thud', 'punch', 'smash', 'strike', 'boom'],
  ['boom', 'explosion', 'blast', 'detonation', 'sub', 'low'],
  ['riser', 'rise', 'build', 'buildup', 'swell', 'tension', 'uplifter', 'crescendo'],
  ['ui', 'interface', 'click', 'tick', 'blip', 'beep', 'digital', 'electronic', 'tech', 'technical', 'hud', 'screen'],
  ['glitch', 'distortion', 'digital', 'data', 'corrupt', 'stutter'],
  ['camera', 'shutter', 'lens', 'movement', 'handheld', 'dolly'],
  ['transition', 'cut', 'change', 'swap'],
  ['fast', 'quick', 'rapid', 'snappy', 'speed', 'high-energy', 'aggressive'],
  ['slow', 'smooth', 'soft', 'gentle', 'subtle', 'calm'],
  ['dark', 'ominous', 'sinister', 'tense', 'menacing', 'drone'],
  ['mechanical', 'machine', 'engine', 'motor', 'servo', 'metal'],
  ['weapon', 'gun', 'missile', 'military', 'rifle', 'ordnance'],
  ['vehicle', 'car', 'engine', 'automotive', 'jet', 'aircraft'],
  ['reverse', 'reversed', 'backwards'],
  ['ambience', 'atmosphere', 'ambient', 'bed', 'room-tone'],
];

const GROUP_INDEX = new Map();
for (const g of SYNONYM_GROUPS) for (const w of g) { if (!GROUP_INDEX.has(w)) GROUP_INDEX.set(w, new Set()); for (const o of g) GROUP_INDEX.get(w).add(o); }

/** term -> {term: weight}; the term itself weighs 1, synonyms 0.55. */
export function expandTerm(term) {
  const t = term.toLowerCase();
  const out = new Map([[t, 1]]);
  for (const s of GROUP_INDEX.get(t) || []) if (!out.has(s)) out.set(s, 0.55);
  return out;
}

export const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'for', 'to', 'and', 'or', 'with', 'in', 'on', 'at', 'by', 'sfx', 'sound', 'audio', 'wav', 'mp3', 'final', 'new', 'copy', 'v1', 'v2']);

/** "fast_whoosh_03.wav" / "FastWhoosh03" -> ['fast', 'whoosh']. Numbers and stopwords dropped. */
export function tokenize(text) {
  return String(text).replace(/\.[^./\\]+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').split(/[^A-Za-z0-9]+/).map((w) => w.toLowerCase()).filter((w) => w.length > 1 && !/^\d+$/.test(w) && !STOPWORDS.has(w));
}
