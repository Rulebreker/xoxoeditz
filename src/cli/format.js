// Human-readable output. `--json` bypasses all of this.

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const green = (s) => c(32, s); export const red = (s) => c(31, s); export const yellow = (s) => c(33, s); export const dim = (s) => c(2, s); export const bold = (s) => c(1, s);

const ICON = { ok: green('✓'), warn: yellow('!'), fail: red('✗'), skip: dim('-') };

export function formatDoctor(data) {
  const lines = data.checks.map((k) => `  ${ICON[k.status] || '?'} ${k.name.padEnd(28)} ${k.detail || ''}${k.status === 'fail' || k.status === 'warn' ? '\n      ' + dim('→ ' + (k.fix || '')) : ''}`.replace(/\n      \S*→ $/, ''));
  return [bold('XOXOEDITZ doctor'), ...lines, '', data.ready ? green('Ready.') : red('Not ready: fix the ✗ items above.')].join('\n');
}

export function formatQa(qa) {
  const lines = [`${qa.passed ? green('QA PASSED') : red('QA FAILED')} — ${qa.summary}`];
  for (const e of (qa.errors || []).slice(0, 15)) lines.push(`  ${red('error')}   [${e.check}] ${e.message}`);
  for (const w of (qa.warnings || []).slice(0, 12)) lines.push(`  ${yellow('warning')} [${w.check}] ${w.message}`);
  if (qa.repairs?.length) { lines.push('  repairs:'); for (const r of qa.repairs) lines.push(`    ${r.success ? green('fixed') : red('failed')} ${r.code} ${r.layer || ''} → ${r.action}`); }
  if (qa.fallbacks_used?.length) { lines.push('  fallbacks used:'); for (const f of qa.fallbacks_used) lines.push(`    ${f.effect} → ${f.using}${f.reason ? dim(' (' + f.reason + ')') : ''}`); }
  return lines.join('\n');
}

export function formatEdit(d) {
  const b = d.build;
  const lines = [`${b.success ? green('Build OK') : red('Build FAILED')} — ${b.summary}${d.dryRun ? dim('  [dry-run: simulator]') : ''}`, `  project:    ${b.project}`, `  transport:  ${b.transport}`];
  for (const e of b.errors || []) lines.push(`  ${red('error')} ${e.label}: ${e.message}`);
  for (const e of b.degraded || []) lines.push(`  ${yellow('dropped')} ${e.label}: ${e.message}`);
  for (const n of (b.notes || []).slice(0, 8)) lines.push(`  ${dim('note')} ${n}`);
  if (d.qa) lines.push('', formatQa({ ...d.qa, passed: d.qaPassed ?? d.qa.passed }));
  return lines.join('\n');
}

export function formatStatus(d) {
  const lines = [bold(`Project ${d.project}`), `  ${dim(d.root)}`];
  for (const [k, v] of Object.entries(d.steps)) lines.push(`  ${k.padEnd(10)} ${v}`);
  lines.push('', `Next: ${bold(d.next)}`);
  return lines.join('\n');
}

export function formatEffects(d) {
  const lines = [d.note, ''];
  for (const r of d.table) lines.push(`  ${r.degraded ? yellow('~') : green('✓')} ${r.id.padEnd(24)} using ${String(r.using).padEnd(20)} ${dim('chain: ' + r.chain.join(' → '))}`);
  return lines.join('\n');
}

export function formatRender(r) {
  const d = r.data;
  const lines = [`${r.success ? green('Render OK') : red('Render FAILED')}  ${d?.output || ''}`];
  for (const s of d?.steps || r.steps || []) lines.push(`  ${dim('•')} ${s}`);
  for (const k of d?.verification?.checks || []) lines.push(`  ${k.ok ? green('✓') : (k.severity === 'warning' ? yellow('!') : red('✗'))} ${k.name}: ${k.detail}`);
  if (d?.frames?.length) lines.push('', 'Preview frames to review (open them):', ...d.frames.map((f) => `  ${f.file}`));
  return lines.join('\n');
}

export function formatGeneric(r) {
  if (!r.success) return `${red('✗')} ${r.operation}: ${r.error}`;
  return `${green('✓')} ${r.operation}\n${JSON.stringify(r.data, null, 2)}`;
}

export function formatProduce(d) {
  const lines = [];
  const sim = d.simulated;
  lines.push(`${d.rendered ? green('DONE') : sim ? yellow('PLANNED + SIMULATED') : red('NOT RENDERED')}  project ${bold(d.project)}${sim ? dim('  [simulator: nothing was rendered]') : ''}`);
  if (d.output) lines.push(`  video:     ${d.output}`);
  lines.push(`  project:   ${d.aep}`, `  plan:      ${d.plan}`, d.beatMap ? `  beat map:  ${d.beatMap}` : null, `  report:    ${d.report}`);
  const q = d.edit?.qa; if (q) lines.push(`  QA:        ${q.passed ? green('passed') : red('FAILED')} — ${q.summary}`);
  const fb = d.edit?.build?.fallbacksUsed || []; if (fb.length) lines.push(`  fallbacks: ${fb.slice(0, 6).map((f) => `${f.effect || f.label} → ${f.using}`).join('; ')}${fb.length > 6 ? ` (+${fb.length - 6})` : ''}`);
  for (const e of (d.edit?.build?.errors || []).slice(0, 5)) lines.push(`  ${red('error')} ${e.label}: ${e.message}`);
  return lines.filter(Boolean).join('\n');
}
