import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Filesystem/identifier-safe slug. Assets and user files are untrusted: never use raw names in paths. */
export function slug(s, fallback = 'untitled') {
  const out = String(s ?? '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 80);
  return out || fallback;
}

/** AE layer/item-safe uppercase identifier, e.g. "j20 front.jpg" -> "J20_FRONT". */
export function ident(s, fallback = 'ITEM') {
  const base = String(s ?? '').replace(/\.[^.]+$/, '');
  const out = slug(base, fallback).toUpperCase().replace(/[.-]+/g, '_');
  return out || fallback;
}

export function projectPaths(config, name) {
  const root = path.join(config.projectsDir, slug(name, 'project'));
  return {
    root,
    plan: path.join(root, 'plan.json'),
    manifest: path.join(root, 'assets.manifest.json'),
    narration: path.join(root, 'narration.json'),
    aep: path.join(root, `${slug(name, 'project')}.aep`),
    versions: path.join(root, 'versions'),
    qa: path.join(root, 'QA_REPORT.json'),
    buildReport: path.join(root, 'build-report.json'),
    renders: path.join(root, 'renders'),
    logs: path.join(root, 'logs'),
    generated: path.join(root, 'generated'),
    state: path.join(root, 'state.json'),
  };
}

export function readJson(file, fallback = undefined) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (fallback !== undefined) return fallback; throw e; }
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/** Convert a path to forward-slash form for embedding in ExtendScript. */
export const toAePath = (p) => path.resolve(p).replace(/\\/g, '/');
