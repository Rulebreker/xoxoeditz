// TYPOGRAPHY ENGINE: from "what should be said on screen" to text layers that are readable, inside the safe area,
// never on top of each other, animated in a way that suits the edit - and still render if an effect is missing.
//   layoutText   size / wrapping / position for a kind of text, auto-shrunk until it fits (no TEXT_OUT_OF_FRAME later)
//   planText     picks animations from the edit type's list (no repeats), times them to the beat, resolves collisions
//   buildTextUnit  executor-ready unit whose alternatives each create the layer from scratch (clean retries)

import { resolveChain } from '../effects/registry.js';
import { exitOps } from './entries.js';
import { makeRng } from '../core/rng.js';
import { snapT } from '../motion/layout.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const SAFE = { x: 0.07, y: 0.07 }; // action-safe margins as a fraction of the frame

/** Kinds of on-screen text. size = fraction of the comp HEIGHT; pos = anchor as fraction of the frame. */
export const TEXT_KINDS = {
  TITLE:       { size: 0.085, pos: [0.5, 0.5],  justify: 'center', maxWords: 6,  maxChars: 44, caseMode: 'upper', tracking: 60,  weight: 'bold', hold: [1.2, 4],  anims: ['scale_punch', 'mask_reveal', 'tracking_reveal', 'glitch_reveal', 'blur_reveal', 'fade', 'slide', 'kinetic'], widthFrac: 0.84 },
  SUBTITLE:    { size: 0.04,  pos: [0.5, 0.66], justify: 'center', maxWords: 12, maxChars: 80, caseMode: 'as-is', tracking: 20, weight: 'regular', hold: [1.2, 5], anims: ['fade', 'slide', 'word_reveal', 'mask_reveal', 'blur_reveal'], widthFrac: 0.8 },
  LOWER_THIRD: { size: 0.036, pos: [0.075, 0.84], justify: 'left', maxWords: 8, maxChars: 48, caseMode: 'as-is', tracking: 30, weight: 'bold', hold: [2, 5], anims: ['slide', 'mask_reveal', 'fade', 'tracking_reveal'], widthFrac: 0.5, decor: 'bar' },
  KEYWORD:     { size: 0.14,  pos: [0.5, 0.5],  justify: 'center', maxWords: 2,  maxChars: 18, caseMode: 'upper', tracking: 40,  weight: 'black', hold: [0.4, 1.6], anims: ['scale_punch', 'glitch_reveal', 'kinetic', 'slide'], widthFrac: 0.88 },
  STAT:        { size: 0.17,  pos: [0.5, 0.46], justify: 'center', maxWords: 2,  maxChars: 12, caseMode: 'as-is', tracking: 0,   weight: 'black', hold: [1.5, 3.5], anims: ['scale_punch', 'fade', 'slide', 'mask_reveal'], widthFrac: 0.8, label: true },
  CALLOUT:     { size: 0.03,  pos: [0.62, 0.3], justify: 'left', maxWords: 6,  maxChars: 32, caseMode: 'upper', tracking: 60,  weight: 'bold', hold: [1.2, 3], anims: ['mask_reveal', 'slide', 'fade', 'glitch_reveal'], widthFrac: 0.3, decor: 'leader' },
  LABEL:       { size: 0.022, pos: [0.08, 0.11], justify: 'left', maxWords: 4,  maxChars: 24, caseMode: 'upper', tracking: 80,  weight: 'regular', mono: true, hold: [1, 4], anims: ['character_reveal', 'fade', 'glitch_reveal'], widthFrac: 0.25 },
  HUD:         { size: 0.02,  pos: [0.07, 0.1], justify: 'left', maxWords: 6,  maxChars: 40, caseMode: 'upper', tracking: 90,  weight: 'regular', mono: true, hold: [2, 6], anims: ['character_reveal', 'glitch_reveal', 'fade'], widthFrac: 0.3 },
  END_CARD:    { size: 0.075, pos: [0.5, 0.45], justify: 'center', maxWords: 8,  maxChars: 50, caseMode: 'upper', tracking: 50,  weight: 'bold', hold: [2, 5], anims: ['fade', 'tracking_reveal', 'mask_reveal', 'blur_reveal'], widthFrac: 0.8 },
};
export const TEXT_KIND_NAMES = Object.keys(TEXT_KINDS);

/** Animation length in seconds, scaled by the edit's intensity (punchy edits snap in faster). */
const ANIM_SECONDS = { fade: 0.5, slide: 0.45, blur_reveal: 0.6, mask_reveal: 0.5, tracking_reveal: 0.8, word_reveal: 0.9, character_reveal: 0.8, scale_punch: 0.38, kinetic: 1.2, glitch_reveal: 0.45 };

/** Rough advance width per character as a fraction of the font size (bold uppercase sans is wide, mono is fixed). */
export const charWidth = (kind, c = 'a') => { const k = TEXT_KINDS[kind]; if (k.mono) return 0.6; const base = k.weight === 'black' ? 0.62 : k.weight === 'bold' ? 0.58 : 0.52; return /[A-Z0-9]/.test(c) ? base * 1.12 : /[ilI.,:;'|!]/.test(c) ? base * 0.5 : /[mwMW@]/.test(c) ? base * 1.35 : base; };

export function applyCase(kind, text) { const m = TEXT_KINDS[kind].caseMode; return m === 'upper' ? text.toUpperCase() : text; }

function wrapLines(kind, text, sizePx, maxWidthPx, trackingPx) {
  const words = text.split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  const width = (s) => [...s].reduce((a, ch) => a + charWidth(kind, ch) * sizePx + trackingPx, 0);
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (!cur || width(t) <= maxWidthPx) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur);
  return { lines, width: Math.max(...lines.map(width), 0) };
}

/**
 * Size, wrap and place text so it fits. Shrinks (down to 55 % of the nominal size) before giving up; reports
 * what it did. `anchor` overrides the kind's default position (frame fractions).
 */
export function layoutText(kind, text, comp, { anchor = null, sizeScale = 1, maxLines = 3 } = {}) {
  const k = TEXT_KINDS[kind]; if (!k) throw new Error(`unknown text kind "${kind}" (known: ${TEXT_KIND_NAMES.join(', ')})`);
  const warnings = [];
  let t = applyCase(kind, String(text).trim().replace(/\s+/g, ' '));
  const words = t.split(' ');
  if (words.length > k.maxWords || t.length > k.maxChars) { warnings.push(`${kind} text is long (${words.length} words, ${t.length} chars; recommended ≤ ${k.maxWords} words / ${k.maxChars} chars)`); }
  const pos = anchor || k.pos;
  const safeW = comp.w * (1 - 2 * SAFE.x); const safeH = comp.h * (1 - 2 * SAFE.y);
  // available width depends on where the text is anchored and how it is justified
  let avail = comp.w * k.widthFrac;
  if (k.justify === 'center') avail = Math.min(avail, 2 * Math.min(pos[0], 1 - pos[0]) * comp.w - 2 * SAFE.x * comp.w, safeW);
  else if (k.justify === 'left') avail = Math.min(avail, (1 - pos[0]) * comp.w - SAFE.x * comp.w);
  else avail = Math.min(avail, pos[0] * comp.w - SAFE.x * comp.w);
  avail = Math.max(avail, comp.w * 0.12);
  let size = Math.round(comp.h * k.size * sizeScale); const nominal = size; let lay;
  for (let i = 0; i < 40; i++) {
    lay = wrapLines(kind, t, size, avail, (k.tracking / 1000) * size);
    const lineH = size * 1.18; const h = lay.lines.length * lineH;
    if (lay.width <= avail && lay.lines.length <= maxLines && h <= safeH * 0.6) break;
    if (size <= nominal * 0.55) { warnings.push(`${kind} text needs ${lay.lines.length} lines even at ${Math.round((size / nominal) * 100)}% size`); break; }
    size = Math.round(size * 0.93);
  }
  if (size < nominal) warnings.push(`size reduced to ${Math.round((size / nominal) * 100)}% to fit`);
  const lineH = size * 1.18; const h = lay.lines.length * lineH; const w = lay.width;
  const px = pos[0] * comp.w; const py = pos[1] * comp.h;
  // rectangle the text occupies (centre-anchored for centred text, left/right-anchored otherwise)
  const x0 = k.justify === 'center' ? px - w / 2 : k.justify === 'left' ? px : px - w; const y0 = py - h / 2;
  const rect = { x: x0, y: y0, w, h };
  const inside = rect.x >= comp.w * SAFE.x - 1 && rect.x + rect.w <= comp.w * (1 - SAFE.x) + 1 && rect.y >= comp.h * SAFE.y - 1 && rect.y + rect.h <= comp.h * (1 - SAFE.y) + 1;
  if (!inside) warnings.push(`${kind} text sits outside the safe area (${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.w)}x${Math.round(rect.h)})`);
  return { kind, text: lay.lines.join('\n'), lines: lay.lines.length, size, nominalSize: nominal, scaled: size < nominal, position: [Math.round(px), Math.round(py)], justify: k.justify, tracking: k.tracking, rect, fits: inside && lay.width <= avail + 1, warnings };
}

const overlap = (a, b, pad = 0.02) => { const p = pad; return a.x < b.x + b.w + p && a.x + a.w + p > b.x && a.y < b.y + b.h + p && a.y + a.h + p > b.y; };
const ANCHORS = { TITLE: [[0.5, 0.5], [0.5, 0.4], [0.5, 0.6]], SUBTITLE: [[0.5, 0.66], [0.5, 0.74], [0.5, 0.58]], KEYWORD: [[0.5, 0.5], [0.5, 0.38], [0.5, 0.62]], STAT: [[0.5, 0.46], [0.5, 0.36]], CALLOUT: [[0.62, 0.3], [0.62, 0.55], [0.1, 0.3]], LABEL: [[0.08, 0.11], [0.08, 0.89]], HUD: [[0.07, 0.1], [0.55, 0.1], [0.07, 0.9]], LOWER_THIRD: [[0.075, 0.84], [0.075, 0.74]], END_CARD: [[0.5, 0.45]] };

/**
 * Plan a list of text items. item = { kind, text, at (seconds), dur?, target?: {x,y} (callout/label frame fractions), emphasis?: 0..1, id? }.
 * opts = { comp, editType, dials: {intensity,text}, seed, snap?: (t)=>t, fps, maxSimultaneous = 2 }
 * Items that cannot be placed without covering another one are moved to an alternative anchor, then dropped (reported).
 */
export function planText(items, opts) {
  const { comp, editType, dials = {}, seed = 'text', snap = (t) => t, fps = 24, maxSimultaneous = 2 } = opts;
  const rng = makeRng('text', seed); const intensity = clamp(dials.intensity ?? editType?.dials?.intensity ?? 0.5, 0, 1);
  const prefer = editType?.typography?.animations || ['fade'];
  const placed = []; const dropped = []; const history = [];
  const sorted = items.map((it, i) => ({ ...it, _i: i })).sort((a, b) => a.at - b.at || a._i - b._i);
  for (const it of sorted) {
    const k = TEXT_KINDS[it.kind]; if (!k) { dropped.push({ item: it, reason: `unknown text kind "${it.kind}"` }); continue; }
    if (!String(it.text ?? '').trim()) { dropped.push({ item: it, reason: 'empty text' }); continue; }
    const holdRange = k.hold; const dur = it.dur ?? clamp(holdRange[0] + (holdRange[1] - holdRange[0]) * (1 - intensity), holdRange[0], holdRange[1]);
    const at = snapT(snap(it.at), fps);
    // animation: the edit type's preference, restricted to what suits this kind, avoiding the last two used
    const allowed = k.anims.filter((a) => prefer.includes(a));
    const pool = (allowed.length ? allowed : k.anims.filter((a) => ['fade', 'slide', 'scale_punch'].includes(a)));
    const fresh = pool.filter((a) => !history.slice(-2).includes(a));
    let anim = it.animation && TEXT_ANIM_OK(it.animation) ? it.animation : rng.pick(fresh.length ? fresh : pool);
    if (anim === 'kinetic' && String(it.text).split(/\s+/).length < 2) { const alt = pool.filter((a) => a !== 'kinetic' && !history.slice(-2).includes(a)); anim = alt.length ? rng.pick(alt) : (pool.find((a) => a !== 'kinetic') || 'scale_punch'); }
    // placement with collision avoidance against everything alive at the same time
    const alive = placed.filter((p) => p.at < at + dur && p.at + p.dur > at);
    if (alive.length >= maxSimultaneous) { dropped.push({ item: it, reason: `already ${alive.length} texts on screen` }); continue; }
    const anchors = it.target && (it.kind === 'CALLOUT' || it.kind === 'LABEL') ? [calloutAnchor(it.target)] : [null, ...(ANCHORS[it.kind] || []).slice(1)];
    let chosen = null; let lastLay = null;
    for (const anchor of anchors) {
      const lay = layoutText(it.kind, it.text, comp, { anchor: anchor || undefined });
      lastLay = lay;
      if (!lay.fits) continue;
      if (alive.some((p) => overlap(p.layout.rect, lay.rect))) continue;
      chosen = lay; break;
    }
    if (!chosen) { dropped.push({ item: it, reason: lastLay && !lastLay.fits ? `does not fit: ${lastLay.warnings.join('; ')}` : 'overlaps another text at every anchor' }); continue; }
    const d = snapT(Math.max(2 / fps, (ANIM_SECONDS[anim] ?? 0.5) * (1.35 - 0.7 * intensity)), fps);
    const entry = { id: it.id ?? `TXT_${String(placed.length + 1).padStart(2, '0')}`, kind: it.kind, text: chosen.text, animation: anim, at, dur: +dur.toFixed(3), animDur: d, outDur: it.kind === 'KEYWORD' ? 0 : snapT(0.25, fps), layout: chosen, target: it.target || null, warnings: chosen.warnings, emphasis: it.emphasis ?? 0.5 };
    placed.push(entry); history.push(anim);
  }
  return { items: placed, dropped };
}
function calloutAnchor(t) { return [clamp(t.x + (t.x > 0.5 ? -0.3 : 0.08), 0.08, 0.7), clamp(t.y - 0.12, 0.12, 0.85)]; }
const TEXT_ANIM_OK = (a) => ANIM_SECONDS[a] !== undefined;

/**
 * Executor-ready unit for one planned text item. Every alternative recreates the layer from scratch, so a failed
 * animation can fall back to the next one without leaving half-built layers behind.
 * ctx = { comp: {name,w,h}, fps, caps, style: {font,color,stroke...}, beats?: [times], layerName?, dir? }
 */
export function buildTextUnit(entry, ctx) {
  const { comp, fps = 24, caps = null, style = {} } = ctx;
  const name = ctx.layerName || `TXT_${entry.id}`;
  const k = TEXT_KINDS[entry.kind];
  const t0 = entry.at; const t1 = +(entry.at + entry.dur).toFixed(4);
  const c = { comp: comp.name, layer: name, t: t0, d: entry.animDur, hold: entry.dur, pos: entry.layout.position, w: comp.w, h: comp.h, size: entry.layout.size, text: entry.text.replace(/\n/g, ' '), words: entry.text.replace(/\n/g, ' ').split(/\s+/), beats: ctx.beats ? ctx.beats.filter((b) => b >= t0 && b < t1) : null, style: { ...style, justify: entry.layout.justify, tracking: entry.layout.tracking, allCaps: k.caseMode === 'upper' }, dir: ctx.dir ?? 0, strength: ctx.strength ?? 0.5, out: entry.outDur ? { t: +(t1 - entry.outDur).toFixed(4), d: entry.outDur } : null };
  const create = [
    ['layers_remove', { comp: comp.name, names: [name], prefix: true }],
    ['layer_add_text', { comp: comp.name, name, text: entry.text, size: entry.layout.size, font: style.font, color: style.color, stroke: style.stroke, strokeWidth: style.strokeWidth, justify: entry.layout.justify, tracking: entry.layout.tracking, allCaps: k.caseMode === 'upper' || undefined, position: entry.layout.position, start: t0, end: t1 }],
  ];
  const decor = decorOps(entry, ctx, name, t0, t1);
  const chain = resolveChain(`text.anim.${entry.animation}`, caps).chain;
  const alternatives = chain.map((impl) => ({ name: impl.id, quality: impl.quality, ops: [...create, ...impl.build(c, impl.resolved), ...(impl.kinetic ? [] : exitOps(c)), ...decor] }));
  alternatives.push({ name: 'plain', quality: 0.05, ops: [...create] });
  return { id: `text.${entry.id}`, label: `${entry.kind} "${entry.text.replace(/\n/g, ' ')}" (${entry.animation})`, names: [name, `SHP_${entry.id}_BAR`, `SHP_${entry.id}_LEADER`, `SHP_${entry.id}_DOT`], alternatives, warnings: entry.warnings };
}

/** Intentional graphic furniture for a kind: an accent bar under a lower third, a leader line + dot for a callout. */
function decorOps(entry, ctx, name, t0, t1) {
  const { comp } = ctx; const k = TEXT_KINDS[entry.kind]; const L = entry.layout; const col = ctx.accent || '#ffffff';
  if (k.decor === 'bar') {
    const barW = Math.round(Math.min(L.rect.w * 1.05, comp.w * 0.4)); const barH = Math.max(3, Math.round(comp.h * 0.004));
    return [['layers_remove', { comp: comp.name, names: [`SHP_${entry.id}_BAR`] }],
      ['layer_add_shape', { comp: comp.name, name: `SHP_${entry.id}_BAR`, position: [L.rect.x + barW / 2, L.rect.y - barH * 3], shapes: [{ type: 'rect', size: [barW, barH], fill: col }], start: t0, end: t1 }],
      ['keyframes', { comp: comp.name, layer: `SHP_${entry.id}_BAR`, prop: 'scale', keys: [{ t: t0, v: [0, 100] }, { t: +(t0 + entry.animDur).toFixed(4), v: [100, 100] }], ease: 'easeOut' }]];
  }
  if (k.decor === 'leader' && entry.target) {
    const tx = entry.target.x * comp.w; const ty = entry.target.y * comp.h; const ax = L.rect.x + (tx > L.rect.x ? 0 : L.rect.w); const ay = L.rect.y + L.rect.h / 2;
    return [['layers_remove', { comp: comp.name, names: [`SHP_${entry.id}_LEADER`, `SHP_${entry.id}_DOT`] }],
      ['layer_add_shape', { comp: comp.name, name: `SHP_${entry.id}_LEADER`, position: [0, 0], shapes: [{ type: 'line', points: [[ax, ay], [tx, ty]], stroke: col, strokeWidth: Math.max(2, Math.round(comp.h * 0.002)), trim: [0, 100] }], start: t0, end: t1 }],
      ['layer_add_shape', { comp: comp.name, name: `SHP_${entry.id}_DOT`, position: [tx, ty], shapes: [{ type: 'ellipse', size: [comp.h * 0.014, comp.h * 0.014], fill: col }], start: t0, end: t1 }]];
  }
  void name; return [];
}
