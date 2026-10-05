import fs from 'node:fs';
import path from 'node:path';
import { validatePlan, normalizePlan, masterEnd } from '../plan/schema.js';
import { compilePlan, countOps } from './compile.js';
import { compileTimeline } from './compile-timeline.js';
import { isTimelinePlan, validateTimeline, normalizeTimeline } from '../timeline/plan.js';
import { readJson } from '../core/paths.js';
import { executeBuild } from './executor.js';
import { openOrCreateProject, checkpoint } from './project.js';
import { mergeHostInfo, saveRegistry } from '../detect/registry.js';
import { autoSfxCues, pickSfxAsset } from '../audio/sound.js';
import { synthesizeSfx, SYNTH } from '../audio/synth.js';
import { writeJson, ensureDir } from '../core/paths.js';
import { nullLogger } from '../core/logger.js';
import { fail } from '../core/result.js';

/** Ask After Effects what it actually has (effects, fonts) and merge into the capability registry. */
export async function refreshHostCapabilities(bridge, caps, config, logger = nullLogger) {
  const info = {};
  const fx = await bridge.call('list_effects');
  if (fx.success) info.effects = fx.data.effects; else logger.warn('list_effects failed', { error: fx.error });
  const fonts = await bridge.call('list_fonts');
  if (fonts.success) info.fonts = fonts.data.fonts; else logger.info('list_fonts unavailable', { error: fonts.error });
  const ping = await bridge.call('ping');
  if (ping.success) info.host = { ...ping.data, transport: bridge.transportName };
  const merged = mergeHostInfo(caps, info);
  // never persist what the simulator reported: it would masquerade as the real application's capabilities
  if (config && bridge.transportName !== 'mock') { try { saveRegistry(config, merged); } catch { /* */ } }
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
export async function buildProject({ config, bridge, caps, plan: rawPlan, manifest, library = null, narration, paths, logger = nullLogger, onProgress, synthSfx = true, incremental = true, discard = false }) {
  const timeline = isTimelinePlan(rawPlan);
  const v = timeline ? validateTimeline(rawPlan, { manifest, library }) : validatePlan(rawPlan, { manifest, narration });
  if (!v.valid) return fail('edit', `plan is invalid:\n${v.errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n')}`, { recoverable: true, code: 'PLAN_INVALID', data: v });
  const plan = timeline ? normalizeTimeline(rawPlan) : normalizePlan(rawPlan, { manifest });

  const hostCaps = await refreshHostCapabilities(bridge, caps, config, logger);
  let sfx = { manifest, cues: [], notes: [] }; let build;
  if (timeline) {
    // incremental only when the saved project is exactly the one the last build produced
    const st = incremental ? readJson(paths.buildState, null) : null;
    const aepNow = fs.existsSync(paths.aep) ? fs.statSync(paths.aep) : null;
    const sameProject = Boolean(st && aepNow && st.aep && st.aep.size === aepNow.size && Math.abs(st.aep.mtimeMs - aepNow.mtimeMs) < 2 && st.fingerprint === `${plan.output.width}x${plan.output.height}@${plan.output.fps}` && (st.transport !== 'mock' || (bridge.transportName === 'mock' && st.pid === process.pid))); // a simulator project lives in memory: it is only reusable inside the process that built it
    const previous = sameProject ? { sameProject, hashes: st.hashes, names: st.names, structure: st.structure } : null;
    build = compileTimeline(plan, { manifest, library, narration, caps: hostCaps.caps, previous });
    // units that vanished from the plan would leave their layers behind: rebuild from scratch
    if (previous && (previous.structure !== build.meta.structure || Object.keys(previous.hashes).some((id) => !(id in build.meta.hashes)))) build = compileTimeline(plan, { manifest, library, narration, caps: hostCaps.caps, previous: null });
  } else {
    sfx = await prepareSfx(config, plan, manifest, paths.generated, { synth: synthSfx });
    build = compilePlan(plan, { manifest: sfx.manifest, narration, caps: hostCaps.caps, sfxCues: sfx.cues });
  }
  build.meta.notes.push(...sfx.notes);
  logger.info('compiled', { stages: build.stages.length, ops: countOps(build) });

  const opened = await openOrCreateProject(bridge, paths.aep, { discard, projectsDir: config.projectsDir, name: path.basename(paths.root), dirtyPolicy: config.dirtyXoxoPolicy || 'save' });
  if (!opened.success) return { ...opened, operation: 'edit' };

  const report = await executeBuild(bridge, build, { logger, onProgress });
  const cp = await checkpoint(bridge, paths, report.success ? 'build' : 'build_with_errors');
  if (!cp.success) report.warnings.push(`checkpoint failed: ${cp.error}`);
  if (timeline && report.success) {
    const stt = fs.existsSync(paths.aep) ? fs.statSync(paths.aep) : null;
    if (stt) writeJson(paths.buildState, { hashes: build.meta.hashes, names: build.meta.unitNames, structure: build.meta.structure, aep: { size: stt.size, mtimeMs: stt.mtimeMs }, fingerprint: `${plan.output.width}x${plan.output.height}@${plan.output.fps}`, transport: bridge.transportName, pid: process.pid, at: new Date().toISOString() });
  } else if (timeline) { try { fs.rmSync(paths.buildState, { force: true }); } catch { /* */ } } // a failed build must not be treated as a base for the next incremental one

  const full = {
    ...report, projectState: opened.data.prepare || null, project: paths.aep, checkpoint: cp.data?.file || null, transport: bridge.transportName,
    ae: opened.data.ae, hostProblems: hostCaps.problems, compiled: { master: build.meta.master, scenes: timeline ? plan.timeline.shots.length : build.meta.sceneComps.length, reusedUnits: build.meta.reused?.length || 0, incremental: Boolean(build.meta.incremental), duration: build.meta.duration, style: build.meta.style, notes: build.meta.notes, assetsUsed: build.meta.assetsUsed },
    validationWarnings: v.warnings,
  };
  ensureDir(paths.root);
  writeJson(paths.buildReport, full);
  writeJson(paths.compiled, { plan, meta: build.meta });
  return { success: report.success, operation: 'edit', data: full, ...(report.success ? {} : { error: `${report.errors.length} required step(s) failed: ${report.errors.slice(0, 3).map((e) => `${e.label}: ${e.message}`).join(' | ')}`, recoverable: true }), _build: build, _full: () => (timeline ? compileTimeline(plan, { manifest, library, narration, caps: hostCaps.caps, previous: null }) : build), _plan: plan, _caps: hostCaps.caps, _manifest: timeline ? { ...manifest, assets: [...manifest.assets, ...(library?.assets || [])] } : sfx.manifest };
}
