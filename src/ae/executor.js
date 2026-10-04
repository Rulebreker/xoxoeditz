// THE EXECUTOR + RECOVERY AGENT.
//
//   run unit (best alternative) -> failed? -> diagnose -> next alternative -> verify -> continue
//
// Units are idempotent (see compile.js), so retrying after a transport hiccup can never duplicate layers.

import { nullLogger } from '../core/logger.js';
import { sleep } from '../core/exec.js';

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

/** Heuristic diagnosis used in the report and to decide whether another alternative could help. */
export function diagnose(error = '', code = '') {
  const e = String(error);
  if (code === 'FILE_NOT_FOUND' || /file not found/i.test(e)) return { cause: 'missing-file', retryable: false, hint: 'The source file is missing or moved. Re-scan assets or fix the path.' };
  if (code === 'UNSUPPORTED_FORMAT') return { cause: 'unsupported-format', retryable: false, hint: 'After Effects cannot import this format. Transcode with ffmpeg to H.264 MP4 / PNG / WAV.' };
  if (code === 'EFFECT_UNAVAILABLE') return { cause: 'effect-unavailable', retryable: true, hint: 'Effect not installed; using the next fallback.' };
  if (code === 'EXPRESSION_ERROR') return { cause: 'expression-engine', retryable: true, hint: 'Expression failed (engine/version difference); using a keyframe fallback.' };
  if (code === 'PROP_NOT_FOUND') return { cause: 'property-missing', retryable: true, hint: 'Property path differs in this After Effects version; using a simpler animation.' };
  if (code === 'COMP_NOT_FOUND' || code === 'LAYER_NOT_FOUND' || code === 'ITEM_NOT_FOUND') return { cause: 'dependency-missing', retryable: true, hint: 'An earlier step did not produce what this step needs.' };
  if (code === 'TIMEOUT' || code === 'TRANSPORT_ERROR' || code === 'LAUNCH_FAILED') return { cause: 'transport', retryable: true, hint: 'After Effects did not answer. Check for modal dialogs and the scripting-file-access preference.' };
  if (code === 'FILE_ACCESS_DENIED') return { cause: 'scripting-prefs', retryable: false, hint: 'Enable Preferences > Scripting & Expressions > Allow Scripts to Write Files and Access Network.' };
  return { cause: 'unknown', retryable: true, hint: 'Unclassified After Effects error; trying the next alternative.' };
}

/**
 * Execute a compiled build.
 * @returns {Promise<BuildReport>}
 */
export async function executeBuild(bridge, build, { logger = nullLogger, onProgress = () => {}, batchUnits = 25, transportRetries = 2, stopOnFatal = false } = {}) {
  const t0 = Date.now();
  const report = { success: true, stages: [], fallbacksUsed: [], errors: [], warnings: [...(build.meta.warnings || [])], degraded: [], timeline: [] };

  // compile-time degradations (an effect that is not installed was already substituted)
  for (const r of build.meta.resolutions || []) {
    if (r.degraded) report.fallbacksUsed.push({ when: 'compile', effect: r.effectId, requested: r.requested, using: r.using, quality: r.quality, bestQuality: r.bestQuality, reasons: r.skipped.map((s) => `${s.impl}: ${s.reason}`) });
  }
  for (const stage of build.stages) {
    for (const u of stage.units) {
      if (u.resolution?.degraded && !(build.meta.resolutions || []).includes(u.resolution)) {
        report.fallbacksUsed.push({ when: 'compile', effect: u.resolution.effectId, requested: u.resolution.requested, using: u.resolution.using, quality: u.resolution.quality, bestQuality: u.resolution.bestQuality, reasons: u.resolution.skipped.map((s) => `${s.impl}: ${s.reason}`) });
      }
    }
  }

  for (const stage of build.stages) {
    const sr = { id: stage.id, label: stage.label, units: stage.units.length, ok: 0, fallback: 0, failed: 0 };
    onProgress({ stage: stage.id, label: stage.label, status: 'start' });
    // per unit state
    const state = new Map(stage.units.map((u) => [u.id, { u, alt: 0, errors: [], done: false, failed: false }]));
    let pending = stage.units.map((u) => u.id);
    let guard = 0;
    while (pending.length && guard++ < 12) {
      const nextPending = [];
      for (const group of chunk(pending, batchUnits)) {
        const units = group.map((id) => { const s = state.get(id); return { id, ops: s.u.alternatives[s.alt].ops.map(([op, args]) => ({ op, args })) }; });
        let res;
        for (let attempt = 0; attempt <= transportRetries; attempt++) {
          res = await bridge.batch(units, { timeoutMs: undefined });
          if (res.success || !['TIMEOUT', 'TRANSPORT_ERROR', 'LAUNCH_FAILED', 'BAD_RESPONSE'].includes(res.code)) break;
          logger.warn('transport failure, retrying batch (units are idempotent)', { stage: stage.id, attempt, error: res.error });
          await sleep(500 * (attempt + 1));
        }
        if (!res.success) {
          // whole batch failed (host-level). Mark every unit failed with this error; no alternative can help.
          const d = diagnose(res.error, res.code);
          for (const id of group) {
            const s = state.get(id);
            s.errors.push({ alternative: s.u.alternatives[s.alt].name, error: res.error, code: res.code, ...d });
            s.failed = true;
          }
          if (stopOnFatal) break;
          continue;
        }
        for (const ur of res.data.units) {
          const s = state.get(ur.id);
          if (ur.success) { s.done = true; continue; }
          const failedOp = ur.results[ur.failedIndex];
          const d = diagnose(failedOp?.error, failedOp?.code);
          s.errors.push({ alternative: s.u.alternatives[s.alt].name, op: failedOp?.op, error: failedOp?.error, code: failedOp?.code, ...d });
          logger.warn('unit failed', { unit: ur.id, alt: s.u.alternatives[s.alt].name, op: failedOp?.op, error: failedOp?.error });
          if (s.alt + 1 < s.u.alternatives.length && d.retryable) { s.alt += 1; nextPending.push(ur.id); } else s.failed = true;
        }
      }
      pending = nextPending;
    }

    for (const s of state.values()) {
      const u = s.u;
      if (s.done) {
        sr.ok++;
        if (s.alt > 0) {
          sr.fallback++;
          const last = s.errors[s.errors.length - 1];
          report.fallbacksUsed.push({ when: 'runtime', unit: u.id, label: u.label, from: u.alternatives[0].name, using: u.alternatives[s.alt].name, quality: u.alternatives[s.alt].quality, reasons: s.errors.map((e) => `${e.alternative}: ${e.error}`), hint: last?.hint });
        }
        report.timeline.push({ unit: u.id, alternative: u.alternatives[s.alt].name });
      } else {
        sr.failed++;
        const err = { unit: u.id, label: u.label, stage: stage.id, optional: Boolean(u.optional), attempts: s.errors };
        const last = s.errors[s.errors.length - 1];
        err.message = last ? `${last.op || 'batch'}: ${last.error}` : 'unit not executed';
        if (u.optional) report.degraded.push(err); else { report.errors.push(err); report.success = false; }
      }
    }
    report.stages.push(sr);
    onProgress({ stage: stage.id, label: stage.label, status: 'done', ...sr });
    if (stopOnFatal && report.errors.length) break;
  }
  report.durationMs = Date.now() - t0;
  report.summary = `${report.stages.reduce((a, s) => a + s.ok, 0)} units ok, ${report.fallbacksUsed.length} fallbacks, ${report.degraded.length} optional elements dropped, ${report.errors.length} errors`;
  return report;
}
