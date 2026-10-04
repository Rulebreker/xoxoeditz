import fs from 'node:fs';
import path from 'node:path';
import { runTool } from '../core/resolve-tool.js';
import { ensureDir, slug, toAePath } from '../core/paths.js';
import { buildAerenderArgs, runAerender } from './aerender.js';
import { verifyRender, extractFrames } from './verify.js';
import { MASTER } from '../ae/compile.js';
import { masterEnd } from '../plan/schema.js';
import { saveProject } from '../ae/project.js';
import { nullLogger } from '../core/logger.js';
import { sleep } from '../core/exec.js';

const INTERMEDIATE_PREF = [/^lossless$/i, /prores 422 hq/i, /prores 422/i, /^lossless/i, /dnxh/i, /quicktime/i];
const DIRECT_PREF = [/h\.?264.*match render settings.*(15|high)/i, /h\.?264/i, /hevc|h\.?265/i];

const pick = (list, prefs) => { for (const re of prefs) { const hit = (list || []).find((t) => re.test(t)); if (hit) return hit; } return null; };

/** Decide how to render with what this machine has. */
export function chooseStrategy(caps, templates, { preferAme = false } = {}) {
  const reasons = [];
  const om = templates?.outputModules || []; const rs = templates?.renderSettings || [];
  const rsTemplate = rs.includes('Best Settings') ? 'Best Settings' : (rs[0] || null);
  const inter = pick(om, INTERMEDIATE_PREF);
  const direct = pick(om, DIRECT_PREF);
  if (!preferAme && caps?.aerender_path && caps?.ffmpeg && inter) return { name: 'aerender+ffmpeg', omTemplate: inter, rsTemplate, reasons: [`intermediate "${inter}" then FFmpeg H.264`] };
  if (!preferAme && caps?.aerender_path && direct) return { name: 'aerender-direct', omTemplate: direct, rsTemplate, reasons: [`direct output module "${direct}"`] };
  if (!preferAme && caps?.aerender_path && !templates?.outputModules?.length) {
    return { name: caps.ffmpeg ? 'aerender+ffmpeg' : 'aerender-direct', omTemplate: caps.ffmpeg ? 'Lossless' : null, rsTemplate: 'Best Settings', reasons: ['output module templates could not be enumerated; assuming Lossless / Best Settings'] };
  }
  if (caps?.media_encoder) return { name: 'ame', omTemplate: null, rsTemplate, reasons: ['queueing in Adobe Media Encoder (completion is observed from the output file)'] };
  if (caps?.aerender_path) reasons.push('no suitable output module template found (need Lossless/ProRes/H.264)');
  return { name: 'none', omTemplate: null, rsTemplate, reasons: reasons.length ? reasons : ['no renderer available (aerender / Media Encoder not found)'] };
}

function transcodeArgs(input, output, plan, { preview, scaleWidth }) {
  const o = plan.output; const codec = (o.codec || 'h264').toLowerCase();
  const a = ['-v', 'error', '-y', '-i', input];
  const vf = [];
  if (scaleWidth) vf.push(`scale=${scaleWidth}:-2`);
  if (vf.length) a.push('-vf', vf.join(','));
  if (codec === 'prores') a.push('-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le');
  else if (codec === 'h265' || codec === 'hevc') a.push('-c:v', 'libx265', '-preset', preview ? 'ultrafast' : 'medium', '-crf', preview ? '30' : '18', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1');
  else {
    a.push('-c:v', 'libx264', '-preset', preview ? 'ultrafast' : 'slow', '-pix_fmt', 'yuv420p');
    if (o.bitrateMbps && !preview) a.push('-b:v', `${o.bitrateMbps}M`, '-maxrate', `${Math.round(o.bitrateMbps * 1.5)}M`, '-bufsize', `${o.bitrateMbps * 2}M`);
    else a.push('-crf', preview ? '28' : '16');
    if (o.height >= 2000) a.push('-level', '5.1');
  }
  a.push('-c:a', 'aac', '-b:a', preview ? '128k' : '320k', '-movflags', '+faststart', output);
  return a;
}

/**
 * Render the master composition and verify the result.
 * @param opts { config, bridge, caps, plan, paths, preview, range:[startSec,endSec], onProgress, logger, keepIntermediate, preferAme }
 */
export async function renderProject(opts) {
  const { config, bridge, caps, plan, paths, preview = false, range = null, onProgress = () => {}, logger = nullLogger, keepIntermediate = false, preferAme = false } = opts;
  const fps = plan.output.fps;
  const total = masterEnd(plan);
  const [t0, t1] = range ? [Math.max(0, range[0]), Math.min(total, range[1])] : [0, total];
  const steps = [];
  const fail = (error, extra = {}) => ({ success: false, operation: 'render', error, recoverable: true, steps, ...extra });

  const saved = await saveProject(bridge, paths.aep);
  if (!saved.success) return fail(`could not save the project before rendering: ${saved.error}`, { code: saved.code });
  steps.push('project saved');

  let templates = null;
  const tpl = await bridge.call('rq_templates');
  if (tpl.success) templates = tpl.data; else steps.push(`render templates not enumerable (${tpl.error}); using defaults`);
  const strategy = chooseStrategy(caps, templates, { preferAme });
  steps.push(`strategy: ${strategy.name} — ${strategy.reasons.join('; ')}`);
  if (strategy.name === 'none') return fail(`no way to render: ${strategy.reasons.join('; ')}. Install After Effects (aerender) or Media Encoder, or render manually from the saved project: ${paths.aep}`, { code: 'NO_RENDERER', recoverable: false });

  ensureDir(paths.renders);
  const base = `${slug(plan.title)}_${plan.output.width}x${plan.output.height}${preview ? '_preview' : ''}`;
  const ext = path.extname(plan.output.path || '') || (plan.output.format === 'mov' ? '.mov' : '.mp4');
  const finalPath = plan.output.path && !preview ? path.resolve(paths.root, plan.output.path) : path.join(paths.renders, `${base}${ext}`);
  ensureDir(path.dirname(finalPath));
  const interExt = '.mov';
  let interPath = path.join(paths.renders, `${base}_intermediate${interExt}`);

  const startFrame = range ? Math.round(t0 * fps) : undefined;
  const endFrame = range ? Math.max(Math.round(t1 * fps) - 1, startFrame ?? 0) : undefined;
  const expectedFrames = Math.round((t1 - t0) * fps);

  if (strategy.name === 'ame') {
    const q = await bridge.call('rq_add', { comp: MASTER, output: toAePath(finalPath) });
    if (!q.success) return fail(`could not add the render queue item: ${q.error}`);
    const ame = await bridge.call('rq_queue_ame', { start: true });
    if (!ame.success) return fail(`could not hand off to Media Encoder: ${ame.error}`);
    steps.push('queued in Media Encoder; waiting for the output file');
    const deadline = Date.now() + config.timeouts.renderMs; let last = -1; let stable = 0;
    while (Date.now() < deadline) {
      await sleep(5000);
      const sz = fs.existsSync(finalPath) ? fs.statSync(finalPath).size : -1;
      if (sz > 0 && sz === last) { if (++stable >= 3) break; } else stable = 0;
      last = sz;
    }
    const v = await verifyRender(config, finalPath, { width: plan.output.width, height: plan.output.height, fps, duration: t1 - t0, audio: Boolean(plan.audio.narration || plan.audio.music.length) });
    return { success: v.passed, operation: 'render', data: { strategy: strategy.name, output: finalPath, verification: v, steps }, ...(v.passed ? {} : { error: 'rendered file failed verification', recoverable: true }) };
  }

  const exe = caps.aerender_path;
  const args = buildAerenderArgs({ project: paths.aep, comp: MASTER, output: strategy.name === 'aerender+ffmpeg' ? interPath : finalPath, rsTemplate: preview && templates?.renderSettings?.includes('Draft Settings') ? 'Draft Settings' : strategy.rsTemplate, omTemplate: strategy.omTemplate, startFrame, endFrame });
  logger.info('aerender', { exe, args });
  steps.push(`aerender ${args.join(' ')}`);
  const t = Date.now();
  const r = await runAerender(exe, args, { onProgress: (p) => onProgress({ phase: 'render', frame: p.frame, of: expectedFrames }), timeoutMs: config.timeouts.renderMs });
  if (r.code !== 0 || r.errors.length) {
    return fail(`aerender failed (exit ${r.code}): ${r.errors[0] || (r.tail || '').trim().split('\n').slice(-2).join(' ') || 'no output'}`, { data: { tail: r.tail } });
  }
  steps.push(`aerender finished: ${r.frames} frames in ${((Date.now() - t) / 1000).toFixed(1)}s`);

  if (strategy.name === 'aerender+ffmpeg') {
    // After Effects may change the extension to suit the output module (e.g. .mov vs .avi)
    const stem = path.basename(interPath, interExt);
    const found = fs.readdirSync(paths.renders).find((f) => f.startsWith(stem));
    if (!found) return fail(`aerender reported success but no file named ${stem}.* appeared in ${paths.renders} (check the output module template "${strategy.omTemplate}")`);
    interPath = path.join(paths.renders, found);
    onProgress({ phase: 'transcode' });
    const tr = await runTool(config, 'ffmpeg', transcodeArgs(interPath, finalPath, plan, { preview, scaleWidth: preview ? 960 : null }), { timeoutMs: config.timeouts.renderMs });
    if (tr.error || tr.code !== 0) return fail(`ffmpeg transcode failed: ${tr.error || tr.stderr.split('\n').slice(-3).join(' ')}`);
    steps.push('transcoded with FFmpeg');
    if (!keepIntermediate) { try { fs.unlinkSync(interPath); } catch { /* */ } }
  }

  const expect = { width: preview ? undefined : plan.output.width, height: preview ? undefined : plan.output.height, fps, duration: t1 - t0, audio: Boolean(plan.audio.narration || plan.audio.music.length) };
  const v = await verifyRender(config, finalPath, expect);
  const data = { strategy: strategy.name, output: finalPath, range: range ? [t0, t1] : null, verification: v, steps };
  if (preview && v.passed && caps.ffmpeg) {
    const n = 6; const times = Array.from({ length: n }, (_, i) => +(((t1 - t0) * (i + 0.5)) / n).toFixed(2));
    data.frames = await extractFrames(config, finalPath, times, path.join(paths.renders, 'preview_frames'));
  }
  return { success: v.passed, operation: 'render', data, ...(v.passed ? {} : { error: `render finished but failed verification: ${v.checks.filter((c) => !c.ok && c.severity === 'error').map((c) => `${c.name} (${c.detail})`).join('; ')}`, recoverable: true }) };
}
