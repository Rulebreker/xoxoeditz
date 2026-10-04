import fs from 'node:fs';
import path from 'node:path';
import { validatePlan, normalizePlan, masterEnd } from '../plan/schema.js';
import { compilePlan, countOps } from './compile.js';
import { executeBuild } from './executor.js';
import { openOrCreateProject, checkpoint } from './project.js';
import { mergeHostInfo, saveRegistry } from '../detect/registry.js';
import { autoSfxCues, pickSfxAsset } from '../audio/sound.js';
import { synthesizeSfx, SYNTH } from '../audio/synth.js';
import { writeJson, ensureDir } from '../core/paths.js';
import { nullLogger } from '../core/logger.js';
import { fail, ok } from '../core/result.js';

/** Ask After Effects what it actually has (effects, fonts) and merge into the capability registry. */
export async function refreshHostCapabilities(bridge, caps, config, logger = nullLogger) {
  const info = {};
  const fx = await bridge.call('list_effects');
  if (fx.success) info.effects = fx.data.effects; else logger.warn('list_effects failed', { error: fx.error });
  const fonts = await bridge.call('list_fonts');
  if (fonts.success) info.fonts = fonts.data.fonts; else logger.info('list_fonts unavailable', { error: fonts.error });
  const ping = await bridge.call('ping');
  if (ping.success) info.host = ping.data;
  const merged = mergeHostInfo(caps, info);
  if (config) { try { saveRegistry(config, merged); } catch { /* */ } }
  return { caps: merged, problems: [fx, fonts].filter((r) => !r.success).map((r) => `${r.operation}: ${r.error}`) };
}

/**
 * Auto sound design: cue list from the edit, mapped to the user's SFX assets, or synthesized as a last resort.
 * Returns a working manifest (with any generated assets appended) and the resolved cues.
 */
export async function prepareSfx(config, plan, manifest, generatedDir, { synth = true } = {}) {
  const working = { ...manifest, assets: [...manifest.assets] };
  const notes = [];
  if (!plan.audio.autoSfx) return { manifest: working, cues: [], notes };
  const cues = autoSfxCues(plan);
  const resolved = [];
  for (const c of cues) {
    let asset = pickSfxAsset(working, c.kind);
    if (!asset && synth && SYNTH[c.kind]) {
      try {
        const file = await synthesizeSfx(config, c.kind, generatedDir);
        asset = { id: `SFX_GEN_${c.kind.toUpperCase()}`, relPath: path.basename(file), path: file, ext: 'wav', type: 'audio', role: 'sfx', roleConfidence: 1, roleReason: 'generated', keywords: [c.kind, 'generated'], meta: { duration: null, hasAudio: true, probe: 'generated' }, generated: true, override: {}, description: `Synthesized ${c.kind}` };
        working.assets.push(asset);
        notes.push(`no ${c.kind} SFX supplied; synthesized one with FFmpeg (basic quality — supply real SFX for a premium result)`);
      } catch (e) { notes.push(`could not synthesize ${c.kind}: ${e.message}`); }
    }
    if (asset) resolved.push({ ...c, assetId: asset.id });
  }
  return { manifest: working, cues: resolved, notes };
}

/**
 * Whole edit: validate -> capabilities -> sound design -> compile -> open project -> execute -> checkpoint.
 */
export async function buildProject({ config, bridge, caps, plan: rawPlan, manifest, narration, paths, logger = nullLogger, onProgress, synthSfx = true }) {
  const v = validatePlan(rawPlan, { manifest, narration });
  if (!v.valid) return fail('edit', `plan is invalid:\n${v.errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n')}`, { recoverable: true, code: 'PLAN_INVALID', data: v });
  const plan = normalizePlan(rawPlan, { manifest });

  const hostCaps = await refreshHostCapabilities(bridge, caps, config, logger);
  const sfx = await prepareSfx(config, plan, manifest, paths.generated, { synth: synthSfx });
  const build = compilePlan(plan, { manifest: sfx.manifest, narration, caps: hostCaps.caps, sfxCues: sfx.cues });
  build.meta.notes.push(...sfx.notes);
  logger.info('compiled', { stages: build.stages.length, ops: countOps(build) });

  const opened = await openOrCreateProject(bridge, paths.aep);
  if (!opened.success) return { ...opened, operation: 'edit' };

  const report = await executeBuild(bridge, build, { logger, onProgress });
  const cp = await checkpoint(bridge, paths, report.success ? 'build' : 'build_with_errors');
  if (!cp.success) report.warnings.push(`checkpoint failed: ${cp.error}`);

  const full = {
    ...report, project: paths.aep, checkpoint: cp.data?.file || null, transport: bridge.transportName,
    ae: opened.data.ae, hostProblems: hostCaps.problems, compiled: { master: build.meta.master, scenes: build.meta.sceneComps.length, duration: build.meta.duration, style: build.meta.style, notes: build.meta.notes, assetsUsed: build.meta.assetsUsed },
    validationWarnings: v.warnings,
  };
  ensureDir(paths.root);
  writeJson(paths.buildReport, full);
  writeJson(path.join(paths.root, 'compiled-plan.json'), { plan, meta: build.meta });
  return { success: report.success, operation: 'edit', data: full, ...(report.success ? {} : { error: `${report.errors.length} required step(s) failed: ${report.errors.slice(0, 3).map((e) => `${e.label}: ${e.message}`).join(' | ')}`, recoverable: true }), _build: build, _plan: plan, _caps: hostCaps.caps, _manifest: sfx.manifest };
}
