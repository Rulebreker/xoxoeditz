// REFINEMENT. Two loops, both honest about what they can and cannot judge:
//
//  refineDirection   generate-and-test on the PLAN: direct with several seeds, critique each, keep the best.
//                    Pure and fast. It cannot fix a pool of ten near-identical photos - it says so.
//  previewLoop       the render loop: render a preview, critique the pixels and sound, re-direct when the critique
//                    finds something a different cut could fix, stop when it passes or the rounds run out.
//                    Rendering is injected, so the loop is testable without After Effects.

import { directTimeline } from '../director/direct.js';
import { critiquePlan } from './index.js';

/** Issues a different seed has a real chance of fixing; the rest are about the inputs, not the cut. */
export const SEED_FIXABLE = new Set(['SLIDESHOW', 'ZOOM_ONLY', 'LOW_MOVE_VARIETY', 'REPEATED_MOVE', 'STATIC_SHOTS', 'LOW_TEMPLATE_VARIETY', 'TEMPLATE_STREAK', 'DUPLICATE_ADJACENT', 'NEAR_DUPLICATE_ADJACENT', 'EARLY_REUSE', 'TRANSITION_REPEAT', 'ONE_TRANSITION', 'TEXT_ANIM_REPEAT', 'CUTS_OFF_BEAT', 'CUTS_LOOSE', 'DROP_NOT_CUT', 'METRONOME', 'PACING_OFF', 'FEW_SPEED_RAMPS', 'SAME_SPEED_MAP', 'FLASH_SHOT', 'SFX_GAP', 'SFX_TOO_DENSE', 'TEXT_DENSE', 'ACCIDENTAL_BOX', 'EMPTY_SHOT', 'SOFT_CROP', 'TIGHT_CROP', 'TEXT_DOES_NOT_FIT']);

const rank = (c) => [c.errors.length, -c.score, c.warnings.length];
const better = (a, b) => { const x = rank(a); const y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };

/**
 * @param {object} input  directTimeline input (directive, manifest, library, beatMap, music, caps, memory)
 * @param {object} o      { rounds = 4, target = 0.9, ctx: {manifest, library} }
 * @returns {{ plan, report, critique, attempts, chosen, improved }}
 */
export function refineDirection(input, { rounds = 4, target = 0.9 } = {}) {
  const baseSeed = input.directive.seed ?? 1; const attempts = []; let best = null;
  for (let r = 0; r < Math.max(1, rounds); r++) {
    const seed = baseSeed + r;
    const directive = { ...input.directive, seed };
    const out = directTimeline({ ...input, directive });
    const crit = critiquePlan(out.plan, { manifest: input.manifest, library: input.library });
    const fixable = [...crit.errors, ...crit.warnings].filter((i) => SEED_FIXABLE.has(i.code)).length;
    attempts.push({ round: r + 1, seed, score: crit.score, errors: crit.errors.length, warnings: crit.warnings.length, fixableByReseed: fixable, issues: [...crit.errors, ...crit.warnings].slice(0, 12).map((i) => `${i.code}${i.shot ? ' ' + i.shot : ''}`) });
    if (!best || better(crit, best.crit)) best = { ...out, crit, seed };
    if (crit.errors.length === 0 && crit.score >= target) break;
    if (fixable === 0 && r >= 1) break; // nothing a new seed could change: stop burning time
  }
  const first = attempts[0];
  const chosen = attempts.find((a) => a.seed === best.seed);
  const critique = { ...best.crit, refinement: { baseSeed, attempts, chosenSeed: best.seed, improved: chosen.score > first.score || chosen.errors < first.errors, note: best.crit.errors.length ? `${best.crit.errors.length} error(s) remain; they come from the inputs (assets/music/library), not from the cut: ${best.crit.errors.slice(0, 3).map((e) => e.code).join(', ')}` : 'no errors' } };
  return { plan: best.plan, report: { ...best.report, seed: best.seed }, critique, attempts, chosen: best.seed, improved: critique.refinement.improved };
}

/**
 * The render loop. Injected: render(plan) -> {file, probe}|null, critique(plan, file, probe) -> critique, redirect(seed, critique) -> plan, build(plan) -> {success}.
 * Stops on a passing critique, on the last round, or when the critique has nothing a re-cut could fix.
 */
export async function previewLoop({ plan, render, critique, redirect, build, rounds = 3, target = 0.88, baseSeed = 1 }) {
  const history = []; let current = plan; let best = null;
  for (let r = 0; r < Math.max(1, rounds); r++) {
    const rendered = await render(current);
    if (!rendered) { history.push({ round: r + 1, rendered: false, note: 'nothing to render (simulator or render disabled)' }); return { plan: current, history, passed: null, best }; }
    const c = await critique(current, rendered.file, rendered.probe);
    history.push({ round: r + 1, rendered: true, file: rendered.file, score: c.score, errors: c.errors.length, warnings: c.warnings.length, issues: [...c.errors, ...c.warnings].slice(0, 10).map((i) => i.code) });
    if (!best || better(c, best.critique)) best = { plan: current, critique: c, file: rendered.file };
    if (c.errors.length === 0 && c.score >= target) return { plan: current, history, passed: true, best };
    const fixable = [...c.errors, ...c.warnings].filter((i) => SEED_FIXABLE.has(i.code) || ['CUTS_NOT_VISIBLE', 'UNPLANNED_CUTS'].includes(i.code)).length;
    if (r === rounds - 1 || fixable === 0) break;
    current = await redirect(baseSeed + r + 1, c);
    const b = await build(current);
    if (!b.success) { history.push({ round: r + 1, note: `rebuild failed: ${b.error}` }); break; }
  }
  return { plan: best?.plan ?? current, history, passed: Boolean(best && best.critique.errors.length === 0 && best.critique.score >= target), best };
}
