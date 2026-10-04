import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from './paths.js';

// Transparency: everything XOXOEDITZ writes OUTSIDE its own folders (e.g. an After Effects startup script) is
// recorded here so it can be listed and removed. Nothing is ever downloaded or installed automatically.

const file = (config) => path.join(config.workspace, 'install-manifest.json');

export function readInstallManifest(config) {
  try { return JSON.parse(fs.readFileSync(file(config), 'utf8')); } catch { return { version: 1, entries: [] }; }
}

export function recordInstall(config, entry) {
  const m = readInstallManifest(config);
  m.entries = m.entries.filter((e) => e.file !== entry.file);
  m.entries.push({ ...entry, at: new Date().toISOString() });
  ensureDir(config.workspace);
  fs.writeFileSync(file(config), JSON.stringify(m, null, 2) + '\n');
}

export function uninstallAll(config) {
  const m = readInstallManifest(config);
  const removed = []; const failed = [];
  for (const e of m.entries) {
    try { fs.unlinkSync(e.file); removed.push(e.file); } catch (err) { if (err.code === 'ENOENT') removed.push(e.file); else failed.push({ file: e.file, error: err.code || err.message }); }
  }
  m.entries = m.entries.filter((e) => failed.some((f) => f.file === e.file));
  ensureDir(config.workspace);
  fs.writeFileSync(file(config), JSON.stringify(m, null, 2) + '\n');
  return { removed, failed };
}
