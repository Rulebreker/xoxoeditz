// UNIVERSAL ASSET LIBRARY: production resources independent of any project (SFX, music, overlays, graphics, fonts,
// LUTs, presets, transitions, textures, AE templates). Scanned into universal-assets.manifest.json with the tags,
// measured features and recommendations the Director searches semantically. Library files are only ever READ.

import fs from 'node:fs';
import path from 'node:path';
import { walk } from '../assets/scan.js';
import { probeFile } from '../assets/probe.js';
import { fingerprintFile } from '../assets/fingerprint.js';
import { typeOf } from '../assets/classify.js';
import { decodePcm, describeSound } from '../audio/pcm.js';
import { TOP_LEVEL, SUBCATEGORIES, SFX_PRIORS, MUSIC_PRIORS, OVERLAY_PRIORS, tokenize } from './lexicon.js';
import { ensureDir, readJson, writeJson, ident } from '../core/paths.js';
import { round } from '../core/time.js';

export const LIBRARY_VERSION = 1;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Create the standard folder structure (idempotent) and a README. Returns the folders created. */
export function initLibrary(root) {
  const made = [];
  for (const [top] of Object.entries(TOP_LEVEL)) {
    for (const sub of SUBCATEGORIES[top] || [null]) {
      const dir = sub ? path.join(root, top, sub) : path.join(root, top);
      if (!fs.existsSync(dir)) { ensureDir(dir); made.push(dir); }
    }
  }
  const readme = path.join(root, 'README.md');
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, `# XOXOEDITZ universal asset library

Drop production resources into the matching folder (SFX/WHOOSH, MUSIC/ACTION, OVERLAYS/DUST, ...).
Names help (\`fast_whoosh_03.wav\`); an optional sidecar \`fast_whoosh_03.json\` can add
\`{"tags":[], "description":"", "energy":0.8, "genre":"", "recommended_for":["velocity"], "preferred_transition":"whip"}\`.
XOXOEDITZ only reads this folder. Run \`xoxo library scan\` after adding files.
`);
  return made;
}

function sidecar(file) {
  const base = file.replace(/\.[^.]+$/, '');
  try { return JSON.parse(fs.readFileSync(`${base}.json`, 'utf8')); } catch { return null; }
}

function priorsFor(top, sub) {
  const key = (sub || '').toUpperCase();
  if (top === 'SFX') return SFX_PRIORS[key];
  if (top === 'MUSIC') return MUSIC_PRIORS[key];
  if (top === 'OVERLAYS') return OVERLAY_PRIORS[key];
  return null;
}

function semanticDescription(a) {
  const bits = [];
  const energyWord = a.energy >= 0.8 ? 'very high-energy' : a.energy >= 0.6 ? 'high-energy' : a.energy >= 0.35 ? 'medium-energy' : 'low-energy';
  const what = [a.subcategory && a.subcategory.toLowerCase().replace(/_/g, ' '), a.category && a.type !== 'sfx' ? a.category.toLowerCase() : null].filter(Boolean)[0] || a.type;
  bits.push(`${energyWord} ${what} ${a.type === 'sfx' ? 'sound effect' : a.type}`);
  const extras = a.tags.filter((t) => !bits[0].includes(t)).slice(0, 4);
  if (extras.length) bits.push(`(${extras.join(', ')})`);
  if (a.duration) bits.push(`${a.duration}s`);
  if (a.type === 'sfx' && a.features) bits.push(a.features.attack <= 0.05 ? 'sharp attack' : a.features.attack >= 0.25 ? 'slow build' : 'moderate attack');
  if (a.type === 'sfx' && a.features) bits.push(a.features.brightness >= 0.5 ? 'bright' : a.features.brightness <= 0.12 ? 'dark/low' : 'balanced tone');
  if (a.bpm) bits.push(`${a.bpm} BPM`);
  return bits.join(' ');
}

/**
 * Scan a library root. `previous` entries are reused when path/size/mtime are unchanged (fast rescans), and user
 * edits stored in `override` survive. `analyzeMusic` is an optional async (file)=>({bpm,...}) hook (beat engine).
 */
export async function scanLibrary(config, root, { previous = null, analyze = true, analyzeMusic = null } = {}) {
  if (!root || !fs.existsSync(root)) throw new Error(`library folder not found: ${root || '(not configured)'}. Set XOXOEDITZ_ASSETS, "libraryRoot" in xoxo.config.json, or run \`xoxo library init <dir>\`.`);
  const { base, files } = walk(root, { maxFiles: 100000, maxDepth: 6 });
  const prev = new Map((previous?.assets || []).map((a) => [a.file, a]));
  const assets = []; const warnings = [];

  const stems = new Set(files.filter((f) => !/\.(json|txt|md)$/i.test(f)).map((f) => f.replace(/\.[^.]+$/, '')));
  for (const full of files) {
    if (/\.(json|txt|md)$/i.test(full) && stems.has(full.replace(/\.[^.]+$/, ''))) continue; // sidecar metadata, not an asset
    if (/(^|[\\/])universal-assets\.manifest\.json$/i.test(full)) continue;
    const rel = path.relative(base, full).split(path.sep).join('/');
    const parts = rel.split('/');
    if (parts.length < 2 && !/\.(wav|mp3|aif|aiff|flac|ogg|m4a|mp4|mov|png|jpg|jpeg|ttf|otf|cube|ffx|mogrt|aep|aet)$/i.test(rel)) continue; // README etc.
    const topRaw = parts.length > 1 ? parts[0] : '';
    const top = TOP_LEVEL[topRaw.toUpperCase()] ? topRaw.toUpperCase() : null;
    if (!top) { warnings.push(`${rel}: not inside a known top-level folder (${Object.keys(TOP_LEVEL).join(', ')}) - skipped`); continue; }
    const subRaw = parts.length > 2 ? parts[1] : null;
    const st = fs.statSync(full);
    const old = prev.get(rel);
    if (old && old.sizeBytes === st.size && old.mtimeMs === Math.round(st.mtimeMs) && old.libraryVersion === LIBRARY_VERSION && !old.stale) { assets.push({ ...old, ...(old.override || {}), path: full }); continue; } // unchanged: reuse (and re-apply any manual override)

    const { ext, type: kind } = typeOf(full);
    const sub = subRaw ? subRaw.toUpperCase() : null;
    const priors = priorsFor(top, sub);
    const sc = sidecar(full) || {};
    const a = {
      file: rel, path: full, type: TOP_LEVEL[top], category: top, subcategory: sub, ext, sizeBytes: st.size, mtimeMs: Math.round(st.mtimeMs),
      libraryVersion: LIBRARY_VERSION, fingerprint: fingerprintFile(full), override: old?.override || {},
    };
    // ---- metadata ----
    if (['audio', 'video', 'image'].includes(kind)) {
      const m = await probeFile(full, kind, config);
      Object.assign(a, {
        duration: m.duration ?? null, fps: m.fps ?? null, sampleRate: m.sampleRate ?? null, channels: m.audioChannels ?? null,
        resolution: m.width ? `${m.width}x${m.height}` : null, orientation: m.orientation ?? null, hasAlpha: /argb|rgba|yuva|bgra/.test(m.pixelFormat || '') || undefined,
      });
    }
    // ---- tags: folder names + file name + sidecar (synonyms are expanded at search time, not stored) ----
    const tagSet = new Set([...(priors?.tags || []), ...tokenize(sub || ''), ...tokenize(path.basename(full)), ...(sc.tags || []).map((t) => String(t).toLowerCase())]);
    if (top === 'MUSIC' && sub) tagSet.add(sub.toLowerCase().replace(/_/g, '-'));
    a.tags = [...tagSet];

    // ---- audio features -> energy / intensity ----
    let energy = priors?.energy ?? 0.5; let intensity = energy;
    if (analyze && kind === 'audio' && top === 'SFX') {
      try {
        const { samples, sampleRate } = await decodePcm(config, full, { maxSeconds: 12 });
        const f = describeSound(samples, sampleRate);
        a.features = f;
        const loud = clamp01((f.rmsDb + 40) / 28); // -40 dB..-12 dB -> 0..1
        const punch = clamp01(1 - f.attack / 0.3);
        energy = clamp01(0.6 * (priors?.energy ?? 0.5) + 0.25 * loud + 0.15 * punch);
        intensity = clamp01(0.5 * loud + 0.3 * clamp01((f.peakDb + 24) / 24) + 0.2 * punch);
        if (f.duration <= 0.4) a.tags.push('short'); else if (f.duration >= 2.5) a.tags.push('long');
        if (f.attack <= 0.05) a.tags.push('sharp'); if (f.brightness >= 0.5) a.tags.push('bright'); else if (f.brightness <= 0.12) a.tags.push('low');
      } catch (e) { warnings.push(`${rel}: audio analysis failed (${e.message})`); }
    } else if (analyze && kind === 'audio' && top === 'MUSIC') {
      try {
        if (analyzeMusic) { const m = await analyzeMusic(full); if (m) { a.bpm = m.bpm; a.beatConfidence = m.confidence; energy = clamp01(0.5 * (priors?.energy ?? 0.5) + 0.5 * clamp01(((m.bpm || 100) - 70) / 90)); } }
        const { samples, sampleRate } = await decodePcm(config, full, { maxSeconds: 30 });
        const f = describeSound(samples, sampleRate);
        intensity = clamp01((f.rmsDb + 40) / 28);
      } catch (e) { warnings.push(`${rel}: music analysis failed (${e.message})`); }
    }
    a.energy = round(clamp01(sc.energy ?? energy), 2);
    a.intensity = round(clamp01(sc.intensity ?? intensity), 2);
    a.genre = sc.genre || priors?.genre || (top === 'MUSIC' && sub ? sub.toLowerCase().replace(/_/g, '-') : null);
    a.recommended_for = [...new Set([...(sc.recommended_for || []).map((x) => String(x).toLowerCase()), ...(priors?.recommended_for || [])])];
    a.preferred_transition = sc.preferred_transition || priors?.transition || null;
    a.preferred_edit_types = a.recommended_for;
    if (priors?.blend) a.blend = priors.blend;
    a.id = `LIB_${ident(path.basename(full))}_${a.fingerprint.slice(0, 5).toUpperCase()}`;
    a.description = sc.description || semanticDescription({ ...a });
    Object.assign(a, a.override); // manual overrides win
    assets.push(a);
  }

  // duplicates by content
  const seen = new Map();
  for (const a of assets) { if (seen.has(a.fingerprint)) { a.duplicateOf = seen.get(a.fingerprint); warnings.push(`${a.file} is a duplicate of ${a.duplicateOf}`); } else seen.set(a.fingerprint, a.file); }

  const counts = {}; for (const a of assets) counts[a.type] = (counts[a.type] || 0) + 1;
  return { version: LIBRARY_VERSION, generatedAt: new Date().toISOString(), root: base, counts, warnings, assets };
}

export function saveLibraryManifest(config, manifest, { alsoInLibrary = false } = {}) {
  ensureDir(config.libraryDir);
  writeJson(config.libraryManifest, manifest);
  if (alsoInLibrary) { try { writeJson(path.join(manifest.root, 'universal-assets.manifest.json'), manifest); } catch { /* read-only library is fine */ } }
  return config.libraryManifest;
}

export function loadLibraryManifest(config) {
  return readJson(config.libraryManifest, null);
}

/** Scan (incrementally) and save. Returns the manifest. */
export async function refreshLibrary(config, opts = {}) {
  const previous = loadLibraryManifest(config);
  const m = await scanLibrary(config, config.libraryRoot, { previous, ...opts });
  saveLibraryManifest(config, m, opts);
  return m;
}
