// THE EDITOR: compile a normalized edit plan into After Effects work.
//
// Output is data, not side effects: stages -> units -> alternatives -> ops. Every unit is idempotent
// (it removes the layers it is about to create), so re-running a build or retrying a unit is always safe.
// Alternatives are ordered best-first; the executor walks them when an operation fails inside After Effects.

import path from 'node:path';
import { masterEnd } from '../plan/schema.js';
import { resolveStyle } from '../motion/styles.js';
import { resolveChain } from '../effects/registry.js';
import { buildGraphic } from '../motion/graphics.js';
import { buildClipUnit } from './clips.js';
import { buildCaptionChunks } from './captions.js';
import { musicLevelKeys, pickSfxAsset } from '../audio/sound.js';
import { snapT } from '../motion/layout.js';
import { ident } from '../core/paths.js';
import { round } from '../core/time.js';

export const MASTER = 'COMP_MASTER';
export const TRANSITIONS = {
  dissolve: { overlap: true }, slide: { overlap: true }, zoom_punch: { overlap: true }, wipe: { overlap: true }, glitch: { overlap: true },
  dip_to_black: { overlap: false, centered: true }, cut: { overlap: false },
};
const pad2 = (n) => String(n).padStart(2, '0');
const sceneCompName = (i) => `COMP_SCENE_${pad2(i + 1)}`;
const sceneLayerName = (i) => `SC_S${pad2(i + 1)}`;

/** A unit whose alternatives come from walking an effect's implementation chain. */
function effectUnit({ id, label, effectId, caps, ctx, pre = [], post = [], names = [], optional = true }) {
  const chain = resolveChain(effectId, caps);
  const alternatives = chain.chain.map((impl) => ({
    name: impl.id, quality: impl.quality,
    ops: [...(names.length ? [['layers_remove', { comp: ctx.comp, names }]] : []), ...(impl.id === 'none' ? [] : pre), ...impl.build(ctx, impl.resolved), ...(impl.id === 'none' ? [] : post)],
  }));
  const best = chain.chain[0];
  return {
    id, label, optional, names, primary: names[0] || null, alternatives,
    resolution: { effectId, requested: chain.requestedId, using: best?.id ?? null, quality: best?.quality ?? 0, bestQuality: chain.bestQuality, skipped: chain.skipped, degraded: !best || best.quality < chain.bestQuality || chain.id !== chain.requestedId },
  };
}

const importFolder = (a) => (a.type === 'video' ? '20_FOOTAGE/Video' : a.type === 'image' ? '20_FOOTAGE/Stills' : '30_AUDIO');

/**
 * @param plan      normalized plan (normalizePlan)
 * @param opts      { manifest, narration, caps, sfxCues:[{kind,at,gainDb,assetId}] }
 */
export function compilePlan(plan, { manifest, narration = null, caps = {}, sfxCues = [] }) {
  const style = resolveStyle(plan.style, caps);
  const { width: W, height: H, fps } = plan.output;
  const end = masterEnd(plan);
  const notes = [...(plan.outputNotes || []), ...style.fontNotes];
  const warnings = [];
  const byId = new Map(manifest.assets.map((a) => [a.id, a]));
  const stages = [];

  // ---------- which assets are used ----------
  const used = new Set();
  for (const s of plan.scenes) for (const c of s.clips) used.add(c.asset);
  if (plan.audio.narration) used.add(plan.audio.narration.asset);
  for (const m of plan.audio.music) used.add(m.asset);
  for (const x of plan.audio.sfx) used.add(x.asset);
  for (const c of sfxCues) if (c.assetId) used.add(c.assetId);

  // ---------- stage: import ----------
  stages.push({
    id: 'import', label: 'Folders & imports',
    units: [...used].sort().filter((id) => byId.has(id)).map((id) => {
      const a = byId.get(id);
      return { id: `import.${id}`, label: `import ${id}`, optional: false, primary: null, names: [], alternatives: [{ name: 'import', quality: 1, ops: [['import_ensure', { path: a.path, name: id, folder: importFolder(a) }]] }] };
    }),
  });

  // ---------- transitions & tails ----------
  const trans = plan.scenes.map((s, i) => {
    const t = s.transition || {};
    let type = t.type || (i === 0 ? 'cut' : style.motion.transition);
    if (!TRANSITIONS[type] && !String(type).startsWith('x-')) { /* unknown ids fall back via the effect resolver */ }
    const lenPrev = i > 0 ? plan.scenes[i - 1].end - plan.scenes[i - 1].start : Infinity;
    const lenThis = s.end - s.start;
    let d = type === 'cut' ? 0 : snapT(Math.min(t.duration ?? style.motion.transitionDur, lenPrev / 2, lenThis / 2), fps);
    if (type !== 'cut' && d < 0.1) { type = 'cut'; d = 0; }
    return { type, d, overlap: (TRANSITIONS[type] ?? { overlap: true }).overlap && d > 0, centered: Boolean(TRANSITIONS[type]?.centered) };
  });
  const tail = plan.scenes.map((s, i) => (i < plan.scenes.length - 1 && trans[i + 1].overlap ? trans[i + 1].d : 0));

  // ---------- stage: comps ----------
  const compUnits = [{
    id: 'comp.master', label: MASTER, optional: false, primary: null, names: [],
    alternatives: [{ name: 'ensure', quality: 1, ops: [['comp_ensure', { name: MASTER, width: W, height: H, fps, duration: end, bg: style.colors.bg, folder: '00_MASTER', reset: true }]] }],
  }];
  plan.scenes.forEach((s, i) => {
    compUnits.push({
      id: `comp.${s.id}`, label: sceneCompName(i), optional: false, primary: null, names: [],
      alternatives: [{ name: 'ensure', quality: 1, ops: [['comp_ensure', { name: sceneCompName(i), width: W, height: H, fps, duration: round(s.end - s.start + tail[i]), bg: style.colors.bg, folder: '10_SCENES', reset: true }]] }],
    });
  });
  stages.push({ id: 'comps', label: 'Compositions', units: compUnits });

  // ---------- stages: scenes ----------
  const compInfo = { w: W, h: H };
  const resolutions = [];
  plan.scenes.forEach((s, i) => {
    const comp = sceneCompName(i);
    const len = round(s.end - s.start);
    const units = [];
    const seen = {};
    s.clips.forEach((c, j) => {
      seen[c.asset] = (seen[c.asset] || 0) + 1;
      const layerName = seen[c.asset] > 1 ? `${c.asset}_${seen[c.asset]}` : c.asset;
      const u = buildClipUnit(c, { comp: { name: comp, ...compInfo }, fps, asset: byId.get(c.asset), layerName, sceneId: s.id, idx: j + 1, tail: tail[i], sceneLen: len, isLast: j === s.clips.length - 1, amount: style.motion.cameraAmount });
      u.optional = false; u.primary = layerName;
      warnings.push(...u.warnings);
      units.push(u);
    });
    const counts = {};
    s.graphics.forEach((g) => {
      if (g.kind === 'map') return;
      counts[g.kind] = (counts[g.kind] || 0) + 1;
      const u = buildGraphic(g, { comp, w: W, h: H, fps, style, caps, sceneId: s.id, sceneLen: len, n: counts[g.kind] });
      u.optional = true; u.primary = u.names[0];
      units.push(u);
      for (const n of u.notes) notes.push(`${s.id} ${g.kind}: ${n}`);
    });
    stages.push({ id: `scene.${s.id}`, label: `Scene ${s.id} (${comp})`, units });
  });

  // ---------- stage: master ----------
  const mu = [];
  plan.scenes.forEach((s, i) => {
    const name = sceneLayerName(i);
    const stop = s.end + tail[i];
    mu.push({
      id: `master.${s.id}`, label: `${MASTER} <- ${sceneCompName(i)}`, optional: false, primary: name, names: [name],
      alternatives: [{ name: 'nest', quality: 1, ops: [['layers_remove', { comp: MASTER, names: [name] }], ['layer_add_footage', { comp: MASTER, item: sceneCompName(i), name, start: s.start, end: stop }]] }],
    });
  });
  plan.scenes.forEach((s, i) => {
    const tr = trans[i];
    if (tr.type === 'cut' && i > 0) return;
    if (i === 0 && tr.type === 'cut') return;
    const t = tr.centered ? Math.max(0, s.start - tr.d / 2) : s.start;
    const u = effectUnit({
      id: `transition.${s.id}`, label: `transition into ${s.id}: ${tr.type}`, effectId: `transition.${tr.type}`, caps,
      ctx: { comp: MASTER, incoming: sceneLayerName(i), outgoing: i > 0 ? sceneLayerName(i - 1) : null, t, d: tr.d, w: W, h: H, fps },
    });
    mu.push(u);
    resolutions.push(u.resolution);
  });
  const endFade = plan.endFade ?? 1.0;
  if (endFade > 0) {
    mu.push({
      id: 'master.endfade', label: 'fade out at end', optional: true, primary: null, names: [],
      alternatives: [{ name: 'fade', quality: 1, ops: [['keyframes', { comp: MASTER, layer: sceneLayerName(plan.scenes.length - 1), prop: 'opacity', keys: [{ t: end - endFade, v: 100 }, { t: end, v: 0 }], ease: 'easeIn', clear: false }]] }],
    });
  }
  stages.push({ id: 'master', label: 'Master timeline & transitions', units: mu });

  // ---------- stage: audio ----------
  const au = [];
  const speech = narration?.speech || [];
  if (plan.audio.narration) {
    const n = plan.audio.narration;
    const ops = [['layers_remove', { comp: MASTER, names: ['NARR_MAIN'] }], ['layer_add_footage', { comp: MASTER, item: n.asset, name: 'NARR_MAIN', start: n.start ?? 0 }]];
    if (n.gainDb) ops.push(['set_property', { comp: MASTER, layer: 'NARR_MAIN', prop: 'audioLevels', value: [n.gainDb, n.gainDb] }]);
    au.push({ id: 'audio.narration', label: 'narration', optional: false, primary: 'NARR_MAIN', names: ['NARR_MAIN'], alternatives: [{ name: 'layer', quality: 1, ops }] });
  }
  plan.audio.music.forEach((m, i) => {
    const asset = byId.get(m.asset);
    const start = m.start ?? 0; const stop = m.end ?? end;
    const gainDb = m.gainDb ?? -20; const dur = asset?.meta?.duration;
    const segs = [];
    if (dur && dur > 1 && stop - start > dur + 0.01) {
      for (let t = start; t < stop - 0.01; t += dur) segs.push([t, Math.min(stop, t + dur)]);
      warnings.push(`music ${m.asset} (${dur.toFixed(1)}s) is shorter than the ${(stop - start).toFixed(1)}s it must cover; it is looped ${segs.length}x`);
    } else segs.push([start, stop]);
    segs.forEach(([a, b], k) => {
      const name = `MUSIC_${ident(m.asset).replace(/^MUSIC_/, '')}${segs.length > 1 ? `_L${k + 1}` : ''}`;
      const keys = musicLevelKeys({ gainDb, duckDb: m.duckDb ?? -10, fadeIn: k === 0 ? (m.fadeIn ?? 2) : 0.25, fadeOut: k === segs.length - 1 ? (m.fadeOut ?? 3) : 0.25, layerStart: a, layerEnd: b, speech: m.duckUnderNarration === false ? [] : speech });
      au.push({
        id: `audio.music.${i + 1}.${k + 1}`, label: `music ${m.asset}`, optional: false, primary: name, names: [name],
        alternatives: [
          { name: 'ducked', quality: 1, ops: [['layers_remove', { comp: MASTER, names: [name] }], ['layer_add_footage', { comp: MASTER, item: m.asset, name, start: a, end: b }], ['keyframes', { comp: MASTER, layer: name, prop: 'audioLevels', keys: keys, ease: 'linear' }]] },
          { name: 'static_level', quality: 0.4, ops: [['layers_remove', { comp: MASTER, names: [name] }], ['layer_add_footage', { comp: MASTER, item: m.asset, name, start: a, end: b }], ['set_property', { comp: MASTER, layer: name, prop: 'audioLevels', value: [gainDb - 6, gainDb - 6] }]] },
        ],
      });
    });
  });
  const allSfx = [...plan.audio.sfx.map((x) => ({ assetId: x.asset, at: x.at, gainDb: x.gainDb ?? -8, why: 'plan' })), ...sfxCues.filter((c) => c.assetId).map((c) => ({ assetId: c.assetId, at: c.at, gainDb: c.gainDb, why: c.why }))].sort((a, b) => a.at - b.at);
  const sfxN = {};
  for (const x of allSfx) {
    sfxN[x.assetId] = (sfxN[x.assetId] || 0) + 1;
    const name = `${x.assetId}_${sfxN[x.assetId]}`;
    const ops = [['layers_remove', { comp: MASTER, names: [name] }], ['layer_add_footage', { comp: MASTER, item: x.assetId, name, start: Math.max(0, x.at) }]];
    if (x.gainDb) ops.push(['set_property', { comp: MASTER, layer: name, prop: 'audioLevels', value: [x.gainDb, x.gainDb] }]);
    au.push({ id: `audio.sfx.${name}`, label: `sfx ${name} @${x.at}s (${x.why})`, optional: true, primary: name, names: [name], alternatives: [{ name: 'layer', quality: 1, ops }] });
  }
  stages.push({ id: 'audio', label: 'Audio: narration, music (ducked), SFX', units: au });

  // ---------- stage: looks ----------
  const lu = [];
  const look = { ...style.look, ...(plan.look || {}) };
  const sw = { comp: MASTER, w: W, h: H, fps };
  if (look.grade || look.glow) {
    const u = effectUnit({ id: 'look.grade', label: 'colour grade', effectId: 'look.tint_grade', caps, names: ['ADJ_GRADE'], ctx: { ...sw, layer: 'ADJ_GRADE', shadow: style.colors.shadow, highlight: style.colors.highlight, amount: look.grade || 12 }, pre: [['layer_add_adjustment', { comp: MASTER, name: 'ADJ_GRADE', duration: end }]] });
    lu.push(u); resolutions.push(u.resolution);
  }
  if (look.glow) {
    const u = effectUnit({ id: 'look.glow', label: 'glow', effectId: 'look.glow', caps, names: ['ADJ_GLOW'], ctx: { ...sw, layer: 'ADJ_GLOW' }, pre: [['layer_add_adjustment', { comp: MASTER, name: 'ADJ_GLOW', duration: end }]] });
    lu.push(u); resolutions.push(u.resolution);
  }
  if (look.grain) {
    const u = effectUnit({ id: 'look.grain', label: 'film grain', effectId: 'look.film_grain', caps, names: ['ADJ_GRAIN'], ctx: { ...sw, layer: 'ADJ_GRAIN' }, pre: [['layer_add_adjustment', { comp: MASTER, name: 'ADJ_GRAIN', duration: end }]] });
    lu.push(u); resolutions.push(u.resolution);
  }
  if (look.vignette) {
    const u = effectUnit({ id: 'look.vignette', label: 'vignette', effectId: 'look.vignette', caps, names: [], ctx: { ...sw, layer: 'SOL_VIGNETTE', amount: look.vignette } });
    lu.push(u);
  }
  const ratio = W / H;
  if (look.letterbox && ratio < 2.3 && ratio > 1.3) {
    const barH = Math.round((H - W / 2.39) / 2);
    if (barH > 2) lu.push(effectUnit({ id: 'look.letterbox', label: 'letterbox', effectId: 'look.letterbox', caps, ctx: { ...sw, barH } }));
  }
  if (lu.length) stages.push({ id: 'looks', label: 'Look: grade, grain, vignette, letterbox', units: lu });

  // ---------- stage: captions ----------
  const cu = [];
  if (plan.captions?.enabled) {
    const portrait = H > W;
    const chunks = buildCaptionChunks({ sentences: narration?.sentences || [], words: narration?.words || null }, { maxChars: plan.captions.maxCharsPerLine ?? (portrait ? 22 : 38), maxLines: 2 });
    if (!chunks.length) warnings.push('captions enabled but no timed transcript exists — run `xoxo narration` with --script/--subtitles/--transcribe');
    const size = Math.round(style.type.captionSize * H * (portrait ? 0.9 : 1));
    const pos = [W / 2, Math.round(H * (1 - style.captions.bottom))];
    chunks.forEach((c, i) => {
      const name = `CAP_${String(i + 1).padStart(4, '0')}`;
      const add = ['layer_add_text', { comp: MASTER, name, text: c.text, size, font: plan.captions.font || style.fonts.body, color: plan.captions.color || style.colors.text, stroke: '#000000', strokeWidth: Math.max(2, Math.round(size * 0.08)), position: pos, justify: 'center', start: c.start, end: c.end }];
      const rm = ['layers_remove', { comp: MASTER, names: [name] }];
      cu.push({
        id: `caption.${i + 1}`, label: name, optional: true, primary: name, names: [name],
        alternatives: [
          { name: 'fade', quality: 1, ops: [rm, add, ['keyframes', { comp: MASTER, layer: name, prop: 'opacity', keys: [{ t: c.start, v: 0 }, { t: c.start + 0.12, v: 100 }, { t: c.end - 0.1, v: 100 }, { t: c.end, v: 0 }], ease: 'linear' }]] },
          { name: 'plain', quality: 0.5, ops: [rm, add] },
        ],
      });
    });
    stages.push({ id: 'captions', label: `Captions (${chunks.length})`, units: cu });
  }

  // ---------- stage: finalize ----------
  const fu = plan.scenes.map((s) => ({
    id: `marker.${s.id}`, label: `marker ${s.id}`, optional: true, primary: null, names: [],
    alternatives: [{ name: 'marker', quality: 1, ops: [['marker_add', { comp: MASTER, time: s.start, comment: `${s.id}${s.intent?.visual ? ': ' + s.intent.visual : ''}`.slice(0, 120) }]] }],
  }));
  fu.push({ id: 'master.workarea', label: 'work area', optional: true, primary: null, names: [], alternatives: [{ name: 'workarea', quality: 1, ops: [['comp_set_work_area', { comp: MASTER, start: 0, duration: end }]] }] });
  stages.push({ id: 'finalize', label: 'Markers & work area', units: fu });

  return {
    stages,
    meta: {
      master: MASTER, width: W, height: H, fps, duration: end, style: style.name,
      sceneComps: plan.scenes.map((s, i) => ({ id: s.id, comp: sceneCompName(i), layer: sceneLayerName(i), start: s.start, end: s.end, tail: tail[i], transition: trans[i] })),
      assetsUsed: [...used], resolutions, notes, warnings,
      expectedUnits: stages.flatMap((st) => st.units.filter((u) => u.primary).map((u) => ({ stage: st.id, comp: unitComp(u), layer: u.primary, optional: Boolean(u.optional) }))),
    },
  };
}

function unitComp(u) {
  for (const a of u.alternatives) for (const [, args] of a.ops) if (args?.comp) return args.comp;
  return null;
}

export function countOps(build) {
  return build.stages.reduce((n, s) => n + s.units.reduce((m, u) => m + u.alternatives[0].ops.length, 0), 0);
}
