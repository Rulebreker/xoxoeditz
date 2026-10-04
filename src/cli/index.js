import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import * as S from '../app/services.js';
import { formatDoctor, formatEdit, formatQa, formatStatus, formatEffects, formatRender, formatGeneric, red, green, dim, bold } from './format.js';
import { readJson, writeJson, ensureDir } from '../core/paths.js';
import { synthesizeSfx, SYNTH } from '../audio/synth.js';
import { runTool } from '../core/resolve-tool.js';
import { OPS_DOC } from '../bridge/ops-doc.js';

const HELP = `
${bold('XOXOEDITZ')} — autonomous After Effects video editing agent

${bold('Everyday workflow')}
  xoxo doctor [--connect]            check After Effects, FFmpeg, bridge, permissions
  xoxo new <name> [--assets dir]     create a project
  xoxo assets [name] [--thumbs]      classify + probe assets -> assets.manifest.json
  xoxo narration [name] [--script f | --subtitles f | --transcribe]
  xoxo plan [name] --scaffold --title T --brief "..." [--style S --resolution 4k --aspect 16:9]
  xoxo plan [name] --validate | --show
  xoxo edit [name] [--dry-run]       build the project in After Effects (+ QA + auto-repair)
  xoxo verify [name]                 re-run QA on the saved project
  xoxo render [name] [--preview --range 10:20]
  xoxo status [name]
  xoxo auto <name> --assets dir --brief "..."   everything above, unattended

${bold('Setup & tools')}
  xoxo setup [--startup]             install bridge scripts, run doctor
  xoxo detect                        rebuild the capability registry (.xoxo/capabilities.json)
  xoxo effects                       effect fallback chains for this machine
  xoxo bridge install|ping|stop|ops|installed|uninstall|call <op> [json]
  xoxo sfx <whoosh|impact|riser|tick> [--out file]
  xoxo selftest [--dry-run]          end-to-end smoke test with generated media
  xoxo mcp                           MCP server on stdio (used by Claude Code)
  xoxo config [set <key> <value> | unset <key>]   show / persist settings (e.g. xoxo config set ffmpeg "C:\\tools\\ffmpeg\\bin\\ffmpeg.exe")

Add ${bold('--json')} to any command for machine-readable output. Docs: README.md, docs/.
`;

const OPTIONS = {
  json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, 'dry-run': { type: 'boolean' }, connect: { type: 'boolean' }, startup: { type: 'boolean' },
  assets: { type: 'string' }, dir: { type: 'string' }, thumbs: { type: 'boolean' }, 'no-probe': { type: 'boolean' },
  audio: { type: 'string' }, script: { type: 'string' }, subtitles: { type: 'string' }, transcribe: { type: 'boolean' }, 'noise-db': { type: 'string' },
  scaffold: { type: 'boolean' }, validate: { type: 'boolean' }, show: { type: 'boolean' }, force: { type: 'boolean' },
  title: { type: 'string' }, brief: { type: 'string' }, style: { type: 'string' }, resolution: { type: 'string' }, aspect: { type: 'string' }, fps: { type: 'string' }, 'no-captions': { type: 'boolean' }, captions: { type: 'boolean' },
  'no-verify': { type: 'boolean' }, 'no-repair': { type: 'boolean' }, 'no-render': { type: 'boolean' },
  preview: { type: 'boolean' }, range: { type: 'string' }, ame: { type: 'boolean' }, 'keep-intermediate': { type: 'boolean' },
  out: { type: 'string' }, verbose: { type: 'boolean', short: 'v' },
};

function emit(opts, r, formatter) {
  if (opts.json) console.log(JSON.stringify(r, null, 2));
  else if (r.success && formatter) console.log(formatter(r.data, r));
  else if (r.operation === 'doctor' && r.data) console.log(formatDoctor(r.data));
  else if (!r.success && r.operation === 'verify' && r.data) console.log(formatQa({ ...r.data, passed: false }));
  else if (!r.success && r.operation === 'edit' && r.data) console.log(formatEdit(r.data), '\n' + red(r.error));
  else if (!r.success && r.operation === 'render') console.log(formatRender(r), '\n' + red(r.error));
  else console.log(formatGeneric(r));
  return r.success ? 0 : 1;
}

export async function main(argv) {
  const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : null;
  const rest = cmd ? argv.slice(1) : argv;
  let parsed;
  try { parsed = parseArgs({ args: rest, options: OPTIONS, allowPositionals: true, strict: true }); }
  catch (e) { console.error(red(e.message) + '\nRun `xoxo help`.'); return 2; }
  const { values: o, positionals: pos } = parsed;
  if (!cmd || cmd === 'help' || o.help) { console.log(HELP); return 0; }

  if (cmd === 'mcp') { const { serve } = await import('../mcp/server.js'); await serve(); return new Promise(() => {}); }

  const ctx = S.createContext({ echo: o.verbose });
  const name = pos[0];
  try {
    switch (cmd) {
      case 'doctor': return emit(o, await S.doctor(ctx, { connect: o.connect }), formatDoctor);
      case 'detect': { const r = await S.detect(ctx); return emit(o, r, (d) => `Capability registry written to ${d.file}\n` + JSON.stringify({ after_effects: d.capabilities.after_effects, version: d.capabilities.after_effects_version, aerender: d.capabilities.aerender, media_encoder: d.capabilities.media_encoder, ffmpeg: d.capabilities.ffmpeg, whisper: d.capabilities.whisper, python: d.capabilities.python, os: d.capabilities.os }, null, 2)); }
      case 'setup': {
        const r = await S.bridgeInstall(ctx, { startup: o.startup });
        if (!o.json) console.log(r.success ? green('✓ bridge scripts installed in ') + r.data.dir : red(r.error));
        const d = await S.doctor(ctx);
        if (!o.json) console.log('\n' + formatDoctor(d.data)); else console.log(JSON.stringify({ install: r, doctor: d }, null, 2));
        if (r.success && r.data.startup && !r.data.startup.ok) console.log(yellowLine(`startup loader not installed: ${r.data.startup.error}`));
        return d.success && r.success ? 0 : 1;
      }
      case 'effects': return emit(o, await S.effects(ctx), formatEffects);
      case 'config': {
        if (name === 'set') { if (pos.length < 3) { console.error('usage: xoxo config set <ffmpeg|ffprobe|whisper|aePath|aerenderPath|mediaEncoderPath|transport|bridgeDir> <value>'); return 2; } return emit(o, await S.configSet(ctx, pos[1], pos.slice(2).join(' ')), (d) => `${green('✓')} ${d.key} saved to ${d.file}${d.resolvedTo ? '\n  resolves to ' + d.resolvedTo : ''}`); }
        if (name === 'unset') { if (!pos[1]) { console.error('usage: xoxo config unset <key>'); return 2; } return emit(o, await S.configUnset(ctx, pos[1]), (d) => `${green('✓')} ${d.key} ${d.removed ? 'removed from' : 'was not set in'} ${d.file}`); }
        return emit(o, { success: true, operation: 'config', data: ctx.config }, (d) => JSON.stringify(d, null, 2));
      }
      case 'new': if (!name) { console.error('usage: xoxo new <name> [--assets dir]'); return 2; } return emit(o, await S.newProject(ctx, name, { assets: o.assets }), (d) => `${green('✓')} project ${d.name} created at ${d.root}\n  assets: ${d.assetsDir}\n  next:   ${d.next}`);
      case 'assets': return emit(o, await S.scanProject(ctx, name, { dir: o.dir || o.assets, thumbs: o.thumbs, probe: !o['no-probe'] }), (d) => [`${green('✓')} ${d.assets.length} assets  ${JSON.stringify(d.counts)}`, ...d.assets.map((a) => `  ${a.id.padEnd(28)} ${a.type.padEnd(8)} ${[a.role && `${a.role}${a.roleConfidence < 0.5 ? '?' : ''}`, a.size, a.duration && `${a.duration}s`].filter(Boolean).join('  ')}`), ...d.warnings.map((w) => `  ${red('!')} ${w}`), ...(d.thumbnails.length ? ['', `thumbnails: ${path.dirname(d.thumbnails[0])}`] : []), '', dim(d.hint)].join('\n'));
      case 'narration': return emit(o, await S.analyzeProjectNarration(ctx, name, { audio: o.audio, script: o.script, subtitles: o.subtitles, transcribe: o.transcribe, noiseDb: o['noise-db'] ? Number(o['noise-db']) : undefined }), (d) => [`${green('✓')} narration ${d.duration}s, ${d.speechSegments} speech segments, ${d.pauses} long pauses, transcript: ${d.transcript.method}`, ...d.scenes.map((s) => `  ${s.id} ${s.start}–${s.end}s  ${s.text}`), ...d.notes.map((n) => dim(n))].join('\n'));
      case 'plan': {
        if (o.scaffold) return emit(o, await S.scaffoldProjectPlan(ctx, name, { title: o.title, brief: o.brief, style: o.style, resolution: o.resolution, aspect: o.aspect, fps: o.fps, captions: o['no-captions'] ? false : (o.captions ? true : undefined), force: o.force }), (d) => `${green('✓')} plan written: ${d.plan}\n  ${d.scenes} scenes, style ${d.style}\n  ${d.validation.valid ? green('valid') : red('INVALID')} (${d.validation.errors.length} errors, ${d.validation.warnings.length} warnings)\n${dim(d.note)}`);
        if (o.show) { const n = S.resolveProjectName(ctx, name); const p = readJson(path.join(ctx.config.projectsDir, n, 'plan.json')); console.log(JSON.stringify(p, null, 2)); return 0; }
        const r = await S.validateProjectPlan(ctx, name);
        if (!r.success && !o.json) {
          console.log(red(`✗ ${r.error || 'plan is invalid'}`));
          for (const e of r.data?.errors || []) console.log(`  ${red('✗')} ${e.path}: ${e.message}`);
          for (const w of r.data?.warnings || []) console.log(`  ${red('!')} ${w.path}: ${w.message}`);
          return 1;
        }
        return emit(o, r, (d) => `${green('✓')} plan valid: ${d.scenes} scenes, ${d.duration}s, ${d.output.width}x${d.output.height}@${d.output.fps}\n${d.warnings.map((w) => `  ${red('!')} ${w.path}: ${w.message}`).join('\n')}`);
      }
      case 'edit': {
        const progress = o.json ? undefined : (p) => { if (p.status === 'start') process.stderr.write(dim(`  → ${p.label}\n`)); };
        const r = await S.editProject(ctx, name, { dryRun: o['dry-run'], verify: !o['no-verify'], repair: !o['no-repair'], onProgress: progress });
        return emit(o, r, formatEdit);
      }
      case 'verify': return emit(o, await S.verifyProject(ctx, name, { dryRun: o['dry-run'], repair: !o['no-repair'] }), (d) => formatQa({ ...d, passed: d.passed }));
      case 'render': {
        const progress = o.json ? undefined : (() => { let last = 0; return (p) => { if (p.phase === 'render' && Date.now() - last > 2000) { last = Date.now(); process.stderr.write(dim(`  rendering frame ${p.frame}/${p.of}\r`)); } else if (p.phase === 'transcode') process.stderr.write(dim('  transcoding…\n')); }; })();
        const r = await S.renderProjectCmd(ctx, name, { preview: o.preview, range: o.range, force: o.force, ame: o.ame, keepIntermediate: o['keep-intermediate'], onProgress: progress });
        return emit(o, r, (d, full) => formatRender(full));
      }
      case 'status': return emit(o, await S.statusProject(ctx, name), formatStatus);
      case 'auto': return await auto(ctx, o, pos);
      case 'selftest': return await selftest(ctx, o);
      case 'sfx': {
        const kind = pos[0];
        if (!SYNTH[kind]) { console.error(`usage: xoxo sfx <${Object.keys(SYNTH).join('|')}> [--out file]`); return 2; }
        const out = await synthesizeSfx(ctx.config, kind, o.out ? path.dirname(path.resolve(o.out)) : ctx.config.assetsDir);
        console.log(out); return 0;
      }
      case 'bridge': return await bridgeCmd(ctx, o, pos);
      default: console.error(`unknown command "${cmd}".`); console.log(HELP); return 2;
    }
  } catch (e) {
    if (o.json) console.log(JSON.stringify({ success: false, operation: cmd, error: e.message })); else console.error(red(`✗ ${cmd}: ${e.message}`));
    return 1;
  }
}

const yellowLine = (s) => `! ${s}`;

async function bridgeCmd(ctx, o, pos) {
  const sub = pos[0];
  if (sub === 'install') return emit(o, await S.bridgeInstall(ctx, { startup: o.startup }), (d) => [`${green('✓')} installed to ${d.dir}`, ...d.next.map((n) => `  • ${n}`), ...(d.startup ? [d.startup.ok ? `  ${green('✓')} startup loader: ${d.startup.file}` : `  ${red('!')} startup loader: ${d.startup.error}`] : [])].join('\n'));
  if (sub === 'ping') return emit(o, await S.bridgePing(ctx), (d) => `${green('✓')} connected via ${d.transport}: After Effects ${d.host.aeVersion} on ${d.host.os}, ${d.effects} effects visible${d.host.scriptsMayWriteFiles === false ? red('\n  scripting file access is OFF') : ''}`);
  if (sub === 'uninstall') return emit(o, await S.bridgeUninstall(ctx), (d) => `${green('✓')} removed ${d.removed.length} installed file(s)${d.failed.length ? red(' — failed: ' + JSON.stringify(d.failed)) : ''}`);
  if (sub === 'installed') return emit(o, await S.installManifest(ctx), (d) => (d.entries.length ? d.entries.map((e) => `${e.file}  (${e.kind}, ${e.at})`).join('\n') : 'XOXOEDITZ has installed nothing outside its own folders.'));
  if (sub === 'stop') { const { stopListenerFile } = await import('../bridge/install.js'); ensureDir(ctx.config.bridgeDir); stopListenerFile(ctx.config); console.log('stop signal written'); return 0; }
  if (sub === 'ops') { for (const [k, d] of Object.entries(OPS_DOC)) console.log(`${k.padEnd(22)} ${d.args}\n    ${d.doc}`); return 0; }
  if (sub === 'call') {
    let args = {}; if (pos[2]) { try { args = JSON.parse(pos[2]); } catch { console.error('args must be JSON'); return 2; } }
    return emit(o, await S.bridgeCall(ctx, pos[1], args, { dryRun: o['dry-run'] }), (d) => JSON.stringify(d, null, 2));
  }
  console.error('usage: xoxo bridge install|ping|stop|ops|installed|uninstall|call <op> [json]'); return 2;
}

async function auto(ctx, o, pos) {
  const name = pos[0];
  if (!name || !o.assets) { console.error('usage: xoxo auto <name> --assets <dir> --brief "..." [--style S --resolution 4k --aspect 16:9 --dry-run --no-render]'); return 2; }
  const step = async (label, p, fmt) => { const r = await p; if (!o.json) console.log(r.success ? `${green('✓')} ${label}` : `${red('✗')} ${label}: ${r.error}`); if (!r.success) { if (!o.json && fmt) console.log(fmt(r)); throw Object.assign(new Error(`${label} failed`), { result: r }); } return r; };
  try {
    await step('project', S.newProject(ctx, name, { assets: o.assets }));
    const scan = await step('assets', S.scanProject(ctx, name, { thumbs: true }));
    const hasNarr = scan.data.assets.some((a) => a.role === 'narration');
    if (hasNarr) await step('narration analysis', S.analyzeProjectNarration(ctx, name, { script: o.script, subtitles: o.subtitles, transcribe: o.transcribe }));
    await step('plan (baseline director)', S.scaffoldProjectPlan(ctx, name, { title: o.title || name, brief: o.brief, style: o.style, resolution: o.resolution, aspect: o.aspect, fps: o.fps, force: true }));
    const edit = await step('edit + QA', S.editProject(ctx, name, { dryRun: o['dry-run'], repair: !o['no-repair'] }), (r) => formatEdit(r.data || {}));
    if (!o.json) console.log(formatEdit(edit.data));
    if (o['dry-run'] || o['no-render']) { if (!o.json) console.log(dim('render skipped')); return 0; }
    const r = await step('render', S.renderProjectCmd(ctx, name, {}), formatRender);
    if (!o.json) console.log(formatRender(r));
    return 0;
  } catch (e) { if (o.json) console.log(JSON.stringify(e.result || { success: false, error: e.message })); return 1; }
}

async function selftest(ctx, o) {
  const dir = path.join(ctx.config.workspace, 'selftest');
  const assets = path.join(dir, 'assets');
  ensureDir(assets);
  const ff = async (args) => { const r = await runTool(ctx.config, 'ffmpeg', ['-v', 'error', '-y', ...args], { timeoutMs: 120000 }); if (r.error || r.code !== 0) throw new Error(`ffmpeg: ${r.error || r.stderr}`); };
  await ff(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:d=0.04', '-frames:v', '1', path.join(assets, 'test_pattern.png')]);
  await ff(['-f', 'lavfi', '-i', 'smptebars=s=1280x720:d=0.04', '-frames:v', '1', path.join(assets, 'color_bars.jpg')]);
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-f', 'lavfi', '-i', 'sine=frequency=260:duration=3', '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1', '-t', '8', path.join(assets, 'narration.wav')]);
  fs.writeFileSync(path.join(assets, 'script.txt'), 'This is the XOXOEDITZ self test. It builds a tiny project. Then it renders it.');
  const flags = { ...o, assets, brief: 'selftest minimal corporate', style: 'minimal-corporate', resolution: '720p', title: 'SELFTEST', script: path.join(assets, 'script.txt'), 'no-render': o['dry-run'] };
  return auto(ctx, flags, ['selftest']);
}
