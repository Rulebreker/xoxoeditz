// QA -> RECOVERY: fix what can be fixed automatically, then QA runs again.
import { MASTER } from '../ae/compile.js';
import { executeBuild } from '../ae/executor.js';
import { musicLevelKeys } from '../audio/sound.js';
import { masterEnd } from '../plan/schema.js';

export async function repairIssues(bridge, qa, { plan, build, narration, manifest, logger }) {
  const actions = [];
  const done = new Set();
  const note = (issue, action, res) => actions.push({ code: issue.code, comp: issue.comp, layer: issue.layer, action, success: Boolean(res?.success), error: res?.success ? undefined : res?.error });

  for (const issue of qa.errors.concat(qa.warnings)) {
    if (!issue.repairable) continue;
    const key = `${issue.code}:${issue.comp}:${issue.layer}`;
    if (done.has(key)) continue;
    done.add(key);
    const { width: W, height: H } = plan.output;

    if (issue.code === 'TEXT_OUT_OF_FRAME') {
      const { bounds: b, position: p, scale: s } = issue.data;
      if (!b || !p) continue;
      const margin = Math.min(W, H) * 0.05;
      let sc = s?.[0] ?? 100;
      let width = b.width; let height = b.height; let left = b.left; let top = b.top;
      const maxW = W - margin * 2; const maxH = H - margin * 2;
      const k = Math.min(1, maxW / width, maxH / height);
      if (k < 1) { // shrink about the layer's anchor, then re-centre the box
        const cx = left + width / 2; const cy = top + height / 2;
        width *= k; height *= k; sc *= k;
        left = cx - width / 2; top = cy - height / 2;
        p[0] = p[0] + (left - b.left) ; p[1] = p[1] + (top - b.top);
        const r1 = await bridge.call('set_property', { comp: issue.comp, layer: issue.layer, prop: 'scale', value: [sc, sc] });
        if (!r1.success) { note(issue, 'scale-to-fit', r1); continue; }
      }
      let dx = 0; let dy = 0;
      if (left < margin) dx = margin - left; else if (left + width > W - margin) dx = W - margin - (left + width);
      if (top < margin) dy = margin - top; else if (top + height > H - margin) dy = H - margin - (top + height);
      const r = await bridge.call('set_property', { comp: issue.comp, layer: issue.layer, prop: 'position', value: [p[0] + dx, p[1] + dy] });
      note(issue, `move-into-frame (${Math.round(dx)},${Math.round(dy)})${k < 1 ? ` + scale ${(k * 100).toFixed(0)}%` : ''}`, r);
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
      // Re-run the unit that should have produced the layer, with its full alternative chain.
      const unit = build.stages.flatMap((s) => s.units).find((u) => u.primary === issue.layer && (u.alternatives[0].ops.some(([, a]) => a.comp === issue.comp)));
      if (!unit) continue;
      const mini = { stages: [{ id: 'repair', label: 'repair', units: [unit] }], meta: { warnings: [], resolutions: [] } };
      const r = await executeBuild(bridge, mini, { logger });
      note(issue, `rebuild-unit ${unit.id}`, { success: r.success && r.errors.length === 0, error: r.errors[0]?.message });
    }
  }
  return actions;
}
