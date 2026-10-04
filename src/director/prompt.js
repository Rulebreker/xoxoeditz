// PROMPT INTERPRETER: natural language -> director parameters. Deterministic and explainable: every phrase that
// changed something is reported with its effect, so "Make it fast but cinematic" is auditable, not magic.
//
//   "Make it fast but cinematic."  -> cutFrequency up, camera cinematic, effects restrained, transitions soft
//   "Insane velocity edit."        -> speedVariation ~0.95, cuts high, ramps aggressive, impact SFX high, motion blur high
//   "Premium Apple-style."         -> minimal, controlled motion, clean type, soft transitions, subtle SFX, premium colour

import { detectEditType } from '../edit-types/index.js';

const INTENSIFIER = /\b(very|extremely|super|really|incredibly|highly|insanely|ultra)\s+$/;
const SOFTENER = /\b(slightly|a bit|a little|somewhat|kind of|subtly)\s+$/;

// d: dial deltas, set: absolute dial values, color/velocityProfile/rig: profile ids, flags: booleans
export const RULES = [
  // ----- compound phrasings first (they also mark their parts as consumed) -----
  { id: 'fast-but-clean', re: /\bfast\b[^.]{0,12}\b(?:but|yet)\b[^.]{0,6}\b(clean|controlled|smooth|cinematic|premium|polished)\b/, d: { cutFrequency: 0.22, intensity: 0.08, effects: -0.15, transitions: -0.08, camera: -0.05 }, color: 'CINEMATIC', note: 'fast pace but restrained treatment', consume: ['fast', 'cinematic', 'clean', 'smooth', 'premium', 'polished', 'controlled'] },
  { id: 'premium-apple', re: /\b(apple[- ]?style|apple[- ]?like|premium|luxury|high[- ]end|minimalist|elegant)\b/, d: { effects: -0.2, text: -0.12, transitions: -0.12, sfx: -0.15, impact: -0.15, camera: -0.08 }, color: 'PREMIUM', rig: 'CAMERA_PRODUCT', note: 'premium / minimal: clean type, soft transitions, subtle SFX, low clutter' },
  // ----- energy -----
  { id: 'insane', re: /\b(insane|insanely|crazy|extreme|extremely wild|maximum|unhinged)\b/, d: { intensity: 0.25, cutFrequency: 0.2, velocity: 0.25, impact: 0.25, motionBlur: 0.2, camera: 0.2, sfx: 0.2, effects: 0.1 }, set: { speedVariation: 0.95 }, velocityProfile: 'VELOCITY_INSANE', note: 'extreme velocity: very high speed variation, cut rate, impacts, motion blur' },
  { id: 'aggressive', re: /\b(aggressive|hard[- ]hitting|brutal|intense|violent|relentless|savage)\b/, d: { intensity: 0.18, impact: 0.2, velocity: 0.15, sfx: 0.15, motionBlur: 0.1, camera: 0.12, cutFrequency: 0.1, speedVariation: 0.12 }, note: 'aggressive energy: harder impacts, ramps and sound' },
  { id: 'fast', re: /\b(fast|quick|rapid|snappy|energetic|high[- ]energy|punchy|dynamic|fast[- ]paced)\b/, d: { cutFrequency: 0.2, intensity: 0.1, sfx: 0.08 }, note: 'faster cutting' },
  { id: 'slow', re: /\b(slow|calm|relaxed|gentle|slow[- ]paced|peaceful|serene|contemplative)\b/, d: { cutFrequency: -0.25, velocity: -0.2, camera: -0.1, intensity: -0.18, impact: -0.15, sfx: -0.1 }, note: 'slower, calmer pacing' },
  { id: 'cinematic', re: /\bcinematic\b/, d: { camera: 0.05, depth: 0.2, color: 0.1 }, color: 'CINEMATIC', rig: 'CAMERA_CINEMATIC', flags: { letterboxHint: true }, note: 'cinematic camera, depth and grade' },
  { id: 'clean', re: /\b(clean|simple|minimal(?!\s+(?:sound|sfx|audio|music))|uncluttered|restrained|understated)\b/, d: { effects: -0.2, text: -0.08, transitions: -0.1 }, color: 'CLEAN', note: 'clean, uncluttered treatment' },
  { id: 'dark', re: /\b(dark|moody|noir|gritty|ominous|menacing)\b/, color: 'DARK', d: { color: 0.15 }, note: 'dark, moody grade' },
  { id: 'vibrant', re: /\b(vibrant|colou?rful|neon|saturated|bold colou?rs)\b/, color: 'VIBRANT', d: { color: 0.15 }, note: 'vibrant colour' },
  { id: 'military', re: /\b(military|j-?20|fighter|jet|aircraft|warplane|army|navy|air force|missile|tactical)\b/, color: 'MILITARY', hintType: 'military', note: 'military subject: stark grade, HUD vocabulary' },
  { id: 'automotive', re: /\b(automotive|supercar|sports car|hypercar|car edit|racing)\b/, color: 'AUTOMOTIVE', hintType: 'automotive', note: 'automotive: glossy grade' },
  { id: 'tech', re: /\b(futuristic|sci-?fi|hud|cyber|high[- ]tech|technology)\b/, color: 'TECH', d: { effects: 0.08 }, note: 'tech look' },
  { id: 'documentary-look', re: /\bdocumentary[- ]style\b/, color: 'DOCUMENTARY', rig: 'CAMERA_DOCUMENTARY', note: 'documentary camera and grade' },
  // ----- tools / techniques -----
  { id: 'ramps', re: /\b(speed[- ]?ramps?|ramps|velocity|time remap\w*|variable speed)\b/, d: { velocity: 0.3, speedVariation: 0.15 }, hintType: 'velocity', note: 'speed ramps / velocity changes' },
  { id: 'slowmo', re: /\b(slow[- ]?mo(?:tion)?)\b/, d: { velocity: 0.1 }, flags: { slowmo: true }, note: 'slow-motion moments' },
  { id: 'beat', re: /\b(beat[- ]?(?:sync(?:ed)?|match(?:ed)?|locked|aware)?|rhythm\w*|on the beat|sync(?:ed)? to (?:the )?(?:music|beat))\b/, d: { beatSync: 0.25 }, flags: { beatSync: true }, note: 'cuts and events locked to the music' },
  { id: 'whip', re: /\bwhip(?:s| pans?)?\b/, d: { transitions: 0.15, camera: 0.08 }, flags: { whip: true }, note: 'whip transitions' },
  { id: 'glitch', re: /\bglitch\w*\b/, d: { effects: 0.15, transitions: 0.05 }, flags: { glitch: true }, note: 'glitch accents' },
  { id: 'shake', re: /\b(shake|shaky|handheld|rumble)\b/, d: { camera: 0.15, impact: 0.08 }, flags: { shake: true }, note: 'camera shake on impacts' },
  { id: 'zoom', re: /\b(zoom(?:s)?|punch[- ]?ins?|punch[- ]?outs?|push[- ]?ins?)\b/, d: { camera: 0.1, impact: 0.08 }, note: 'zoom punches' },
  { id: 'motionblur', re: /\bmotion[- ]?blur\b/, d: { motionBlur: 0.25 }, note: 'motion blur' },
  { id: 'parallax', re: /\b(parallax|2\.5d|depth|layered)\b/, d: { depth: 0.3 }, flags: { parallax: true }, note: '2.5D / parallax depth' },
  { id: 'camera-move', re: /\b(camera (?:movement|motion|moves?)|dolly|orbit|crane|tracking shot)\b/, d: { camera: 0.2 }, note: 'more camera movement' },
  { id: 'typography', re: /\b(kinetic (?:typography|text)|typography|bold text|big text|rhythmic (?:type|text|typography)|titles?)\b/, d: { text: 0.2 }, note: 'more typography' },
  { id: 'sound', re: /\b(sound design|sfx|impact sfx|whooshes|whoosh|impacts?|risers?)\b/, d: { sfx: 0.15 }, note: 'stronger sound design' },
  { id: 'subtle-sound', re: /\b(subtle (?:sound|sfx|audio)|quiet sound|minimal sound)\b/, d: { sfx: -0.2, impact: -0.1 }, note: 'subtle sound' },
  { id: 'vfx', re: /\b(vfx|effects?|compositing|overlays?|light leaks?|lens flares?)\b/, d: { effects: 0.15 }, note: 'more visual effects' },
  { id: 'transitions-more', re: /\b(lots of transitions|many transitions|transition[- ]heavy)\b/, d: { transitions: 0.25 }, note: 'more transitions' },
  { id: 'professional', re: /\b(professional mode|pro mode|maximum quality|best possible|broadcast quality|top[- ]tier)\b/, flags: { professional: true }, note: 'professional mode' },
  // ----- negations -----
  { id: 'no-text', re: /\b(no (?:text|titles?|typography)|without (?:text|titles?|typography)|text[- ]free)\b/, set: { text: 0 }, flags: { captions: false }, note: 'no text' },
  { id: 'no-sfx', re: /\b(no sfx|no sound effects|without sfx|without sound effects)\b/, set: { sfx: 0 }, flags: { sfx: false }, note: 'no SFX' },
  { id: 'no-music', re: /\b(no music|without music|music[- ]free)\b/, flags: { music: false }, note: 'no music' },
  { id: 'no-glitch', re: /\b(no glitch\w*|without glitch\w*)\b/, flags: { glitch: false }, note: 'no glitch effects' },
  { id: 'no-effects', re: /\b(no effects|without effects|no vfx)\b/, set: { effects: 0.05 }, note: 'no effects' },
  { id: 'captions', re: /\b(captions?|subtitles?)\b/, flags: { captions: true }, note: 'captions' },
  { id: 'no-captions', re: /\b(no captions?|no subtitles?|without (?:captions?|subtitles?))\b/, flags: { captions: false }, note: 'no captions' },
];

const NEGATION_PRIORITY = new Set(['no-text', 'no-sfx', 'no-music', 'no-glitch', 'no-effects', 'no-captions']);

function parseDuration(text) {
  let m = /(\d+(?:\.\d+)?)\s*[- ]?\s*(?:minutes?|mins?)\b/.exec(text);
  if (m) return Math.round(Number(m[1]) * 60);
  m = /(\d+(?:\.\d+)?)\s*[- ]?\s*(?:seconds?|secs?|s)\b(?![a-z])/.exec(text);
  if (m && Number(m[1]) >= 3 && Number(m[1]) <= 600) return Math.round(Number(m[1]));
  return null;
}

function parseOutput(text) {
  const out = {};
  if (/\b(9:16|vertical|portrait|tiktok|reels?|shorts?|stories)\b/.test(text)) out.aspect = '9:16';
  else if (/\b(1:1|square)\b/.test(text)) out.aspect = '1:1';
  else if (/\b(2\.39|cinemascope|anamorphic|ultra[- ]?wide)\b/.test(text)) out.aspect = '2.39:1';
  else if (/\b(16:9|widescreen|landscape)\b/.test(text)) out.aspect = '16:9';
  const r = /\b(4k|uhd|2160p|1440p|1080p|720p|8k)\b/.exec(text); if (r) out.resolution = r[1] === 'uhd' || r[1] === '2160p' ? '4k' : r[1];
  const f = /\b(24|25|30|50|60)\s*fps\b/.exec(text); if (f) out.fps = Number(f[1]);
  return out;
}

function extractTexts(raw) {
  const quoted = []; const re = /["“”']([^"“”']{2,60})["“”']/g; let m;
  while ((m = re.exec(raw))) if (!/\s{3,}/.test(m[1]) && m[1].split(' ').length <= 8) quoted.push(m[1].trim());
  const titled = /\b(?:titled?|called|named)\s+["“]?([A-Z0-9][^".,\n]{1,40})/.exec(raw);
  const subjects = [...new Set((raw.match(/\b[A-Z]{1,3}-?\d{1,3}[A-Za-z]?\b|\b[A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,})*\b/g) || []).filter((s) => !/^(Make|Create|Use|Edit|Type|The|It|This|Add|With|And|Insane|Premium|Cinematic|Fast|Slow|Build|Give)$/.test(s)))];
  return { quoted, title: titled ? titled[1].trim() : (quoted[0] || null), subjects };
}

/**
 * @returns {{ dials: {name: delta}, set: {name: value}, color, rig, velocityProfile, flags, hintType, detectedType,
 *             durationSeconds, aspect, resolution, fps, title, quoted, subjects, explanation, consumed }}
 */
export function interpretPrompt(prompt = '') {
  const raw = String(prompt);
  const text = raw.toLowerCase();
  const r = { dials: {}, set: {}, color: null, rig: null, velocityProfile: null, flags: {}, hintType: null, explanation: [], matchedRules: [] };
  const consumed = new Set();
  const hits = [];
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    if (!NEGATION_PRIORITY.has(rule.id)) {
      // a word already explained by a compound rule does not fire again on its own
      if (rule.id !== 'fast-but-clean' && [...consumed].some((w) => m[0] === w || m[0].includes(w)) && ['fast', 'cinematic', 'clean'].includes(rule.id)) continue;
    }
    if (rule.consume) for (const w of rule.consume) consumed.add(w);
    const before = text.slice(0, m.index);
    const scale = INTENSIFIER.test(before) ? 1.5 : SOFTENER.test(before) ? 0.5 : 1;
    hits.push({ rule, phrase: m[0], scale });
  }
  for (const { rule, phrase, scale } of hits) {
    for (const [k, v] of Object.entries(rule.d || {})) r.dials[k] = (r.dials[k] || 0) + v * scale;
    Object.assign(r.set, rule.set || {});
    if (rule.color) r.color = rule.color;
    if (rule.rig) r.rig = rule.rig;
    if (rule.velocityProfile) r.velocityProfile = rule.velocityProfile;
    if (rule.hintType) r.hintType = r.hintType || rule.hintType;
    Object.assign(r.flags, rule.flags || {});
    r.matchedRules.push(rule.id);
    r.explanation.push({ phrase, rule: rule.id, effect: rule.note, ...(scale !== 1 ? { scaled: scale } : {}) });
  }
  const det = detectEditType(raw);
  r.detectedType = det ? det.id : null;
  r.durationSeconds = parseDuration(text);
  Object.assign(r, parseOutput(text));
  const t = extractTexts(raw);
  r.title = t.title; r.quoted = t.quoted; r.subjects = t.subjects;
  for (const k of Object.keys(r.dials)) r.dials[k] = Math.round(r.dials[k] * 1000) / 1000;
  return r;
}
