// `xoxo showcase`: the complete autonomous pipeline on a real asset folder, in real After Effects.
//   scan -> classify -> probe -> narration -> curated plan -> validate -> build -> QA(+repair) -> save .aep ->
//   aerender + FFmpeg -> ffprobe verification -> REAL_EDIT_REPORT.md
// It refuses to pretend: without real After Effects it stops before doing anything (unless a test opts into the
// simulator, in which case the report says SIMULATOR in its first line).

import fs from 'node:fs';
import path from 'node:path';
import * as S from './services.js';
import { curatePlan } from '../plan/curate.js';
import { renderEditReport } from './report.js';
import { projectPaths, readJson, writeJson, ensureDir, slug } from '../core/paths.js';
import { toolAvailable } from '../core/resolve-tool.js';

const stat = (p) => { try { const s = fs.statSync(p); return { path: p, exists: true, size: `${(s.size / 1e6).toFixed(2)} MB` }; } catch { return { path: p, exists: false }; } };

export async function runShowcase(ctx, name, opts = {}) {
  const n = slug(name);
  const p = projectPaths(ctx.config, n);
  const steps = []; let aborted = false;
  const t00 = Date.now();
  const log = opts.onStep || (() => {});
  const step = async (id, label, fn) => {
    if (aborted) { steps.push({ id, label, ok: false, ms: 0, error: 'skipped: an earlier step failed' }); return null; }
    const t0 = Date.now(); log({ id, label, status: 'start' });
    let r;
    try { r = await fn(); } catch (e) { r = { success: false, error: e.message }; }
    const s = { id, label, ok: Boolean(r?.success), ms: Date.now() - t0, ...(r?.success ? { detail: r.detail } : { error: r?.error || 'failed' }) };
    steps.push(s); log({ ...s, status: 'done' });
    if (!s.ok) aborted = true;
    return r;
  };
  const run = { name: n, real: !opts.allowMock, transport: ctx.config.transport, finishedAt: null, ae: null };
  const data = { run, steps, limitations: [] };

  // ---- 0. preflight: real After Effects or stop ----
  await step('preflight', 'Preflight: real After Effects reachable', async () => {
    if (ctx.config.transport === 'mock' && !opts.allowMock) return { success: false, error: 'transport is "mock" (simulator). The showcase needs real After Effects: unset XOXO_TRANSPORT / "transport":"mock".' };
    if (opts.allowMock) return { success: true, detail: 'SIMULATOR (test only)' };
    const caps = await S.getCapabilities(ctx, { refresh: true });
    if (!caps.after_effects && !fs.existsSync(path.join(ctx.config.bridgeDir, 'heartbeat.json'))) return { success: false, error: 'After Effects not found on this machine. Run `xoxo doctor`.' };
    if (!toolAvailable(ctx.config, 'ffmpeg') || !toolAvailable(ctx.config, 'ffprobe')) return { success: false, error: 'FFmpeg/FFprobe not resolved. Run `xoxo doctor` (or `xoxo config set ffmpeg "<path>"`).' };
    const { bridge } = await S.openBridge(ctx);
    const ping = await bridge.ping(); await bridge.close();
    if (!ping.success) return { success: false, error: `cannot reach After Effects: ${ping.error}` };
    if (ping.data.scriptsMayWriteFiles === false) return { success: false, error: 'scripting file access is disabled in After Effects preferences' };
    run.ae = ping.data; run.transport = bridge.transportName;
    if (bridge.transportName === 'mock') return { success: false, error: 'resolved to the simulator transport; refusing to run a "real" test' };
    return { success: true, detail: `After Effects ${ping.data.aeVersion} via ${bridge.transportName}` };
  });

  // ---- 1-2. project, scan, classify, probe ----
  await step('project', 'Create project', async () => S.newProject(ctx, n, { assets: opts.assets }));
  const scan = await step('assets', 'Scan, classify and probe every asset', async () => {
    const r = await S.scanProject(ctx, n, { thumbs: true });
    if (r.success) r.detail = `${r.data.assets.length} assets (${Object.entries(r.data.counts).map(([k, v]) => `${v} ${k}`).join(', ')})`;
    return r;
  });
  const manifest = readJson(p.manifest, null);

  // ---- 3-5. narration ----
  let narration = null;
  const narrAsset = manifest?.assets.find((a) => a.type === 'audio' && a.role === 'narration');
  await step('narration', narrAsset ? 'Analyse narration timing' : 'Narration (none found)', async () => {
    if (!narrAsset) return { success: true, detail: 'no narration asset: the edit follows the visuals' };
    let r = await S.analyzeProjectNarration(ctx, n, { script: opts.script, subtitles: opts.subtitles });
    const noText = r.success && r.data.transcript.method === 'none';
    if (noText && toolAvailable(ctx.config, 'whisper') && opts.transcribe !== false) {
      const w = await S.analyzeProjectNarration(ctx, n, { transcribe: true });
      if (w.success) r = w; else data.limitations.push(`Whisper transcription was attempted and failed (${w.error}); continued with pause-based timing.`);
    }
    if (r.success) { narration = readJson(p.narration, null); r.detail = `${r.data.duration}s, transcript: ${r.data.transcript.method}, ${r.data.pauses} long pauses`; }
    return r;
  });

  // ---- 6-11. curated plan ----
  let plan = null;
  await step('plan', 'Direct: curated scene-by-scene edit plan', async () => {
    plan = curatePlan({ name: n, title: opts.title, brief: opts.brief || '', style: opts.style, manifest, narration, targetSeconds: opts.target || 25, output: { resolution: opts.resolution || '1080p', aspect: opts.aspect, fps: opts.fps }, captions: opts.captions === undefined ? null : { enabled: Boolean(opts.captions) } });
    writeJson(p.plan, plan);
    writeJson(path.join(p.root, 'edit-plan.json'), plan);
    const v = await S.validateProjectPlan(ctx, n);
    if (!v.success) return { success: false, error: `curated plan failed validation: ${(v.data?.errors || []).map((e) => `${e.path}: ${e.message}`).join('; ') || v.error}` };
    return { success: true, detail: `${plan.scenes.length} scenes, ${plan.scenes.at(-1).end}s, style ${plan.style}` };
  });

  // ---- 12-24. build, effects, QA, repair, save ----
  const edit = await step('edit', 'Build in After Effects + QA + auto-repair + save .aep', async () => {
    const r = await S.editProject(ctx, n, { dryRun: Boolean(opts.allowMock) ? false : false, verify: true, repair: true, onProgress: opts.onProgress });
    if (r.data?.build) r.detail = r.data.build.summary;
    return r;
  });

  // ---- 25-26. render + verify ----
  let render = null;
  const rr = await step('render', 'Render with aerender + FFmpeg, verify with ffprobe', async () => {
    render = await S.renderProjectCmd(ctx, n, { onProgress: opts.onRenderProgress, force: false });
    if (render.success) render.detail = `${render.data.strategy}: ${render.data.verification.probe?.width}x${render.data.verification.probe?.height}, ${render.data.verification.probe?.duration}s`;
    return render;
  });

  // ---- report (always written, success or not) ----
  run.finishedAt = new Date().toISOString();
  const report = renderEditReport({
    run, plan: readJson(p.plan, null), manifest, narration,
    compiled: readJson(p.compiled, null) ? { ...readJson(p.compiled), assetsUsed: readJson(p.compiled).meta?.assetsUsed } : null,
    build: readJson(p.buildReport, null), qa: readJson(p.qa, null), render, steps, limitations: data.limitations,
    files: {
      'After Effects project': stat(p.aep), 'Edit plan': stat(path.join(p.root, 'edit-plan.json')), 'Build report': stat(p.buildReport),
      'QA report': stat(p.qa), 'Final render': stat(path.join(p.renders, 'final.mp4')), 'Narration analysis': stat(p.narration), 'Asset manifest': stat(p.manifest),
    },
  });
  const reportPath = path.join(p.root, 'REAL_EDIT_REPORT.md');
  ensureDir(p.root); fs.writeFileSync(reportPath, report);
  const success = steps.every((s) => s.ok);
  return {
    success, operation: 'showcase', data: { steps, report: reportPath, project: p.root, output: path.join(p.renders, 'final.mp4'), real: run.real },
    ...(success ? {} : { error: `${steps.find((s) => !s.ok)?.label}: ${steps.find((s) => !s.ok)?.error}`, recoverable: true }),
  };
}
