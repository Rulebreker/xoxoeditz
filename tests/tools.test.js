import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir, baseEnv, testConfig, NO_FAKE_EXE } from './helpers/env.js';
import { hasFfmpeg, makeAssetFolder, makeVideo } from './helpers/media.js';
import { resolveTool, normalizeToolPath, runTool, toolPath, describeResolved } from '../src/core/resolve-tool.js';
import { loadConfig } from '../src/core/config.js';
import { createContext, doctor, configSet, configUnset, getCapabilities, newProject, scanProject, editProject, renderProjectCmd, analyzeProjectNarration, scaffoldProjectPlan } from '../src/app/services.js';
import { scanAssets, makeThumbnails } from '../src/assets/scan.js';
import { analyzeNarration } from '../src/narration/analyze.js';
import { synthesizeSfx } from '../src/audio/synth.js';
import { verifyRender, extractFrames } from '../src/render/verify.js';
import { createMockAE } from '../src/bridge/mock-ae.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'xoxo.js');
const posixOnly = process.platform === 'win32' ? 'POSIX shell scripts used as fake binaries' : false;

// ------------------------------------------------------------------------------------------------
// Windows semantics, simulated on any OS (platform:'win32' + in-memory file system)
// ------------------------------------------------------------------------------------------------
const WIN = 'win32';
function fakeFs(entries) {
  const files = new Map(Object.entries(entries));
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return {
    constants: { X_OK: 1 },
    statSync(p) { const e = files.get(p); if (e === undefined) throw enoent(); return { isFile: () => e !== 'dir', isDirectory: () => e === 'dir' }; },
    accessSync() {},
  };
}
const winTool = (explicit, files, extra = {}) => resolveTool('ffmpeg', { platform: WIN, fsx: fakeFs(files), env: {}, cwd: 'C:\\repo', explicit, ...extra });

const SPACED = 'C:\\Users\\Some User\\OneDrive\\Desktop\\ffmpeg\\ffmpeg-master-latest-win64-gpl\\bin\\ffmpeg.exe';

test('win32: absolute path with spaces is accepted as-is', () => {
  const r = winTool(SPACED, { [SPACED]: 'file' });
  assert.equal(r.ok, true);
  assert.equal(r.path, SPACED);
  assert.equal(r.source, 'config');
});

test('win32: surrounding quotes (cmd `set X="..."` keeps them) and forward slashes are normalised', () => {
  const real = 'C:\\Program Files\\ff mpeg\\bin\\ffmpeg.exe';
  const r = winTool('"C:/Program Files/ff mpeg/bin/ffmpeg.exe"', { [real]: 'file' });
  assert.equal(r.ok, true);
  assert.equal(r.path, real);
  assert.equal(normalizeToolPath("'C:/a b/c.exe'", { platform: WIN, env: {}, cwd: 'C:\\' }), 'C:\\a b\\c.exe');
  assert.equal(normalizeToolPath('C:\\a\\\\b/c//d.exe', { platform: WIN, env: {}, cwd: 'C:\\' }), 'C:\\a\\b\\c\\d.exe');
  assert.equal(normalizeToolPath('   ', { platform: WIN, env: {}, cwd: 'C:\\' }), null);
});

test('win32: missing .exe extension, and a folder pointing at bin\\, both resolve', () => {
  const exe = 'C:\\tools\\ffmpeg-8\\bin\\ffmpeg.exe';
  const fsMap = { [exe]: 'file', 'C:\\tools\\ffmpeg-8\\bin': 'dir', 'C:\\tools\\ffmpeg-8': 'dir' };
  assert.equal(winTool('C:\\tools\\ffmpeg-8\\bin\\ffmpeg', fsMap).path, exe);
  assert.equal(winTool('C:\\tools\\ffmpeg-8\\bin', fsMap).path, exe);
  assert.equal(winTool('C:/tools/ffmpeg-8/', fsMap).path, exe); // install root: finds bin\ffmpeg.exe
});

test('win32: %VAR% is expanded using the injected environment (case-insensitive names)', () => {
  const exe = 'D:\\Media Tools\\ffmpeg.exe';
  const r = winTool('%MEDIAROOT%\\ffmpeg.exe', { [exe]: 'file' }, { env: { mediaroot: 'D:\\Media Tools' } });
  assert.equal(r.ok, true);
  assert.equal(r.path, exe);
});

test('win32: .cmd/.bat shims are rejected with an actionable reason (shell:false cannot run them)', () => {
  const r = winTool('C:\\shims\\ffmpeg.cmd', { 'C:\\shims\\ffmpeg.cmd': 'file' });
  assert.equal(r.ok, false);
  assert.match(r.tried[0].reason, /need.*shell|cannot be started without a shell/);
  const noExt = winTool('C:\\shims\\ffmpeg', { 'C:\\shims\\ffmpeg.cmd': 'file' });
  assert.equal(noExt.ok, false);
  assert.match(noExt.tried[0].reason, /needs a shell/);
});

test('win32: PATH lookup honours `Path` casing, quoted entries and PATHEXT-style .exe', () => {
  const exe = 'C:\\Program Files\\FF Tools\\bin\\ffmpeg.exe';
  const r = resolveTool('ffmpeg', { platform: WIN, fsx: fakeFs({ [exe]: 'file' }), cwd: 'C:\\', env: { Path: 'C:\\Windows\\System32;"C:\\Program Files\\FF Tools\\bin";;C:\\nothing' } });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'path');
  assert.equal(r.path, exe);
});

test('precedence: explicit config > XOXO_FFMPEG > PATH', () => {
  const A = 'C:\\a\\ffmpeg.exe'; const B = 'C:\\b\\ffmpeg.exe'; const C = 'C:\\c\\ffmpeg.exe';
  const files = { [A]: 'file', [B]: 'file', [C]: 'file' };
  const env = { XOXO_FFMPEG: B, PATH: 'C:\\c' };
  assert.deepEqual(pick(winTool(A, files, { envVar: 'XOXO_FFMPEG', env })), [A, 'config']);
  assert.deepEqual(pick(winTool(null, files, { envVar: 'XOXO_FFMPEG', env })), [B, 'env']);
  assert.deepEqual(pick(winTool(null, files, { envVar: 'XOXO_FFMPEG', env: { PATH: 'C:\\c' } })), [C, 'path']);
  function pick(r) { return [r.path, r.source]; }
});

test('an invalid higher-priority source falls through, with a warning that says why', () => {
  const B = 'C:\\b\\ffmpeg.exe';
  const r = winTool('C:\\typo\\ffmpeg.exe', { [B]: 'file' }, { envVar: 'XOXO_FFMPEG', env: { XOXO_FFMPEG: B } });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'env');
  assert.match(r.warnings[0], /C:\\typo\\ffmpeg\.exe" does not exist -- using env/);
  assert.equal(r.tried.length, 2);
});

test('total failure lists every source tried and the three ways to fix it', () => {
  const r = winTool('C:\\nope\\ffmpeg.exe', {}, { envVar: 'XOXO_FFMPEG', env: { XOXO_FFMPEG: 'C:\\also\\no.exe', PATH: 'C:\\x' } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.tried.map((t) => t.source), ['config', 'env', 'path']);
  assert.match(r.error, /ffmpeg not found/);
  assert.match(r.error, /XOXO_FFMPEG/);
  assert.match(r.error, /xoxo config set ffmpeg/);
  assert.match(describeResolved(r), /ffmpeg not found/);
});

// ------------------------------------------------------------------------------------------------
// Real processes (POSIX): spaces in paths, env/config/PATH, shell:false
// ------------------------------------------------------------------------------------------------
function fakeBin(dir, name, body = 'echo "$0 version 9.9-test"') {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

test('XOXO_FFMPEG override works for a path containing spaces and parentheses', { skip: posixOnly }, async () => {
  const exe = fakeBin(path.join(tmpDir(), 'My Tools (x86)', 'ff mpeg', 'bin'), 'ffmpeg');
  const cfg = loadConfig({ cwd: tmpDir(), env: { XOXO_FFMPEG: exe, PATH: '' } });
  assert.equal(cfg.tools.ffmpeg.ok, true);
  assert.equal(cfg.tools.ffmpeg.source, 'env');
  assert.equal(toolPath(cfg, 'ffmpeg'), exe);
  const r = await runTool(cfg, 'ffmpeg', ['-version']);
  assert.equal(r.code, 0, r.error);
  assert.match(r.stdout, /9\.9-test/);
});

test('same override with surrounding quotes (as `set X="..."` leaves them)', { skip: posixOnly }, () => {
  const exe = fakeBin(path.join(tmpDir(), 'q dir'), 'ffprobe');
  const cfg = loadConfig({ cwd: tmpDir(), env: { XOXO_FFPROBE: `"${exe}"`, PATH: '' } });
  assert.equal(cfg.tools.ffprobe.path, exe);
});

test('config value beats env, env beats PATH, PATH still works when nothing is set', { skip: posixOnly }, () => {
  const a = fakeBin(path.join(tmpDir(), 'a dir'), 'ffmpeg');
  const b = fakeBin(path.join(tmpDir(), 'b dir'), 'ffmpeg');
  const pathDir = path.join(tmpDir(), 'on path'); const c = fakeBin(pathDir, 'ffmpeg');
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'xoxo.config.json'), JSON.stringify({ ffmpeg: a }));
  const both = loadConfig({ cwd: root, env: { XOXO_FFMPEG: b, PATH: pathDir } });
  assert.deepEqual([both.tools.ffmpeg.path, both.tools.ffmpeg.source], [a, 'config']);
  const envOnly = loadConfig({ cwd: tmpDir(), env: { XOXO_FFMPEG: b, PATH: pathDir } });
  assert.deepEqual([envOnly.tools.ffmpeg.path, envOnly.tools.ffmpeg.source], [b, 'env']);
  const pathOnly = loadConfig({ cwd: tmpDir(), env: { PATH: pathDir } });
  assert.deepEqual([pathOnly.tools.ffmpeg.path, pathOnly.tools.ffmpeg.source], [c, 'path']);
  const none = loadConfig({ cwd: tmpDir(), env: { PATH: '' } });
  assert.equal(none.tools.ffmpeg.ok, false);
  assert.equal(toolPath(none, 'ffmpeg'), null);
});

test('a file without the execute bit, and a directory, are not accepted as the binary', { skip: posixOnly }, () => {
  const dir = path.join(tmpDir(), 'noexec');
  const p = fakeBin(dir, 'ffmpeg'); fs.chmodSync(p, 0o644);
  assert.match(resolveTool('ffmpeg', { explicit: p, env: {}, platform: 'linux' }).tried[0].reason, /not executable/);
  const viaDir = resolveTool('ffmpeg', { explicit: dir, env: {}, platform: 'linux' });
  assert.equal(viaDir.ok, false);
  fs.chmodSync(p, 0o755);
  assert.equal(resolveTool('ffmpeg', { explicit: dir, env: {}, platform: 'linux' }).path, p, 'a folder containing the binary is accepted once it is executable');
});

test('spawned with shell:false: metacharacters in arguments and in the path are inert', { skip: posixOnly }, async () => {
  const marker = path.join(tmpDir(), 'PWNED');
  const exe = fakeBin(path.join(tmpDir(), `semi;colon & $(touch ${marker}) dir`), 'ffmpeg', 'for a in "$@"; do echo "ARG:$a"; done');
  const cfg = loadConfig({ cwd: tmpDir(), env: { XOXO_FFMPEG: exe, PATH: '' } });
  const evil = `x y; touch ${marker}; $(touch ${marker}) \`touch ${marker}\``;
  const r = await runTool(cfg, 'ffmpeg', ['-i', evil]);
  assert.equal(r.code, 0, r.error);
  assert.ok(r.stdout.includes(`ARG:${evil}`), 'argument arrived as ONE untouched string');
  assert.equal(fs.existsSync(marker), false, 'nothing was executed by a shell');
});

test('unresolved tool: runTool does not spawn and returns the full explanation', async () => {
  const cfg = loadConfig({ cwd: tmpDir(), env: { PATH: '' } });
  const r = await runTool(cfg, 'ffmpeg', ['-version']);
  assert.equal(r.code, -1);
  assert.match(r.error, /ffmpeg not found \(PATH: not found in 0 PATH directories\)/);
  assert.match((await runTool(cfg, 'nonsense', [])).error, /unknown managed tool/);
});

// ------------------------------------------------------------------------------------------------
// Every subsystem must use the resolved binary (proved with logging wrappers, PATH has no ffmpeg at all)
// ------------------------------------------------------------------------------------------------
function whichReal(name) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  return r.stdout.split(/\r?\n/)[0].trim();
}

function wrappers() {
  const dir = path.join(tmpDir(), 'Wrapped FF (spaces)', 'bin');
  const log = path.join(tmpDir(), 'calls.log');
  const mk = (name) => fakeBin(dir, name, `echo "${name} $*" >> '${log}'\nexec '${whichReal(name)}' "$@"`);
  return { ffmpeg: mk('ffmpeg'), ffprobe: mk('ffprobe'), log, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) };
}

test('asset probing, thumbnails, narration, SFX synth, verification and frame extraction all use the resolved binaries', { skip: posixOnly || !hasFfmpeg }, async () => {
  const w = wrappers();
  const cfg = testConfig({});
  const wcfg = loadConfig({ cwd: cfg.root, env: { PATH: '/nonexistent', XOXO_FFMPEG: w.ffmpeg, XOXO_FFPROBE: w.ffprobe } });
  assert.equal(wcfg.tools.ffmpeg.path, w.ffmpeg);
  const media = makeAssetFolder(tmpDir());

  const manifest = await scanAssets(wcfg, media);                       // ffprobe (asset probing)
  assert.ok(manifest.assets.find((a) => a.id === 'IMG_J20_FRONT').meta.probe === 'ffprobe');
  assert.equal((await makeThumbnails(wcfg, manifest, path.join(wcfg.workspace, 't'))).length, 4); // ffmpeg
  const n = await analyzeNarration(wcfg, { audio: path.join(media, 'narration.wav') });             // ffmpeg silencedetect
  assert.ok(n.duration > 8);
  await synthesizeSfx(wcfg, 'whoosh', path.join(wcfg.workspace, 'sfx'));                            // ffmpeg synth
  const video = makeVideo(path.join(tmpDir(), 'v.mp4'), { dur: 2 });
  const v = await verifyRender(wcfg, video, { width: 640, height: 360, fps: 24, duration: 2, audio: true }); // ffprobe + blackdetect
  assert.equal(v.passed, true, JSON.stringify(v.checks));
  assert.equal((await extractFrames(wcfg, video, [0.5], path.join(wcfg.workspace, 'f'))).length, 1);     // ffmpeg

  const calls = w.calls();
  const has = (tool, re) => calls.some((c) => c.startsWith(tool + ' ') && re.test(c));
  assert.ok(has('ffprobe', /-show_streams/), 'probe + verify went through the resolved ffprobe');
  assert.ok(has('ffmpeg', /silencedetect/), 'narration analysis');
  assert.ok(has('ffmpeg', /anoisesrc/), 'SFX synthesis');
  assert.ok(has('ffmpeg', /blackdetect/), 'render verification');
  assert.ok(has('ffmpeg', /-frames:v 1/), 'thumbnails / frame extraction');
});

test('full pipeline incl. render/transcode with only env-configured binaries (PATH has no ffmpeg)', { skip: posixOnly || NO_FAKE_EXE || !hasFfmpeg }, async () => {
  const w = wrappers();
  const root = tmpDir('xoxo-tools-');
  const assets = makeAssetFolder(path.join(root, 'assets'));
  fs.writeFileSync(path.join(assets, 'script.txt'), 'A short narration. It has a second sentence.');
  const fakeAerender = path.join(ROOT, 'tests', 'helpers', 'fake-aerender.mjs');
  process.env.FAKE_AERENDER_MAXW = '1280';
  const ctx = createContext({ cwd: root, env: { PATH: '/nonexistent', XOXO_FFMPEG: w.ffmpeg, XOXO_FFPROBE: w.ffprobe }, overrides: { transport: 'mock', aerenderPath: fakeAerender }, mockAE: createMockAE() });
  const must = (r) => { assert.equal(r.success, true, `${r.operation}: ${r.error}`); return r.data; };
  must(await newProject(ctx, 't', { assets }));
  must(await scanProject(ctx, 't'));
  must(await analyzeProjectNarration(ctx, 't', { script: path.join(assets, 'script.txt') }));
  must(await scaffoldProjectPlan(ctx, 't', { title: 'T', brief: 'tech', resolution: '720p' }));
  must(await editProject(ctx, 't'));
  const r = await renderProjectCmd(ctx, 't', {});
  assert.equal(r.success, true, r.error + JSON.stringify(r.data?.verification));
  assert.match(r.data.strategy, /aerender\+ffmpeg/);
  assert.ok(w.calls().some((c) => c.startsWith('ffmpeg ') && /libx264/.test(c)), 'the H.264 transcode ran through the resolved ffmpeg');
  assert.ok(w.calls().some((c) => c.startsWith('ffprobe ') && /-show_format/.test(c)), 'output verification used the resolved ffprobe');
});

test('doctor reports the actual resolved paths; CLI doctor and selftest work with env-only binaries', { skip: posixOnly || !hasFfmpeg }, async () => {
  const w = wrappers();
  const env = { PATH: '/nonexistent', XOXO_FFMPEG: w.ffmpeg, XOXO_FFPROBE: w.ffprobe };
  const ctx = createContext({ cwd: tmpDir(), env, overrides: { transport: 'mock' } });
  const d = (await doctor(ctx)).data.checks;
  const ff = d.find((c) => c.name === 'FFmpeg'); const fp = d.find((c) => c.name === 'FFprobe');
  assert.equal(ff.status, 'ok'); assert.equal(fp.status, 'ok');
  assert.ok(ff.detail.startsWith(w.ffmpeg), ff.detail);
  assert.ok(fp.detail.startsWith(w.ffprobe), fp.detail);
  assert.match(ff.detail, /XOXO_FFMPEG/);

  const cliEnv = { ...process.env, ...env, XOXO_ROOT: tmpDir(), XOXO_TRANSPORT: 'auto' };
  const out = spawnSync(process.execPath, [BIN, 'doctor', '--json'], { encoding: 'utf8', env: cliEnv });
  const j = JSON.parse(out.stdout).data.checks;
  assert.equal(j.find((c) => c.name === 'FFmpeg').status, 'ok');
  assert.ok(j.find((c) => c.name === 'FFmpeg').detail.startsWith(w.ffmpeg));
  const st = spawnSync(process.execPath, [BIN, 'selftest', '--dry-run'], { encoding: 'utf8', env: cliEnv });
  assert.equal(st.status, 0, st.stdout + st.stderr);
  assert.ok(w.calls().some((c) => c.startsWith('ffmpeg ') && /testsrc2/.test(c)), 'selftest generated its media with the resolved ffmpeg');
});

test('doctor with nothing configured says exactly what was tried and how to fix it', { skip: posixOnly }, async () => {
  const ctx = createContext({ cwd: tmpDir(), env: { PATH: '' }, overrides: { transport: 'mock' } });
  const d = (await doctor(ctx)).data.checks.find((c) => c.name === 'FFmpeg');
  assert.equal(d.status, 'warn');
  assert.match(d.detail, /ffmpeg not found \(PATH: not found in 0 PATH directories\)/);
  assert.match(d.fix, /XOXO_FFMPEG/);
  assert.match(d.fix, /xoxo config set ffmpeg/);
});

test('the capability cache is invalidated when the resolved ffmpeg changes', { skip: posixOnly || !hasFfmpeg }, async () => {
  const root = tmpDir();
  const none = createContext({ cwd: root, env: { PATH: '' }, overrides: { transport: 'mock' } });
  const c1 = await getCapabilities(none, { refresh: true });
  assert.equal(c1.ffmpeg, false);
  const w = wrappers();
  const fixed = createContext({ cwd: root, env: { PATH: '', XOXO_FFMPEG: w.ffmpeg, XOXO_FFPROBE: w.ffprobe }, overrides: { transport: 'mock' } });
  const c2 = await getCapabilities(fixed); // not refresh:true -> must still notice the change
  assert.equal(c2.ffmpeg, true);
  assert.equal(c2.tools.ffmpeg.path, w.ffmpeg);
});

test('xoxo config set validates, persists (spaces ok) and config then wins over env; unset reverts', { skip: posixOnly }, async () => {
  const root = tmpDir();
  const good = fakeBin(path.join(tmpDir(), 'Some Dir (1)'), 'ffmpeg');
  const envBin = fakeBin(path.join(tmpDir(), 'env dir'), 'ffmpeg');
  const ctx = createContext({ cwd: root, env: { PATH: '', XOXO_FFMPEG: envBin }, overrides: { transport: 'mock' } });
  const bad = await configSet(ctx, 'ffmpeg', path.join(root, 'nope', 'ffmpeg'));
  assert.equal(bad.success, false);
  assert.match(bad.error, /does not exist/);
  assert.equal(fs.existsSync(path.join(root, 'xoxo.config.json')), false, 'a bad value is never saved');
  assert.equal((await configSet(ctx, 'bogus', 'x')).success, false);
  const ok = await configSet(ctx, 'ffmpeg', `"${good}"`);
  assert.equal(ok.success, true, ok.error);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'xoxo.config.json'), 'utf8')).ffmpeg, good);
  const reloaded = loadConfig({ cwd: root, env: { PATH: '', XOXO_FFMPEG: envBin } });
  assert.deepEqual([reloaded.tools.ffmpeg.path, reloaded.tools.ffmpeg.source], [good, 'config']);
  assert.equal((await configUnset(ctx, 'ffmpeg')).data.removed, true);
  assert.equal(loadConfig({ cwd: root, env: { PATH: '', XOXO_FFMPEG: envBin } }).tools.ffmpeg.source, 'env');
});

// ------------------------------------------------------------------------------------------------
// Repository-wide guards
// ------------------------------------------------------------------------------------------------
function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out); else if (/\.(js|mjs|jsx|md|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('no code path bypasses the shared resolver (no config.ffmpeg/ffprobe/whisper, no literal binary names passed to run/spawn)', () => {
  const offenders = [];
  for (const f of sourceFiles(path.join(ROOT, 'src')).concat(sourceFiles(path.join(ROOT, 'bin')), sourceFiles(path.join(ROOT, 'scripts')))) {
    if (f.endsWith(path.join('core', 'resolve-tool.js')) || f.endsWith(path.join('core', 'config.js'))) continue;
    const src = fs.readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\bconfig\.(ffmpeg|ffprobe|whisper)\b/.test(line)) offenders.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
      if (/\b(run|spawn|spawnSync|execFile|execFileSync)\(\s*['"`](ffmpeg|ffprobe|whisper)/.test(line)) offenders.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
      if (/shell:\s*true/.test(line) || /import\s*\{[^}]*\bexec(Sync)?\b[^}]*\}\s*from\s*'node:child_process'/.test(line)) offenders.push(`${path.relative(ROOT, f)}:${i + 1}: shell use: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('no personal paths or user names are hard-coded anywhere in the repository', () => {
  const needles = [['bis', 'wa'].join('')]; // the maintainer's user name; built from parts so this file doesn't match itself
  const offenders = [];
  for (const f of sourceFiles(ROOT)) {
    if (f.includes(`${path.sep}.git${path.sep}`)) continue;
    const src = fs.readFileSync(f, 'utf8').toLowerCase();
    for (const n of needles) if (src.includes(n.toLowerCase())) offenders.push(`${path.relative(ROOT, f)} contains "${n}"`);
  }
  assert.deepEqual(offenders, []);
});
