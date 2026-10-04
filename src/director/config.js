// edit.config.json: the machine-readable form of an edit request. Everything is optional; CLI flags and the
// prompt can override it. Unknown keys are reported (typos should not silently do nothing).

import fs from 'node:fs';
import { requireEditType, resolveEditType, scaleByIntensity, clamp01, EDIT_TYPE_IDS, DIALS } from '../edit-types/index.js';
import { interpretPrompt } from './prompt.js';

export const KNOWN_KEYS = ['assets', 'type', 'style', 'intensity', 'music', 'sfx', 'captions', 'resolution', 'aspect', 'fps', 'prompt', 'output', 'library', 'seed', 'professional', 'duration', 'title', 'overrides', 'quality', 'memory'];
export const OVERRIDE_KEYS = ['velocity', 'camera', 'effects', 'sfx', 'transitions', 'text', 'color', 'motionBlur', 'speed', 'impact', 'beatSync', 'depth', 'cutFrequency', 'speedVariation', 'music', 'intensity'];

export const STYLE_ALIASES = { cinematic: 'CINEMATIC', military: 'MILITARY', automotive: 'AUTOMOTIVE', tech: 'TECH', dark: 'DARK', vibrant: 'VIBRANT', documentary: 'DOCUMENTARY', clean: 'CLEAN', premium: 'PREMIUM' };

export function validateEditConfig(cfg) {
  const errors = []; const warnings = [];
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { valid: false, errors: ['edit.config.json must be an object'], warnings };
  for (const k of Object.keys(cfg)) if (!KNOWN_KEYS.includes(k)) warnings.push(`unknown key "${k}" (known: ${KNOWN_KEYS.join(', ')})`);
  if (cfg.type !== undefined && !resolveEditType(cfg.type)) errors.push(`type "${cfg.type}" is not an edit type (known: ${EDIT_TYPE_IDS.join(', ')})`);
  if (cfg.intensity !== undefined && !(typeof cfg.intensity === 'number' && cfg.intensity >= 0 && cfg.intensity <= 1)) errors.push('intensity must be a number 0..1');
  if (cfg.fps !== undefined && !(Number.isFinite(cfg.fps) && cfg.fps >= 12 && cfg.fps <= 120)) errors.push('fps must be 12..120');
  if (cfg.style !== undefined && !STYLE_ALIASES[String(cfg.style).toLowerCase()]) warnings.push(`style "${cfg.style}" is not a colour profile (${Object.keys(STYLE_ALIASES).join(', ')}); it will only be used as prompt text`);
  if (cfg.captions !== undefined && typeof cfg.captions !== 'boolean') errors.push('captions must be true/false');
  if (cfg.music !== undefined && typeof cfg.music !== 'string' && typeof cfg.music !== 'boolean') errors.push('music must be "auto", "off", false, or a file/library path');
  if (cfg.sfx !== undefined && typeof cfg.sfx !== 'string' && typeof cfg.sfx !== 'boolean') errors.push('sfx must be "auto", "off", or false');
  for (const [k, v] of Object.entries(cfg.overrides || {})) {
    if (!OVERRIDE_KEYS.includes(k)) warnings.push(`unknown override "${k}" (known: ${OVERRIDE_KEYS.join(', ')})`);
    else if (!(typeof v === 'number' && v >= 0 && v <= 1)) errors.push(`override ${k} must be a number 0..1`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function loadEditConfig(file) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`cannot read ${file}: ${e.message}`); }
  const v = validateEditConfig(cfg);
  if (!v.valid) throw new Error(`${file}: ${v.errors.join('; ')}`);
  return { config: cfg, warnings: v.warnings };
}

/**
 * Combine everything the Director must honour. Precedence (low -> high):
 *   edit-type defaults  <  intensity scaling  <  edit.config.json  <  prompt  <  explicit overrides (CLI / human)
 * Returns the final directive with a per-dial `sources` map so the decision trail is visible.
 */
export function resolveDirective({ type = null, prompt = '', config = {}, overrides = {} } = {}) {
  const p = interpretPrompt([config.prompt, prompt].filter(Boolean).join('. '));
  const typeProfile = (type && requireEditType(type)) || resolveEditType(config.type) || (p.detectedType && requireEditType(p.detectedType)) || (p.hintType && resolveEditType(p.hintType)) || requireEditType('cinematic');
  const typeSource = type ? 'cli' : config.type ? 'config' : p.detectedType ? 'prompt' : p.hintType ? 'prompt-hint' : 'default';

  const sources = {}; const dials = { ...typeProfile.dials }; for (const d of DIALS) sources[d] = 'type';
  const intensityWanted = config.intensity ?? overrides.intensity ?? (p.dials.intensity !== undefined ? clamp01(typeProfile.dials.intensity + p.dials.intensity) : undefined);
  let cur = scaleByIntensity(dials, typeProfile.dials.intensity, intensityWanted);
  if (intensityWanted !== undefined) for (const d of DIALS) if (cur[d] !== dials[d]) sources[d] = config.intensity !== undefined ? 'config.intensity' : 'prompt';

  const ov = { ...(config.overrides || {}) };
  if (ov.speed !== undefined) { ov.velocity ??= ov.speed; delete ov.speed; }
  for (const [k, v] of Object.entries(ov)) if (DIALS.includes(k)) { cur[k] = clamp01(v); sources[k] = 'config.overrides'; }
  for (const [k, v] of Object.entries(p.dials)) if (k !== 'intensity' && DIALS.includes(k)) { cur[k] = clamp01(cur[k] + v); sources[k] = 'prompt'; }
  for (const [k, v] of Object.entries(p.set)) if (DIALS.includes(k)) { cur[k] = clamp01(v); sources[k] = 'prompt'; }
  const cli = { ...overrides }; if (cli.speed !== undefined) { cli.velocity ??= cli.speed; delete cli.speed; }
  for (const [k, v] of Object.entries(cli)) if (DIALS.includes(k) && v !== undefined) { cur[k] = clamp01(v); sources[k] = 'override'; }

  const styleId = config.style ? STYLE_ALIASES[String(config.style).toLowerCase()] : null;
  const colorProfile = styleId || p.color || typeProfile.color;
  const flags = { captions: config.captions ?? p.flags.captions ?? undefined, professional: Boolean(config.professional ?? p.flags.professional), beatSync: Boolean(p.flags.beatSync) || cur.beatSync >= 0.7,
    music: config.music === false || config.music === 'off' ? false : p.flags.music === false ? false : true, sfx: config.sfx === false || config.sfx === 'off' ? false : p.flags.sfx === false ? false : true,
    glitch: p.flags.glitch, whip: p.flags.whip, shake: p.flags.shake, parallax: p.flags.parallax || cur.depth >= 0.5, slowmo: p.flags.slowmo, letterbox: p.flags.letterboxHint };
  const musicPref = typeof config.music === 'string' && !['auto', 'off'].includes(config.music) ? config.music : null;

  return {
    editType: typeProfile, typeId: typeProfile.id, typeSource, dials: cur, sources, colorProfile,
    velocityProfile: p.velocityProfile || (cur.velocity >= 0.05 ? typeProfile.velocity.profile : null),
    rig: p.rig || typeProfile.camera.rig, flags, musicPref,
    durationSeconds: config.duration ?? p.durationSeconds ?? null,
    output: { aspect: config.aspect || p.aspect || typeProfile.aspect || '16:9', resolution: config.resolution || p.resolution || '4k', fps: config.fps || p.fps || 30 },
    title: config.title || p.title || null, quoted: p.quoted, subjects: p.subjects,
    seed: config.seed ?? 1, explanation: p.explanation, prompt: [config.prompt, prompt].filter(Boolean).join('. '), library: config.library || null,
    quality: config.quality || 'final',
  };
}
