// TYPOGRAPHY ENGINE: from "what should be said on screen" to text layers that are readable, inside the safe area,
// never on top of each other, animated in a way that suits the edit - and still render if an effect is missing.
//   layoutText   size / wrapping / position for a kind of text, auto-shrunk until it fits (no TEXT_OUT_OF_FRAME later)
//   planText     picks animations from the edit type's list (no repeats), times them to the beat, resolves collisions
//   buildTextUnit  executor-ready unit whose alternatives each create the layer from scratch (clean retries)

import { resolveChain } from '../effects/registry.js';
import { exitOps, roleFallbacks } from './entries.js';
import { makeRng } from '../core/rng.js';
import { snapT } from '../motion/layout.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Default text-safe area as a fraction of the frame, per edge: titles never leave it, nothing is placed in the bottom 10 % (caption territory). */
export const SAFE_AREA = { left: 0.05, right: 0.05, top: 0.08, bottom: 0.10 };
export const safeBox = (comp, safe = SAFE_AREA) => ({ left: comp.w * safe.left, top: comp.h * safe.top, right: comp.w * (1 - safe.right), bottom: comp.h * (1 - safe.bottom) });

/** Semantic roles (a text kind IS its role) and the short names used in deterministic layer ids (TXT_TITLE_01, TXT_END_01, TXT_KEYWORD_03). */
export const ROLE_ABBR = { TITLE: 'TITLE', SUBTITLE: 'SUB', LOWER_THIRD: 'LOWER', CAPTION: 'CAP', CALLOUT: 'CALLOUT', HUD: 'HUD', LABEL: 'LABEL', STAT: 'STAT', END_CARD: 'END', KEYWORD: 'KEYWORD' };
/** Headlines own the screen: at most one is visible at any moment, however many shots there are. */
export const HEADLINE_ROLES = ['TITLE', 'END_CARD', 'KEYWORD', 'STAT'];
/** Roles that always have to exist when the Director asked for them (never silently dropped). */
export const REQUIRED_ROLES = ['TITLE', 'END_CARD'];

// Pairs of roles that MAY be visible at the same time (text over footage is normal; text over text needs a reason).
// Even an allowed pair has to occupy separate areas of the frame. Everything not listed is an unintentional overlap.
const COEXIST = new Set([
  'TITLE|SUBTITLE', 'TITLE|LOWER_THIRD', 'TITLE|CAPTION', 'TITLE|HUD', 'TITLE|LABEL', 'TITLE|CALLOUT',
  'END_CARD|SUBTITLE', 'END_CARD|CAPTION', 'END_CARD|HUD', 'END_CARD|LABEL', 'END_CARD|LOWER_THIRD',
  'KEYWORD|CAPTION', 'KEYWORD|HUD', 'KEYWORD|LABEL', 'KEYWORD|LOWER_THIRD', 'KEYWORD|CALLOUT', 'KEYWORD|SUBTITLE',
  'STAT|CAPTION', 'STAT|HUD', 'STAT|LABEL', 'STAT|CALLOUT', 'STAT|LOWER_THIRD', 'STAT|SUBTITLE',
  'SUBTITLE|HUD', 'SUBTITLE|LABEL', 'SUBTITLE|LOWER_THIRD', 'SUBTITLE|CALLOUT',
  'LOWER_THIRD|CAPTION', 'LOWER_THIRD|CALLOUT', 'LOWER_THIRD|HUD', 'LOWER_THIRD|LABEL',
  'CALLOUT|CAPTION', 'CALLOUT|HUD', 'CALLOUT|LABEL', 'CALLOUT|CALLOUT',
  'HUD|CAPTION', 'HUD|HUD', 'HUD|LABEL', 'LABEL|CAPTION', 'LABEL|LABEL',
]);
/** May two texts of these roles be on screen together? (They must still not occupy the same area.) */
export const textMayCoexist = (a, b) => COEXIST.has(`${a}|${b}`) || COEXIST.has(`${b}|${a}`);
/** Approximate area the burned-in captions occupy (bottom band), so other text keeps out of it. */
export const captionZone = (comp, { bottom = 0.1, size = 0.04, lines = 2 } = {}) => { const sz = Math.round(comp.h * size); const baseline = comp.h * (1 - bottom); return { x: comp.w * 0.05, y: baseline - sz * 1.0, w: comp.w * 0.9, h: sz * (0.4 + lines * 1.2) }; };

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
 * Size, wrap and place text so it fits - the layout engine. Wrapping comes first (more lines at the nominal size), the
 * size shrinks only when the line budget is exhausted (down to 55 %), and the result carries a `fit` payload for the
 * host's `text_fit` op, which repeats the job with MEASURED bounds inside After Effects (this module can only estimate
 * glyph widths). `anchor` overrides the kind's default position (frame fractions); `avoid` = rects (px) to keep out of.
 * Estimates are checked against the safe area (SAFE_AREA: 5 % left/right, 8 % top, 10 % bottom).
 */
export function layoutText(kind, text, comp, { anchor = null, sizeScale = 1, maxLines = null, safe = SAFE_AREA, avoid = [] } = {}) {
  const k = TEXT_KINDS[kind]; if (!k) throw new Error(`unknown text kind "${kind}" (known: ${TEXT_KIND_NAMES.join(', ')})`);
  const warnings = [];
  const t = applyCase(kind, String(text).trim().replace(/\s+/g, ' '));
  const words = t.split(' ');
  if (words.length > k.maxWords || t.length > k.maxChars) { warnings.push(`${kind} text is long (${words.length} words, ${t.length} chars; recommended ≤ ${k.maxWords} words / ${k.maxChars} chars)`); }
  const pos = anchor || k.pos;
  const portrait = comp.h > comp.w;
  const lineBudget = maxLines ?? (kind === 'TITLE' || kind === 'END_CARD' ? (portrait ? 4 : 3) : kind === 'SUBTITLE' ? 3 : kind === 'LOWER_THIRD' || kind === 'CALLOUT' ? 2 : kind === 'HUD' || kind === 'LABEL' ? 2 : 2);
  const box = safeBox(comp, safe); const safeW = box.right - box.left; const safeH = box.bottom - box.top;
  // available width depends on where the text is anchored and how it is justified
  let avail = comp.w * k.widthFrac; if (portrait) avail = Math.max(avail, safeW * 0.9);
  const px = pos[0] * comp.w; const py = pos[1] * comp.h;
  if (k.justify === 'center') avail = Math.min(avail, 2 * Math.min(px - box.left, box.right - px), safeW);
  else if (k.justify === 'left') avail = Math.min(avail, box.right - px);
  else avail = Math.min(avail, px - box.left);
  avail = Math.max(avail, comp.w * 0.12);
  let size = Math.round(comp.h * k.size * sizeScale); const nominal = size; let lay;
  for (let i = 0; i < 40; i++) {
    lay = wrapLines(kind, t, size, avail, (k.tracking / 1000) * size);
    const lineH = size * 1.18; const h = lay.lines.length * lineH;
    if (lay.width <= avail && lay.lines.length <= lineBudget && h <= safeH * 0.6) break;
    if (size <= nominal * 0.55) { warnings.push(`${kind} text needs ${lay.lines.length} lines even at ${Math.round((size / nominal) * 100)}% size`); break; }
    size = Math.round(size * 0.93);
  }
  if (size < nominal) warnings.push(`size reduced to ${Math.round((size / nominal) * 100)}% to fit`);
  const lineH = size * 1.18; const h = lay.lines.length * lineH; const w = lay.width;
  // rectangle the text occupies (centre-anchored for centred text, left/right-anchored otherwise)
  const x0 = k.justify === 'center' ? px - w / 2 : k.justify === 'left' ? px : px - w; const y0 = py - h / 2;
  const rect = { x: x0, y: y0, w, h };
  const inside = rect.x >= box.left - 1 && rect.x + rect.w <= box.right + 1 && rect.y >= box.top - 1 && rect.y + rect.h <= box.bottom + 1;
  if (!inside) warnings.push(`${kind} text sits outside the safe area (${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.w)}x${Math.round(rect.h)})`);
  const hit = avoid.find((z) => overlap(rect, z, 0));
  if (hit) warnings.push(`${kind} text collides with the caption zone`);
  // point text anchors on the first baseline: the estimate of where that is (the host re-places it from measured bounds)
  const position = [Math.round(k.justify === 'center' ? px : k.justify === 'left' ? rect.x : rect.x + rect.w), Math.round(rect.y + size * 0.82)];
  // region the text must stay inside (horizontally the allowed width around the anchor), kept away from the caption band
  const bx0 = k.justify === 'center' ? px - avail / 2 : k.justify === 'left' ? px : px - avail; const bx1 = k.justify === 'center' ? px + avail / 2 : k.justify === 'left' ? px + avail : px;
  let top = box.top; let bottom = box.bottom;
  for (const z of avoid) { if (z.y >= py) bottom = Math.min(bottom, z.y - comp.h * 0.01); else top = Math.max(top, z.y + z.h + comp.h * 0.01); }
  const fit = { box: { left: Math.round(Math.max(box.left, bx0)), top: Math.round(top), right: Math.round(Math.min(box.right, bx1)), bottom: Math.round(Math.max(top + 1, bottom)) }, ref: [Math.round(k.justify === 'center' ? px : k.justify === 'left' ? rect.x : rect.x + rect.w), Math.round(py)], hAlign: k.justify, vAlign: 'center', maxLines: lineBudget, minSize: Math.max(8, Math.round(size * 0.6)) };
  return { kind, text: lay.lines.join('\n'), lines: lay.lines.length, size, nominalSize: nominal, scaled: size < nominal, position, justify: k.justify, tracking: k.tracking, rect, fits: inside && lay.width <= avail + 1 && !hit, fit, warnings };
}

const overlap = (a, b, pad = 0.02) => { const p = pad; return a.x < b.x + b.w + p && a.x + a.w + p > b.x && a.y < b.y + b.h + p && a.y + a.h + p > b.y; };
const ANCHORS = { TITLE: [[0.5, 0.5], [0.5, 0.4], [0.5, 0.6]], SUBTITLE: [[0.5, 0.66], [0.5, 0.74], [0.5, 0.58], [0.5, 0.78], [0.5, 0.3], [0.5, 0.22]], KEYWORD: [[0.5, 0.5], [0.5, 0.38], [0.5, 0.62]], STAT: [[0.5, 0.46], [0.5, 0.36]], CALLOUT: [[0.62, 0.3], [0.62, 0.55], [0.1, 0.3]], LABEL: [[0.08, 0.11], [0.08, 0.89]], HUD: [[0.07, 0.1], [0.55, 0.1], [0.07, 0.9]], LOWER_THIRD: [[0.075, 0.84], [0.075, 0.74]], END_CARD: [[0.5, 0.45]] };

/**
 * Plan a list of text items. item = { kind, text, at (seconds), dur?, target?: {x,y} (callout/label frame fractions),
 * emphasis?: 0..1, id?, shotId?, required?, allowOverlap? }.
 * opts = { comp, editType, dials: {intensity,text}, seed, snap?: (t)=>t, fps, shots?: [{id,start,end}], avoid?: [rect px] }
 *
 * Every planned entry has an EXPLICIT interval (start, end, duration - clamped into its shot's window when `shots` is
 * given, so a title can never outlive the shot it belongs to), a semantic role, a deterministic id (TXT_TITLE_01,
 * TXT_END_01, TXT_KEYWORD_03 - never derived from the display text) and a layout. Visibility rules:
 *  - headline roles (TITLE, END_CARD, KEYWORD, STAT) are mutually exclusive in time;
 *  - other roles may coexist (see textMayCoexist) only in separate areas of the frame;
 *  - `required` items (TITLE / END_CARD the Director asked for) are placed first and are never dropped for a collision -
 *    the optional text around them gives way;
 *  - `allowOverlap` on an item is the explicit opt-out.
 * Items that cannot be placed without covering another one are moved to an alternative anchor, then dropped (reported).
 */
export function planText(items, opts) {
  const { comp, editType, dials = {}, seed = 'text', snap = (t) => t, fps = 24, shots = null, avoid = [] } = opts;
  const rng = makeRng('text', seed); const intensity = clamp(dials.intensity ?? editType?.dials?.intensity ?? 0.5, 0, 1);
  const prefer = editType?.typography?.animations || ['fade'];
  const placed = []; const dropped = []; const history = [];
  const window = (it) => (shots ? shots.find((x) => x.id === it.shotId) || shots.find((x) => it.at >= x.start - 1e-6 && it.at < x.end - 1e-6) || null : null);
  // required first (they cannot lose a collision), then by time; animation history follows time order within each pass
  const sorted = items.map((it, i) => ({ ...it, required: Boolean(it.required), _i: i })).sort((a, b) => Number(b.required) - Number(a.required) || a.at - b.at || a._i - b._i);
  for (const it of sorted) {
    const k = TEXT_KINDS[it.kind]; if (!k) { dropped.push({ item: it, reason: `unknown text kind "${it.kind}"` }); continue; }
    if (!String(it.text ?? '').trim()) { dropped.push({ item: it, reason: 'empty text' }); continue; }
    const holdRange = k.hold; let dur = it.dur ?? clamp(holdRange[0] + (holdRange[1] - holdRange[0]) * (1 - intensity), holdRange[0], holdRange[1]);
    let at = snapT(snap(it.at), fps);
    const win = window(it);
    if (win) { // the interval lives inside its shot: shift earlier before shortening, never beyond the shot's end
      const winLen = win.end - win.start; dur = Math.min(dur, winLen);
      at = clamp(at, win.start, Math.max(win.start, win.end - dur)); at = snapT(at, fps);
      if (at + dur > win.end + 1e-6) dur = Math.max(2 / fps, win.end - at);
    }
    dur = Math.max(2 / fps, dur);
    // animation: the edit type's preference, restricted to what suits this kind, avoiding the last two used
    const allowed = k.anims.filter((a) => prefer.includes(a));
    const pool = (allowed.length ? allowed : k.anims.filter((a) => ['fade', 'slide', 'scale_punch'].includes(a)));
    const fresh = pool.filter((a) => !history.slice(-2).includes(a));
    let anim = it.animation && TEXT_ANIM_OK(it.animation) ? it.animation : rng.pick(fresh.length ? fresh : pool);
    if (anim === 'kinetic' && String(it.text).split(/\s+/).length < 2) { const alt = pool.filter((a) => a !== 'kinetic' && !history.slice(-2).includes(a)); anim = alt.length ? rng.pick(alt) : (pool.find((a) => a !== 'kinetic') || 'scale_punch'); }
    // visibility conflicts with everything alive at the same time
    const alive = placed.filter((p) => p.at < at + dur - 1e-6 && p.at + p.dur > at + 1e-6);
    if (!it.allowOverlap) {
      const clash = alive.find((p) => !p.allowOverlap && !textMayCoexist(it.kind, p.kind));
      if (clash) { dropped.push({ item: it, reason: `${clash.kind} ${clash.id} is already on screen (${it.kind} may not share the frame with it)` }); continue; }
    }
    const anchors = it.target && (it.kind === 'CALLOUT' || it.kind === 'LABEL') ? [calloutAnchor(it.target)] : [null, ...(ANCHORS[it.kind] || []).slice(1)];
    let chosen = null; let lastLay = null;
    for (const anchor of anchors) {
      const lay = layoutText(it.kind, it.text, comp, { anchor: anchor || undefined, avoid: it.kind === 'CAPTION' ? [] : avoid });
      lastLay = lay;
      if (!lay.fits) continue;
      if (!it.allowOverlap && alive.some((p) => !p.allowOverlap && overlap(p.layout.rect, lay.rect))) continue;
      chosen = lay; break;
    }
    if (!chosen && it.required && lastLay) chosen = lastLay; // a required text is placed even if the estimate is unhappy: the host fits it by measurement
    if (!chosen) { dropped.push({ item: it, reason: lastLay && !lastLay.fits ? `does not fit: ${lastLay.warnings.join('; ')}` : 'overlaps another text at every anchor' }); continue; }
    const outDur = it.kind === 'KEYWORD' ? 0 : snapT(Math.min(0.25, dur * 0.25), fps);
    // the entrance (and exit) must end inside the interval: animation never changes WHEN the text is visible
    const d = snapT(Math.min(Math.max(2 / fps, (ANIM_SECONDS[anim] ?? 0.5) * (1.35 - 0.7 * intensity)), Math.max(2 / fps, (dur - outDur) * 0.8)), fps);
    const end = +(at + dur).toFixed(4);
    const entry = { id: it.id ?? null, kind: it.kind, role: it.kind, text: chosen.text, animation: anim, at, dur: +dur.toFixed(3), start: at, end, duration: +dur.toFixed(3), animDur: d, outDur, layout: chosen, target: it.target || null, warnings: chosen.warnings, emphasis: it.emphasis ?? 0.5, shotId: it.shotId ?? win?.id ?? null, sceneId: it.shotId ?? win?.id ?? null, required: it.required, allowOverlap: Boolean(it.allowOverlap) };
    placed.push(entry); history.push(anim);
  }
  // deterministic ids in time order per role: TXT_TITLE_01, TXT_END_01, TXT_KEYWORD_03 (an id the caller supplied is kept)
  const counters = {}; placed.sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind));
  for (const e of placed) { if (e.id) continue; counters[e.kind] = (counters[e.kind] || 0) + 1; e.id = `TXT_${ROLE_ABBR[e.kind] || e.kind}_${String(counters[e.kind]).padStart(2, '0')}`; }
  return { items: placed, dropped };
}
function calloutAnchor(t) { return [clamp(t.x + (t.x > 0.5 ? -0.3 : 0.08), 0.08, 0.7), clamp(t.y - 0.12, 0.12, 0.85)]; }
const TEXT_ANIM_OK = (a) => ANIM_SECONDS[a] !== undefined;

/**
 * Executor-ready unit for one planned text item. Every alternative recreates the layer from scratch, so a failed
 * animation can fall back to the next one without leaving half-built layers behind (and `layer_add_text` itself is
 * atomic, so even a failure INSIDE creation leaves nothing). Each alternative is: remove stale -> create (name, interval
 * and ownership mark applied immediately) -> text_fit (measured placement) -> animation (position moves are relative,
 * because the fitted position is only known at build time) -> exit -> decor.
 * Required roles (TITLE / END_CARD marked required) are never optional and have extra fallback animations, ending in a
 * plain static layer: the text always exists.
 * ctx = { comp: {name,w,h}, fps, caps, style: {font,color,stroke...}, beats?: [times], layerName?, dir? }
 */
export function buildTextUnit(entry, ctx) {
  const { comp, fps = 24, caps = null, style = {} } = ctx;
  const name = ctx.layerName || (String(entry.id).startsWith('TXT_') ? entry.id : `TXT_${entry.id}`);
  const k = TEXT_KINDS[entry.kind];
  const t0 = entry.at; const t1 = +(entry.at + entry.dur).toFixed(4);
  const rest = +Math.min(t1 - Math.max(entry.outDur || 0, 0.02) - 0.01, Math.max(t0 + 0.02, t0 + entry.animDur + 1 / fps)).toFixed(4);
  const fit = entry.layout.fit || null;
  const mark = { k: 'text', role: entry.kind, id: name, shot: entry.shotId || undefined, rest };
  const c = { comp: comp.name, layer: name, t: t0, d: entry.animDur, hold: entry.dur, pos: entry.layout.position, w: comp.w, h: comp.h, size: entry.layout.size, role: entry.kind, shot: entry.shotId, fit, rest, text: entry.text.replace(/\n/g, ' '), words: entry.text.replace(/\n/g, ' ').split(/\s+/), beats: ctx.beats ? ctx.beats.filter((b) => b >= t0 && b < t1) : null, style: { ...style, justify: entry.layout.justify, tracking: entry.layout.tracking, allCaps: k.caseMode === 'upper' }, dir: ctx.dir ?? 0, strength: ctx.strength ?? 0.5, out: entry.outDur ? { t: +(t1 - entry.outDur).toFixed(4), d: entry.outDur } : null };
  const create = [
    ['layers_remove', { comp: comp.name, names: [name], prefix: true }],
    ['layer_add_text', { comp: comp.name, name, text: entry.text, size: entry.layout.size, font: style.font, color: style.color, stroke: style.stroke, strokeWidth: style.strokeWidth, justify: entry.layout.justify, tracking: entry.layout.tracking, caps: k.caseMode === 'upper' ? 'upper' : undefined, position: entry.layout.position, start: t0, end: t1, role: entry.kind, mark }],
    ...(fit ? [['text_fit', { comp: comp.name, layer: name, at: rest, ...fit }]] : []),
  ];
  const decor = decorOps(entry, ctx, name, t0, t1);
  const chain = resolveChain(`text.anim.${entry.animation}`, caps).chain;
  const alternatives = chain.map((impl) => ({ name: impl.id, quality: impl.quality, ops: [...create, ...impl.build(c, impl.resolved), ...(impl.kinetic ? [] : exitOps(c)), ...decor] }));
  for (const fb of roleFallbacks(entry.kind)) if (!alternatives.some((a) => a.name === fb.id)) alternatives.push({ name: fb.id, quality: fb.quality, ops: [...create, ...fb.build(c), ...exitOps(c), ...decor] });
  alternatives.push({ name: 'plain', quality: 0.05, ops: [...create] });
  const required = Boolean(entry.required);
  // the unit owns EVERY layer any alternative creates (kinetic type makes one layer per word)
  const owned = [...new Set([name, `SHP_${decorId(name)}_BAR`, `SHP_${decorId(name)}_LEADER`, `SHP_${decorId(name)}_DOT`, ...alternatives.flatMap((a) => a.ops.filter(([op, x]) => /^layer_add_/.test(op) && x?.name).map(([, x]) => x.name))])];
  return { id: `text.${name}`, label: `${entry.kind} "${entry.text.replace(/\n/g, ' ')}" (${entry.animation})`, names: owned, alternatives, warnings: entry.warnings, required, optional: !required, text: { name, role: entry.kind, shotId: entry.shotId || null, start: t0, end: t1, duration: +(t1 - t0).toFixed(4), required, rest } };
}
const decorId = (name) => String(name).replace(/^TXT_/, '');

/** Intentional graphic furniture for a kind: an accent bar under a lower third, a leader line + dot for a callout. */
function decorOps(entry, ctx, name, t0, t1) {
  const { comp } = ctx; const k = TEXT_KINDS[entry.kind]; const L = entry.layout; const col = ctx.accent || '#ffffff';
  if (k.decor === 'bar') {
    const barW = Math.round(Math.min(L.rect.w * 1.05, comp.w * 0.4)); const barH = Math.max(3, Math.round(comp.h * 0.004));
    return [['layers_remove', { comp: comp.name, names: [`SHP_${decorId(name)}_BAR`] }],
      ['layer_add_shape', { comp: comp.name, name: `SHP_${decorId(name)}_BAR`, position: [L.rect.x + barW / 2, L.rect.y - barH * 3], shapes: [{ type: 'rect', size: [barW, barH], fill: col }], start: t0, end: t1, mark: { k: 'textdecor', id: `SHP_${decorId(name)}_BAR` } }],
      ['keyframes', { comp: comp.name, layer: `SHP_${decorId(name)}_BAR`, prop: 'scale', keys: [{ t: t0, v: [0, 100] }, { t: +(t0 + entry.animDur).toFixed(4), v: [100, 100] }], ease: 'easeOut' }]];
  }
  if (k.decor === 'leader' && entry.target) {
    const tx = entry.target.x * comp.w; const ty = entry.target.y * comp.h; const ax = L.rect.x + (tx > L.rect.x ? 0 : L.rect.w); const ay = L.rect.y + L.rect.h / 2;
    return [['layers_remove', { comp: comp.name, names: [`SHP_${decorId(name)}_LEADER`, `SHP_${decorId(name)}_DOT`] }],
      ['layer_add_shape', { comp: comp.name, name: `SHP_${decorId(name)}_LEADER`, position: [0, 0], shapes: [{ type: 'line', points: [[ax, ay], [tx, ty]], stroke: col, strokeWidth: Math.max(2, Math.round(comp.h * 0.002)), trim: [0, 100] }], start: t0, end: t1, mark: { k: 'textdecor', id: `SHP_${decorId(name)}_LEADER` } }],
      ['layer_add_shape', { comp: comp.name, name: `SHP_${decorId(name)}_DOT`, position: [tx, ty], shapes: [{ type: 'ellipse', size: [comp.h * 0.014, comp.h * 0.014], fill: col }], start: t0, end: t1, mark: { k: 'textdecor', id: `SHP_${decorId(name)}_DOT` } }]];
  }
  void name; return [];
}
