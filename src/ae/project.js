import fs from 'node:fs';
import path from 'node:path';
import { toAePath, ensureDir } from '../core/paths.js';

/** Open the project's .aep if it exists, otherwise create and save a fresh one. Idempotent. */
export async function openOrCreateProject(bridge, aepPath, { discard = false } = {}) {
  const ping = await bridge.ping();
  if (!ping.success) return { success: false, operation: 'open_project', error: ping.error, recoverable: true, code: ping.code };
  ensureDir(path.dirname(aepPath));
  const target = toAePath(aepPath);
  if (fs.existsSync(aepPath)) {
    const r = await bridge.call('project_open', { path: target, discard });
    if (!r.success) return { ...r, operation: 'open_project' };
    return { success: true, operation: 'open_project', data: { created: false, ae: ping.data, ...r.data } };
  }
  const n = await bridge.call('project_new', { discard });
  if (!n.success) return { ...n, operation: 'open_project' };
  const s = await bridge.call('project_save', { path: target });
  if (!s.success) return { ...s, operation: 'open_project' };
  return { success: true, operation: 'open_project', data: { created: true, ae: ping.data, file: s.data.file } };
}

export async function saveProject(bridge, aepPath) {
  const r = await bridge.call('project_save', { path: toAePath(aepPath) });
  return { ...r, operation: 'save_project' };
}

/**
 * Save and keep a numbered copy in versions/ (After Effects has no scripted "Save a Copy", but a saved
 * .aep is a single file, so copying it is a safe checkpoint).
 */
export async function checkpoint(bridge, paths, label = 'checkpoint') {
  const s = await saveProject(bridge, paths.aep);
  if (!s.success) return s;
  ensureDir(paths.versions);
  const existing = fs.readdirSync(paths.versions).filter((f) => /_v\d{3}/.test(f)).length;
  const n = String(existing + 1).padStart(3, '0');
  const safe = label.replace(/[^\w-]+/g, '_');
  const dest = path.join(paths.versions, `${path.basename(paths.aep, '.aep')}_v${n}_${safe}.aep`);
  try { fs.copyFileSync(paths.aep, dest); } catch (e) { return { success: false, operation: 'checkpoint', error: e.message, recoverable: true }; }
  return { success: true, operation: 'checkpoint', data: { file: dest, version: Number(n) } };
}
