// Services for creative QA, tiers and memory (CLI + MCP call these).
import fs from 'node:fs';
import path from 'node:path';
import * as S from './services.js';
import { attempt } from '../core/result.js';
import { projectPaths, readJson } from '../core/paths.js';
import { critiquePlan, critiqueRender, writeCreativeQa } from '../creative-qa/index.js';
import { probeFile } from '../assets/probe.js';
import { loadLibraryManifest } from '../library/scan.js';
import { loadMemory, saveMemory, resetMemory, rate, memoryEnabled } from '../memory/index.js';

export { promoteProject } from './tiers.js';

/** Critique a project's plan (and, with `file` or --last, its render). Writes CREATIVE_QA.json. */
export function critiqueProject(ctx, name, { file = null, last = false } = {}) {
  return attempt('critique', async () => {
    const n = S.resolveProjectName(ctx, name); const p = projectPaths(ctx.config, n);
    const plan = readJson(p.plan, null); if (!plan) throw new Error('no plan.json yet');
    if (plan.mode !== 'timeline') throw new Error('creative QA judges timeline (autonomous) plans; this project uses scene mode');
    const manifest = readJson(p.manifest, null); const used = readJson(p.libraryUsed, null); const shared = loadLibraryManifest(ctx.config);
    const library = used ? { ...(shared || {}), assets: [...(shared?.assets || []).filter((a) => !used.assets.some((u) => u.id === a.id)), ...used.assets] } : shared;
    let target = file ? path.resolve(file) : null;
    if (!target && last) { const lr = readJson(p.lastRender, null); target = lr?.output || null; }
    let report;
    if (target) {
      if (!fs.existsSync(target)) throw new Error(`render not found: ${target}`);
      const meta = await probeFile(target, 'video', ctx.config);
      report = await critiqueRender(ctx.config, plan, target, { manifest, library }, { width: meta.width, height: meta.height, duration: meta.duration, hasAudio: meta.hasAudio });
    } else report = critiquePlan(plan, { manifest, library });
    writeCreativeQa(p.creativeQa, report);
    return { ...report, file: p.creativeQa };
  });
}

/** xoxo memory [show|reset|like|dislike] */
export function memoryCommand(ctx, action = 'show', ids = []) {
  return attempt('memory', () => {
    const on = memoryEnabled(ctx.config, {}, ctx.env);
    if (action === 'reset') return { reset: resetMemory(ctx.config), file: ctx.config.memoryFile };
    if (action === 'like' || action === 'dislike') {
      if (!ids.length) throw new Error(`usage: xoxo memory ${action} <asset or sound id> [...]`);
      const m = loadMemory(ctx.config); rate(m, ids, action === 'like' ? 1 : -1); saveMemory(ctx.config, m);
      return { rated: ids.map((id) => ({ id, rating: +m.ratings[id].toFixed(2) })), file: ctx.config.memoryFile };
    }
    const m = loadMemory(ctx.config);
    return { enabled: on, file: ctx.config.memoryFile, runs: m.runs.length, ratings: m.ratings, recentRuns: m.runs.slice(-5).map((r) => ({ at: r.at, project: r.project, type: r.type, seed: r.seed, score: r.score })), note: 'Only ids, ratings and counts are stored locally - never paths or media. Disable with "memory": false in edit.config.json or XOXO_MEMORY=0.' };
  });
}
