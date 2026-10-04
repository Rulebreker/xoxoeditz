// Style packs: the "art direction" tokens every motion-graphic template reads.
// Sizes are ratios of frame height so a style works at 720p, 4K, vertical or square without edits.

const SAFE_FALLBACK = { display: 'Arial-BoldMT', body: 'ArialMT', mono: 'ArialMT' };

export const STYLES = {
  'cinematic-documentary': {
    description: 'Serious, restrained, slow push-ins, wide tracking, thin accent rules.',
    fonts: { display: ['TrajanPro-Bold', 'Cinzel-Bold', 'Georgia-Bold', 'Arial-BoldMT'], body: ['SourceSansPro-Regular', 'SegoeUI', 'HelveticaNeue', 'ArialMT'], mono: ['Consolas', 'CourierNewPSMT', 'ArialMT'] },
    colors: { bg: '#07090c', text: '#f2efe9', muted: '#9aa0a6', accent: '#d8a64b', accent2: '#5b8fb9', shadow: '#0b1a2b', highlight: '#fff4e0' },
    type: { titleCase: 'upper', tracking: 160, titleSize: 0.085, subtitleSize: 0.036, bodySize: 0.032, captionSize: 0.04 },
    motion: { ease: 'easeOut', inDur: 0.9, outDur: 0.6, cameraAmount: 0.08, transition: 'dissolve', transitionDur: 1.0 },
    look: { letterbox: false, grain: true, vignette: 35, grade: 18 }, captions: { bottom: 0.1, bg: false },
  },
  'premium-commercial': {
    description: 'Clean, glossy, confident; crisp slides and tight easing.',
    fonts: { display: ['HelveticaNeue-Bold', 'Bahnschrift', 'SegoeUI-Bold', 'Arial-BoldMT'], body: ['HelveticaNeue', 'SegoeUI', 'ArialMT'], mono: ['ArialMT'] },
    colors: { bg: '#050505', text: '#ffffff', muted: '#b8b8b8', accent: '#e8e8ea', accent2: '#c9a45c', shadow: '#10131a', highlight: '#ffffff' },
    type: { titleCase: 'none', tracking: 40, titleSize: 0.09, subtitleSize: 0.038, bodySize: 0.034, captionSize: 0.042 },
    motion: { ease: 'easeOut', inDur: 0.7, outDur: 0.45, cameraAmount: 0.06, transition: 'zoom_punch', transitionDur: 0.5 },
    look: { letterbox: false, grain: false, vignette: 20, grade: 8 }, captions: { bottom: 0.1, bg: false },
  },
  'military-documentary': {
    description: 'Stark, technical, HUD brackets, olive/amber palette, monospaced data.',
    fonts: { display: ['Bahnschrift', 'Impact', 'Arial-BoldMT'], body: ['Bahnschrift', 'SegoeUI', 'ArialMT'], mono: ['Consolas', 'CourierNewPSMT', 'ArialMT'] },
    colors: { bg: '#080a07', text: '#e8eadc', muted: '#8d9480', accent: '#c9a227', accent2: '#6b7f3a', shadow: '#0e140c', highlight: '#f2f0d8' },
    type: { titleCase: 'upper', tracking: 120, titleSize: 0.08, subtitleSize: 0.034, bodySize: 0.03, captionSize: 0.038 },
    motion: { ease: 'easeOut', inDur: 0.6, outDur: 0.4, cameraAmount: 0.07, transition: 'dissolve', transitionDur: 0.8 },
    look: { letterbox: true, grain: true, vignette: 40, grade: 22 }, captions: { bottom: 0.12, bg: false },
  },
  'tech-explainer': {
    description: 'Bright, modern, rounded; confident motion with cyan accent.',
    fonts: { display: ['SegoeUI-Bold', 'Bahnschrift', 'Arial-BoldMT'], body: ['SegoeUI', 'ArialMT'], mono: ['Consolas', 'ArialMT'] },
    colors: { bg: '#0b1020', text: '#f5f8ff', muted: '#9fb0d0', accent: '#2ee6d6', accent2: '#7a6bff', shadow: '#0b1020', highlight: '#e8fbff' },
    type: { titleCase: 'none', tracking: 20, titleSize: 0.08, subtitleSize: 0.036, bodySize: 0.034, captionSize: 0.042 },
    motion: { ease: 'easeOut', inDur: 0.55, outDur: 0.35, cameraAmount: 0.05, transition: 'slide', transitionDur: 0.55 },
    look: { letterbox: false, grain: false, vignette: 0, grade: 0 }, captions: { bottom: 0.1, bg: true },
  },
  'minimal-corporate': {
    description: 'Quiet, light touch; fades only, generous whitespace.',
    fonts: { display: ['SegoeUI-Semibold', 'HelveticaNeue-Medium', 'ArialMT'], body: ['SegoeUI', 'HelveticaNeue', 'ArialMT'], mono: ['ArialMT'] },
    colors: { bg: '#101214', text: '#f4f4f2', muted: '#a6a8a6', accent: '#4f8cff', accent2: '#4f8cff', shadow: '#101214', highlight: '#ffffff' },
    type: { titleCase: 'none', tracking: 10, titleSize: 0.07, subtitleSize: 0.034, bodySize: 0.032, captionSize: 0.04 },
    motion: { ease: 'easeInOut', inDur: 0.6, outDur: 0.4, cameraAmount: 0.03, transition: 'dissolve', transitionDur: 0.6 },
    look: { letterbox: false, grain: false, vignette: 0, grade: 0 }, captions: { bottom: 0.1, bg: false },
  },
  'fast-youtube': {
    description: 'Punchy: quick cuts, big bold captions, zoom punches, high contrast.',
    fonts: { display: ['Impact', 'Arial-BlackItalic', 'Arial-BoldMT'], body: ['Arial-BoldMT', 'ArialMT'], mono: ['ArialMT'] },
    colors: { bg: '#000000', text: '#ffffff', muted: '#d0d0d0', accent: '#ffd200', accent2: '#ff3d3d', shadow: '#000000', highlight: '#ffffff' },
    type: { titleCase: 'upper', tracking: 0, titleSize: 0.11, subtitleSize: 0.045, bodySize: 0.042, captionSize: 0.058 },
    motion: { ease: 'easeOut', inDur: 0.3, outDur: 0.2, cameraAmount: 0.1, transition: 'zoom_punch', transitionDur: 0.25 },
    look: { letterbox: false, grain: false, vignette: 0, grade: 0 }, captions: { bottom: 0.22, bg: false },
  },
};

export const STYLE_ALIASES = {
  cinematic: 'cinematic-documentary', documentary: 'cinematic-documentary', 'cinematic documentary': 'cinematic-documentary',
  automotive: 'premium-commercial', commercial: 'premium-commercial', premium: 'premium-commercial',
  military: 'military-documentary', defense: 'military-documentary', defence: 'military-documentary',
  tech: 'tech-explainer', technology: 'tech-explainer', explainer: 'tech-explainer',
  corporate: 'minimal-corporate', minimal: 'minimal-corporate',
  youtube: 'fast-youtube', 'fast-paced': 'fast-youtube', fast: 'fast-youtube',
};

/** Choose a style pack from a free-text brief. Deterministic keyword scoring. */
export function guessStyle(brief = '') {
  const t = brief.toLowerCase();
  const score = (re) => (t.match(re) || []).length;
  const scores = { // whole words only ("jet" must not match "objective"); ties fall to the first entry
    'cinematic-documentary': score(/\b(cinematic|documentary|serious|epic|history|historic|premium|story)\b/g),
    'military-documentary': score(/\b(military|fighter|jets?|j-?20|f-?\d\d|weapons?|army|navy|air force|defen[cs]e|warfare|combat|missiles?)\b/g) * 2,
    'premium-commercial': score(/\b(commercial|automotive|cars?|luxury|brand|advert\w*)\b/g) * 2,
    'tech-explainer': score(/\b(tech|technology|software|ai|explainer|app|startup|saas)\b/g) * 2,
    'minimal-corporate': score(/\b(corporate|minimal|business|clean|presentation)\b/g),
    'fast-youtube': score(/\b(youtube|fast|viral|shorts|tiktok|reels|punchy|meme)\b/g) * 2,
  };
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]; // stable sort keeps insertion order on ties
  return best[1] > 0 ? best[0] : 'cinematic-documentary';
}

export function pickFont(candidates, caps) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  const installed = caps?.fonts?.postScriptNames || [];
  if (installed.length === 0) return { font: list[list.length - 1], verified: false };
  const hit = list.find((f) => installed.includes(f));
  return hit ? { font: hit, verified: true, fellBack: hit !== list[0] } : { font: installed.includes('ArialMT') ? 'ArialMT' : installed[0], verified: true, fellBack: true };
}

/**
 * Resolve a style (name, alias, or partial custom object) into concrete tokens with real, installed fonts.
 */
export function resolveStyle(style, caps) {
  let base; let name;
  if (typeof style === 'object' && style) { name = style.extends || 'cinematic-documentary'; base = STYLES[STYLE_ALIASES[name] || name] || STYLES['cinematic-documentary']; }
  else { const k = String(style || 'cinematic-documentary').toLowerCase(); name = STYLE_ALIASES[k] || k; base = STYLES[name]; if (!base) { name = guessStyle(k); base = STYLES[name]; } }
  const over = typeof style === 'object' && style ? style : {};
  const merged = {
    name, description: base.description,
    colors: { ...base.colors, ...(over.colors || {}) },
    type: { ...base.type, ...(over.type || {}) },
    motion: { ...base.motion, ...(over.motion || {}) },
    look: { ...base.look, ...(over.look || {}) },
    captions: { ...base.captions, ...(over.captions || {}) },
  };
  const fonts = {}; const fontNotes = [];
  for (const role of ['display', 'body', 'mono']) {
    const cands = over.fonts?.[role] ? [].concat(over.fonts[role], base.fonts[role]) : base.fonts[role];
    const p = pickFont(cands, caps);
    fonts[role] = p.font;
    if (p.fellBack) fontNotes.push(`${role} font fell back to ${p.font} (preferred ${cands[0]} not installed)`);
    if (!p.verified) fontNotes.push(`${role} font ${p.font} not verified against After Effects' font list`);
  }
  merged.fonts = fonts; merged.fontNotes = fontNotes;
  return merged;
}
