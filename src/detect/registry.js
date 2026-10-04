import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { findAfterEffects, findMediaEncoder, scanPlugins } from './adobe.js';
import { scanFontFiles } from './fonts.js';
import { detectTools, detectGpu, isAeRunning } from './tools.js';
import { ensureDir } from '../core/paths.js';

/**
 * Capability registry: everything the planner/editor may rely on. Built by *discovery*, never assumption.
 * Shape is stable and documented in docs/ARCHITECTURE.md. Bridge-derived fields (effects, fonts,
 * templates, prefs) are merged in by `mergeHostInfo` once After Effects has answered.
 */
export async function buildCapabilityRegistry(config, { fsx = fs, platform = process.platform, env = process.env, probeGpu = true } = {}) {
  const installs = findAfterEffects({ platform, env, fsx, extraRoots: config.extraAdobeRoots, explicit: config.aePath });
  const chosen = installs[0] || null;
  const ame = findMediaEncoder({ platform, env, fsx, extraRoots: config.extraAdobeRoots });
  const tools = await detectTools(config);
  const plugins = scanPlugins(chosen, fsx);
  const fontFiles = scanFontFiles({ platform, env }, fsx);
  const running = chosen ? await isAeRunning(platform) : false;
  const gpu = probeGpu ? await detectGpu(platform) : [];

  const aerender = config.aerenderPath || chosen?.aerender || null;
  const reg = {
    generatedAt: new Date().toISOString(),
    os: { platform, release: os.release(), arch: os.arch(), cpus: os.cpus().length, memGb: Math.round(os.totalmem() / 2 ** 30) },
    gpu,
    after_effects: Boolean(chosen?.afterfx),
    after_effects_version: chosen?.version ?? null,
    after_effects_running: running,
    after_effects_install: chosen,
    after_effects_installs: installs.map((i) => ({ version: i.version, root: i.root, beta: i.beta })),
    aerender: Boolean(aerender),
    aerender_path: aerender,
    media_encoder: ame.length > 0,
    media_encoder_path: config.mediaEncoderPath || ame[0]?.exe || null,
    ffmpeg: tools.ffmpeg.available,
    ffprobe: tools.ffprobe.available,
    python: tools.python.available,
    node: true,
    whisper: tools.whisper.available,
    tools,
    plugins: { aex: plugins.aex, ffx_presets: plugins.ffx },
    fonts: { files: fontFiles, postScriptNames: [] },
    // filled from After Effects via the bridge:
    effects: { matchNames: [], byMatchName: {}, known: false },
    host: { known: false },
  };
  return reg;
}

/** Merge facts only After Effects can tell us (installed effects, fonts, prefs, render templates). */
export function mergeHostInfo(reg, info = {}) {
  const next = { ...reg, host: { known: true, ...(info.host || {}) } };
  if (Array.isArray(info.effects)) {
    const by = {};
    for (const e of info.effects) by[e.matchName] = { displayName: e.displayName, category: e.category };
    next.effects = { matchNames: Object.keys(by).sort(), byMatchName: by, known: true };
  }
  if (Array.isArray(info.fonts)) next.fonts = { ...reg.fonts, postScriptNames: info.fonts.map((f) => f.postScriptName).filter(Boolean) };
  if (info.renderTemplates) next.render_templates = info.renderTemplates;
  return next;
}

export function saveRegistry(config, reg) {
  ensureDir(path.dirname(config.capabilitiesFile));
  fs.writeFileSync(config.capabilitiesFile, JSON.stringify(reg, null, 2) + '\n');
  return config.capabilitiesFile;
}

export function loadRegistry(config) {
  try {
    const reg = JSON.parse(fs.readFileSync(config.capabilitiesFile, 'utf8'));
    // defensive: host facts that came from the simulator are never trusted
    if (reg?.host?.transport === 'mock') { reg.effects = { matchNames: [], byMatchName: {}, known: false }; reg.host = { known: false }; }
    return reg;
  } catch { return null; }
}

/** Does the registry say this effect (AE match name) is installed? Unknown = optimistic false for fallbacks. */
export function hasEffect(reg, matchName) {
  if (!reg?.effects?.known) return false;
  return Boolean(reg.effects.byMatchName[matchName]);
}

export function hasFont(reg, postScriptName) {
  return Boolean(reg?.fonts?.postScriptNames?.includes(postScriptName));
}
