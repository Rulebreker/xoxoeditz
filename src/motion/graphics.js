// Motion-graphic templates. Each builder is a pure function: (graphic, ctx, reveal) -> ops.
// `reveal` is one implementation of the 'text.reveal' effect, so a failing text animator degrades to
// simpler animation without losing the graphic (see executor: alternatives walk the effect chain).

import { anchorFor, norm, applyCase, snapT } from './layout.js';
import { resolveChain } from '../effects/registry.js';

const K = (comp, layer, prop, keys, ease = 'easeOut', clear = true) => ['keyframes', { comp, layer, prop, keys, ease, clear }];
const k = (t, v) => ({ t, v });
const TRIM_END = 'ADBE Root Vectors Group/ADBE Vector Group/ADBE Vectors Group/ADBE Vector Filter - Trim/ADBE Vector Trim End';

function T(ctx, g) {
  const fps = ctx.fps;
  const a = snapT(g.start ?? 0, fps); const b = snapT(g.end ?? ctx.sceneLen, fps);
  const inDur = Math.min(ctx.style.motion.inDur, (b - a) * 0.45);
  const outDur = Math.min(ctx.style.motion.outDur, (b - a) * 0.3);
  return { a, b, inDur, outDur, outAt: b - outDur };
}

const fadeOut = (ctx, layer, t) => K(ctx.comp, layer, 'opacity', [k(t.outAt, 100), k(t.b, 0)], 'easeIn', false);

/** Add a text layer + reveal + fade-out. Returns ops. */
function textBlock(ctx, rv, { name, text, size, font, color, pos, justify, t, tracking, mode = 'fade_up', box, allCaps, delay = 0, stroke }) {
  const start = t.a + delay;
  const ops = [
    ['layer_add_text', { comp: ctx.comp, name, text, size: Math.round(size), font, color, position: pos, justify, tracking, start: t.a, end: t.b, box, allCaps, stroke, strokeWidth: stroke ? Math.max(1, Math.round(size * 0.04)) : undefined }],
    ...rv.build({ comp: ctx.comp, layer: name, t: start, d: Math.max(0.2, t.inDur), h: ctx.h, pos, mode }, rv.resolved),
    fadeOut(ctx, name, t),
  ];
  return ops;
}

const shape = (ctx, name, shapes, pos, t) => ['layer_add_shape', { comp: ctx.comp, name, shapes, position: pos, start: t.a, end: t.b }];

function title(g, ctx, rv) {
  const { w, h, style } = ctx; const t = T(ctx, g);
  const { pos, justify } = anchorFor(g.position || 'center', w, h);
  const size = style.type.titleSize * h * (g.scale || 1);
  const n = ctx.n;
  const ops = textBlock(ctx, rv, { name: `TXT_TITLE_${n}`, text: applyCase(g.text, style.type.titleCase), size, font: style.fonts.display, color: style.colors.text, pos, justify, t, tracking: style.type.tracking, mode: style.type.tracking > 100 ? 'tracking_in' : 'fade_up' });
  const ruleW = Math.min(w * 0.14, size * 4);
  const ruleY = pos[1] + size * 0.75;
  const ruleX = justify === 'left' ? pos[0] + ruleW / 2 : (justify === 'right' ? pos[0] - ruleW / 2 : pos[0]);
  ops.push(
    shape(ctx, `SHP_TITLE_RULE_${n}`, [{ type: 'line', points: [[-ruleW / 2, 0], [ruleW / 2, 0]], stroke: style.colors.accent, strokeWidth: Math.max(2, Math.round(h * 0.004)) }], [ruleX, ruleY], t),
    K(ctx.comp, `SHP_TITLE_RULE_${n}`, 'scale', [k(t.a + t.inDur * 0.4, [0, 100]), k(t.a + t.inDur * 1.4, [100, 100])], 'easeOut'),
    fadeOut(ctx, `SHP_TITLE_RULE_${n}`, t),
  );
  if (g.subtitle) {
    ops.push(...textBlock(ctx, rv, { name: `TXT_TITLE_SUB_${n}`, text: g.subtitle, size: style.type.subtitleSize * h, font: style.fonts.body, color: style.colors.muted, pos: [pos[0], ruleY + h * 0.05], justify, t, delay: t.inDur * 0.6 }));
  }
  return { names: [`TXT_TITLE_${n}`, `SHP_TITLE_RULE_${n}`, `TXT_TITLE_SUB_${n}`], ops };
}

function subtitle(g, ctx, rv) {
  const { w, h, style } = ctx; const t = T(ctx, g);
  const { pos, justify } = anchorFor(g.position || 'bottom-center', w, h);
  const name = `TXT_SUBTITLE_${ctx.n}`;
  return { names: [name], ops: textBlock(ctx, rv, { name, text: g.text, size: style.type.subtitleSize * h, font: style.fonts.body, color: style.colors.text, pos, justify, t }) };
}

function lowerThird(g, ctx, rv) {
  const { w, h, style } = ctx; const t = T(ctx, g); const n = ctx.n;
  const { pos, justify } = anchorFor(g.position || 'lower-left', w, h);
  const barH = h * 0.085; const barW = Math.max(4, Math.round(h * 0.006));
  const sign = justify === 'right' ? -1 : 1;
  const textX = pos[0] + sign * (barW + h * 0.02);
  const names = [`SHP_LT_BAR_${n}`, `TXT_LT_NAME_${n}`, `TXT_LT_ROLE_${n}`];
  const ops = [
    shape(ctx, names[0], [{ type: 'rect', size: [barW, barH], fill: style.colors.accent }], [pos[0] + (justify === 'right' ? -barW / 2 : barW / 2), pos[1] + barH * 0.15], t),
    K(ctx.comp, names[0], 'scale', [k(t.a, [100, 0]), k(t.a + t.inDur * 0.7, [100, 100])], 'easeOut'),
    fadeOut(ctx, names[0], t),
    ...textBlock(ctx, rv, { name: names[1], text: applyCase(g.title || g.text, style.type.titleCase === 'upper' ? 'upper' : 'none'), size: style.type.subtitleSize * h * 1.15, font: style.fonts.display, color: style.colors.text, pos: [textX, pos[1] - barH * 0.1], justify, t, delay: t.inDur * 0.3, tracking: Math.round(style.type.tracking / 3) }),
  ];
  if (g.subtitle) ops.push(...textBlock(ctx, rv, { name: names[2], text: g.subtitle, size: style.type.bodySize * h * 0.9, font: style.fonts.body, color: style.colors.muted, pos: [textX, pos[1] + barH * 0.4], justify, t, delay: t.inDur * 0.5 }));
  return { names, ops };
}

function callout(g, ctx, rv) {
  const { w, h, style } = ctx; const t = T(ctx, g); const n = ctx.n;
  const { pos, justify } = anchorFor(g.position || 'upper-right', w, h);
  const names = [`TXT_CALLOUT_${n}`, `SHP_CALLOUT_LINE_${n}`, `SHP_CALLOUT_DOT_${n}`];
  const ops = textBlock(ctx, rv, { name: names[0], text: g.text, size: style.type.bodySize * h, font: style.fonts.body, color: style.colors.text, pos, justify, t, box: undefined });
  if (g.target) {
    const [tx, ty] = norm(g.target, w, h);
    const lineY = pos[1] + h * 0.03;
    const sx = pos[0] + (justify === 'left' ? 0 : justify === 'right' ? 0 : 0);
    ops.push(
      shape(ctx, names[1], [{ type: 'line', points: [[sx - tx, lineY - ty], [0, 0]], stroke: style.colors.accent, strokeWidth: Math.max(2, Math.round(h * 0.003)), trim: true, trimEnd: 100 }], [tx, ty], t),
      K(ctx.comp, names[1], TRIM_END, [k(t.a + t.inDur * 0.2, 0), k(t.a + t.inDur * 1.2, 100)], 'easeOut'),
      fadeOut(ctx, names[1], t),
      shape(ctx, names[2], [{ type: 'ellipse', size: [h * 0.014, h * 0.014], fill: style.colors.accent }], [tx, ty], t),
      K(ctx.comp, names[2], 'scale', [k(t.a + t.inDur, [0, 0]), k(t.a + t.inDur * 1.4, [100, 100])], 'easeOut'),
      fadeOut(ctx, names[2], t),
    );
  }
  return { names, ops };
}

const COUNT_EXPR = (p) => `var t0 = thisLayer.inPoint + ${p.delay};
var t1 = t0 + ${p.dur};
var v = ease(time, t0, t1, 0, ${p.value});
var s = v.toFixed(${p.decimals});
var parts = s.split(".");
parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
"${p.prefix}" + parts.join(".") + "${p.suffix}"`;

const fmtStatic = (g) => `${g.prefix || ''}${Number(g.value).toLocaleString('en-US', { minimumFractionDigits: g.decimals || 0, maximumFractionDigits: g.decimals || 0 })}${g.suffix || ''}`;

function stat(g, ctx, rv, { animated = true } = {}) {
  const { w, h, style } = ctx; const t = T(ctx, g); const n = ctx.n;
  const { pos, justify } = anchorFor(g.position || 'lower-left', w, h);
  const names = [`TXT_STAT_VALUE_${n}`, `TXT_STAT_LABEL_${n}`, `SHP_STAT_RULE_${n}`];
  const size = style.type.titleSize * h * 0.9;
  const ops = textBlock(ctx, rv, { name: names[0], text: fmtStatic({ ...g, value: animated ? 0 : g.value }), size, font: style.fonts.display, color: style.colors.accent, pos, justify, t, mode: 'fade_up' });
  if (animated) {
    const dur = Math.max(0.8, Math.min(2.4, (t.b - t.a) * 0.5));
    ops.splice(1, 0, ['expression', { comp: ctx.comp, layer: names[0], prop: 'sourceText', expression: COUNT_EXPR({ delay: t.inDur * 0.5, dur, value: Number(g.value), decimals: g.decimals || 0, prefix: String(g.prefix || '').replace(/"/g, '\\"'), suffix: String(g.suffix || '').replace(/"/g, '\\"') }) }]);
  }
  if (g.label) ops.push(...textBlock(ctx, rv, { name: names[1], text: applyCase(g.label, style.type.titleCase === 'upper' ? 'upper' : 'none'), size: style.type.bodySize * h, font: style.fonts.body, color: style.colors.muted, pos: [pos[0], pos[1] - size * 0.95], justify, t, delay: t.inDur * 0.3 }));
  ops.push(
    shape(ctx, names[2], [{ type: 'line', points: [[0, 0], [w * 0.1, 0]], stroke: style.colors.accent, strokeWidth: Math.max(2, Math.round(h * 0.003)) }], [justify === 'right' ? pos[0] - w * 0.05 : (justify === 'center' ? pos[0] : pos[0] + w * 0.05), pos[1] + size * 0.75], t),
    fadeOut(ctx, names[2], t),
  );
  return { names, ops };
}

function barChart(g, ctx, rv) {
  const { w, h, style } = ctx; const t = T(ctx, g); const n = ctx.n;
  const items = g.items; const max = Math.max(...items.map((i) => i.value));
  const area = { x: w * 0.2, y: h * 0.28, w: w * 0.6, h: h * 0.42 };
  const gap = area.w / items.length; const bw = gap * 0.55;
  const names = []; const ops = [];
  items.forEach((it, i) => {
    const bh = Math.max(4, (it.value / max) * area.h);
    const cx = area.x + gap * (i + 0.5); const base = area.y + area.h;
    const bar = `SHP_BAR_${n}_${i + 1}`; const lbl = `TXT_BAR_LABEL_${n}_${i + 1}`; const val = `TXT_BAR_VALUE_${n}_${i + 1}`;
    names.push(bar, lbl, val);
    const d0 = t.a + i * 0.12;
    ops.push(
      shape(ctx, bar, [{ type: 'rect', size: [bw, bh], position: [0, -bh / 2], fill: i === items.indexOf(items.reduce((a, b) => (b.value > a.value ? b : a))) ? style.colors.accent : style.colors.accent2 }], [cx, base], t),
      K(ctx.comp, bar, 'scale', [k(d0, [100, 0]), k(d0 + t.inDur * 1.2, [100, 100])], 'easeOut'),
      fadeOut(ctx, bar, t),
      ...textBlock(ctx, rv, { name: lbl, text: it.label, size: style.type.bodySize * h * 0.8, font: style.fonts.body, color: style.colors.muted, pos: [cx, base + h * 0.04], justify: 'center', t, delay: i * 0.12 }),
      ...textBlock(ctx, rv, { name: val, text: `${it.value}${g.unit ? ' ' + g.unit : ''}`, size: style.type.bodySize * h * 0.85, font: style.fonts.display, color: style.colors.text, pos: [cx, base - bh - h * 0.025], justify: 'center', t, delay: i * 0.12 + t.inDur * 0.8 }),
    );
  });
  if (g.title) { names.push(`TXT_BAR_TITLE_${n}`); ops.push(...textBlock(ctx, rv, { name: `TXT_BAR_TITLE_${n}`, text: g.title, size: style.type.subtitleSize * h, font: style.fonts.display, color: style.colors.text, pos: [w / 2, area.y - h * 0.07], justify: 'center', t })); }
  return { names, ops };
}

function highlightBox(g, ctx) {
  const { w, h, style } = ctx; const t = T(ctx, g); const n = ctx.n;
  const [x, y, rw, rh] = [g.rect[0] * w, g.rect[1] * h, g.rect[2] * w, g.rect[3] * h];
  const name = `SHP_HIGHLIGHT_${n}`;
  return { names: [name], ops: [
    shape(ctx, name, [{ type: 'rect', size: [rw, rh], stroke: style.colors.accent, strokeWidth: Math.max(3, Math.round(h * 0.004)), roundness: h * 0.004 }], [x + rw / 2, y + rh / 2], t),
    K(ctx.comp, name, 'scale', [k(t.a, [112, 112]), k(t.a + t.inDur * 0.8, [100, 100])], 'easeOut'),
    K(ctx.comp, name, 'opacity', [k(t.a, 0), k(t.a + t.inDur * 0.6, 100)], 'easeOut'),
    fadeOut(ctx, name, t),
  ] };
}

function timeline(g, ctx, rv) {
  const { w, h, style } = ctx; const t = T(ctx, g); const n = ctx.n;
  const items = g.items; const y = h * 0.62; const x0 = w * 0.12; const x1 = w * 0.88;
  const names = [`SHP_TL_LINE_${n}`]; const ops = [
    shape(ctx, names[0], [{ type: 'line', points: [[x0 - w / 2, 0], [x1 - w / 2, 0]], stroke: style.colors.muted, strokeWidth: Math.max(2, Math.round(h * 0.003)), trim: true, trimEnd: 100 }], [w / 2, y], t),
    K(ctx.comp, names[0], TRIM_END, [k(t.a, 0), k(t.a + t.inDur * 1.6, 100)], 'easeInOut'),
    fadeOut(ctx, names[0], t),
  ];
  items.forEach((it, i) => {
    const x = x0 + ((x1 - x0) * i) / (items.length - 1);
    const d0 = t.a + t.inDur * (0.8 + i * 0.35);
    const dot = `SHP_TL_NODE_${n}_${i + 1}`; const lab = `TXT_TL_LABEL_${n}_${i + 1}`; const dat = `TXT_TL_DATE_${n}_${i + 1}`;
    names.push(dot, lab, dat);
    const up = i % 2 === 0;
    ops.push(
      shape(ctx, dot, [{ type: 'ellipse', size: [h * 0.022, h * 0.022], fill: style.colors.accent }], [x, y], t),
      K(ctx.comp, dot, 'scale', [k(d0, [0, 0]), k(d0 + 0.3, [100, 100])], 'easeOut'),
      fadeOut(ctx, dot, t),
      ...textBlock(ctx, rv, { name: dat, text: String(it.date ?? ''), size: style.type.bodySize * h, font: style.fonts.display, color: style.colors.accent, pos: [x, y + (up ? -h * 0.07 : h * 0.1)], justify: 'center', t, delay: d0 - t.a }),
      ...textBlock(ctx, rv, { name: lab, text: it.label, size: style.type.bodySize * h * 0.85, font: style.fonts.body, color: style.colors.text, pos: [x, y + (up ? -h * 0.03 : h * 0.145)], justify: 'center', t, delay: d0 - t.a + 0.1 }),
    );
  });
  return { names, ops };
}

function hudCorners(g, ctx) {
  const { w, h, style } = ctx; const t = T(ctx, g); const n = ctx.n;
  const r = g.rect ? { x: g.rect[0] * w, y: g.rect[1] * h, w: g.rect[2] * w, h: g.rect[3] * h } : { x: w * 0.06, y: h * 0.08, w: w * 0.88, h: h * 0.84 };
  const L = Math.min(r.w, r.h) * 0.08; const sw = Math.max(2, Math.round(h * 0.003));
  const corners = [
    ['TL', [r.x, r.y], [[0, L], [0, 0], [L, 0]]],
    ['TR', [r.x + r.w, r.y], [[-L, 0], [0, 0], [0, L]]],
    ['BL', [r.x, r.y + r.h], [[0, -L], [0, 0], [L, 0]]],
    ['BR', [r.x + r.w, r.y + r.h], [[-L, 0], [0, 0], [0, -L]]],
  ];
  const names = []; const ops = [];
  corners.forEach(([tag, p, pts], i) => {
    const nm = `SHP_HUD_${tag}_${n}`; names.push(nm);
    ops.push(
      shape(ctx, nm, [{ type: 'polyline', points: pts, stroke: style.colors.accent, strokeWidth: sw, trim: true, trimEnd: 100 }], p, t),
      K(ctx.comp, nm, TRIM_END, [k(t.a + i * 0.08, 0), k(t.a + i * 0.08 + t.inDur, 100)], 'easeOut'),
      fadeOut(ctx, nm, t),
    );
  });
  return { names, ops };
}

function kinetic(g, ctx, rv) {
  const { w, h, style } = ctx; const t = T(ctx, g);
  const { pos, justify } = anchorFor(g.position || 'center', w, h);
  const name = `TXT_KINETIC_${ctx.n}`;
  return { names: [name], ops: textBlock(ctx, rv, { name, text: applyCase(g.text, style.type.titleCase), size: style.type.titleSize * h * 0.9, font: style.fonts.display, color: style.colors.text, pos, justify, t: { ...t, inDur: Math.min(1.6, (t.b - t.a) * 0.5) }, mode: 'typewriter' }) };
}

const BUILDERS = { title, subtitle, lower_third: lowerThird, callout, stat, bar_chart: barChart, highlight_box: highlightBox, timeline, hud_corners: hudCorners, kinetic };
const TEXTLESS = new Set(['highlight_box', 'hud_corners']);

/**
 * Build a graphic as a unit with an alternative per viable text.reveal implementation, then a final
 * "plain" alternative (static text, no animation) so the graphic itself never fails to appear.
 * @returns {{ id, label, names, alternatives: {name, ops}[] , notes: string[] }}
 */
export function buildGraphic(g, ctx) {
  const builder = BUILDERS[g.kind];
  if (!builder) throw new Error(`no builder for graphic kind ${g.kind}`);
  const chain = resolveChain('text.reveal', ctx.caps);
  const alternatives = []; let names = [];
  const rvList = TEXTLESS.has(g.kind) ? [chain.chain[0] || { id: 'none', build: () => [], resolved: {} }] : chain.chain;
  for (const rv of rvList) {
    const r = builder(g, ctx, rv);
    names = r.names;
    alternatives.push({ name: rv.id, quality: rv.quality, ops: [['layers_remove', { comp: ctx.comp, names: r.names }], ...r.ops] });
  }
  if (g.kind === 'stat') { // expression engines differ; keep a static-number alternative
    const rv = chain.chain[chain.chain.length - 1] || { id: 'none', build: () => [], resolved: {} };
    const r = stat(g, ctx, rv, { animated: false });
    alternatives.push({ name: 'static_number', quality: 0.2, ops: [['layers_remove', { comp: ctx.comp, names: r.names }], ...r.ops] });
  }
  return { id: `${ctx.sceneId}.${g.kind}.${ctx.n}`, label: `${ctx.sceneId} ${g.kind} ${ctx.n}`, names, alternatives, notes: chain.skipped.map((s) => `text.reveal/${s.impl}: ${s.reason}`) };
}
