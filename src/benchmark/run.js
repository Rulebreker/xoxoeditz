// BENCHMARK RUNNER. `xoxo benchmark velocity` produces a complete edit from generated inputs (or your own --assets)
// through the exact same path as `xoxo edit`, then judges the result against the benchmark's checklist and writes
// BENCHMARK_REPORT.md. Run it with --dry-run for the simulator (plan, compile and host-script consistency, no render)
// or without it on a machine with After Effects for the real thing. A criterion that needs a real render is reported as
// 'skipped' - never 'pass' - when it cannot have been checked.

import fs from 'node:fs';
import path from 'node:path';
import { attempt, fail } from '../core/result.js';
import { projectPaths, readJson, ensureDir, writeJson } from '../core/paths.js';
import { loadLibraryManifest } from '../library/scan.js';
import { validateTimeline } from '../timeline/plan.js';
import { produceVideo } from '../app/produce.js';
import { pathsFor } from '../app/services.js';
import { SPECS, COMMON, BENCHMARK_IDS } from './specs.js';
import { makeBenchmarkInputs } from './media.js';

function snapshot(dir) {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (!e.name.startsWith('.')) { const s = fs.statSync(f); out[path.relative(dir, f)] = `${s.size}:${Math.round(s.mtimeMs)}`; } } };
  walk(dir); return out;
}

export function runBenchmark(ctx, id, opts = {}) {
  return attempt('benchmark', async () => {
    const spec = SPECS[id];
    if (!spec) throw new Error(`unknown benchmark "${id}" (known: ${BENCHMARK_IDS.join(', ')}, all)`);
    const t0 = Date.now(); const log = (m) => opts.onProgress?.({ message: `[${id}] ${m}` });
    const work = path.join(ctx.config.workspace, 'benchmarks', id); ensureDir(work);
    // inputs: generated and self-contained, or the user's own folder
    let inputs = opts.assets ? path.resolve(opts.assets) : path.join(work, 'input');
    if (!opts.assets) { log('generating self-contained inputs (procedural clips, stills, music, SFX pack)'); const g = await makeBenchmarkInputs(ctx.config, inputs, spec); log(g.reused ? 'inputs unchanged: reusing' : 'inputs generated'); }
    else if (!fs.existsSync(inputs)) throw new Error(`assets folder not found: ${inputs}`);
    const configFile = path.join(work, 'edit.config.json');
    fs.writeFileSync(configFile, JSON.stringify({ ...spec.config, ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...(opts.quality ? { quality: opts.quality } : {}) }, null, 2) + '\n');
    const before = snapshot(inputs);

    const name = `benchmark-${id}`;
    const produced = await produceVideo(ctx, { assets: inputs, type: spec.type, prompt: spec.prompt, config: configFile, name, output: opts.output, dryRun: opts.dryRun, quality: opts.quality, starterSfx: !ctx.config.libraryRoot, render: opts.render !== false, remember: false, onProgress: opts.onProgress ? (e) => log(e.message) : undefined });
    if (!produced.data?.plan) return fail('benchmark', `the edit could not be produced: ${produced.error}`, { data: { produced }, recoverable: true });

    // judge it
    const finalName = produced.data.project; const p = projectPaths(ctx.config, finalName);
    const plan = readJson(p.plan); const manifest = readJson(p.manifest);
    const used = readJson(p.libraryUsed, null); const shared = loadLibraryManifest(ctx.config);
    const library = used ? { ...(shared || {}), assets: [...(shared?.assets || []).filter((a) => !used.assets.some((u) => u.id === a.id)), ...used.assets] } : shared;
    const buildReport = readJson(pathsFor(ctx, finalName, { dryRun: Boolean(opts.dryRun) }).buildReport, {}); // a dry run keeps its reports apart from a real build's
    const env = {
      plan, simulated: produced.data.simulated, edit: produced.data.edit || {}, render: produced.data.rendered ? { success: true, data: produced.data.render } : (produced.data.simulated ? null : { success: false, error: produced.error }),
      creative: readJson(p.creativeQa, null), validation: validateTimeline(plan, { manifest, library }), builtUnits: (buildReport.timeline || []).map((t) => t.unit), report: produced.data,
      sourceUntouched: JSON.stringify(snapshot(inputs)) === JSON.stringify(before),
    };
    const results = judge(spec, env);
    const failed = results.filter((r) => r.status === 'fail'); const skipped = results.filter((r) => r.status === 'skipped');
    const summary = { id, title: spec.title, project: finalName, simulated: env.simulated, passed: failed.length === 0, passCount: results.filter((r) => r.status === 'pass').length, failCount: failed.length, skippedCount: skipped.length, seconds: Math.round((Date.now() - t0) / 100) / 10 };
    const md = benchmarkReport(spec, summary, results, env, produced.data);
    const file = path.join(p.root, 'BENCHMARK_REPORT.md'); fs.writeFileSync(file, md); writeJson(path.join(p.root, 'benchmark.json'), { ...summary, results, at: new Date().toISOString() });
    if (opts.output) { try { ensureDir(path.resolve(opts.output)); fs.writeFileSync(path.join(path.resolve(opts.output), `BENCHMARK_REPORT_${id}.md`), md); } catch { /* output folder not writable */ } }
    return { ...summary, report: file, editReport: produced.data.report, plan: p.plan, aep: p.aep, output: produced.data.output, results };
  });
}

/** Evaluate a spec's checklist (plus the common one) against what was produced. A criterion that throws FAILS. */
export function judge(spec, env) {
  return [...COMMON, ...spec.criteria].map((c) => { let r; try { r = c.check(env); } catch (e) { r = { status: 'fail', detail: `criterion crashed: ${e.message}` }; } return { id: c.id, label: c.label, ...r }; });
}

export async function runAllBenchmarks(ctx, opts = {}) {
  const out = [];
  for (const id of BENCHMARK_IDS) { const r = await runBenchmark(ctx, id, opts); out.push(r.success ? r.data : { id, passed: false, error: r.error, project: `benchmark-${id}` }); }
  return { success: out.every((x) => x.passed), operation: 'benchmark', data: { all: true, benchmarks: out, passed: out.every((x) => x.passed), simulated: out.some((x) => x.simulated) }, ...(out.every((x) => x.passed) ? {} : { error: `${out.filter((x) => !x.passed).map((x) => x.id).join(', ')} did not pass` }) };
}

const icon = { pass: '✅', fail: '❌', skipped: '⏭️' };
function benchmarkReport(spec, s, results, env, produced) {
  const L = [];
  L.push(`# Benchmark: ${spec.title}`, '', `**${s.passed ? 'PASSED' : 'FAILED'}** — ${s.passCount} passed, ${s.failCount} failed, ${s.skippedCount} skipped (${s.seconds}s)`, '');
  L.push(s.simulated
    ? '> **SIMULATED RUN.** This benchmark ran against the built-in After Effects simulator. It verifies the Director, the plan, the compiler and that every host-script call is consistent. It does **not** prove how After Effects behaves, and **no video was rendered**. Run `xoxo benchmark ' + spec.id + '` (without `--dry-run`) on a machine with After Effects for the real benchmark.'
    : '> **REAL RUN** in After Effects.', '');
  L.push('## Checklist', '| | Criterion | Result |', '|---|---|---|', ...results.map((r) => `| ${icon[r.status]} | ${r.label} | ${String(r.detail ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')} |`), '');
  L.push('## The brief', `> ${spec.prompt}`, '', '```json', JSON.stringify(spec.config, null, 2), '```', '');
  L.push('## What was produced', `- Project: \`${s.project}\``, `- Plan: ${produced.plan}`, `- After Effects project: ${produced.aep}`, `- Edit report: ${produced.report}`, `- Creative QA: ${produced.creativeQa || 'n/a'} (score ${env.creative?.score ?? 'n/a'})`, `- Video: ${produced.output || (s.simulated ? 'none (simulated)' : 'not rendered')}`, '');
  const sh = env.plan.timeline.shots;
  L.push('## Shot list', '| Shot | Time | Template | Camera | Speed | Into next |', '|---|---|---|---|---|---|', ...sh.map((x, i) => { const rm = x.layers.find((l) => l.remap); const tr = env.plan.timeline.transitions[i]; return `| ${x.id} | ${x.start.toFixed(2)}–${x.end.toFixed(2)} | ${x.template} | ${x.camera?.move || '—'} | ${rm ? rm.remap.summary.slice(0, 48) : '1x'} | ${tr ? tr.type + (tr.d ? ' ' + tr.d.toFixed(2) + 's' : '') : ''} |`; }), '');
  L.push('## Honest limits', '- The generated inputs are procedural patterns with a moving block: they exercise the engine, they are not good-looking footage. Use `--assets <folder>` with real material for a real judgement of taste.', '- Creative QA judges structure (variety, rhythm, sound, safety). It cannot tell whether a picture is beautiful.', '- Anything marked skipped was not checked in this run.', '');
  return L.join('\n');
}
