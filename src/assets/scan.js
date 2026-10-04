import fs from 'node:fs';
import path from 'node:path';
import { typeOf, inferAudioRole, assetIdPrefix, keywordsFor } from './classify.js';
import { probeFile } from './probe.js';
import { ident, isInside, readJson, writeJson, ensureDir } from '../core/paths.js';
import { runTool } from '../core/resolve-tool.js';

const SKIP_DIRS = new Set(['node_modules', '.git', '.xoxo', '__MACOSX', '$RECYCLE.BIN', 'System Volume Information']);

/** Walk a directory without following symlinks that leave it. Everything found is treated as untrusted data. */
export function walk(root, { maxFiles = 20000, maxDepth = 8 } = {}) {
  const base = fs.realpathSync(root);
  const out = [];
  const visit = (dir, depth) => {
    if (depth > maxDepth || out.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name) || (depth === 0 && /^readme(\.\w+)?$/i.test(e.name))) continue;
      const full = path.join(dir, e.name);
      let real;
      try { real = fs.realpathSync(full); } catch { continue; }
      if (!isInside(base, real)) continue; // symlink escape
      if (e.isDirectory() || (e.isSymbolicLink() && fs.statSync(real).isDirectory())) visit(real, depth + 1);
      else out.push(real);
    }
  };
  visit(base, 0);
  return { base, files: out };
}

function sidecar(file) {
  for (const ext of ['.json', '.txt', '.md']) {
    const p = file.replace(/\.[^.]+$/, '') + ext;
    if (p !== file && fs.existsSync(p) && fs.statSync(p).size < 20000) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        if (ext === '.json') { const j = JSON.parse(raw); return { description: j.description || '', tags: Array.isArray(j.tags) ? j.tags : [] }; }
        return { description: raw.trim().slice(0, 500), tags: [] };
      } catch { /* ignore malformed sidecar */ }
    }
  }
  return null;
}

/**
 * Scan a directory into the asset manifest. Re-running is safe: `override` blocks and descriptions the user
 * (or Claude) added to an existing manifest are preserved per relative path, and ids stay stable.
 */
export async function scanAssets(config, dir, { previous = null, probe = true } = {}) {
  const { base, files } = walk(dir);
  const prev = new Map((previous?.assets || []).map((a) => [a.relPath, a]));
  const usedIds = new Set((previous?.assets || []).map((a) => a.id));
  const assets = [];
  const sidecarSources = new Set();

  for (const file of files) {
    const rel = path.relative(base, file).split(path.sep).join('/');
    const { ext, type } = typeOf(file);
    const st = fs.statSync(file);
    const old = prev.get(rel);
    const a = {
      id: old?.id, relPath: rel, path: file, ext, type, sizeBytes: st.size, mtimeMs: Math.round(st.mtimeMs),
      keywords: keywordsFor(rel), description: old?.description || '', override: old?.override || {},
    };
    const sc = sidecar(file);
    if (sc) { a.description ||= sc.description; a.keywords = [...new Set([...a.keywords, ...sc.tags.map((t) => String(t).toLowerCase())])]; }
    if (probe && ['video', 'image', 'audio'].includes(type)) a.meta = await probeFile(file, type, config);
    else a.meta = {};
    if (type === 'audio') {
      const inferred = inferAudioRole(rel, a.meta.duration);
      a.role = a.override.role || inferred.role;
      a.roleConfidence = a.override.role ? 1 : inferred.confidence;
      a.roleReason = a.override.role ? 'manual override' : inferred.reason;
    }
    if (!a.id) {
      const prefix = assetIdPrefix(type, a.role);
      let stem = ident(path.basename(file));
      stem = stem.replace(new RegExp(`^${prefix}_`), '');
      let id = `${prefix}_${stem}`;
      for (let n = 2; usedIds.has(id); n++) id = `${prefix}_${stem}_${n}`;
      a.id = id;
    }
    usedIds.add(a.id);
    assets.push(a);
  }

  // A lone, unlabelled long audio file is most plausibly the narration; say so (low confidence), don't assume.
  const audio = assets.filter((x) => x.type === 'audio');
  if (audio.length && !audio.some((x) => x.role === 'narration')) {
    const unknown = audio.filter((x) => x.role === 'unknown' && !x.override.role);
    if (unknown.length === 1 && (unknown[0].meta.duration || 0) > 20) {
      unknown[0].role = 'narration'; unknown[0].roleConfidence = 0.35; unknown[0].roleReason = 'only unlabelled long audio file';
      if (unknown[0].id.startsWith('AUD_')) unknown[0].id = unknown[0].id.replace(/^AUD_/, 'NARR_');
    }
  }

  const byType = {};
  for (const a of assets) byType[a.type] = (byType[a.type] || 0) + 1;
  const warnings = [];
  const lowConf = assets.filter((a) => a.type === 'audio' && a.roleConfidence < 0.5).map((a) => a.id);
  if (lowConf.length) warnings.push(`audio role is a guess for: ${lowConf.join(', ')} — confirm or set override.role in the manifest`);
  const noProbe = assets.filter((a) => a.meta?.probe === 'fallback' && a.type !== 'image').map((a) => a.id);
  if (noProbe.length) warnings.push(`metadata unavailable (ffprobe missing or failed) for: ${noProbe.join(', ')}`);

  return { generatedAt: new Date().toISOString(), root: base, counts: byType, warnings, assets };
}

export function saveManifest(file, manifest) { writeJson(file, manifest); return file; }
export function loadManifest(file) { return readJson(file, null); }

export function findAsset(manifest, id) { return manifest.assets.find((a) => a.id === id); }

/** Extract a representative JPEG for Claude (or a human) to look at. */
export async function makeThumbnails(config, manifest, outDir, { width = 640, only = null } = {}) {
  ensureDir(outDir);
  const made = [];
  for (const a of manifest.assets) {
    if (!['video', 'image'].includes(a.type) || (only && !only.includes(a.id))) continue;
    const out = path.join(outDir, `${a.id}.jpg`);
    const args = ['-v', 'error', '-y', '-protocol_whitelist', 'file'];
    if (a.type === 'video') args.push('-ss', String(Math.max(0, (a.meta?.duration || 0) / 3).toFixed(2)));
    args.push('-i', a.path, '-frames:v', '1', '-vf', `scale='min(${width},iw)':-2`, out);
    const r = await runTool(config, 'ffmpeg', args, { timeoutMs: 60000 });
    if (!r.error && r.code === 0 && fs.existsSync(out)) made.push({ id: a.id, file: out });
  }
  return made;
}
