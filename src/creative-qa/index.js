// CREATIVE QA entry points: run the plan checks (and, given a render, the render checks), score the result per
// category, and write CREATIVE_QA.json. A score is a summary for comparing attempts, not a promise of taste.

import fs from 'node:fs';
import { planChecks, CATEGORIES } from './plan-checks.js';
import { renderChecks } from './render-checks.js';
import { writeJson } from '../core/paths.js';

const PENALTY = { error: 0.18, warning: 0.06, info: 0.01 };

export function scoreIssues(issues) {
  const per = Object.fromEntries([...CATEGORIES, 'render'].map((c) => [c, 1]));
  for (const i of issues) per[i.category] = Math.max(0, (per[i.category] ?? 1) - (PENALTY[i.severity] ?? 0));
  const cats = Object.values(per); const overall = cats.reduce((a, b) => a + b, 0) / cats.length;
  const worst = Math.min(...cats);
  return { categories: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, +v.toFixed(3)])), overall: +(0.7 * overall + 0.3 * worst).toFixed(3) };
}

/** Plan-only critique (fast, no media access). */
export function critiquePlan(plan, ctx = {}) {
  const { issues, metrics } = planChecks(plan, ctx);
  const score = scoreIssues(issues); const errors = issues.filter((i) => i.severity === 'error');
  return { generatedAt: new Date().toISOString(), level: 'plan', passed: errors.length === 0, score: score.overall, categories: score.categories, summary: `${errors.length} errors, ${issues.filter((i) => i.severity === 'warning').length} warnings, score ${score.overall}`, errors, warnings: issues.filter((i) => i.severity === 'warning'), info: issues.filter((i) => i.severity === 'info'), metrics };
}

/** Plan + render critique. `probe` = { width, height, duration, hasAudio } of the file. */
export async function critiqueRender(config, plan, file, ctx = {}, probe = null) {
  const base = critiquePlan(plan, ctx);
  if (!file || !fs.existsSync(file)) return { ...base, level: 'plan', renderChecked: false, note: 'no render to inspect' };
  const r = await renderChecks(config, file, { plan, probe });
  const all = [...base.errors, ...base.warnings, ...base.info, ...r.issues]; const score = scoreIssues(all); const errors = all.filter((i) => i.severity === 'error');
  return { ...base, level: 'plan+render', renderChecked: true, file, passed: errors.length === 0, score: score.overall, categories: score.categories, errors, warnings: all.filter((i) => i.severity === 'warning'), info: all.filter((i) => i.severity === 'info'), summary: `${errors.length} errors, ${all.filter((i) => i.severity === 'warning').length} warnings, score ${score.overall}`, metrics: { ...base.metrics, render: r.metrics } };
}

export function writeCreativeQa(file, report) { writeJson(file, report); return file; }
export { planChecks, renderChecks, CATEGORIES };
