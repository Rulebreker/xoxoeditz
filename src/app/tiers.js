// DRAFT / PREVIEW / FINAL. The same edit at three costs. A tier is a separate project (own plan, own .aep, own
// renders) so a draft can be thrown away without touching a final, and "promote" re-uses the approved plan exactly,
// scaled to the final resolution.
//
//   draft    ~480p, no grain/glow/vignette/letterbox, frame blending off, motion blur off: seconds to build and render
//   preview  720p, the full look, normal frame blending: what to judge the edit on
//   final    the configured resolution

import fs from 'node:fs';
import path from 'node:path';
import { projectPaths, readJson, writeJson, ensureDir, slug } from '../core/paths.js';
import { resolveOutput } from '../plan/output.js';
import { attempt, fail } from '../core/result.js';

export const TIERS = {
  draft: { resolution: '480p', looks: false, frameBlend: 'none', motionBlur: false, suffix: '-draft' },
  preview: { resolution: '720p', looks: true, frameBlend: null, motionBlur: true, suffix: '-preview' },
  final: { resolution: null, looks: true, frameBlend: null, motionBlur: true, suffix: '' },
};
export const tierName = (name, tier) => `${slug(name)}${(TIERS[tier] || TIERS.final).suffix}`;
export const tierOf = (name) => (name.endsWith('-draft') ? 'draft' : name.endsWith('-preview') ? 'preview' : 'final');
export const baseName = (name) => name.replace(/-(draft|preview)$/, '');

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Scale every pixel-valued field of a timeline plan to a new output size (same aspect ratio). */
export function scalePlanForOutput(plan, width, height) {
  const k = height / plan.output.height;
  if (Math.abs(width / height - plan.output.width / plan.output.height) > 0.01) throw new Error(`cannot rescale ${plan.output.width}x${plan.output.height} to ${width}x${height}: the aspect ratio differs`);
  const p = JSON.parse(JSON.stringify(plan));
  p.output = { ...p.output, width, height };
  const r = (v) => Math.round(v * k * 100) / 100;
  for (const s of p.timeline.shots) {
    for (const L of s.layers) {
      if (L.blur) L.blur = Math.max(1, Math.round(L.blur * k));
      if (L.mask?.feather) L.mask.feather = Math.round(L.mask.feather * k * 100) / 100;
      if (L.widthPx) L.widthPx = Math.max(1, Math.round(L.widthPx * k));
    }
    for (const t of s.text) {
      const lay = t.layout; if (!lay) continue;
      lay.size = Math.round(lay.size * k); lay.nominalSize = Math.round(lay.nominalSize * k);
      lay.position = lay.position.map(r); lay.rect = { x: r(lay.rect.x), y: r(lay.rect.y), w: r(lay.rect.w), h: r(lay.rect.h) };
    }
  }
  return p;
}

/** The plan as a tier would build it: scaled to the tier's resolution and simplified. */
export function deriveTierPlan(plan, tier, { finalResolution = null } = {}) {
  const t = TIERS[tier]; if (!t) throw new Error(`unknown tier "${tier}" (draft, preview, final)`);
  const res = t.resolution || finalResolution || plan.output.height;
  const dims = resolveOutput({ resolution: res, aspect: aspectOf(plan), fps: plan.output.fps });
  const p = scalePlanForOutput(plan, dims.width, dims.height);
  p.quality = tier;
  if (!t.looks) p.look = { ...p.look, grain: 0, glow: 0, vignette: 0, letterbox: false };
  if (t.frameBlend !== null || !t.motionBlur) for (const s of p.timeline.shots) for (const L of s.layers) { if (L.remap && t.frameBlend !== null) L.remap.frameBlend = t.frameBlend; if (!t.motionBlur) L.motionBlur = false; }
  return p;
}
const aspectOf = (plan) => `${plan.output.width}:${plan.output.height}`;

/**
 * Copy an approved tier project into another tier: same assets, music, beat map, library copy and plan decisions,
 * rescaled and simplified. Nothing is built or rendered here.
 */
export function promoteProject(ctx, name, { to = 'final', from = null, finalResolution = null } = {}) {
  return attempt('promote', () => {
    const src = projectPaths(ctx.config, slug(name)); const srcTier = from || tierOf(slug(name));
    if (!fs.existsSync(src.plan)) throw new Error(`project ${name} has no plan.json yet`);
    if (!TIERS[to]) throw new Error(`unknown tier "${to}"`);
    const destName = tierName(baseName(slug(name)), to); const dst = projectPaths(ctx.config, destName);
    const plan = readJson(src.plan);
    if (plan.mode !== 'timeline') throw new Error('only timeline (autonomous) projects can be promoted between tiers');
    const derived = deriveTierPlan(plan, to, { finalResolution: finalResolution || (to === 'final' ? plan.directive?.finalResolution || null : null) });
    for (const d of [dst.root, dst.renders, dst.logs, dst.generated, dst.versions]) ensureDir(d);
    for (const f of ['manifest', 'narration', 'beatMap', 'libraryUsed', 'directorReport']) if (fs.existsSync(src[f])) fs.copyFileSync(src[f], dst[f]);
    writeJson(dst.plan, derived);
    const st = readJson(src.state, {}); writeJson(dst.state, { ...st, name: destName, promotedFrom: slug(name), tier: to });
    return { from: slug(name), fromTier: srcTier, to: destName, tier: to, root: dst.root, output: `${derived.output.width}x${derived.output.height}`, next: `xoxo edit ${destName}   (build)   then   xoxo render ${destName}` };
  });
}
export { fail };
