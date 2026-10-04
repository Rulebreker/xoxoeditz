// REAL_EDIT_REPORT.md - assembled ONLY from artefacts the run actually produced (plan, build report, QA report,
// render result, probe data). Nothing is asserted that was not measured; a simulator run is stamped as such.

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const fmt = (n, d = 2) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '-');
const table = (head, rows) => rows.length ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n') : '_none_';

export function renderEditReport(d) {
  const { run, plan, manifest, narration, compiled, build, qa, render, steps, files } = d;
  const L = [];
  const real = run.real;
  L.push(`# Real edit report - ${plan?.title ?? run.name}`, '');
  L.push(real && !run.ae
    ? `> **Run type: NOT PERFORMED.** Real After Effects was never reached, so nothing below was built or rendered. Generated ${run.finishedAt}.`
    : real
    ? `> **Run type: REAL After Effects** (${run.ae?.aeVersion ? `After Effects ${run.ae.aeVersion}` : 'version unknown'}, transport \`${run.transport}\`). Generated ${run.finishedAt}.`
    : `> **Run type: SIMULATOR - NOT a real After Effects run.** No \`.aep\` that After Effects can open was produced and nothing was rendered by After Effects. This report exists to test the report generator only.`, '');
  const ok = steps.every((s) => s.ok);
  L.push(`**Overall: ${ok ? 'COMPLETED' : 'FAILED'}** - ${steps.filter((s) => s.ok).length}/${steps.length} steps succeeded in ${(steps.reduce((a, s) => a + s.ms, 0) / 1000).toFixed(1)}s.`, '');

  L.push('## Pipeline steps', table(['#', 'Step', 'Result', 'Time', 'Detail'], steps.map((s, i) => [i + 1, s.label, s.ok ? 'OK' : 'FAILED', `${(s.ms / 1000).toFixed(1)}s`, s.detail || s.error || ''])), '');

  if (manifest) {
    const usedIds = new Set(compiled?.meta?.assetsUsed || compiled?.assetsUsed || []);
    L.push('## Assets', `Scanned ${manifest.assets.length} files: ${Object.entries(manifest.counts || {}).map(([k, v]) => `${v} ${k}`).join(', ')}.`, '');
    L.push(table(['ID', 'Type', 'Role', 'Size / duration / fps', 'Codec', 'Used'], manifest.assets.map((a) => [
      a.id, a.type, a.role ? `${a.role}${a.roleConfidence < 0.5 ? '?' : ''}` : '-',
      [a.meta?.width ? `${a.meta.width}x${a.meta.height}` : null, a.meta?.duration ? `${fmt(a.meta.duration)}s` : null, a.meta?.fps && !a.meta?.isStill ? `${fmt(a.meta.fps, 2)}fps` : null].filter(Boolean).join(' / ') || '-',
      a.meta?.videoCodec || a.meta?.audioCodec || '-', usedIds.has(a.id) ? 'yes' : 'no'])), '');
    const unused = manifest.assets.filter((a) => ['image', 'video', 'audio'].includes(a.type) && !usedIds.has(a.id));
    if (unused.length) L.push(`Not used: ${unused.map((a) => a.id).join(', ')} (see the editorial decisions below for why any asset was excluded).`, '');
  }

  if (plan) {
    L.push('## Scenes', table(['Scene', 'Time', 'Shots (asset, camera)', 'Text', 'Transition in'], plan.scenes.map((s) => [
      s.id, `${fmt(s.start, 1)}-${fmt(s.end, 1)}s`, s.clips.map((c) => `${c.asset} ${c.motion}${c.sourceIn ? ` @${c.sourceIn}s` : ''}${c.speed && c.speed !== 1 ? ` x${c.speed}` : ''}`).join(' -> '),
      s.graphics.map((g) => `${g.kind}: ${g.text || g.title || `${g.prefix || ''}${g.value ?? ''}${g.suffix || ''}`}`).join('; ') || '-',
      s.transition ? `${s.transition.type} ${s.transition.duration ?? ''}s` : 'cut'])), '');
    if (plan._decisions?.length) L.push('### Editorial decisions (the Director\'s log)', ...plan._decisions.map((x) => `- ${x}`), '');
  }

  // effects actually used = what the build executed, not what was requested
  L.push('## Effects and animation actually used');
  const timeline = build?.timeline || [];
  const alt = (re) => timeline.filter((t) => re.test(t.unit));
  const counts = (arr) => Object.entries(arr.reduce((m, t) => ((m[t.alternative] = (m[t.alternative] || 0) + 1), m), {})).map(([k, v]) => `${k} x${v}`).join(', ') || '-';
  L.push(table(['Area', 'Implementation (as executed)'], [
    ['Camera moves', counts(plan ? plan.scenes.flatMap((s) => s.clips.map((c) => ({ alternative: c.motion }))) : [])],
    ['Transitions', (compiled?.meta?.sceneComps || []).filter((s) => s.transition?.type && s.transition.type !== 'cut').map((s) => `${s.id}: ${s.transition.type} ${fmt(s.transition.d)}s`).join(', ') || '-'],
    ['Titles / graphics', counts(alt(/\.(title|stat|lower_third|callout|bar_chart|timeline|subtitle|kinetic|hud_corners|highlight_box)\./))],
    ['Transition implementations', (compiled?.meta?.resolutions || []).filter((r) => r.effectId.startsWith('transition.')).map((r) => `${r.effectId.replace('transition.', '')} -> ${r.using}`).join(', ') || '-'],
    ['Looks', (compiled?.meta?.resolutions || []).filter((r) => r.effectId.startsWith('look.')).map((r) => `${r.effectId.replace('look.', '')} -> ${r.using}`).join(', ') || 'none requested'],
    ['Captions', counts(alt(/^caption\./))],
    ['Audio layers', counts(alt(/^audio\./))],
  ]), '');

  L.push('## Fallbacks');
  const fbs = build?.fallbacksUsed || [];
  L.push(fbs.length ? table(['When', 'What', 'Used instead', 'Why'], fbs.map((f) => [f.when, f.effect || f.label || f.unit, f.using, (f.reasons || [])[0] || ''])) : 'No fallbacks were needed: every first-choice implementation worked.', '');
  if (build?.degraded?.length) L.push('Optional elements that could not be created (dropped):', ...build.degraded.map((x) => `- ${x.label}: ${x.message}`), '');
  if (build?.errors?.length) L.push('**Required steps that failed:**', ...build.errors.map((x) => `- ${x.label}: ${x.message}`), '');

  L.push('## Audio processing');
  if (narration) L.push(`- Narration: ${fmt(narration.duration, 1)}s, ${narration.speech.length} speech segments, ${narration.pauses.length} long pauses, mean ${narration.loudness.meanDb} dB / peak ${narration.loudness.maxDb} dB${narration.loudness.clipping ? ' (**clipping**)' : ''}; transcript source: ${narration.transcript.method}.`);
  else L.push('- No narration analysed.');
  for (const m of plan?.audio?.music || []) L.push(`- Music ${m.asset}: ${m.gainDb} dB bed, ducked ${m.duckDb} dB under speech (keyframes from the measured speech segments), fade in ${m.fadeIn}s / out ${m.fadeOut}s.`);
  const sfxUnits = alt(/^audio\.sfx\./);
  L.push(`- SFX: ${sfxUnits.length} placed${(compiled?.meta?.notes || []).filter((n) => /SFX/.test(n)).map((n) => `; ${n}`).join('')}.`);
  if (plan?.audio?.narration?.end) L.push(`- Narration trimmed to ${plan.audio.narration.end}s with a 0.4s fade.`);
  L.push('');

  L.push('## Render settings');
  if (render) {
    const r = render.data || {};
    const pr = r.verification?.probe;
    L.push(`- Strategy: \`${r.strategy || 'n/a'}\``, ...(r.steps || []).map((s) => `- ${s}`));
    const out = compiled?.plan?.output || plan.output;
    L.push(`- Target: ${out.width}x${out.height} @ ${out.fps}fps, ${out.codec}, ${out.bitrateMbps ? out.bitrateMbps + ' Mbps' : 'CRF 16 (high quality)'}, AAC 320k`);
    if (pr) L.push(`- Output file (ffprobe): ${pr.width}x${pr.height}, ${pr.videoCodec}, ${pr.fps}fps, ${fmt(pr.duration)}s, audio ${pr.hasAudio ? `${pr.audioCodec} ${pr.audioChannels}ch` : 'NONE'}`);
    L.push('', table(['Verification check', 'Result', 'Detail'], (r.verification?.checks || []).map((c) => [c.name, c.ok ? 'pass' : (c.severity === 'warning' ? 'warn' : 'FAIL'), c.detail])));
    if (!render.success) L.push('', `**Render failed:** ${render.error}`);
  } else L.push('Not rendered (an earlier step failed or this was a simulator run).');
  L.push('');

  L.push('## QA');
  if (qa) {
    L.push(`**${qa.passed ? 'PASSED' : 'FAILED'}** - ${qa.summary}.`, '');
    L.push(table(['Check', 'Result', 'Issues'], Object.entries(qa.checks).map(([k, v]) => [k, v.passed ? 'pass' : 'FAIL', v.issues.map((i) => `${i.severity}: ${i.message}`).join(' / ') || '-'])));
    if (qa.repairs?.length) L.push('', 'Automatic repairs:', ...qa.repairs.map((r) => `- ${r.success ? 'fixed' : 'FAILED'} ${r.code} ${r.layer || ''} -> ${r.action}`));
  } else L.push('QA did not run.');
  L.push('');

  L.push('## Limitations (derived from this run)');
  const lim = [...(d.limitations || [])];
  if (!real) lim.unshift('This was a simulator run: nothing here proves behaviour inside After Effects.');
  if (!narration || narration.transcript.method === 'none') lim.push('No transcript (script/SRT/Whisper): captions are off and scene cuts follow pauses, not words.');
  if (narration?.transcript.method === 'script-heuristic') lim.push('Caption timing is estimated from the script and the pause pattern, not word-accurate.');
  if ((compiled?.meta?.notes || []).some((n) => /synthesized/.test(n))) lim.push('Some SFX are simple FFmpeg-synthesised sounds (basic quality).');
  if (!(plan?.audio?.music || []).length) lim.push('No music asset was supplied.');
  lim.push('Asset choice is keyword- and quality-based. The built-in director cannot see the pictures; a Claude Code session reading the thumbnails would choose better.');
  lim.push('Text placement uses safe-area layout and approximate text bounds; callout targets need a viewer (not used here).');
  L.push(...lim.map((x) => `- ${x}`), '');

  L.push('## Files', ...Object.entries(files || {}).map(([k, v]) => `- ${k}: \`${v.path}\` ${v.exists ? `(${v.size})` : '(**missing**)'}`), '');
  return L.join('\n');
}
