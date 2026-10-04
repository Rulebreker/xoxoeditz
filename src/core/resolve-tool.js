// ONE resolver for every external tool XOXOEDITZ launches (ffmpeg, ffprobe, whisper).
//
//   precedence:  explicit config  ->  XOXO_* environment variable  ->  PATH lookup  ->  failure
//
// A candidate only counts if it is a real file that can be executed directly (spawned with shell:false).
// Every source that was tried, and why it was rejected, is kept in `tried` so failures are diagnosable.
// Nothing here hard-codes a location; `platform`, `env`, `cwd` and `fsx` are injectable so Windows behaviour is
// unit-testable on any OS.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './exec.js';

export const TOOL_SPECS = {
  ffmpeg: { envVar: 'XOXO_FFMPEG', configKey: 'ffmpeg' },
  ffprobe: { envVar: 'XOXO_FFPROBE', configKey: 'ffprobe' },
  whisper: { envVar: 'XOXO_WHISPER', configKey: 'whisper' },
};

// With shell:false only real executables can be started. .cmd/.bat need a shell, which we never use.
const WIN_EXEC_EXT = ['.exe', '.com'];
const WIN_SHELL_EXT = ['.cmd', '.bat'];

const envGet = (env, key) => {
  if (env[key] !== undefined) return env[key];
  const k = Object.keys(env).find((x) => x.toLowerCase() === key.toLowerCase()); // Windows env names are case-insensitive
  return k === undefined ? undefined : env[k];
};

/**
 * Clean a user-supplied path: trim, strip one pair of surrounding quotes (cmd's `set X="C:\a b\x.exe"` keeps them),
 * expand ~ and %VAR% (Windows), and normalise separators for the target platform. Returns null for empty input.
 */
export function normalizeToolPath(raw, { platform = process.platform, env = process.env, cwd = process.cwd() } = {}) {
  if (raw === undefined || raw === null) return null;
  let v = String(raw).trim();
  const q = /^(["'])(.*)\1$/.exec(v);
  if (q) v = q[2].trim();
  if (!v) return null;
  const P = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') v = v.replace(/%([^%]+)%/g, (m, name) => envGet(env, name) ?? m);
  if (v === '~' || v.startsWith('~/') || v.startsWith('~\\')) {
    const home = envGet(env, 'HOME') || envGet(env, 'USERPROFILE') || os.homedir();
    v = P.join(home, v.slice(1));
  }
  // bare command names ("ffmpeg") are PATH lookups; anything with a separator is a path
  const isBare = !/[\\/]/.test(v);
  if (isBare) return v;
  v = P.normalize(v); // "C:/a/b\c" -> "C:\a\b\c" on win32; collapses ".." safely
  if (!P.isAbsolute(v)) v = P.resolve(cwd, v);
  const root = P.parse(v).root;
  while (v.length > root.length && /[\\/]$/.test(v)) v = v.slice(0, -1); // pasted folder paths often end in a separator
  return v;
}

function statOf(fsx, p) { try { return fsx.statSync(p); } catch { return null; } }

/** Check one concrete file path. Returns {ok, path} or {ok:false, reason}. */
function checkFile(p, { platform, fsx, P }) {
  const st = statOf(fsx, p);
  if (!st) return { ok: false, reason: 'does not exist' };
  if (!st.isFile()) return { ok: false, reason: 'is not a file' };
  if (platform === 'win32') {
    const ext = P.extname(p).toLowerCase();
    if (WIN_SHELL_EXT.includes(ext)) return { ok: false, reason: `${ext} scripts cannot be started without a shell; point at the real .exe` };
    if (!WIN_EXEC_EXT.includes(ext)) return { ok: false, reason: `not an executable (${ext || 'no extension'})` };
    return { ok: true, path: p };
  }
  try { fsx.accessSync(p, fsx.constants.X_OK); } catch { return { ok: false, reason: 'is not executable (missing execute permission)' }; }
  return { ok: true, path: p };
}

/** Try `base` as given, then (Windows) with executable extensions appended. */
function checkWithExtensions(base, ctx) {
  const first = checkFile(base, ctx);
  if (first.ok || ctx.platform !== 'win32' || WIN_EXEC_EXT.includes(ctx.P.extname(base).toLowerCase())) return first;
  for (const ext of WIN_EXEC_EXT) { const r = checkFile(base + ext, ctx); if (r.ok) return r; }
  for (const ext of WIN_SHELL_EXT) { if (statOf(ctx.fsx, base + ext)) return { ok: false, reason: `only ${ctx.P.basename(base)}${ext} exists, which needs a shell; point at the real .exe` }; }
  return first;
}

function lookupOnPath(name, ctx, env) {
  const pathVar = envGet(env, 'PATH') ?? '';
  const dirs = pathVar.split(ctx.P.delimiter).map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
  const names = ctx.platform === 'win32' && !ctx.P.extname(name) ? WIN_EXEC_EXT.map((e) => name + e) : [name];
  for (const d of dirs) for (const n of names) { const r = checkFile(ctx.P.join(d, n), ctx); if (r.ok) return r; }
  return { ok: false, reason: `not found in ${dirs.length} PATH director${dirs.length === 1 ? 'y' : 'ies'}` };
}

/** Resolve one candidate string (a path, a directory containing the tool, or a bare command name). */
function resolveCandidate(name, raw, ctx, env) {
  const value = normalizeToolPath(raw, { platform: ctx.platform, env, cwd: ctx.cwd });
  if (value === null) return { ok: false, reason: 'empty value', value: String(raw) };
  if (!/[\\/]/.test(value)) { const r = lookupOnPath(value, ctx, env); return { ...r, value }; } // bare name
  const st = statOf(ctx.fsx, value);
  if (st?.isDirectory()) { // user pointed at the folder (e.g. ...\bin)
    for (const sub of [value, ctx.P.join(value, 'bin')]) {
      const r = checkWithExtensions(ctx.P.join(sub, name), ctx);
      if (r.ok) return { ...r, value };
    }
    return { ok: false, reason: `directory contains no ${name} executable`, value };
  }
  return { ...checkWithExtensions(value, ctx), value };
}

/**
 * @returns {{ name, ok, path|null, source: 'config'|'env'|'path'|null, tried: {source,value,ok,reason?}[], warnings: string[], error?: string }}
 */
export function resolveTool(name, { explicit = null, envVar = null, env = process.env, platform = process.platform, cwd = process.cwd(), fsx = fs } = {}) {
  const ctx = { platform, fsx, cwd, P: platform === 'win32' ? path.win32 : path.posix };
  const tried = []; const warnings = [];
  const sources = [];
  if (explicit !== null && explicit !== undefined && String(explicit).trim() !== '') sources.push(['config', explicit, 'xoxo.config.json / overrides']);
  const envValue = envVar ? envGet(env, envVar) : undefined;
  if (envValue !== undefined && String(envValue).trim() !== '') sources.push(['env', envValue, envVar]);

  for (const [source, raw, label] of sources) {
    const r = resolveCandidate(name, raw, ctx, env);
    tried.push({ source, label, value: r.value ?? String(raw), ok: r.ok, ...(r.ok ? {} : { reason: r.reason }) });
    if (r.ok) {
      if (tried.length > 1) warnings.push(`${tried.filter((t) => !t.ok).map((t) => `${t.label} "${t.value}" ${t.reason}`).join('; ')} -- using ${source} instead`);
      return { name, ok: true, path: r.path, source, tried, warnings };
    }
  }
  // PATH lookup under the tool's own name
  const onPath = lookupOnPath(name, ctx, env);
  tried.push({ source: 'path', label: 'PATH', value: name, ok: onPath.ok, ...(onPath.ok ? {} : { reason: onPath.reason }) });
  if (onPath.ok) {
    if (tried.length > 1) warnings.push(`${tried.filter((t) => !t.ok).map((t) => `${t.label} "${t.value}" ${t.reason}`).join('; ')} -- using PATH instead`);
    return { name, ok: true, path: onPath.path, source: 'path', tried, warnings };
  }
  return { name, ok: false, path: null, source: null, tried, warnings, error: describeFailure({ name, tried }) };
}

/** What was tried and why each source was rejected (no remediation text). */
export function describeTried({ name, tried }) {
  return `${name} not found (${tried.map((t) => `${t.label}${t.source === 'path' ? '' : ` = "${t.value}"`}: ${t.reason}`).join('; ')})`;
}

export function describeFailure({ name, tried }) {
  const spec = TOOL_SPECS[name];
  const how = spec ? ` Fix: put ${name} on PATH, set ${spec.envVar}="<full path to ${name}${process.platform === 'win32' ? '.exe' : ''}>", or run: xoxo config set ${spec.configKey} "<full path>".` : '';
  return `${describeTried({ name, tried })}.${how}`;
}

/** Resolve every managed tool for a loaded config. Called once by loadConfig. */
export function resolveAllTools(config, env, opts = {}) {
  const out = {};
  for (const [name, spec] of Object.entries(TOOL_SPECS)) {
    out[name] = resolveTool(name, { explicit: config[spec.configKey], envVar: spec.envVar, env, cwd: config.root, ...opts });
  }
  return out;
}

// ---- the accessors every subsystem must use ----

/** Resolved absolute path of a managed tool, or null. */
export function toolPath(config, name) {
  return config.tools?.[name]?.path ?? null;
}

/**
 * Run a managed tool through the single resolver. Never throws; an unresolved tool yields a failed result
 * carrying the full "what was tried" explanation instead of a bare ENOENT. Always spawned with shell:false.
 */
export function runTool(config, name, args = [], opts = {}) {
  const r = config.tools?.[name];
  if (!r) return Promise.resolve({ code: -1, stdout: '', stderr: '', error: `unknown managed tool "${name}"` });
  if (!r.ok) return Promise.resolve({ code: -1, stdout: '', stderr: '', error: r.error });
  return run(r.path, args, { ...opts, trusted: true });
}

export const toolAvailable = (config, name) => Boolean(config.tools?.[name]?.ok);

/** One-line description for logs/doctor: "C:\...\ffmpeg.exe (env XOXO_FFMPEG)". */
export function describeResolved(r) {
  if (!r?.ok) return r?.error || 'not found';
  const via = r.source === 'config' ? 'config' : r.source === 'env' ? 'env' : 'PATH';
  return `${r.path} (${via})`;
}
