import fs from 'node:fs';
import path from 'node:path';

// Discovery only — nothing here assumes a username, drive letter, or Adobe version.
// `fsx` and `platform` are injectable so discovery is unit-testable on any OS.

const exists = (fsx, p) => { try { fsx.accessSync(p); return true; } catch { return false; } };
const listDir = (fsx, p) => { try { return fsx.readdirSync(p); } catch { return []; } };

/** "Adobe After Effects 2025" -> { label:'2025', sortKey:2025, beta:false } */
export function parseAeVersionLabel(dirName) {
  const m = /Adobe After Effects\s*(.*)$/i.exec(dirName);
  const label = (m ? m[1] : dirName).trim();
  const beta = /beta/i.test(label);
  const year = /(20\d\d)/.exec(label);
  const cc = /CC\s*(\d{4})?/i.exec(label);
  let sortKey = 0;
  if (year) sortKey = Number(year[1]);
  else if (cc) sortKey = cc[1] ? Number(cc[1]) : 2014; // "CC" alone predates 2014.5
  return { label: label || 'unknown', sortKey, beta };
}

export function adobeRoots({ platform = process.platform, env = process.env, extra = [] } = {}) {
  const roots = [...extra];
  if (platform === 'win32') {
    for (const k of ['ProgramFiles', 'ProgramW6432', 'ProgramFiles(x86)']) {
      if (env[k]) roots.push(path.join(env[k], 'Adobe'));
    }
    if (!roots.length) roots.push('C:\\Program Files\\Adobe');
    // other drives: Adobe lets users install elsewhere
    for (const letter of 'DEFG') roots.push(`${letter}:\\Program Files\\Adobe`, `${letter}:\\Adobe`);
  } else if (platform === 'darwin') {
    roots.push('/Applications');
  }
  return [...new Set(roots)];
}

function describeInstall(fsx, platform, root, dirName) {
  const base = path.join(root, dirName);
  const ver = parseAeVersionLabel(dirName);
  let afterfx; let aerender; let support;
  if (platform === 'win32') {
    support = path.join(base, 'Support Files');
    afterfx = path.join(support, 'AfterFX.exe');
    aerender = path.join(support, 'aerender.exe');
  } else {
    // macOS: /Applications/Adobe After Effects 2025/{Adobe After Effects 2025.app, aerender, Scripts, Plug-ins}
    support = base;
    afterfx = path.join(base, `${dirName}.app`);
    aerender = path.join(base, 'aerender');
  }
  if (!exists(fsx, afterfx) && !exists(fsx, aerender)) return null;
  const scriptsDir = path.join(support, 'Scripts');
  return {
    name: dirName,
    version: ver.label,
    sortKey: ver.sortKey,
    beta: ver.beta,
    root: base,
    supportFiles: support,
    afterfx: exists(fsx, afterfx) ? afterfx : null,
    aerender: exists(fsx, aerender) ? aerender : null,
    pluginsDir: exists(fsx, path.join(support, 'Plug-ins')) ? path.join(support, 'Plug-ins') : null,
    scriptsDir: exists(fsx, scriptsDir) ? scriptsDir : null,
    startupDir: exists(fsx, path.join(scriptsDir, 'Startup')) ? path.join(scriptsDir, 'Startup') : null,
    scriptUiPanelsDir: exists(fsx, path.join(scriptsDir, 'ScriptUI Panels')) ? path.join(scriptsDir, 'ScriptUI Panels') : null,
  };
}

/**
 * Find every After Effects install. `explicit` (config/env) may be an AfterFX binary or an install root.
 * Result is sorted newest-first, stable releases before betas.
 */
export function findAfterEffects({ platform = process.platform, env = process.env, fsx = fs, extraRoots = [], explicit = null } = {}) {
  const installs = [];
  const seen = new Set();
  const add = (i) => { if (i && !seen.has(i.root)) { seen.add(i.root); installs.push(i); } };

  if (explicit) {
    // Walk up from the given path until a directory named "Adobe After Effects*" is found.
    let cur = path.resolve(explicit);
    for (let i = 0; i < 4; i++) {
      const name = path.basename(cur);
      if (/^Adobe After Effects/i.test(name) && !/\.app$/i.test(name)) {
        add(describeInstall(fsx, platform, path.dirname(cur), name));
        break;
      }
      cur = path.dirname(cur);
    }
    if (!installs.length && exists(fsx, explicit)) {
      // Unconventional layout: trust the path as the binary.
      installs.push({
        name: 'explicit', version: 'unknown', sortKey: 0, beta: false, root: path.dirname(explicit), supportFiles: path.dirname(explicit),
        afterfx: explicit, aerender: null, pluginsDir: null, scriptsDir: null, startupDir: null, scriptUiPanelsDir: null,
      });
    }
  }

  for (const root of adobeRoots({ platform, env, extra: extraRoots })) {
    for (const d of listDir(fsx, root)) {
      if (/^Adobe After Effects/i.test(d) && !/\.app$/i.test(d)) add(describeInstall(fsx, platform, root, d));
    }
  }
  installs.sort((a, b) => (a.beta - b.beta) || (b.sortKey - a.sortKey));
  return installs;
}

export function findMediaEncoder({ platform = process.platform, env = process.env, fsx = fs, extraRoots = [] } = {}) {
  const found = [];
  for (const root of adobeRoots({ platform, env, extra: extraRoots })) {
    for (const d of listDir(fsx, root)) {
      if (!/^Adobe Media Encoder/i.test(d)) continue;
      const exe = platform === 'win32'
        ? path.join(root, d, 'Adobe Media Encoder.exe')
        : path.join(root, d, `${d}.app`);
      if (exists(fsx, exe)) found.push({ name: d, exe, sortKey: Number((/(20\d\d)/.exec(d) || [0, 0])[1]) });
    }
  }
  found.sort((a, b) => b.sortKey - a.sortKey);
  return found;
}

/** Plugins (.aex) and animation presets (.ffx) actually present on disk. */
export function scanPlugins(install, fsx = fs, limit = 5000) {
  const out = { aex: [], ffx: [] };
  if (!install) return out;
  const walk = (dir, depth, collect) => {
    if (depth > 4 || out.aex.length + out.ffx.length > limit) return;
    for (const name of listDir(fsx, dir)) {
      const full = path.join(dir, name);
      let st; try { st = fsx.statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, depth + 1, collect);
      else collect(name, full);
    }
  };
  if (install.pluginsDir) walk(install.pluginsDir, 0, (n) => { if (/\.aex$/i.test(n)) out.aex.push(n.replace(/\.aex$/i, '')); });
  const presets = install.supportFiles ? path.join(install.supportFiles, 'Presets') : null;
  const presets2 = install.root ? path.join(install.root, 'Presets') : null;
  for (const p of [presets, presets2]) {
    if (p && exists(fsx, p)) walk(p, 0, (n, full) => { if (/\.ffx$/i.test(n)) out.ffx.push(path.relative(p, full).replace(/\\/g, '/')); });
  }
  out.aex.sort(); out.ffx.sort();
  return out;
}
