// PRODUCE: the autonomous path. One call takes a folder of media plus a type and a prompt and returns a finished,
// verified edit (or an honest account of how far it got):
//
//   config -> project -> scan -> visual analysis -> library -> music + beat map -> Director -> build -> QA/repair -> render -> report
//
// Source media is only ever read. Everything is written under projects/<name>/ (and copied to --output).

import fs from 'node:fs';
import path from 'node:path';
import * as S from './services.js';
import { attempt, fail } from '../core/result.js';
import { ensureDir, projectPaths, readJson, writeJson, slug } from '../core/paths.js';
import { saveManifest } from '../assets/scan.js';
import { probeFile } from '../assets/probe.js';
import { ensureVisualAnalysis } from '../assets/visual.js';
import { refreshLibrary, loadLibraryManifest } from '../library/scan.js';
import { generateStarterSfx } from '../library/starter.js';
import { analyzeBeats } from '../beat/analyze.js';
import { loadEditConfig, resolveDirective } from '../director/config.js';
import { chooseMusic } from '../director/music.js';
import { directTimeline } from '../director/direct.js';
import { validateTimeline } from '../timeline/plan.js';
import { ident } from '../core/paths.js';
import { refreshHostCapabilities } from '../ae/build.js';

const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
const QUALITY_RES = { draft: '480p', preview: '720p' };

/** Find edit.config.json: explicit path, else next to the assets, else in the folder above, else the repo root. */
export function findEditConfig(ctx, assetsDir, explicit = null) {
  if (explicit) { const f = path.resolve(explicit); if (!fs.existsSync(f)) throw new Error(`config file not found: ${f}`); return f; }
  for (const d of [assetsDir, path.dirname(assetsDir), ctx.config.root]) { const f = path.join(d, 'edit.config.json'); if (fs.existsSync(f)) return f; }
  return null;
}

/** What After Effects can really do (installed effects, fonts), so the Director plans for this machine. Falls back to the cached registry. */
async function hostCapabilities(ctx, dryRun, log) {
  try {
    const { bridge, caps } = await S.openBridge(ctx, { dryRun });
    try { const h = await refreshHostCapabilities(bridge, caps, ctx.config, ctx.logger); if (h.problems.length) log(`host capability query: ${h.problems.join('; ')}`); return h.caps; }
    finally { await bridge.close(); }
  } catch (e) { log(`could not query After Effects for its effects (${e.message}); planning with the cached registry, so optional effects will be treated as unavailable`); return S.getCapabilities(ctx); }
}

/** Everything the Director needs from a project folder: manifest with visual analysis, library, music, beat map. */
async function prepareInputs(ctx, name, directive, opts, log) {
  const p = projectPaths(ctx.config, name);
  let manifest = readJson(p.manifest);
  const vis = await ensureVisualAnalysis(ctx.config, manifest, path.join(ctx.config.workspace, 'cache', 'visual.json'));
  saveManifest(p.manifest, manifest);
  log(`visual analysis: ${vis.analysed} new, ${vis.reused} cached${vis.warnings.length ? `, ${vis.warnings.length} failed` : ''}`);
  let library = null;
  if (ctx.config.libraryRoot && fs.existsSync(ctx.config.libraryRoot)) { library = await refreshLibrary(ctx.config, {}); log(`library: ${Object.entries(library.counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'empty'}`); }
  else if (opts.starterSfx) {
    const root = path.join(ctx.config.workspace, 'starter-library');
    await generateStarterSfx(ctx.config, root);
    library = await refreshLibrary({ ...ctx.config, libraryRoot: root, libraryDir: path.join(ctx.config.workspace, 'library-starter'), libraryManifest: path.join(ctx.config.workspace, 'library-starter', 'universal-assets.manifest.json') }, {});
    log(`no library configured: generated the license-free starter sound pack (${library.counts.sfx || 0} SFX) in ${root}`);
  } else library = loadLibraryManifest(ctx.config);

  const music = chooseMusic({ directive, manifest, library, duration: directive.durationSeconds ?? directive.editType.pacing.targetSeconds });
  if (music.source === 'explicit') { // a file outside the project: bring it in as an asset (read only)
    const file = music.file;
    if (!fs.existsSync(file)) throw new Error(`music file not found: ${file}`);
    const meta = await probeFile(file, 'audio', ctx.config);
    const asset = { id: `MUS_${ident(path.basename(file))}`, type: 'audio', role: 'music', roleConfidence: 1, roleReason: 'requested explicitly', relPath: path.basename(file), path: file, ext: path.extname(file).slice(1), meta, keywords: [], override: {}, description: 'requested music' };
    if (!manifest.assets.some((a) => a.id === asset.id)) { manifest.assets.push(asset); saveManifest(p.manifest, manifest); }
    music.asset = asset; music.source = 'project';
  }
  let beatMap = null;
  if (music.asset?.path && fs.existsSync(music.asset.path)) {
    try { beatMap = await analyzeBeats(ctx.config, music.asset.path, { outFile: p.beatMap }); log(`beat map: ${beatMap.bpm} BPM (confidence ${beatMap.confidence}), ${beatMap.drops.length} drops, ${beatMap.impacts.length} impacts -> ${path.basename(p.beatMap)}`); }
    catch (e) { log(`beat analysis failed (${e.message}); using a virtual grid`); }
  } else if (music.asset) log(`music ${music.asset.id} is not on disk here: using a virtual grid`);
  return { manifest, library, music, beatMap };
}

/** Run the Director on an existing project and save plan.json + DIRECTOR_REPORT.json. */
export function directProject(ctx, name, opts = {}) {
  return attempt('direct', async () => {
    const n = S.resolveProjectName(ctx, name); const p = projectPaths(ctx.config, n);
    if (!fs.existsSync(p.manifest)) throw new Error('scan assets first: `xoxo assets`');
    const state = readJson(p.state, {});
    const cfg = { ...(state.editConfig || {}), ...defined({ seed: opts.seed, duration: opts.duration, professional: opts.professional, title: opts.title, quality: opts.quality }) };
    const directive = resolveDirective({ type: opts.type || state.editType || null, prompt: opts.prompt ?? state.prompt ?? '', config: cfg, overrides: opts.overrides || {} });
    const log = opts.log || (() => {});
    const inputs = await prepareInputs(ctx, n, directive, opts, log);
    const hostCaps = opts.hostCaps || await hostCapabilities(ctx, Boolean(opts.dryRun), log);
    const { plan, report } = directTimeline({ directive, manifest: inputs.manifest, library: inputs.library, beatMap: inputs.beatMap, music: inputs.music, caps: hostCaps });
    const v = validateTimeline(plan, { manifest: inputs.manifest, library: inputs.library });
    if (!v.valid) return fail('direct', `the Director produced an invalid plan:\n${v.errors.slice(0, 8).map((e) => `  - ${e.path}: ${e.message}`).join('\n')}`, { code: 'PLAN_INVALID', data: { errors: v.errors } });
    writeJson(p.plan, plan); writeJson(p.directorReport, report);
    // keep a project-local copy of every library asset the plan refers to: the plan then survives library changes
    const refs = new Set([...plan.audio.music.map((m) => m.asset), ...plan.audio.sfxEvents.map((e) => e.assetId), ...plan.timeline.transitions.map((t) => t.overlayAsset), ...plan.timeline.shots.flatMap((s) => s.layers.map((l) => l.asset))].filter(Boolean));
    const used = (inputs.library?.assets || []).filter((a) => refs.has(a.id));
    if (used.length) writeJson(p.libraryUsed, { version: 1, generatedAt: new Date().toISOString(), assets: used }); else fs.rmSync(p.libraryUsed, { force: true });
    writeJson(p.state, { ...state, editType: directive.typeId, prompt: directive.prompt, editConfig: cfg });
    return { plan: p.plan, report: p.directorReport, shots: plan.timeline.shots.length, duration: plan.timeline.duration, bpm: plan.timeline.bpm, editType: directive.typeId, why: directive.explanation, templates: report.templates, warnings: report.warnings, music: report.music };
  });
}

/** Beat map for any audio file (CLI: xoxo beats). */
export function beatsFor(ctx, file, { out = null, seconds = 0 } = {}) {
  return attempt('beats', async () => {
    const f = path.resolve(file); if (!fs.existsSync(f)) throw new Error(`audio file not found: ${f}`);
    const map = await analyzeBeats(ctx.config, f, { outFile: out ? path.resolve(out) : null, maxSeconds: seconds });
    return { file: f, bpm: map.bpm, confidence: map.confidence, beats: map.beats.length, downbeats: map.downbeats.length, bars: map.bars.length, drops: map.drops, breaks: map.breaks, rises: map.rises, impacts: map.impacts.length, sections: map.sections, out: out ? path.resolve(out) : null, note: map.note };
  });
}

/** The whole thing. */
export function produceVideo(ctx, opts = {}) {
  return attempt('produce', async () => {
    const t0 = Date.now(); const steps = []; const log = (m) => { steps.push({ at: Math.round((Date.now() - t0) / 100) / 10, message: m }); opts.onProgress?.({ message: m }); };
    if (!opts.assets) throw new Error('--assets <folder> is required');
    const assetsDir = path.resolve(opts.assets);
    if (!fs.existsSync(assetsDir) || !fs.statSync(assetsDir).isDirectory()) throw new Error(`assets folder not found: ${assetsDir}`);

    // 1. configuration
    const cfgFile = findEditConfig(ctx, assetsDir, opts.config);
    const loaded = cfgFile ? loadEditConfig(cfgFile) : { config: {}, warnings: [] };
    const quality = opts.quality || loaded.config.quality || 'final';
    if (!['draft', 'preview', 'final'].includes(quality)) throw new Error(`quality must be draft, preview or final (got "${quality}")`);
    const config = { ...loaded.config, ...defined({ duration: opts.duration, resolution: opts.resolution, aspect: opts.aspect, fps: opts.fps, seed: opts.seed, professional: opts.professional, music: opts.music, sfx: opts.sfx, style: opts.style, intensity: opts.intensity, captions: opts.captions, title: opts.title, quality }) };
    if (quality !== 'final' && !opts.resolution && !loaded.config.resolution) config.resolution = QUALITY_RES[quality];
    const directive = resolveDirective({ type: opts.type || null, prompt: opts.prompt || '', config, overrides: opts.overrides || {} });
    log(`edit type: ${directive.typeId} (from ${directive.typeSource})${cfgFile ? `; config ${cfgFile}` : ''}`);
    for (const w of loaded.warnings) log(`config warning: ${w}`);

    // 2. project
    const name = slug(opts.name || directive.title || path.basename(opts.output ? path.resolve(opts.output) : assetsDir) || `${directive.typeId}-edit`, `${directive.typeId}-edit`);
    const created = await S.newProject(ctx, name, { assets: assetsDir }); if (!created.success) return created;
    const scan = await S.scanProject(ctx, name, { dir: assetsDir }); if (!scan.success) return scan;
    log(`scanned ${Object.values(scan.data.counts).reduce((a, b) => a + b, 0)} files ${JSON.stringify(scan.data.counts)}`);
    const p = projectPaths(ctx.config, name);
    const { prompt: _ignored, ...configNoPrompt } = config; // the prompt travels separately: keeping it in two places would apply its intensifiers twice
    const st = readJson(p.state, {}); writeJson(p.state, { ...st, editType: directive.typeId, prompt: directive.prompt, editConfig: configNoPrompt }); void _ignored;

    // 3. direct
    const dir = await directProject(ctx, name, { type: directive.typeId, prompt: directive.prompt, overrides: opts.overrides, seed: config.seed, log, starterSfx: opts.starterSfx, dryRun: opts.dryRun });
    if (!dir.success) return dir;
    log(`directed: ${dir.data.shots} shots, ${dir.data.duration}s @ ${Math.round(dir.data.bpm)} BPM (${Object.entries(dir.data.templates).map(([k, v]) => `${k}×${v}`).join(', ')})`);

    // 4. build + QA + repair
    const edit = await S.editProject(ctx, name, { dryRun: Boolean(opts.dryRun), verify: opts.verify !== false, repair: opts.repair !== false, onProgress: (e) => { if (e.status === 'start') log(`build: ${e.label}`); } });
    log(`build: ${edit.success ? 'ok' : 'FAILED'}${edit.data?.qa ? `; QA ${edit.data.qa.passed ? 'passed' : 'FAILED'} (${edit.data.qa.summary})` : ''}`);

    // 5. render (never for a dry run / simulator: nothing exists to render)
    let render = null;
    const mock = Boolean(opts.dryRun) || ctx.config.transport === 'mock';
    if (edit.success && opts.render !== false && !mock) {
      render = await S.renderProjectCmd(ctx, name, { preview: quality !== 'final', force: opts.force, onProgress: opts.onRenderProgress });
      log(`render: ${render.success ? render.data.output : 'FAILED: ' + render.error}`);
    } else if (mock) log('render skipped: the simulator builds the plan but renders nothing');

    // 6. report + deliver
    const outDir = opts.output ? path.resolve(opts.output) : null;
    let delivered = null;
    if (outDir) { ensureDir(outDir); if (render?.success && render.data.output && fs.existsSync(render.data.output)) { delivered = path.join(outDir, `${name}${quality === 'final' ? '' : '_' + quality}${path.extname(render.data.output)}`); fs.copyFileSync(render.data.output, delivered); } }
    const reportFile = writeEditReport(ctx, name, { directive, config, quality, steps, edit, render, mock, delivered, outDir, scan: scan.data, director: dir.data });
    const success = Boolean(edit.success) && (render === null || render.success);
    return { success, operation: 'produce', data: { project: name, projectDir: p.root, plan: p.plan, aep: p.aep, qa: p.qa, beatMap: fs.existsSync(p.beatMap) ? p.beatMap : null, directorReport: p.directorReport, report: reportFile, output: delivered || render?.data?.output || null, rendered: Boolean(render?.success), simulated: mock, steps, edit: edit.data, render: render?.data || null }, ...(success ? {} : { error: !edit.success ? `build/QA: ${edit.error}` : `render: ${render.error}`, recoverable: true }) };
  });
}

// ---------------------------------------------------------------------------------------------------------
const fmt = (n, d = 2) => (typeof n === 'number' ? n.toFixed(d) : String(n ?? ''));
const row = (cells) => `| ${cells.map((c) => String(c ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ')} |`;

/** EDIT_REPORT.md: what was made, how it was decided, and - above all - what was and was not actually verified. */
export function writeEditReport(ctx, name, { directive, config, quality, steps, edit, render, mock, delivered, outDir, scan, director }) {
  const p = projectPaths(ctx.config, name);
  const plan = readJson(p.plan, null); const dr = readJson(p.directorReport, null); const qa = readJson(p.qa, null);
  const L = [];
  const status = mock ? 'SIMULATED — nothing was rendered' : render?.success ? 'REAL After Effects build, rendered and verified' : edit.success ? 'REAL After Effects build; not rendered' : 'FAILED';
  L.push(`# Edit report: ${name}`, '', `**Status: ${status}**`, '');
  if (mock) L.push('> This run used the built-in simulator (`--dry-run` or `transport: mock`). It proves the plan, the compile and the host scripts\' arguments are consistent. It does **not** prove anything about real After Effects behaviour, and **no video file exists**.', '');
  L.push('## Result', row(['Item', 'Value']), row(['---', '---']), row(['Edit type', `${directive.typeId} (${directive.typeSource})`]), row(['Quality tier', quality]), row(['Duration', plan ? `${fmt(plan.timeline.duration, 1)} s` : '?']), row(['Output', plan ? `${plan.output.width}x${plan.output.height} @ ${plan.output.fps} fps` : '?']), row(['Video', delivered || render?.data?.output || (mock ? 'none (simulated)' : 'not rendered')]), row(['After Effects project', p.aep]), row(['QA', qa ? `${qa.passed ? 'passed' : 'FAILED'} — ${qa.summary}` : 'not run']), '');
  L.push('## How the brief was read', directive.explanation?.length ? directive.explanation.map((e) => `- ${e}`).join('\n') : '- (no special instructions found in the prompt)', '');
  const dials = plan?.directive?.dials || directive.dials;
  L.push('## Behaviour dials (0–1) and where each came from', row(['Dial', 'Value', 'Source']), row(['---', '---', '---']), ...Object.entries(dials).map(([k, v]) => row([k, fmt(v), plan?.directive?.sources?.[k] || directive.sources?.[k] || ''])), '');
  if (plan) {
    L.push('## Music and rhythm', `- Music: ${dr?.music?.id || 'none'} (${dr?.music?.source}) — ${dr?.music?.reason || ''}`, `- Tempo: ${plan.timeline.bpm ? Math.round(plan.timeline.bpm * 10) / 10 + ' BPM' : 'n/a'}${dr?.virtualBeats ? ' — **virtual grid, no music was analysed**' : ''}`, `- Beat map: ${plan.beatMap.beats.length} beats, ${plan.beatMap.drops.length} drops, ${plan.beatMap.impacts.length} impacts`, '');
    L.push('## Shots', row(['Shot', 'Time', 'Template', 'Asset', 'Camera', 'Speed', 'Into next', 'Text']), row(['---', '---', '---', '---', '---', '---', '---', '---']));
    plan.timeline.shots.forEach((s, i) => {
      const rm = s.layers.find((l) => l.remap); const tr = plan.timeline.transitions[i];
      L.push(row([s.id, `${fmt(s.start)}–${fmt(s.end)}`, s.template, s.assets.main || '—', s.camera ? `${s.camera.move}` : '—', rm ? rm.remap.summary.slice(0, 70) : '1x', tr ? `${tr.type}${tr.d ? ' ' + fmt(tr.d) + 's' : ''}` : '', s.text.map((t) => `${t.text} (${t.animation})`).join('; ')]));
    });
    L.push('', `## Sound design`, `${plan.audio.sfxEvents.length} sound events (${[...new Set(plan.audio.sfxEvents.map((e) => e.role))].join(', ') || 'none'}). ${dr?.sound?.dropped ? dr.sound.dropped + ' candidates dropped (budget / simultaneity).' : ''}`, '');
  }
  const fb = edit.data?.build?.fallbacksUsed || [];
  L.push('## Fallbacks and degradations', fb.length ? fb.map((f) => `- ${f.effect || f.label}: used "${f.using}" (quality ${f.quality}) — ${(f.reasons || [])[0] || ''}`).join('\n') : '- none', '');
  const warns = [...(dr?.warnings || []), ...(qa?.warnings || []).map((w) => w.message)].slice(0, 30);
  L.push('## Warnings', warns.length ? warns.map((w) => `- ${w}`).join('\n') : '- none', '');
  L.push('## What was NOT verified', '- Camera/transition/typography behaviour inside real After Effects until `xoxo selftest` and a real run have been done on this machine.', '- Anything in the Director\'s creative judgement (it is heuristic: it cannot see the picture the way a person does). Review the preview.', mock ? '- The render: none was made.' : (render?.success ? '' : '- The render did not complete.'), '');
  L.push('## Log', ...steps.map((s) => `- [${s.at}s] ${s.message}`), '');
  const text = L.filter((x) => x !== undefined).join('\n');
  const file = path.join(p.root, 'EDIT_REPORT.md'); fs.writeFileSync(file, text);
  if (outDir) { try { fs.writeFileSync(path.join(outDir, 'EDIT_REPORT.md'), text); } catch { /* output folder not writable: the project copy remains */ } }
  void scan; void director; void config;
  return file;
}
