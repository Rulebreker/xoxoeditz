// SEMANTIC SFX SEARCH over the universal library manifest. Deterministic and explainable: every result carries
// the reasons for its score. Nothing here picks at random.

import { expandTerm, tokenize } from '../library/lexicon.js';
import { round } from '../core/time.js';

/** Event phrases the Director uses -> weighted search terms (the spec's examples are the first four). */
export const INTENTS = [
  { re: /\b(fast|quick|rapid|whip)\b.*\btransition\b|\bwhip\b/, terms: { whoosh: 1.6, fast: 1.2, transition: 1.2 }, role: 'transition' },
  { re: /\bimpact\b|\bslam\b|\bhit\b(?!.*camera)/, terms: { impact: 1.6, hit: 1.2, cinematic: 0.7 }, role: 'impact' },
  { re: /\b(technical|tech|hud)\b.*\bui\b|\bui\b|\binterface\b|\bdata\b/, terms: { digital: 1.2, click: 1, ui: 1.6, electronic: 1 }, role: 'text' },
  { re: /\bcamera\b.*\b(punch|hit|impact)\b|\bpunch[- ]?in\b/, terms: { camera: 1.4, movement: 1, hit: 1.2, punch: 1 }, role: 'camera' },
  { re: /\bris(?:er|e)\b|\bbuild[- ]?up\b|\btension build\b/, terms: { riser: 1.7, build: 1.2, tension: 0.8 }, role: 'riser' },
  { re: /\b(bass )?drop\b|\bsub\b/, terms: { sub: 1.4, boom: 1.2, drop: 1.2, low: 0.6 }, role: 'impact' },
  { re: /\bglitch\b|\bdistort(?:ion)?\b/, terms: { glitch: 1.7, digital: 1, distortion: 1 }, role: 'glitch' },
  { re: /\breverse\b|\brewind\b/, terms: { reverse: 1.7, build: 0.8 }, role: 'riser' },
  { re: /\bambien\w*|\batmospher\w*|\bbed\b/, terms: { ambience: 1.6, atmosphere: 1.2, bed: 0.8 }, role: 'ambience' },
  { re: /\bengine\b|\bcar\b|\bvehicle\b/, terms: { vehicle: 1.5, engine: 1.3, car: 1 }, role: 'vehicle' },
  { re: /\bweapon\b|\bgun\b|\bshot\b|\bmissile\b/, terms: { weapon: 1.5, gun: 1.2, shot: 1 }, role: 'weapon' },
  { re: /\bswell\b|\bswoosh\b|\bsmooth transition\b/, terms: { swoosh: 1.4, smooth: 1.1, transition: 0.9 }, role: 'transition' },
  { re: /\bdeep\b.*\bboom\b|\bboom\b|\bexplosion\b/, terms: { boom: 1.7, deep: 1, big: 0.8 }, role: 'impact' },
];

/** Query (string | {terms}) -> [{term, weight, syn: Map(synonym -> factor)}]: one group per concept the user asked for. */
export function expandGroups(query) {
  const base = new Map();
  if (query && typeof query === 'object' && query.terms) for (const [t, w] of Object.entries(query.terms)) base.set(t.toLowerCase(), w);
  else {
    const q = String(query || '').toLowerCase();
    for (const intent of INTENTS) if (intent.re.test(q)) for (const [t, w] of Object.entries(intent.terms)) base.set(t, Math.max(base.get(t) || 0, w));
    for (const t of tokenize(q)) if (!base.has(t)) base.set(t, 1);
  }
  return [...base].map(([term, weight]) => ({ term, weight, syn: new Map(expandTerm(term)) }));
}

/** Flat view of the same expansion: term -> weight (synonyms scaled by their similarity). */
export function expandQuery(query) {
  const out = new Map();
  for (const g of expandGroups(query)) for (const [syn, sw] of g.syn) out.set(syn, Math.max(out.get(syn) || 0, g.weight * sw));
  return out;
}

const FIELD_W = { subcategory: 3, tag: 1.6, name: 1.2, description: 0.7 };

// Each concept in the query counts once, through its best-matching synonym in its best-matching field, so a long
// synonym list can never dilute the score of a sound that matches what was asked for.
function lexicalScore(asset, groups) {
  const sub = (asset.subcategory || '').toLowerCase().replace(/_/g, ' ');
  const tags = new Set(asset.tags || []);
  const nameTokens = new Set(tokenize(asset.file || ''));
  const desc = ` ${(asset.description || '').toLowerCase()} `;
  let got = 0; let total = 0; const matched = [];
  for (const g of groups) {
    total += g.weight;
    let best = 0; let how = null;
    for (const [t, sw] of g.syn) {
      let f = 0; let where = null;
      if (sub === t) { f = FIELD_W.subcategory; where = 'category'; }
      else if (tags.has(t)) { f = FIELD_W.tag; where = 'tag'; }
      else if (nameTokens.has(t)) { f = FIELD_W.name; where = 'name'; }
      else if (desc.includes(` ${t} `) || desc.includes(` ${t},`) || desc.includes(`(${t}`)) { f = FIELD_W.description; where = 'description'; }
      if (f * sw > best) { best = f * sw; how = `${t}@${where}`; }
    }
    if (best) { got += g.weight * best; matched.push(how); }
  }
  return { score: total ? Math.min(1, got / (total * 2.2)) : 0, matched };
}

/**
 * @param {object} manifest universal-assets manifest
 * @param {string|object} query
 * @param {object} ctx { type:'sfx', editType, energy, intensity, duration, preferSubs:[], exclude:[], usage:Map|obj, memory:{id:score}, limit, minScore }
 * @returns {{asset, score, reasons}[]} best first
 */
export function searchLibrary(manifest, query, ctx = {}) {
  const { type = 'sfx', editType = null, energy = null, intensity = null, duration = null, preferSubs = [], exclude = [], usage = {}, memory = {}, limit = 5, minScore = 0.15 } = ctx;
  const groups = expandGroups(query);
  const prefer = new Set(preferSubs.map((s) => s.toUpperCase()));
  const use = usage instanceof Map ? Object.fromEntries(usage) : usage;
  const out = [];
  for (const a of manifest.assets) {
    if (a.type !== type || exclude.includes(a.id) || a.duplicateOf) continue;
    const lex = lexicalScore(a, groups);
    if (lex.score <= 0) continue;
    const r = { text: lex.score * 0.55 };
    r.energy = energy === null ? 0 : (1 - Math.abs((a.energy ?? 0.5) - energy)) * 0.2;
    r.intensity = intensity === null ? 0 : (1 - Math.abs((a.intensity ?? 0.5) - intensity)) * 0.06;
    if (duration && a.duration) { const ratio = a.duration / duration; r.duration = (ratio >= 0.6 && ratio <= 1.6 ? 1 : ratio > 1.6 ? Math.max(0, 1 - (ratio - 1.6) / 4) : Math.max(0, ratio / 0.6)) * 0.12; } else r.duration = 0;
    r.editType = editType && (a.recommended_for || []).includes(editType) ? 0.12 : 0;
    r.category = prefer.size && prefer.has((a.subcategory || '').toUpperCase()) ? 0.16 : 0;
    r.diversity = use[a.id] ? -0.14 * use[a.id] : 0; // never -0: plans are compared and serialised
    r.memory = 0.08 * (memory[a.id] || 0);
    const score = Object.values(r).reduce((x, y) => x + y, 0);
    if (score < minScore) continue;
    out.push({ asset: a, score: round(score, 4), reasons: { matched: lex.matched, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, round(v, 3)])) } });
  }
  out.sort((x, y) => y.score - x.score || x.asset.id.localeCompare(y.asset.id)); // ties are broken by id: never by chance
  return out.slice(0, limit);
}

/**
 * Pick one result. With an rng, choose among near-ties (within `slack`) so a repeated query can vary, still
 * reproducibly for a given seed; without, take the best.
 */
export function pick(results, { rng = null, slack = 0.05 } = {}) {
  if (!results.length) return null;
  if (!rng) return results[0];
  const near = results.filter((r) => results[0].score - r.score <= slack);
  return near[Math.floor(rng() * near.length)];
}

/** Role -> default query text (used when the Director only knows the kind of event). */
export const ROLE_QUERY = {
  transition: 'fast transition whoosh', whip: 'fast transition whoosh', soft_transition: 'smooth swoosh transition',
  impact: 'impact', big_impact: 'boom impact', hit: 'hit impact punch', riser: 'riser build tension', reverse: 'reverse build',
  text: 'technical ui', ui: 'technical ui', tick: 'tick click ui', camera: 'camera punch', glitch: 'glitch digital', drop: 'bass drop sub boom',
  ambience: 'ambience atmosphere bed', swell: 'swell build', vehicle: 'engine vehicle', weapon: 'weapon shot',
};

export function categoriesForRole(editType, role) {
  const p = editType?.sfx?.prefer || {};
  const key = { whip: 'transition', soft_transition: 'transition', big_impact: 'impact', hit: 'impact', ui: 'text', tick: 'text', reverse: 'riser', drop: 'impact', swell: 'riser' }[role] || role;
  return p[key] || [];
}
