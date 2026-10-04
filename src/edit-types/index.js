import { EDIT_TYPES, EDIT_TYPE_IDS, DIALS } from './profiles.js';

export { EDIT_TYPES, EDIT_TYPE_IDS, DIALS };
export const ACTIVITY_DIALS = ['cutFrequency', 'velocity', 'speedVariation', 'camera', 'motionBlur', 'effects', 'sfx', 'transitions', 'impact'];

const LOOK_TYPES = new Set(['cinematic', 'dark', 'epic', 'minimal', 'military', 'automotive', 'fashion', 'product', 'tech', 'corporate']);
const norm = (s) => String(s ?? '').toLowerCase().replace(/[_\-\s]+/g, ' ').trim();
const ALIAS = new Map();
for (const t of Object.values(EDIT_TYPES)) for (const a of [t.id, t.label, ...t.aliases]) ALIAS.set(norm(a), t.id);

/** "Music Video" / "music_video" / "mv" / "velocity edit" -> profile, or null. */
export function resolveEditType(name) {
  if (!name) return null;
  const id = ALIAS.get(norm(name));
  return id ? EDIT_TYPES[id] : null;
}

export function requireEditType(name) {
  const t = resolveEditType(name);
  if (!t) throw new Error(`unknown edit type "${name}". Known: ${EDIT_TYPE_IDS.join(', ')}`);
  return t;
}

/** Find an edit type mentioned in free text (longest alias wins); null if none. */
export function detectEditType(text) {
  const t = ` ${norm(text)} `;
  let best = null;
  for (const [alias, id] of ALIAS) {
    if (alias.length < 4 && !['mv', 'ad', 'yt'].includes(alias)) continue;
    if (['mv', 'ad', 'yt', 'doc', 'film', 'auto', 'game', 'short', 'sport', 'clean', 'simple', 'report', 'grand', 'moody', 'news'].includes(alias) && !t.includes(` ${alias} edit `) && !t.includes(` ${alias} video `)) continue; // too ambiguous alone
    if (!t.includes(` ${alias} `)) continue;
    // "a cinematic movie trailer": the FORM of the piece (trailer, velocity, documentary...) outranks a LOOK adjective (cinematic, dark, epic...)
    const score = alias.length + (LOOK_TYPES.has(id) ? 0 : 100);
    if (!best || score > best.score) best = { alias, id, score };
  }
  return best ? EDIT_TYPES[best.id] : null;
}

export const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Scale the activity dials by (wanted intensity / the type's own intensity), bounded so a calm type never
 * explodes and an aggressive one never goes dead.
 */
export function scaleByIntensity(dials, typeIntensity, wanted) {
  if (wanted === undefined || wanted === null) return { ...dials };
  const k = Math.min(1.6, Math.max(0.5, wanted / (typeIntensity || 0.5)));
  const out = { ...dials, intensity: clamp01(wanted) };
  for (const d of ACTIVITY_DIALS) out[d] = clamp01(dials[d] * k);
  return out;
}
