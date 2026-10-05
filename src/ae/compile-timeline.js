// THE EDITOR for timeline plans: compile a v2 plan into the same stages -> units -> alternatives -> ops structure the
// executor already runs. One master composition holds everything (no scene precomps), every shot is a unit that owns
// its layers, and a final unit re-establishes z-order so the result never depends on the order units ran in.
//
//   import | comp | shots | transitions | looks | text | audio | captions | finalize(order, markers, work area)
//
// Idempotent like the scene compiler: a unit removes the layers it is about to create. Optionally incremental:
// pass `previous` = { hashes: {unitId: hash}, sameProject: true } and unchanged units are not rebuilt.

import crypto from 'node:crypto';
import { MASTER, effectUnit } from './compile.js';
import { stackOps } from '../compositing/templates.js';
import { transitionAlternatives } from '../transitions/engine.js';
import { buildTextUnit } from '../typography/engine.js';
import { resolveChain } from '../effects/registry.js';
import { colorEffectId } from '../color/looks.js';
import { resolveStyle } from '../motion/styles.js';
import { toTimeRemapKeys } from '../velocity/speedmap.js';
import { buildCaptionChunks } from './captions.js';
import { musicLevelKeys } from '../audio/sound.js';
import { snapT } from '../motion/layout.js';
import { ident } from '../core/paths.js';
import { round } from '../core/time.js';

export const SILENT = -96;
const hashOf = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const importFolder = (a) => (a.type === 'video' ? '20_FOOTAGE/Video' : a.type === 'image' ? '20_FOOTAGE/Stills' : '30_AUDIO');
const unit = (u) => ({ optional: false, primary: null, names: [], ...u });

/** Names created by a list of ops (layer_add_* with a name), in order. */
export const namesOf = (ops) => ops.filter(([op, a]) => /^layer_add_/.test(op) && a?.name).map(([, a]) => a.name);

/** Full-frame content layers of a shot: what a transition must act on (inset, logo and text are excluded). */
const targetsOf = (shot) => shot.layers.filter((l) => (l.kind === 'footage' && l.role !== 'inset' && l.role !== 'logo') || l.kind === 'solid').map((l) => l.name);

/** Shift shot-relative times so they are relative to the (earlier-starting) layer. */
function shiftLayer(L, hIn) {
  const c = { ...L };
  if (L.motion) c.motion = L.motion.map((m) => ({ ...m, at: (m.at ?? 0) + hIn }));
  if (L.enter) c.enter = { ...L.enter, at: L.enter.at + hIn };
  if (L.kind === 'footage' && !L.remap && L.sourceIn !== undefined) c.sourceIn = Math.max(0, L.sourceIn - hIn);
  return c;
}

/**
 * @param {object} plan   normalized timeline plan
 * @param {object} o      { manifest, library, narration, caps, previous? }
 */
export function compileTimeline(plan, { manifest, library = null, narration = null, caps = {}, previous = null }) {
  const { width: W, height: H, fps } = plan.output;
  const tl = plan.timeline; const shots = tl.shots; const trs = tl.transitions; const end = tl.duration;
  const style = resolveStyle(plan.style, caps);
  const notes = [...(plan.output.notes || []), ...style.fontNotes]; const warnings = []; const resolutions = [];
  const byId = new Map([...(library?.assets || []), ...(manifest?.assets || [])].map((a) => [a.id, a]));
  const comp = { name: MASTER, w: W, h: H };
  const stages = [];
  const incremental = Boolean(previous?.sameProject && previous?.hashes);
  const hashes = {}; const unitNames = {}; const reused = [];
  // A unit whose hash changed is rebuilt; layers it used to own but no longer does are removed first.
  const keep = (u) => {
    u.hash = hashOf(u.alternatives.map((a) => a.ops)); hashes[u.id] = u.hash; unitNames[u.id] = u.names || [];
    if (incremental && previous.hashes[u.id] === u.hash) { reused.push(u.id); return false; }
    const stale = incremental ? (previous.names?.[u.id] || []).filter((n) => !(u.names || []).includes(n)) : [];
    if (stale.length) for (const a of u.alternatives) a.ops.unshift(['layers_remove', { comp: MASTER, names: stale }]);
    return true;
  };

  // ---------- assets in use ----------
  const used = new Set();
  for (const s of shots) for (const L of s.layers) if (L.kind === 'footage') used.add(L.asset);
  for (const t of trs) if (t.overlayAsset) used.add(t.overlayAsset);
  for (const m of plan.audio.music) used.add(m.asset);
  if (plan.audio.narration) used.add(plan.audio.narration.asset);
  for (const e of plan.audio.sfxEvents) used.add(e.assetId);
  stages.push({ id: 'import', label: 'Folders & imports', units: [...used].sort().filter((id) => byId.has(id)).map((id) => { const a = byId.get(id); return unit({ id: `import.${id}`, label: `import ${id}`, alternatives: [{ name: 'import', quality: 1, ops: [['import_ensure', { path: a.path, name: id, folder: importFolder(a) }]] }] }); }).filter(keep) });
  for (const id of used) if (!byId.has(id)) warnings.push(`asset ${id} is not in the manifest or library`);

  // ---------- master comp ----------
  const wantsBlur = shots.some((s) => s.layers.some((l) => l.motionBlur || l.remap)) || trs.some((t) => ['whip', 'zoom', 'push', 'motion_blur'].includes(t.type));
  stages.push({ id: 'comps', label: 'Master composition', units: [unit({ id: 'comp.master', label: MASTER, alternatives: [{ name: 'ensure', quality: 1, ops: [['comp_ensure', { name: MASTER, width: W, height: H, fps, duration: end, bg: '#000000', folder: '00_MASTER', reset: !incremental, motionBlur: wantsBlur, frameBlending: shots.some((s) => s.layers.some((l) => l.remap && l.remap.frameBlend !== 'none')) }]] }] })] });

  // ---------- shots ----------
  const layout = []; // z-order bookkeeping: [{shot, layers:[names], matteAfter}]
  const su = []; const shotLayerMeta = [];
  shots.forEach((s, i) => {
    const hIn = i > 0 ? trs[i - 1].d / 2 : 0; const hOut = i < shots.length - 1 ? trs[i].d / 2 : 0;
    const layerStart = round(s.start - hIn, 4); const layerEnd = round(s.end + hOut, 4); const dur = round(layerEnd - layerStart, 4);
    const tin = i > 0 ? trs[i - 1] : null; const tout = i < shots.length - 1 ? trs[i] : null;
    const targets = targetsOf(s);
    const build = (mode) => {
      const layers = s.layers.map((L) => {
        let c = shiftLayer(L, hIn);
        if (L.kind === 'footage') {
          const isTarget = targets.includes(L.name);
          // transition moves ride on the same camera track as the shot's own moves
          const extra = [];
          if (mode !== 'static' && isTarget) {
            if (tin && tin.motion) extra.push(...tin.motion.incoming.map((m) => ({ ...m, tag: 'transition' })));
            if (tout && tout.motion) extra.push(...tout.motion.outgoing.map((m) => ({ ...m, tag: 'transition' })));
          }
          c.exempt = [];
          if (tin && isTarget && tin.type !== 'cut') c.exempt.push([0, tin.d]);
          if (tout && isTarget && tout.type !== 'cut') c.exempt.push([dur - tout.d, dur]);
          c.motion = mode === 'static' ? [] : [...(c.motion || []), ...extra];
          if (mode === 'static') { c.blur = 0; c.mask = c.mask; }
          if (mode !== 'full' && c.remap) { c = { ...c, remap: null, speed: 'normal', sourceIn: Math.max(0, (L.remap?.sourceIn ?? 0) - hIn) }; }
        }
        return c;
      });
      const plan2 = { layers, overlays: (s.overlays || []).map((o) => ({ ...o, at: o.at + hIn })), fadeOut: s.fadeOut || 0 };
      const remap = (L) => {
        if (!L.remap) return [];
        const a = byId.get(L.asset); const clip = a?.meta?.duration ?? a?.duration ?? 9999;
        const { keys, clamped } = toTimeRemapKeys(L.remap.map, { fps, srcStart: L.remap.sourceIn, clipDuration: clip, handleIn: hIn, handleOut: hOut });
        if (clamped) warnings.push(`${s.id}/${L.name}: the speed map reaches the end of its clip (${clip.toFixed?.(1) ?? clip}s) and holds the last frame`);
        return [['time_remap', { comp: MASTER, layer: L.name, keys: keys.map((k) => ({ t: round(s.start + k.t, 4), src: k.src })), start: layerStart, end: layerEnd, frameBlend: L.remap.frameBlend || 'mix', motionBlur: true }]];
      };
      return stackOps(plan2, { comp, fps, caps, shot: { id: s.id, start: layerStart, dur }, seed: `${plan.seed}.${s.id}`, remap, hasAudio: (id) => Boolean(byId.get(id)?.meta?.hasAudio) });
    };
    const full = build('full');
    const hasRemap = s.layers.some((l) => l.remap); const hasMotion = s.layers.some((l) => l.motion?.length) || trs.some((t, j) => (j === i || j === i - 1) && t.motion && (t.motion.incoming.length || t.motion.outgoing.length));
    const alts = [{ name: 'full', quality: 1, ops: full.ops }];
    if (hasRemap) alts.push({ name: 'constant_speed', quality: 0.6, ops: build('no_remap').ops });
    if (hasMotion || hasRemap) alts.push({ name: 'static', quality: 0.35, ops: build('static').ops });
    const names = [...new Set(alts.flatMap((a) => namesOf(a.ops)))];
    const primary = targets[0] || names[0];
    alts.push({ name: 'placeholder', quality: 0.05, ops: [['layers_remove', { comp: MASTER, names, prefix: false }], ['layer_add_solid', { comp: MASTER, name: `${primary}`, color: '#3a0d0d', start: layerStart, end: layerEnd }], ['layer_add_text', { comp: MASTER, name: `${primary}_MISSING`, text: `MISSING: ${s.id}`, size: Math.round(H * 0.04), color: '#ff6a6a', start: layerStart, end: layerEnd, mark: { k: 'placeholder', id: `${primary}_MISSING` } }]] });
    warnings.push(...full.warnings.map((w) => `${s.id}: ${w}`));
    const u = unit({ id: `shot.${s.id}`, label: `${s.id} ${s.template}`, primary, names, alternatives: alts });
    su.push(u);
    layout.push({ shot: s, layers: namesOf(full.ops), targets, names });
    shotLayerMeta.push({ id: s.id, layer: primary, start: layerStart, end: layerEnd, expectStart: layerStart, expectEnd: layerEnd });
  });
  stages.push({ id: 'shots', label: `Shots (${shots.length})`, units: su.filter(keep) });

  // ---------- transitions ----------
  const tu = [];
  trs.forEach((t, i) => {
    if (t.type === 'cut' || !(t.d > 0)) return;
    const incoming = targetsOf(shots[i + 1]); const outgoing = targetsOf(shots[i]);
    const n = Math.max(incoming.length, outgoing.length);
    // run the implementation once per layer pair; identical ops (the overlay solids) collapse to one
    const perPair = Array.from({ length: n }, (_, k) => transitionAlternatives(t, caps, { comp: MASTER, incoming: incoming[Math.min(k, incoming.length - 1)], outgoing: outgoing.length ? outgoing[Math.min(k, outgoing.length - 1)] : null, w: W, h: H, fps }));
    const alts = perPair[0].map((alt, ai) => {
      const seen = new Set(); const ops = [];
      for (const pair of perPair) for (const op of (pair[ai]?.ops || [])) { const key = JSON.stringify(op); if (!seen.has(key)) { seen.add(key); ops.push(op); } }
      return { name: alt.name, quality: alt.quality, ops };
    });
    const names = [...new Set(alts.flatMap((a) => namesOf(a.ops)))];
    const chain = resolveChain(t.effectId, caps);
    const res = { effectId: t.effectId, requested: chain.requestedId, using: chain.chain[0]?.id ?? null, quality: chain.chain[0]?.quality ?? 0, bestQuality: chain.bestQuality, skipped: chain.skipped, degraded: !chain.chain[0] || chain.chain[0].quality < chain.bestQuality || chain.id !== chain.requestedId };
    resolutions.push(res);
    tu.push(unit({ id: `transition.${i + 1}`, label: `${shots[i].id} -> ${shots[i + 1].id}: ${t.type}`, optional: true, names, primary: namesOf(alts[0].ops)[0] || null, alternatives: alts, resolution: res })); // primary = what the BEST alternative creates (a fallback may create others)
    layout[i + 1].fx = names;
  });
  stages.push({ id: 'transitions', label: `Transitions (${tu.length})`, units: tu.filter(keep) });

  // ---------- looks ----------
  const lu = []; const look = plan.look; const sw = { comp: MASTER, w: W, h: H, fps };
  const lookNames = [];
  if (look.color) {
    const u = effectUnit({ id: 'look.color', label: `colour ${look.color}`, effectId: colorEffectId(look.color), caps, names: ['ADJ_COLOR'], ctx: { ...sw, layer: 'ADJ_COLOR', strength: look.strength }, pre: [['layer_add_adjustment', { comp: MASTER, name: 'ADJ_COLOR', duration: end }]] });
    lu.push(u); resolutions.push(u.resolution); lookNames.push('ADJ_COLOR');
  }
  if (look.glow > 0.05) { const u = effectUnit({ id: 'look.glow', label: 'glow', effectId: 'look.glow', caps, names: ['ADJ_GLOW'], ctx: { ...sw, layer: 'ADJ_GLOW' }, pre: [['layer_add_adjustment', { comp: MASTER, name: 'ADJ_GLOW', duration: end }]] }); lu.push(u); resolutions.push(u.resolution); lookNames.push('ADJ_GLOW'); }
  if (look.grain > 0.05) { const u = effectUnit({ id: 'look.grain', label: 'film grain', effectId: 'look.film_grain', caps, names: ['ADJ_GRAIN'], ctx: { ...sw, layer: 'ADJ_GRAIN' }, pre: [['layer_add_adjustment', { comp: MASTER, name: 'ADJ_GRAIN', duration: end }]] }); lu.push(u); resolutions.push(u.resolution); lookNames.push('ADJ_GRAIN'); }
  if (look.vignette > 0.05) { lu.push(effectUnit({ id: 'look.vignette', label: 'vignette', effectId: 'look.vignette', caps, names: [], ctx: { ...sw, layer: 'SOL_VIGNETTE', amount: Math.round(20 + 50 * look.vignette) } })); lookNames.push('SOL_VIGNETTE'); }
  if (look.letterbox) { const barH = Math.round((H - W / 2.39) / 2); if (barH > 2) { lu.push(effectUnit({ id: 'look.letterbox', label: 'letterbox', effectId: 'look.letterbox', caps, ctx: { ...sw, barH } })); lookNames.push('SHP_LETTERBOX_TOP', 'SHP_LETTERBOX_BOTTOM'); } }
  stages.push({ id: 'looks', label: 'Look: colour, grain, vignette, letterbox', units: lu.filter(keep) });

  // ---------- text ----------
  // Every text unit owns an explicit interval (start/end/duration inside its shot), a semantic role and a deterministic
  // id (TXT_TITLE_01, TXT_END_01, ...). TITLE / END_CARD marked required are NOT optional: if every alternative fails the
  // build fails loudly instead of silently dropping them. An optional text that cannot be built is reported, never hidden.
  const xu = []; const textNames = []; const textLayers = []; const beats = plan.beatMap?.beats || [];
  for (const s of shots) for (const t of s.text) {
    const tu2 = buildTextUnit(t, { comp, fps, caps, style: { font: style.fonts.display, color: style.colors.text, stroke: '#000000', strokeWidth: Math.max(2, Math.round(H * 0.002)) }, beats, accent: style.colors.accent, dir: 0 });
    // a unit owns every layer any of its alternatives creates (kinetic type makes one layer per word)
    tu2.names = [...new Set([...tu2.names, ...tu2.alternatives.flatMap((a) => namesOf(a.ops))])];
    tu2.primary = tu2.names[0]; xu.push(tu2); textNames.push(...tu2.names);
    textLayers.push({ ...tu2.text, id: tu2.text.name, shotId: s.id, sceneId: s.id, animation: t.animation, children: tu2.names.filter((n) => n !== tu2.text.name && /^TXT_/.test(n)) });
    delete tu2.text;
  }
  stages.push({ id: 'text', label: `Type (${xu.length})`, units: xu.filter(keep) });

  // ---------- audio ----------
  const au = []; const speech = narration?.speech || [];
  if (plan.audio.narration) {
    const n = plan.audio.narration;
    au.push(unit({ id: 'audio.narration', label: 'narration', primary: 'NARR_MAIN', names: ['NARR_MAIN'], alternatives: [{ name: 'layer', quality: 1, ops: [['layers_remove', { comp: MASTER, names: ['NARR_MAIN'] }], ['layer_add_footage', { comp: MASTER, item: n.asset, name: 'NARR_MAIN', start: n.start ?? 0 }], ...(n.gainDb ? [['set_property', { comp: MASTER, layer: 'NARR_MAIN', prop: 'audioLevels', value: [n.gainDb, n.gainDb] }]] : [])] }] }));
  }
  plan.audio.music.forEach((m, i) => {
    const a = byId.get(m.asset); const start = m.start ?? 0; const stop = m.end ?? end; const dur = a?.meta?.duration ?? a?.duration;
    const segs = [];
    if (dur && dur > 1 && stop - start > dur + 0.01) { for (let t = start; t < stop - 0.01; t += dur) segs.push([t, Math.min(stop, t + dur)]); warnings.push(`music ${m.asset} (${dur.toFixed(1)}s) is shorter than the ${(stop - start).toFixed(1)}s it must cover; it is looped ${segs.length}x, so the beat grid drifts after the first pass`); }
    else segs.push([start, stop]);
    segs.forEach(([x, y], k) => {
      const name = `MUSIC_${ident(m.asset).replace(/^MUSIC_/, '')}${segs.length > 1 ? `_L${k + 1}` : ''}`;
      const keys = musicLevelKeys({ gainDb: m.gainDb ?? -10, duckDb: m.duckDb ?? -10, fadeIn: k === 0 ? (m.fadeIn ?? 0.5) : 0.1, fadeOut: k === segs.length - 1 ? (m.fadeOut ?? 2) : 0.1, layerStart: x, layerEnd: y, speech: m.duckUnderNarration ? speech : [] });
      const add = [['layers_remove', { comp: MASTER, names: [name] }], ['layer_add_footage', { comp: MASTER, item: m.asset, name, start: x, end: y }]];
      au.push(unit({ id: `audio.music.${i + 1}.${k + 1}`, label: `music ${m.asset}`, primary: name, names: [name], alternatives: [{ name: 'ducked', quality: 1, ops: [...add, ['keyframes', { comp: MASTER, layer: name, prop: 'audioLevels', keys, ease: 'linear' }]] }, { name: 'static_level', quality: 0.4, ops: [...add, ['set_property', { comp: MASTER, layer: name, prop: 'audioLevels', value: [(m.gainDb ?? -10) - 4, (m.gainDb ?? -10) - 4] }]] }] }));
    });
  });
  for (const e of plan.audio.sfxEvents) {
    e.fit.layers.forEach((l, k) => {
      const name = `SFX_${e.id.replace(/^SFX_/, '')}${e.fit.layers.length > 1 ? `_${k + 1}` : ''}_${ident(e.role)}`;
      const len = (l.sourceOut - l.sourceIn) * (l.stretch || 1); const start = l.start; const stop = round(start + len, 4); const g = l.gainDb;
      const keys = [{ t: start, v: [SILENT, SILENT] }, { t: round(start + Math.min(l.fadeIn, len / 2), 4), v: [g, g] }, { t: round(Math.max(start + len / 2, stop - l.fadeOut), 4), v: [g, g] }, { t: stop, v: [SILENT, SILENT] }];
      au.push(unit({ id: `audio.sfx.${name}`, label: `sfx ${e.role} @${e.at.toFixed(2)}s (${e.why})`, optional: true, primary: name, names: [name], alternatives: [
        { name: 'fitted', quality: 1, ops: [['layers_remove', { comp: MASTER, names: [name] }], ['layer_add_footage', { comp: MASTER, item: e.assetId, name, start, end: stop, sourceIn: l.sourceIn, speed: 1 / (l.stretch || 1) }], ['keyframes', { comp: MASTER, layer: name, prop: 'audioLevels', keys, ease: 'linear' }]] },
        { name: 'plain', quality: 0.5, ops: [['layers_remove', { comp: MASTER, names: [name] }], ['layer_add_footage', { comp: MASTER, item: e.assetId, name, start, end: stop, sourceIn: l.sourceIn }], ['set_property', { comp: MASTER, layer: name, prop: 'audioLevels', value: [g, g] }]] },
      ] }));
    });
  }
  stages.push({ id: 'audio', label: 'Audio: music (ducked), SFX', units: au.filter(keep) });

  // ---------- captions ----------
  if (plan.captions?.enabled && narration) {
    const chunks = buildCaptionChunks({ sentences: narration.sentences || [], words: narration.words || null }, { maxChars: H > W ? 22 : 38, maxLines: 2 });
    const size = Math.round(style.type.captionSize * H * (H > W ? 0.9 : 1)); const pos = [W / 2, Math.round(H * (1 - style.captions.bottom))];
    const cu = chunks.map((c, i) => { const name = `CAP_${String(i + 1).padStart(4, '0')}`; textNames.push(name); const rm = ['layers_remove', { comp: MASTER, names: [name] }]; textLayers.push({ name, role: 'CAPTION', id: name, shotId: null, sceneId: null, start: c.start, end: c.end, duration: round(c.end - c.start, 4), required: false }); const add = ['layer_add_text', { comp: MASTER, name, text: c.text, size, font: style.fonts.body, color: style.colors.text, stroke: '#000000', strokeWidth: Math.max(2, Math.round(size * 0.08)), position: pos, justify: 'center', start: c.start, end: c.end, role: 'CAPTION', mark: { k: 'text', role: 'CAPTION', id: name } }]; return unit({ id: `caption.${i + 1}`, label: name, optional: true, primary: name, names: [name], alternatives: [{ name: 'fade', quality: 1, ops: [rm, add, ['keyframes', { comp: MASTER, layer: name, prop: 'opacity', keys: [{ t: c.start, v: 0 }, { t: c.start + 0.12, v: 100 }, { t: c.end - 0.1, v: 100 }, { t: c.end, v: 0 }], ease: 'linear' }]] }, { name: 'plain', quality: 0.5, ops: [rm, add] }] }); });
    stages.push({ id: 'captions', label: `Captions (${cu.length})`, units: cu.filter(keep) });
  }

  // ---------- stale text: anything generated that the current plan no longer wants ----------
  // Runs first in the text stage on every build (never reused): removes text/decor layers that carry an XOXO mark but are
  // not expected (a renamed or deleted text unit, an earlier plan) and unmarked text layers named after their own text
  // (orphans of a failed build). Expected names come from EVERY unit, reused or not.
  const expected = [...new Set([...Object.values(unitNames).flat(), ...textNames, ...lookNames])];
  const prune = unit({ id: 'text.prune', label: 'remove stale text layers', optional: true, alternatives: [{ name: 'prune', quality: 1, ops: [['layers_prune', { comp: MASTER, keep: expected, kinds: ['text', 'textdecor'], orphans: true }]] }] });
  stages.find((st) => st.id === 'text').units.unshift(prune);

  // ---------- finalize: z-order, end fade, markers, work area ----------
  const order = [];
  layout.forEach((l, i) => {
    const incomingTarget = l.targets[0];
    for (const n of l.layers) { order.push(n); if (n === incomingTarget) for (const f of (l.fx || []).filter((x) => /MATTE/.test(x))) order.push(f); }
    for (const f of (l.fx || []).filter((x) => !/MATTE/.test(x))) order.push(f);
    void i;
  });
  order.push(...lookNames, ...textNames);
  const fu = [unit({ id: 'master.order', label: 'z-order', optional: true, alternatives: [{ name: 'reorder', quality: 1, ops: [['layers_reorder', { comp: MASTER, order: [...new Set(order)] }]] }] })];
  if (plan.endFade > 0) {
    const last = layout.at(-1).targets;
    fu.push(unit({ id: 'master.endfade', label: 'fade out at end', optional: true, alternatives: [{ name: 'fade', quality: 1, ops: last.map((n) => ['keyframes', { comp: MASTER, layer: n, prop: 'opacity', keys: [{ t: round(end - plan.endFade, 4), v: 100 }, { t: end, v: 0 }], ease: 'easeIn', clear: false }]) }] }));
  }
  // markers are idempotent by time (setValueAtTime replaces), so they follow the normal reuse rules
  const markerUnits = shots.map((s) => unit({ id: `marker.${s.id}`, label: `marker ${s.id}`, optional: true, alternatives: [{ name: 'marker', quality: 1, ops: [['marker_add', { comp: MASTER, time: s.start, comment: `${s.id} ${s.template}${s.camera ? ' / ' + s.camera.move : ''}`.slice(0, 120) }]] }] })).filter(keep);
  fu.push(unit({ id: 'master.workarea', label: 'work area', optional: true, alternatives: [{ name: 'workarea', quality: 1, ops: [['comp_set_work_area', { comp: MASTER, start: 0, duration: end }]] }] }));
  stages.push({ id: 'finalize', label: 'Z-order, markers & work area', units: [...fu, ...markerUnits] });
  // the order unit and the end fade depend on every other unit, so they always run
  for (const u of fu) { u.hash = hashOf(u.alternatives.map((a) => a.ops)); hashes[u.id] = u.hash; unitNames[u.id] = []; }

  const structure = hashOf(shots.map((s) => [s.id, s.start, s.end, s.template]));
  const expectedUnits = stages.flatMap((st) => st.units.filter((u) => u.primary).map((u) => ({ stage: st.id, comp: MASTER, layer: u.primary, optional: Boolean(u.optional) })));
  const allShotLayers = shotLayerMeta;
  return {
    stages,
    meta: {
      mode: 'timeline', master: MASTER, width: W, height: H, fps, duration: end, style: style.name, sceneComps: [], shotLayers: allShotLayers,
      assetsUsed: [...used], resolutions, notes, warnings, expectedUnits, hashes, unitNames, reused, incremental, structure,
      textLayers,
      stats: { shots: shots.length, transitions: tu.length, text: xu.length, sfx: plan.audio.sfxEvents.length, layers: order.length },
    },
  };
}
