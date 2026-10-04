// LOCAL MEMORY (optional, on by default, never leaves the machine). It remembers two kinds of things:
//   - explicit taste: `xoxo memory like|dislike <asset-or-sound id>` nudges future choices
//   - recent use: sounds and clips used in the last few productions are slightly avoided, so consecutive videos
//     do not all open with the same whoosh
// Only ids, ratings, counts and run summaries are stored - never file paths or media. Turn it off with
// "memory": false in edit.config.json, XOXO_MEMORY=0, or `xoxo memory reset`.

import fs from 'node:fs';
import { readJson, writeJson, ensureDir } from '../core/paths.js';
import path from 'node:path';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const EMPTY = () => ({ version: 1, updatedAt: null, ratings: {}, usage: {}, runs: [] });
const KEEP_RUNS = 40;
const RECENT_RUNS = 3;

export const memoryEnabled = (config, editConfig = {}, env = process.env) => editConfig.memory !== false && config.memory !== false && !['0', 'false', 'off'].includes(String(env.XOXO_MEMORY ?? '').toLowerCase());

export function loadMemory(config) {
  const m = readJson(config.memoryFile, null);
  return m && m.version === 1 ? { ...EMPTY(), ...m } : EMPTY();
}
export function saveMemory(config, memory) {
  ensureDir(path.dirname(config.memoryFile));
  writeJson(config.memoryFile, { ...memory, updatedAt: new Date().toISOString() });
}
export function resetMemory(config) { try { fs.rmSync(config.memoryFile, { force: true }); return true; } catch { return false; } }

/** Per-id bias in [-1, 1]: explicit rating minus a recency penalty for what recent productions already used. */
export function memoryBias(memory) {
  const bias = {};
  const recent = memory.runs.slice(-RECENT_RUNS);
  const used = {};
  for (const r of recent) for (const id of new Set([...(r.sfx || []), ...(r.assets || [])])) used[id] = (used[id] || 0) + 1;
  for (const [id, v] of Object.entries(memory.ratings)) bias[id] = clamp(v, -1, 1);
  for (const [id, n] of Object.entries(used)) bias[id] = clamp((bias[id] ?? 0) - 0.25 * n, -1, 1);
  const split = { assets: {}, sfx: {} };
  for (const [id, v] of Object.entries(bias)) (id.startsWith('LIB_') ? split.sfx : split.assets)[id] = v;
  return split;
}

export function rate(memory, ids, value) {
  for (const id of ids) memory.ratings[id] = clamp(0.5 * (memory.ratings[id] ?? 0) + 0.5 * value + 0.25 * Math.sign(value), -1, 1);
  return memory;
}

export function recordRun(memory, { project, type, seed, score, plan }) {
  const assets = [...new Set(plan.timeline.shots.flatMap((s) => s.layers.filter((l) => l.kind === 'footage').map((l) => l.asset)))];
  const sfx = [...new Set(plan.audio.sfxEvents.map((e) => e.assetId))];
  for (const id of [...assets, ...sfx]) memory.usage[id] = (memory.usage[id] || 0) + 1;
  memory.runs.push({ at: new Date().toISOString(), project, type, seed, score, templates: [...new Set(plan.timeline.shots.map((s) => s.template))], assets, sfx });
  memory.runs = memory.runs.slice(-KEEP_RUNS);
  return memory;
}
