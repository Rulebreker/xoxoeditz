// Application services: the single implementation behind both the CLI and the MCP server.
// Every function returns a structured result: { success, operation, data?, error?, recoverable? }.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { ok, fail, attempt } from '../core/result.js';
import { ensureDir, projectPaths, readJson, writeJson, slug, REPO_ROOT } from '../core/paths.js';
import { buildCapabilityRegistry, loadRegistry, saveRegistry, mergeHostInfo } from '../detect/registry.js';
import { findAfterEffects } from '../detect/adobe.js';
import { createBridge } from '../bridge/client.js';
import { installBridge } from '../bridge/install.js';
import { MockTransport } from '../bridge/transports/mock.js';
import { Bridge } from '../bridge/client.js';
import { createMockAE } from '../bridge/mock-ae.js';
import { scanAssets, saveManifest, loadManifest, makeThumbnails } from '../assets/scan.js';
import { analyzeNarration } from '../narration/analyze.js';
import { scaffoldPlan } from '../plan/scaffold.js';
import { validatePlan, normalizePlan, masterEnd } from '../plan/schema.js';
import { buildProject, refreshHostCapabilities, prepareSfx } from '../ae/build.js';
import { compilePlan } from '../ae/compile.js';
import { runQa } from '../qa/checks.js';
import { repairIssues } from '../qa/repair.js';
import { renderProject } from '../render/index.js';
import { describeCapabilities } from '../effects/registry.js';
import { isAeRunning } from '../detect/tools.js';
import { readInstallManifest, uninstallAll } from '../core/install-manifest.js';

export function createContext({ cwd, env = process.env, overrides = {}, echo = false, mockAE = null } = {}) {
  cwd ??= env.XOXO_ROOT || REPO_ROOT; // XOXO_ROOT relocates assets/projects/.xoxo (used by tests and shared installs)
  const config = loadConfig({ cwd, env, overrides });
  const logger = createLogger({ dir: config.logDir, level: config.logLevel, echo });
  return { config, logger, env, mockAE };
}

// ---------------- project resolution ----------------
const currentFile = (ctx) => path.join(ctx.config.workspace, 'current.json');

export function listProjects(ctx) {
  try { return fs.readdirSync(ctx.config.projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
}

export function resolveProjectName(ctx, name) {
  if (name) return slug(name);
  const cur = readJson(currentFile(ctx), null);
  if (cur?.project) return cur.project;
  const all = listProjects(ctx);
  if (all.length === 1) return all[0];
  throw new Error(all.length ? `several projects exist (${all.join(', ')}); pass a project name` : 'no project yet; run `xoxo new <name> --assets <dir>`');
}

function pathsFor(ctx, name, { dryRun = false } = {}) {
  const p = projectPaths(ctx.config, name);
  if (dryRun) {
    const d = path.join(p.root, 'dryrun');
    return { ...p, aep: path.join(d, `${slug(name)}.mock-aep.json`), versions: path.join(d, 'versions'), renders: path.join(d, 'renders'), qa: path.join(d, 'QA_REPORT.json'), buildReport: path.join(d, 'build-report.json'), compiled: path.join(d, 'compiled-plan.json'), lastRender: path.join(d, 'last-render.json'), generated: p.generated, dryRunDir: d };
  }
  return p;
}

function loadProject(ctx, name, { dryRun = false } = {}) {
  const paths = pathsFor(ctx, name, { dryRun });
  if (!fs.existsSync(paths.root)) throw new Error(`project "${name}" does not exist`);
  return {
    name, paths,
    manifest: readJson(paths.manifest, null),
    narration: readJson(paths.narration, null),
    plan: readJson(paths.plan, null),
  };
}

// ---------------- capabilities ----------------
export async function getCapabilities(ctx, { refresh = false } = {}) {
  if (!refresh) { const c = loadRegistry(ctx.config); if (c) return c; }
  const reg = await buildCapabilityRegistry(ctx.config);
  saveRegistry(ctx.config, reg);
  return reg;
}

export const detect = (ctx, { refresh = true } = {}) => attempt('detect', async () => {
  const caps = await getCapabilities(ctx, { refresh });
  return { capabilities: caps, file: ctx.config.capabilitiesFile };
});

export const effects = (ctx) => attempt('effects', async () => {
  const caps = await getCapabilities(ctx);
  return { effectsKnown: caps.effects?.known || false, note: caps.effects?.known ? 'Using the installed-effect list from After Effects.' : 'After Effects has not been queried yet, so native-effect implementations are treated as unavailable. Run `xoxo bridge ping` or an edit to populate it.', table: describeCapabilities(caps) };
});

// ---------------- doctor ----------------
export async function doctor(ctx, { connect = false } = {}) {
  const checks = [];
  const add = (name, status, detail, fix) => checks.push({ name, status, detail, ...(fix ? { fix } : {}) });
  const { config } = ctx;
  const major = Number(process.versions.node.split('.')[0]);
  add('Node.js', major >= 20 ? 'ok' : 'fail', `v${process.versions.node}`, major >= 20 ? undefined : 'Install Node.js 20 or newer from https://nodejs.org');
  const caps = await getCapabilities(ctx, { refresh: true });
  add('Operating system', 'ok', `${caps.os.platform} ${caps.os.release} (${caps.os.arch}), ${caps.os.cpus} cores, ${caps.os.memGb} GB RAM${caps.gpu.length ? ', GPU: ' + caps.gpu.join(' / ') : ''}`);
  if (caps.after_effects) {
    const i = caps.after_effects_install;
    add('After Effects', 'ok', `${i.name} (${caps.after_effects_installs.length} install${caps.after_effects_installs.length > 1 ? 's' : ''} found)${caps.after_effects_running ? ', running' : ', not running'}`);
    add('aerender (headless render)', caps.aerender ? 'ok' : 'warn', caps.aerender_path || 'not found', caps.aerender ? undefined : 'aerender ships next to AfterFX.exe; set XOXO_AERENDER_PATH if installed elsewhere. Without it only Media Encoder can render.');
  } else {
    add('After Effects', 'fail', 'not found', config.aePath ? `The configured path "${config.aePath}" does not contain After Effects.` : 'Install Adobe After Effects, or set XOXO_AE_PATH (or "aePath" in xoxo.config.json) to AfterFX.exe / the install folder. You can still use `--dry-run` with the built-in simulator.');
  }
  add('Media Encoder', caps.media_encoder ? 'ok' : 'warn', caps.media_encoder_path || 'not found', caps.media_encoder ? undefined : 'Optional. Needed only if aerender cannot produce your format.');
  add('FFmpeg', caps.ffmpeg ? 'ok' : 'warn', caps.tools.ffmpeg.version ? `ffmpeg ${caps.tools.ffmpeg.version}` : (caps.tools.ffmpeg.error || 'not found'), caps.ffmpeg ? undefined : 'Install FFmpeg (https://ffmpeg.org/download.html) and put it on PATH, or set XOXO_FFMPEG. Needed for asset probing, narration analysis, H.264 output and render verification.');
  add('FFprobe', caps.ffprobe ? 'ok' : 'warn', caps.tools.ffprobe.version || caps.tools.ffprobe.error || 'not found');
  add('Python', caps.python ? 'ok' : 'skip', caps.tools.python.version || 'not found (optional)');
  add('Whisper (transcription)', caps.whisper ? 'ok' : 'skip', caps.whisper ? 'whisper CLI found' : 'not found (optional): without it, provide a script or SRT for caption timing');
  add('Fonts', caps.fonts.files.length ? 'ok' : 'warn', `${caps.fonts.files.length} font files visible`);
  for (const [label, dir] of [['workspace', config.workspace], ['projects', config.projectsDir], ['assets', config.assetsDir], ['bridge', config.bridgeDir]]) {
    try { ensureDir(dir); fs.accessSync(dir, fs.constants.W_OK); add(`Directory: ${label}`, 'ok', dir); } catch (e) { add(`Directory: ${label}`, 'fail', `${dir}: ${e.code || e.message}`, 'Check permissions.'); }
  }
  add('Bridge scripts', fs.existsSync(path.join(config.bridgeDir, 'host.jsx')) ? 'ok' : 'warn', fs.existsSync(path.join(config.bridgeDir, 'host.jsx')) ? 'installed' : 'not installed yet', 'Run `xoxo setup` or `xoxo bridge install`.');
  add('Raw script eval', config.allowRawEval ? 'warn' : 'ok', config.allowRawEval ? 'ENABLED — arbitrary ExtendScript may run' : 'disabled (recommended)');

  // Live connection
  if (caps.after_effects || config.transport === 'mock') {
    let bridge = null; let ping = null;
    try {
      const listener = fs.existsSync(path.join(config.bridgeDir, 'heartbeat.json'));
      if (connect || listener || caps.after_effects_running) {
        bridge = await createBridge(config, { logger: ctx.logger, install: caps.after_effects_install });
        ping = await bridge.ping();
      }
    } catch (e) { ping = { success: false, error: e.message }; }
    if (!ping) add('Bridge connection', 'skip', 'not tested (would launch After Effects). Run `xoxo doctor --connect` to test.');
    else if (ping.success) {
      add('Bridge connection', 'ok', `${bridge.transportName} transport; After Effects ${ping.data.aeVersion}`);
      add('Script file access', ping.data.scriptsMayWriteFiles === false ? 'fail' : 'ok', ping.data.scriptsMayWriteFiles === false ? 'disabled' : 'enabled', 'In After Effects: Edit > Preferences > Scripting & Expressions > tick "Allow Scripts to Write Files and Access Network".');
      const h = await refreshHostCapabilities(bridge, caps, config, ctx.logger);
      add('Effects visible to scripts', h.caps.effects.known ? 'ok' : 'warn', h.caps.effects.known ? `${h.caps.effects.matchNames.length} effects` : 'could not list');
    } else add('Bridge connection', 'fail', ping.error, 'See docs/TROUBLESHOOTING.md. Common causes: scripting-file-access preference off, a modal dialog open in After Effects, or the listener not started.');
    await bridge?.close();
  }
  const failed = checks.filter((c) => c.status === 'fail');
  return { success: failed.length === 0, operation: 'doctor', data: { checks, ready: failed.length === 0 }, ...(failed.length ? { error: `${failed.length} blocking problem(s): ${failed.map((c) => c.name).join(', ')}`, recoverable: true } : {}) };
}

// ---------------- bridge ----------------
export async function bridgeInstall(ctx, { startup = false } = {}) {
  return attempt('bridge_install', async () => {
    const caps = await getCapabilities(ctx);
    const r = installBridge(ctx.config, { install: caps.after_effects_install, startup });
    return { ...r, next: ['Start the live listener (optional, faster): in After Effects choose File > Scripts > Run Script File… and pick ' + r.listenerFile, 'Or do nothing: the one-shot transport launches scripts through AfterFX -r on demand.', 'Enable Preferences > Scripting & Expressions > "Allow Scripts to Write Files and Access Network".'] };
  });
}

export const bridgeUninstall = (ctx) => attempt('bridge_uninstall', () => ({ ...uninstallAll(ctx.config), manifest: readInstallManifest(ctx.config) }));
export const installManifest = (ctx) => attempt('install_manifest', () => readInstallManifest(ctx.config));

export async function openBridge(ctx, { dryRun = false } = {}) {
  const caps = await getCapabilities(ctx);
  if (dryRun || ctx.config.transport === 'mock') {
    ctx.mockAE ??= createMockAE(); // one simulated application per context: state persists across calls, like the real one
    const bridge = new Bridge(new MockTransport({ mock: ctx.mockAE }), { config: ctx.config, logger: ctx.logger });
    return { bridge, caps, mock: true };
  }
  const bridge = await createBridge(ctx.config, { logger: ctx.logger, install: caps.after_effects_install });
  return { bridge, caps, mock: false };
}

export async function bridgePing(ctx) {
  return attempt('bridge_ping', async () => {
    const { bridge, caps } = await openBridge(ctx);
    const p = await bridge.ping();
    if (!p.success) return fail('bridge_ping', p.error, { code: p.code });
    const h = await refreshHostCapabilities(bridge, caps, ctx.config, ctx.logger);
    return { transport: bridge.transportName, host: p.data, effects: h.caps.effects.matchNames.length, problems: h.problems };
  });
}

export async function bridgeCall(ctx, op, args, { dryRun = false } = {}) {
  const { bridge } = await openBridge(ctx, { dryRun });
  const r = await bridge.call(op, args);
  await bridge.close();
  return r;
}

// ---------------- project steps ----------------
export function newProject(ctx, name, { assets = null } = {}) {
  return attempt('new_project', () => {
    const n = slug(name);
    const p = projectPaths(ctx.config, n);
    for (const d of [p.root, p.renders, p.logs, p.generated, p.versions]) ensureDir(d);
    const state = readJson(p.state, {});
    writeJson(p.state, { ...state, name: n, createdAt: state.createdAt || new Date().toISOString(), assetsDir: assets ? path.resolve(assets) : (state.assetsDir || ctx.config.assetsDir) });
    ensureDir(ctx.config.workspace);
    writeJson(currentFile(ctx), { project: n });
    return { name: n, root: p.root, assetsDir: readJson(p.state).assetsDir, next: `xoxo assets ${n}` };
  });
}

export function scanProject(ctx, name, { dir = null, thumbs = false, probe = true } = {}) {
  return attempt('scan_assets', async () => {
    const n = resolveProjectName(ctx, name);
    const p = projectPaths(ctx.config, n);
    const state = readJson(p.state, {});
    const assetsDir = path.resolve(dir || state.assetsDir || ctx.config.assetsDir);
    if (!fs.existsSync(assetsDir)) throw new Error(`assets directory not found: ${assetsDir}`);
    const previous = readJson(p.manifest, null);
    const manifest = await scanAssets(ctx.config, assetsDir, { previous, probe });
    saveManifest(p.manifest, manifest);
    writeJson(p.state, { ...state, assetsDir });
    let thumbnails = [];
    if (thumbs) thumbnails = await makeThumbnails(ctx.config, manifest, path.join(p.root, 'thumbs'));
    return {
      manifest: p.manifest, counts: manifest.counts, warnings: manifest.warnings,
      assets: manifest.assets.map((a) => ({ id: a.id, type: a.type, role: a.role, rel: a.relPath, ...(a.meta?.width ? { size: `${a.meta.width}x${a.meta.height}` } : {}), ...(a.meta?.duration ? { duration: a.meta.duration } : {}), ...(a.role ? { roleConfidence: a.roleConfidence } : {}) })),
      thumbnails: thumbnails.map((t) => t.file),
      hint: thumbs ? 'Open the thumbnails (Read tool) and write a one-line "description" for each asset in assets.manifest.json so the plan can match visuals to the narration.' : 'Run with --thumbs to generate preview images you can look at.',
    };
  });
}

export function analyzeProjectNarration(ctx, name, opts = {}) {
  return attempt('analyze_narration', async () => {
    const n = resolveProjectName(ctx, name);
    const prj = loadProject(ctx, n);
    if (!prj.manifest) throw new Error('scan assets first: `xoxo assets`');
    let audio = opts.audio;
    if (audio && !path.isAbsolute(audio)) { const guess = prj.manifest.assets.find((a) => a.id === audio || a.relPath === audio); audio = guess ? guess.path : path.resolve(audio); }
    if (!audio) audio = prj.manifest.assets.find((a) => a.type === 'audio' && a.role === 'narration')?.path;
    if (!audio) throw new Error('no narration audio found; pass --audio <file> or mark an audio asset role "narration" (override.role in the manifest)');
    const subtitles = opts.subtitles ? path.resolve(opts.subtitles) : (prj.manifest.assets.find((a) => a.type === 'subtitle')?.path || null);
    let script = opts.script ? path.resolve(opts.script) : null;
    if (!script && !subtitles && !opts.transcribe) script = prj.manifest.assets.find((a) => a.type === 'script' && /script|narration|transcript|voice/i.test(a.relPath))?.path || null;
    const res = await analyzeNarration(ctx.config, { audio, subtitles, script, transcribe: Boolean(opts.transcribe), outDir: path.join(prj.paths.root, 'narration-work'), noiseDb: opts.noiseDb ?? -35 });
    writeJson(prj.paths.narration, res);
    return { file: prj.paths.narration, duration: res.duration, transcript: res.transcript, speechSegments: res.speech.length, pauses: res.pauses.length, scenes: res.scenes.map((s) => ({ id: s.id, start: s.start, end: s.end, text: s.text.slice(0, 100) })), loudness: res.loudness, notes: res.notes };
  });
}

export function scaffoldProjectPlan(ctx, name, opts = {}) {
  return attempt('scaffold_plan', () => {
    const n = resolveProjectName(ctx, name);
    const prj = loadProject(ctx, n);
    if (!prj.manifest) throw new Error('scan assets first: `xoxo assets`');
    if (fs.existsSync(prj.paths.plan) && !opts.force) throw new Error(`${prj.paths.plan} already exists; pass --force to overwrite it (the old plan is saved as plan.previous.json)`);
    if (fs.existsSync(prj.paths.plan)) fs.copyFileSync(prj.paths.plan, path.join(prj.paths.root, 'plan.previous.json'));
    const plan = scaffoldPlan({ title: opts.title || n, brief: opts.brief || '', style: opts.style || null, manifest: prj.manifest, narration: prj.narration, output: { resolution: opts.resolution, aspect: opts.aspect, fps: opts.fps ? Number(opts.fps) : undefined }, captions: opts.captions === undefined ? null : { enabled: Boolean(opts.captions) } });
    writeJson(prj.paths.plan, plan);
    const v = validatePlan(plan, { manifest: prj.manifest, narration: prj.narration });
    return { plan: prj.paths.plan, scenes: plan.scenes.length, style: plan.style, validation: v, note: 'This is a first draft. Read it, then edit plan.json to improve scene breaks, asset choices, graphics and transitions.' };
  });
}

export function validateProjectPlan(ctx, name) {
  return attempt('validate_plan', () => {
    const n = resolveProjectName(ctx, name);
    const prj = loadProject(ctx, n);
    if (!prj.plan) throw new Error('no plan.json yet; run `xoxo plan --scaffold` or write one');
    const v = validatePlan(prj.plan, { manifest: prj.manifest, narration: prj.narration });
    const norm = v.valid ? normalizePlan(prj.plan, { manifest: prj.manifest }) : null;
    return { ...ok('validate_plan', { valid: v.valid, errors: v.errors, warnings: v.warnings, output: norm?.output, duration: norm ? masterEnd(norm) : null, scenes: prj.plan.scenes?.length }), success: v.valid, ...(v.valid ? {} : { error: `${v.errors.length} problem(s) in plan.json`, recoverable: true }) };
  });
}

// ---------------- edit / verify ----------------
async function inspectProject(bridge) {
  return bridge.call('inspect', { layers: true, bounds: true });
}

async function reconstructBuild(ctx, prj, caps) {
  const plan = normalizePlan(prj.plan, { manifest: prj.manifest });
  const sfx = await prepareSfx(ctx.config, plan, prj.manifest, prj.paths.generated, { synth: true });
  return { plan, build: compilePlan(plan, { manifest: sfx.manifest, narration: prj.narration, caps, sfxCues: sfx.cues }), manifest: sfx.manifest };
}

export async function runVerify(ctx, { bridge, caps, prj, plan, build, manifest, report, repair = true, outputPath, dryRun = false }) {
  const t = await inspectProject(bridge);
  if (!t.success) return fail('verify', `could not inspect the project: ${t.error}`, { code: t.code });
  const qaCtx = (inspect) => ({ plan, manifest, narration: prj.narration, inspect, build, report, caps, config: ctx.config, outputPath, dryRun });
  let qa = runQa(qaCtx(t.data));
  let repairs = [];
  if (repair && !qa.passed || (repair && qa.warnings.some((w) => w.repairable))) {
    repairs = await repairIssues(bridge, qa, { plan, build, narration: prj.narration, manifest, logger: ctx.logger });
    if (repairs.length) {
      const again = await inspectProject(bridge);
      if (again.success) qa = runQa(qaCtx(again.data));
    }
  }
  qa.repairs = repairs;
  qa.dryRun = dryRun;
  if (repairs.some((r) => r.success)) { // repairs live in the open project: persist them
    const saved = await bridge.call('project_save', { path: prj.paths.aep.replace(/\\/g, '/') });
    if (!saved.success) qa.warnings.push({ check: 'PROJECT_CHECK', code: 'SAVE_AFTER_REPAIR_FAILED', severity: 'warning', message: `repairs were applied but the project could not be saved: ${saved.error}` });
  }
  writeJson(prj.paths.qa, qa);
  return { success: qa.passed, operation: 'verify', data: { passed: qa.passed, summary: qa.summary, errors: qa.errors, warnings: qa.warnings.slice(0, 40), fallbacks_used: qa.fallbacks_used, repairs, report: prj.paths.qa }, ...(qa.passed ? {} : { error: `QA failed: ${qa.summary}`, recoverable: true }) };
}

export function editProject(ctx, name, { dryRun = false, verify = true, repair = true, onProgress } = {}) {
  return attempt('edit', async () => {
    const n = resolveProjectName(ctx, name);
    const prj = loadProject(ctx, n, { dryRun });
    if (!prj.plan) throw new Error('no plan.json; run `xoxo plan --scaffold` or write one');
    if (!prj.manifest) throw new Error('no assets.manifest.json; run `xoxo assets`');
    ensureDir(prj.paths.root); ensureDir(path.dirname(prj.paths.aep));
    const { bridge, caps, mock } = await openBridge(ctx, { dryRun });
    try {
      const built = await buildProject({ config: ctx.config, bridge, caps, plan: prj.plan, manifest: prj.manifest, narration: prj.narration, paths: prj.paths, logger: ctx.logger, onProgress });
      if (built.error && !built._build) return built; // invalid plan / cannot open project
      const out = { build: { success: built.success, summary: built.data?.summary, errors: built.data?.errors, fallbacksUsed: built.data?.fallbacksUsed, degraded: built.data?.degraded, project: prj.paths.aep, checkpoint: built.data?.checkpoint, transport: bridge.transportName, notes: built.data?.compiled?.notes, report: prj.paths.buildReport }, dryRun: mock };
      if (verify) {
        const v = await runVerify(ctx, { bridge, caps: built._caps, prj, plan: built._plan, build: built._build, manifest: built._manifest, report: built.data, repair, outputPath: path.join(prj.paths.renders, 'x.mp4'), dryRun: mock });
        out.qa = v.data ?? { passed: false, error: v.error };
        if (v.success !== undefined) out.qaPassed = v.success;
      }
      const success = built.success && (!verify || out.qaPassed);
      return { success, operation: 'edit', data: out, ...(success ? {} : { error: !built.success ? built.error : `QA failed: ${out.qa?.summary || out.qa?.error}`, recoverable: true }) };
    } finally { await bridge.close(); }
  });
}

export function verifyProject(ctx, name, { dryRun = false, repair = true } = {}) {
  return attempt('verify', async () => {
    const n = resolveProjectName(ctx, name);
    const prj = loadProject(ctx, n, { dryRun });
    if (!prj.plan || !prj.manifest) throw new Error('need plan.json and assets.manifest.json');
    const { bridge, caps } = await openBridge(ctx, { dryRun });
    try {
      const info = await refreshHostCapabilities(bridge, caps, ctx.config, ctx.logger);
      const { plan, build, manifest } = await reconstructBuild(ctx, prj, info.caps);
      const report = readJson(prj.paths.buildReport, null);
      if (!dryRun) {
        const open = await bridge.call('project_info');
        if (!open.success) return open;
        if (!open.data.file || path.resolve(open.data.file) !== path.resolve(prj.paths.aep)) {
          const o = await bridge.call('project_open', { path: prj.paths.aep.replace(/\\/g, '/') });
          if (!o.success) return fail('verify', `could not open ${prj.paths.aep}: ${o.error}`);
        }
      }
      return await runVerify(ctx, { bridge, caps: info.caps, prj, plan, build, manifest, report, repair, outputPath: path.join(prj.paths.renders, 'x.mp4'), dryRun });
    } finally { await bridge.close(); }
  });
}

// ---------------- render ----------------
export function renderProjectCmd(ctx, name, opts = {}) {
  return attempt('render', async () => {
    const n = resolveProjectName(ctx, name);
    const prj = loadProject(ctx, n);
    if (!prj.plan || !prj.manifest) throw new Error('need plan.json and assets.manifest.json');
    const plan = normalizePlan(prj.plan, { manifest: prj.manifest });
    const qa = readJson(prj.paths.qa, null);
    if (!qa) return fail('render', 'no QA report yet; run `xoxo verify` (or `xoxo edit`) first — rendering an unverified project wastes time', { recoverable: true, code: 'QA_REQUIRED' });
    if (!qa.passed && !opts.force) return fail('render', `QA_REPORT.json has ${qa.errors.length} error(s): ${qa.errors.slice(0, 3).map((e) => e.message).join(' | ')}. Fix them (or pass --force).`, { recoverable: true, code: 'QA_FAILED' });
    const caps = await getCapabilities(ctx);
    const { bridge } = await openBridge(ctx);
    try {
      const open = await bridge.call('project_info');
      if (!open.success) return open;
      if (!open.data.file || path.resolve(open.data.file) !== path.resolve(prj.paths.aep)) {
        const o = await bridge.call('project_open', { path: prj.paths.aep.replace(/\\/g, '/') });
        if (!o.success) return fail('render', `could not open ${prj.paths.aep}: ${o.error}`);
      }
      const range = opts.range ? opts.range.split(':').map(Number) : null;
      const r = await renderProject({ config: ctx.config, bridge, caps, plan, paths: prj.paths, preview: Boolean(opts.preview), range, onProgress: opts.onProgress, logger: ctx.logger, preferAme: Boolean(opts.ame), keepIntermediate: Boolean(opts.keepIntermediate) });
      if (r.success) writeJson(prj.paths.lastRender, { at: new Date().toISOString(), preview: Boolean(opts.preview), ...r.data });
      return r;
    } finally { await bridge.close(); }
  });
}

// ---------------- status ----------------
export function statusProject(ctx, name) {
  return attempt('status', () => {
    const n = resolveProjectName(ctx, name);
    const p = projectPaths(ctx.config, n);
    const has = (f) => fs.existsSync(f);
    const manifest = readJson(p.manifest, null); const plan = readJson(p.plan, null); const qa = readJson(p.qa, null); const br = readJson(p.buildReport, null); const lr = readJson(p.lastRender, null); const dr = readJson(path.join(p.root, 'dryrun', 'QA_REPORT.json'), null);
    const steps = {
      assets: manifest ? `${manifest.assets.length} assets` : 'not scanned',
      narration: has(p.narration) ? 'analysed' : 'none',
      plan: plan ? `${plan.scenes.length} scenes, style ${plan.style}` : 'none',
      build: br ? `${br.success ? 'ok' : 'FAILED'} — ${br.summary}` : 'not built',
      qa: qa ? `${qa.passed ? 'passed' : 'FAILED'} — ${qa.summary}` : 'not run',
      render: lr ? `${lr.output}${lr.preview ? ' (preview)' : ''}` : 'not rendered',
      aep: has(p.aep) ? p.aep : 'none',
      ...(dr ? { 'dry-run': `simulator QA ${dr.passed ? 'passed' : 'FAILED'} — ${dr.summary} (nothing was built in After Effects)` } : {}),
    };
    const next = !manifest ? `xoxo assets ${n}` : !plan ? `xoxo plan ${n} --scaffold` : !br ? `xoxo edit ${n}` : !qa ? `xoxo verify ${n}` : !qa.passed ? 'fix QA errors in QA_REPORT.json (edit plan.json) and re-run `xoxo edit`' : !lr ? `xoxo render ${n}` : 'done';
    return { project: n, root: p.root, steps, next };
  });
}

export { findAfterEffects, mergeHostInfo };
