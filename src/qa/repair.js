// QA -> RECOVERY: fix what can be fixed automatically, then QA runs again.
import { MASTER } from '../ae/compile.js';
import { executeBuild } from '../ae/executor.js';
import { musicLevelKeys } from '../audio/sound.js';
import { masterEnd } from '../plan/schema.js';

export const issueKey = (i) => `${i.code}:${i.comp ?? ''}:${i.layer ?? ''}`;

/**
 * One repair round. `attempt` escalates the strategy for an issue that survived the previous round (attempt 1 = the
 * gentle fix, 2 = a stronger one, 3 = rebuild the owning unit). An action only says what was APPLIED (`success`);
 * whether it WORKED is decided by the caller, who re-inspects the project and re-runs QA (see `verifyRepairs`).
 */
export async function repairIssues(bridge, qa, { plan, build, narration, manifest, logger, attempt = 1, fullBuild = null }) {
  const actions = [];
  const done = new Set();
  const note = (issue, action, res) => actions.push({ key: issueKey(issue), code: issue.code, comp: issue.comp, layer: issue.layer, action, attempt, success: Boolean(res?.success), error: res?.success ? undefined : res?.error });
  const { width: W, height: H } = plan.output;
  const unitFor = async (issue) => {
    const find = (b) => b.stages.flatMap((s) => s.units).find((u) => (u.primary === issue.layer || (u.names || []).includes(issue.layer)) && (u.alternatives[0].ops.some(([, a]) => a.comp === issue.comp)));
    return find(build) || (fullBuild ? find(await fullBuild()) : null);
  };
  const rebuildUnit = async (issue) => {
    const unit = await unitFor(issue);
    if (!unit) return null;
    const mini = { stages: [{ id: 'repair', label: 'repair', units: [{ ...unit, optional: false }] }], meta: { warnings: [], resolutions: [] } };
    const r = await executeBuild(bridge, mini, { logger });
    return { success: r.success && r.errors.length === 0, error: r.errors[0]?.message, unit: unit.id };
  };

  for (const issue of qa.errors.concat(qa.warnings)) {
    if (!issue.repairable) continue;
    const key = `${issue.code}:${issue.comp}:${issue.layer}`;
    if (done.has(key)) continue;
    done.add(key);
    const { width: W, height: H } = plan.output;

    if (issue.code === 'TEXT_OUT_OF_FRAME' || issue.code === 'TEXT_OUTSIDE_SAFE') {
      // Re-fit with MEASURED bounds inside After Effects: wrap first, shrink only if needed, never touch Scale. The
      // caller re-inspects and re-runs QA; if this did not fix it, the next attempt is stronger, then the unit is rebuilt.
      const role = issue.data?.role;
      if (attempt >= 3) { const r = await rebuildUnit(issue); if (r) note(issue, `rebuild-unit ${r.unit}`, r); else note(issue, 'rebuild-unit (no unit found)', { success: false, error: 'owning unit not found' }); continue; }
      const m = role === 'CAPTION' ? 0.03 : 0.05; const safe = { left: W * m, top: H * (role === 'CAPTION' ? 0.03 : 0.08), right: W * (1 - m), bottom: H * (role === 'CAPTION' ? 0.97 : 0.90) };
      const strong = attempt >= 2;
      const box = strong ? { left: safe.left + W * 0.02, top: safe.top + H * 0.02, right: safe.right - W * 0.02, bottom: safe.bottom - H * 0.02 } : safe;
      const r = await bridge.call('text_fit', { comp: issue.comp, layer: issue.layer, box, maxLines: strong ? 4 : 3, minSize: strong ? 8 : undefined });
      note(issue, `text_fit${strong ? ' (stronger margin, 4 lines)' : ''}`, r.success && r.data?.fits !== false ? r : { success: false, error: r.success ? 'text still does not fit after text_fit' : r.error });
    } else if (issue.code === 'TEXT_UNEXPECTED') {
      const keep = [...new Set([...Object.values(build.meta.unitNames || {}).flat(), ...(build.meta.textLayers || []).flatMap((t) => [t.name, ...(t.children || [])])])];
      note(issue, 'prune-stale-text', await bridge.call('layers_prune', { comp: issue.comp, keep, kinds: ['text', 'textdecor'], orphans: true }));
    } else if (issue.code === 'TEXT_TIMING') {
      if (attempt >= 2) { const r = await rebuildUnit(issue); if (r) note(issue, `rebuild-unit ${r.unit}`, r); continue; }
      note(issue, 'set-text-interval', await bridge.call('layer_set', { comp: issue.comp, layer: issue.layer, props: { inPoint: issue.data.start, outPoint: issue.data.end } }));
    } else if (issue.code === 'TEXT_KEYFRAMES_OUTSIDE') {
      const r = await rebuildUnit(issue); if (r) note(issue, `rebuild-unit ${r.unit}`, r);
    } else if (issue.code === 'COMP_DURATION_MISMATCH') {
      note(issue, 'set-comp-duration', await bridge.call('comp_set', { comp: issue.comp, duration: issue.data.want }));
    } else if (issue.code === 'AUDIO_MUTED') {
      note(issue, 'unmute', await bridge.call('layer_set', { comp: issue.comp, layer: issue.layer, props: { audioEnabled: true } }));
    } else if (issue.code === 'AUDIO_BROLL_UNMUTED') {
      note(issue, 'mute-broll-audio', await bridge.call('layer_set', { comp: issue.comp, layer: issue.layer, props: { audioEnabled: false } }));
    } else if (issue.code === 'AUDIO_NOT_DUCKED') {
      const m = plan.audio.music.find((x, i) => issue.layer.startsWith(`MUSIC_`) && build.stages.some((st) => st.units.some((u) => u.primary === issue.layer && u.id.startsWith(`audio.music.${i + 1}.`))));
      if (!m || !narration?.speech) continue;
      const end = masterEnd(plan);
      const keys = musicLevelKeys({ gainDb: m.gainDb ?? -20, duckDb: m.duckDb ?? -10, fadeIn: m.fadeIn ?? 2, fadeOut: m.fadeOut ?? 3, layerStart: m.start ?? 0, layerEnd: m.end ?? end, speech: narration.speech });
      note(issue, 'reapply-ducking', await bridge.call('keyframes', { comp: MASTER, layer: issue.layer, prop: 'audioLevels', keys, ease: 'linear' }));
    } else if (issue.code === 'MISSING_LAYER') {
      // Re-run the unit that should have produced the layer, with its full alternative chain (a required unit fails loudly).
      const r = await rebuildUnit(issue);
      if (r) note(issue, `rebuild-unit ${r.unit}`, r);
    }
  }
  return actions;
}
