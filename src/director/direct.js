// THE CREATIVE DIRECTOR for timeline edits. Pure and deterministic for a seed: given a resolved directive, the
// project's assets, the universal library and a beat map, it returns a complete timeline plan plus an account of
// every decision. It never touches After Effects, the disk or the network.
//
//   rhythm (slots on the beat) -> transitions -> per shot: asset, template, camera, velocity -> text -> sound
//   -> music / look / output -> plan + rationale

import { makeRng } from '../core/rng.js';
import { resolveOutput } from '../plan/output.js';
import { virtualBeatMap, snapToGrid, gridPoints } from '../beat/analyze.js';
import { slotShots, impactsIn, roleFor } from './slots.js';
import { AssetAssigner } from './assign.js';
import { sfxCandidates, planSound } from './sound.js';
import { chooseMusic } from './music.js';
import { planTransitions } from '../transitions/engine.js';
import { chooseTemplate, planShot } from '../compositing/templates.js';
import { planText } from '../typography/engine.js';
import { CameraPlanner } from '../camera/rigs.js';
import { VelocityPlanner, describeMap } from '../velocity/engine.js';
import { VELOCITY_PROFILES } from '../velocity/profiles.js';
import { resolveStyle } from '../motion/styles.js';
import { TIMELINE_VERSION } from '../timeline/plan.js';
import { slug } from '../core/paths.js';
import { round } from '../core/time.js';

export const MASTER_COMP = 'COMP_MASTER';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const STYLE_FOR_COLOR = { CINEMATIC: 'cinematic-documentary', DOCUMENTARY: 'cinematic-documentary', DARK: 'cinematic-documentary', MILITARY: 'military-documentary', AUTOMOTIVE: 'premium-commercial', PREMIUM: 'premium-commercial', TECH: 'tech-explainer', CLEAN: 'minimal-corporate', VIBRANT: 'fast-youtube' };
const pad = (n) => String(n).padStart(2, '0');

const STOP = new Set('a an the of on in at to for with and or by from into over under near this that these those is are was were be been it its as shot view image photo picture clip video close closeup wide up out'.split(' '));
/** A short on-screen label from the (human/Claude-written) asset description: its first two content words. */
export function labelFromDescription(a) {
  const words = String(a?.description || '').toLowerCase().replace(/[^a-z0-9 -]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  return words.length ? words.slice(0, 2).join(' ').toUpperCase() : null;
}

const templateAsset = (a) => (a ? { id: a.id, item: a.id, w: a.meta?.width || a.width || null, h: a.meta?.height || a.height || null, type: a.type, subject: a.visual?.subject || null, duration: a.meta?.duration ?? null } : null);

/** Professional mode: restraint. Fewer, cleaner effects; no glitch/shake; longer shots; softer dials. */
function professional(et, dials) {
  const palette = et.transitions.palette.filter((p) => !['glitch', 'distortion'].includes(p.type));
  return {
    et: { ...et, transitions: { ...et.transitions, palette: palette.length ? palette : [{ type: 'dissolve', w: 1 }, { type: 'cut', w: 1 }], hardCutShare: Math.max(et.transitions.hardCutShare, 0.35) },
      typography: { ...et.typography, animations: et.typography.animations.filter((a) => !['glitch_reveal', 'kinetic'].includes(a)).concat(['fade']) },
      pacing: { ...et.pacing, shotSeconds: et.pacing.shotSeconds.map((s) => s * 1.15) } },
    dials: { ...dials, effects: dials.effects * 0.7, transitions: Math.min(dials.transitions, 0.6), impact: dials.impact * 0.8, motionBlur: Math.min(dials.motionBlur, 0.6) },
  };
}

/**
 * @param {object} input {
 *   directive (resolveDirective), manifest (project assets, with .visual), library (universal manifest | null),
 *   beatMap (real | null), music (chooseMusic result | null), narration (analysis | null), caps, memory ({assets:{}, sfx:{}} | null),
 *   title?, durationSeconds? }
 * @returns {{ plan, report }}
 */
export function directTimeline(input) {
  const { directive, manifest, library = null, beatMap = null, narration = null, caps = null, memory = null } = input;
  const warnings = []; const rationale = [];
  let et = directive.editType; let dials = { ...directive.dials };
  if (directive.flags.professional) { const p = professional(et, dials); et = p.et; dials = p.dials; }
  const seed = directive.seed ?? 1; const rng = makeRng('direct', seed, et.id);
  const out = resolveOutput({ resolution: directive.output.resolution, aspect: directive.output.aspect, fps: directive.output.fps });
  const comp = { name: MASTER_COMP, w: out.width, h: out.height }; const fps = out.fps;

  // ---- music, duration, beat map ----
  const music = input.music || chooseMusic({ directive, manifest, library, duration: directive.durationSeconds ?? et.pacing.targetSeconds });
  let duration = directive.durationSeconds ?? narration?.duration ?? et.pacing.targetSeconds;
  const musicDur = music.asset?.duration ?? music.asset?.meta?.duration ?? null;
  if (!directive.durationSeconds && musicDur && musicDur >= 8) duration = Math.min(duration, musicDur);
  duration = Math.max(6, Math.round(duration * fps) / fps);
  const midBpm = Math.round(((et.music.bpmRange?.[0] ?? 90) + (et.music.bpmRange?.[1] ?? 130)) / 2);
  const map = beatMap || virtualBeatMap({ bpm: midBpm, duration });
  const bpm = map.bpm || midBpm; const P = 60 / bpm;
  if (map.virtual) warnings.push(`no music was analysed: cutting to a virtual ${bpm} BPM grid. Supply music (project audio or the library) for a real beat sync.`);

  // ---- title / intro / outro ----
  const title = directive.title || directive.quoted?.[0] || (directive.subjects?.[0] ? String(directive.subjects[0]).toUpperCase() : null);
  const wantIntro = Boolean(title) && duration >= 12 && (et.shots.DARK_TITLE ?? 0) >= 0.15 && dials.text >= 0.2;
  const wantOutro = Boolean(title) && duration >= 12 && (et.shots.END_CARD ?? 0) >= 0.2 && dials.text >= 0.2;
  const introSeconds = wantIntro ? clamp(8 * P, 2.5, 5) : 0; const outroSeconds = wantOutro ? clamp(8 * P, 2.5, 5) : 0;

  // ---- rhythm ----
  const slots = slotShots(map, { duration, shotSeconds: et.pacing.shotSeconds, cutFrequency: dials.cutFrequency, rng: rng.fork('slots'), phrasing: et.pacing.phrasing, introSeconds, outroSeconds, fps });
  const n = slots.length;
  const shots = slots.map((s, i) => ({ id: `S${pad(i + 1)}`, start: s.start, end: s.end, dur: round(s.end - s.start, 4), index: i, hasNext: i < n - 1, isFirst: i === 0, isLast: i === n - 1, energy: s.energy, section: s.section, onImpact: s.onImpact, role: roleFor(s, i, n, map) }));
  shots.forEach((s) => { s.impacts = impactsIn(map, s.start, s.end, { hot: s.energy >= 0.7 && dials.impact >= 0.5 }); s.intensity = clamp(0.6 * s.energy + 0.4 * dials.intensity, 0, 1); });
  if (wantIntro) shots[0].role = 'intro'; if (wantOutro) shots[n - 1].role = 'outro';

  // ---- transitions ----
  const chapters = [];
  for (let i = 0; i < n - 1; i++) { const a = shots[i]; const b = shots[i + 1]; if ((i === 0 && wantIntro) || (i === n - 2 && wantOutro) || (a.section && b.section && a.section !== b.section && ['drop', 'break'].includes(b.section))) chapters.push(i); }
  const overlayAssets = (library?.assets || []).filter((a) => a.type === 'overlay' && /leak|light/i.test(`${a.subcategory} ${(a.tags || []).join(' ')}`)).map((a) => a.id);
  const transitions = planTransitions(shots, { editType: et, dials, caps, seed: `${seed}`, bpm, fps, overlayAssets, chapters, noTransitions: dials.transitions <= 0.02 });

  // ---- shots: asset, template, camera, velocity ----
  const pool = (manifest?.assets || []).filter((a) => ['image', 'video'].includes(a.type));
  if (!pool.length) warnings.push('the project has no images or videos: only title cards can be made');
  const assigner = new AssetAssigner(pool, { rng: rng.fork('assets'), comp, keywords: [...(directive.subjects || []), ...(directive.quoted || [])], memory: memory?.assets || {} });
  const rig = new CameraPlanner({ rig: directive.rig || et.camera.rig, seed: `${seed}`, intensity: dials.intensity });
  const velocity = directive.velocityProfile && dials.velocity >= 0.05 && VELOCITY_PROFILES[directive.velocityProfile] ? new VelocityPlanner({ profileId: directive.velocityProfile, dials, rng: rng.fork('velocity'), fps }) : null;
  const style = resolveStyle(STYLE_FOR_COLOR[directive.colorProfile] || 'cinematic-documentary', caps);
  const accent = style.colors.accent; const bg = style.colors.bg;
  const textBank = [...(directive.quoted || []).slice(1), ...(directive.subjects || [])].map((s) => String(s).toUpperCase()).filter((s, i, a) => s && a.indexOf(s) === i && s !== (title || '').toUpperCase());
  const bankUse = new Map(); // each word is shown at most twice: repeating one keyword all video long is noise
  const nextWord = () => { const w = textBank.filter((x) => (bankUse.get(x) || 0) < 2).sort((a, b) => (bankUse.get(a) || 0) - (bankUse.get(b) || 0))[0]; if (!w) return null; bankUse.set(w, (bankUse.get(w) || 0) + 1); return w; };
  const history = []; const shotPlans = []; const tplRng = rng.fork('templates');

  for (const shot of shots) {
    const handleIn = shot.index > 0 ? transitions[shot.index - 1].d / 2 : 0; const handleOut = shot.hasNext ? transitions[shot.index].d / 2 : 0;
    shot.needSeconds = shot.dur + handleIn + handleOut;
    const asset = assigner.pick(shot, {});
    const exclude = asset ? [asset.id] : [];
    const second = pool.length > 1 && shot.dur >= 1.5 ? pool.filter((a) => !exclude.includes(a.id)).sort((a, b) => (assigner.uses.get(a.id) || 0) - (assigner.uses.get(b.id) || 0) || a.id.localeCompare(b.id))[0] : null;
    const textHere = shot.isFirst && wantIntro ? title : shot.isLast && wantOutro ? title : null;
    const word = nextWord();
    const ctx = { comp, fps, seed, editType: et, rig, asset: templateAsset(asset), asset2: templateAsset(second), title: textHere || undefined, text: textHere || word || undefined, callout: word || labelFromDescription(asset) || undefined, accent, bg, subtitle: shot.isLast && wantOutro ? (directive.quoted?.[1] || undefined) : undefined };
    let name; let scores = null;
    if (shot.isFirst && wantIntro) name = 'DARK_TITLE'; else if (shot.isLast && wantOutro) name = 'END_CARD';
    else { const c = chooseTemplate({ ...shot, chapter: chapters.includes(shot.index) }, ctx, { history, rng: tplRng.fork(shot.id) }); name = c.name; scores = c.scores; }
    let plan;
    try { plan = planShot(name, shot, ctx); }
    catch (e) {
      if (asset) { warnings.push(`${shot.id}: ${name} failed (${e.message}); using FULL_BLEED`); name = 'FULL_BLEED'; plan = planShot(name, shot, ctx); }
      else { warnings.push(`${shot.id}: no image or video available (${e.message}); this shot is a plain dark slate`); name = 'SLATE'; plan = { template: name, ok: true, layers: [{ kind: 'solid', name: `${shot.id}_BG`, color: bg, opacity: 100 }], overlays: [], textSlots: [], velocityHint: null, camera: null, notes: ['slate: nothing to show'], fadeOut: 0 }; }
    }
    history.push(name);

    // velocity / source window per footage layer (layers of one asset share one map so a depth stack stays in sync)
    const maps = new Map();
    for (const L of plan.layers.filter((l) => l.kind === 'footage')) {
      const a = pool.find((x) => x.id === L.asset) || (library?.assets || []).find((x) => x.id === L.asset);
      if (!a || a.type !== 'video') continue;
      const clipDur = a.meta?.duration ?? a.duration ?? 0;
      if (L.speed === 'follow' && velocity) {
        if (!maps.has(L.asset)) {
          const prefer = { start: assigner.window(a, { span: shot.needSeconds * 1.4, handle: handleIn * 1.5, role: shot.role }) };
          let vp = velocity.plan({ duration: shot.dur, clip: { duration: clipDur, fps: a.meta?.fps || 24 }, handleIn, handleOut, prefer, hint: plan.velocityHint });
          if (!vp.fits) { warnings.push(`${shot.id}: ${L.asset} is short for this speed map (${vp.notes.join('; ')})`); }
          maps.set(L.asset, vp);
        }
        const vp = maps.get(L.asset);
        L.remap = { profile: directive.velocityProfile, patternId: vp.patternId, map: vp.map, sourceIn: vp.sourceIn, k: vp.k, frameBlend: vp.frameBlend, handleIn: round(handleIn, 4), handleOut: round(handleOut, 4), summary: describeMap(vp.map) };
        L.sourceIn = vp.sourceIn;
      } else if (L.speed === 'follow' || L.speed === 'normal') {
        L.sourceIn = assigner.window(a, { span: shot.needSeconds, handle: handleIn, role: shot.role });
      }
    }
    const asked = shot.role === 'intro' || shot.role === 'outro' ? 'structure' : 'rhythm/role';
    shotPlans.push({ shot, name, plan, asset, handleIn, handleOut });
    rationale.push({ shot: shot.id, at: [shot.start, shot.end], role: shot.role, template: name, why: `${asked}: ${shot.role}, energy ${shot.energy}${shot.section ? `, section ${shot.section}` : ''}${plan.notes?.length ? `; ${plan.notes.join('; ')}` : ''}`, asset: asset?.id ?? null, camera: plan.camera?.description ?? null, templateScores: scores });
  }

  // ---- text (global: collision-free across the whole timeline) ----
  const items = [];
  shotPlans.forEach(({ shot, plan }) => {
    for (const slot of plan.textSlots || []) items.push({ kind: slot.kind, text: slot.text, at: shot.start + slot.at, dur: slot.dur, target: slot.target, id: undefined, animation: (shot.isFirst && wantIntro && et.typography.animations.includes('kinetic') && String(slot.text).split(/\s+/).length >= 2 && dials.text >= 0.4) ? 'kinetic' : undefined, shotId: shot.id });
  });
  if (et.typography.style === 'rhythmic' && dials.text >= 0.35 && textBank.length) {
    for (const d of [...(map.drops || []), ...(map.impacts || []).filter((i) => (i.strength ?? 0) >= 0.85 && i.kind !== 'drop')].sort((a, b) => a.t - b.t).slice(0, 4)) {
      if (d.t < 2 || d.t > duration - 3) continue;
      if (items.some((it) => Math.abs(it.at - d.t) < 1.2)) continue;
      const shot = shots.find((s) => d.t >= s.start && d.t < s.end); if (!shot) continue;
      // the project's own words first; then what the shot actually shows (its description), never the same label twice
      const shownAsset = pool.find((a) => a.id === shotPlans.find((sp) => sp.shot.id === shot.id)?.asset?.id);
      const label = labelFromDescription(shownAsset); const used = items.map((it) => String(it.text).toUpperCase());
      const kw = nextWord() || (label && !used.includes(label) ? label : null); if (!kw) continue;
      items.push({ kind: 'KEYWORD', text: kw, at: d.t, dur: 0.7, shotId: shot.id });
    }
  }
  const planned = planText(items, { comp, editType: et, dials, seed, snap: (t) => snapToGrid(map, t, 'half', 0.06), fps });
  for (const d of planned.dropped) warnings.push(`text "${d.item.text}" dropped: ${d.reason}`);
  planned.items.forEach((it, i) => { it.id = `T${pad(i + 1)}`; });

  // ---- sound ----
  const finalShots = shotPlans.map(({ shot, name, plan }) => ({ ...shot, template: name, overlays: plan.overlays || [], velocity: plan.layers.find((l) => l.remap)?.remap || null }));
  const cands = dials.sfx > 0.02 && directive.flags.sfx !== false ? sfxCandidates({ shots: finalShots, transitions, textItems: planned.items, map, duration, editType: et, dials }) : [];
  const sound = planSound({ candidates: cands, library, editType: et, dials, rng: rng.fork('sfx'), memory: memory?.sfx || {}, duration });

  // ---- assemble ----
  const narrAsset = (manifest?.assets || []).find((a) => a.role === 'narration');
  const musicEntry = music.asset ? [{ asset: music.asset.id, start: 0, end: duration, gainDb: narrAsset ? -20 : round(-12 + 7 * dials.music, 1), fadeIn: et.id === 'cinematic' || et.id === 'documentary' ? 1.5 : 0.25, fadeOut: Math.min(3, outroSeconds || 2), duckDb: -10, duckUnderNarration: Boolean(narrAsset), bpm: map.bpm, source: music.source }] : [];
  if (music.source === 'explicit') warnings.push(`music ${music.file} is not in the project or the library; add it to the project's assets folder so it can be imported`);
  const tPlan = {
    version: TIMELINE_VERSION, mode: 'timeline', title: slug(title || directive.subjects?.[0] || `${et.id}-edit`, 'edit'), displayTitle: title || null, seed, prompt: directive.prompt, editType: et.id, quality: directive.quality || 'final',
    directive: { type: directive.typeId, typeSource: directive.typeSource, dials: Object.fromEntries(Object.entries(dials).map(([k, v]) => [k, round(v, 3)])), sources: directive.sources, colorProfile: directive.colorProfile, rig: directive.rig, velocityProfile: directive.velocityProfile, flags: directive.flags, explanation: directive.explanation },
    output: { ...out, format: 'mp4', codec: 'h264' }, style: STYLE_FOR_COLOR[directive.colorProfile] || 'cinematic-documentary',
    audio: { narration: narrAsset ? { asset: narrAsset.id, start: 0, gainDb: 0 } : null, music: musicEntry, sfx: [], sfxEvents: sound.events, autoSfx: false },
    look: { color: directive.colorProfile, strength: round(dials.color, 2), grain: round((et.look.grain ?? 0.3) * (0.5 + dials.effects), 2), vignette: round((et.look.vignette ?? 0.3) * (0.6 + 0.8 * dials.effects), 2), glow: round((et.look.glow ?? 0.2) * (0.5 + dials.effects), 2), letterbox: Boolean(et.look.letterbox) && Math.abs(comp.w / comp.h - 16 / 9) < 0.05 },
    captions: { enabled: Boolean(directive.flags.captions) && Boolean(narration) },
    endFade: wantOutro ? Math.min(1, outroSeconds * 0.3) : 0.6,
    beatMap: { virtual: Boolean(map.virtual), bpm: map.bpm, confidence: map.confidence ?? 0, beats: gridPoints(map, 'beat').filter((t) => t <= duration), drops: (map.drops || []).map((d) => d.t), impacts: (map.impacts || []).map((i) => i.t), sections: map.sections, file: map.source?.file ?? null },
    timeline: {
      duration, fps, bpm: map.bpm,
      shots: shotPlans.map(({ shot, name, plan }) => ({
        id: shot.id, start: shot.start, end: shot.end, template: name, role: shot.role, energy: shot.energy, section: shot.section,
        assets: { main: plan.layers.find((l) => l.kind === 'footage')?.asset ?? null },
        layers: plan.layers, overlays: plan.overlays || [], camera: plan.camera ? { rig: plan.camera.rig, move: plan.camera.move, family: plan.camera.family, description: plan.camera.description, amount: plan.camera.amount } : null,
        velocityHint: plan.velocityHint || null, fadeOut: plan.fadeOut || 0, notes: plan.notes || [], impacts: shot.impacts, text: planned.items.filter((it) => it.at >= shot.start - 1e-6 && it.at < shot.end - 1e-6),
      })),
      transitions: transitions.map(({ index, from, to, type, family, effectId, cut, d, dir, strength, window, outAt, overlayAsset, motion, sfx, notes }) => ({ index, from, to, type, family, effectId, cut, d, dir, strength, window, outAt, overlayAsset, motion, sfx, notes })),
    },
  };
  const report = {
    seed, editType: et.id, duration, bpm: map.bpm, virtualBeats: Boolean(map.virtual), music: { source: music.source, id: music.asset?.id ?? null, reason: music.reason, candidates: music.candidates },
    shots: shots.length, templates: Object.fromEntries([...new Set(history)].map((k) => [k, history.filter((h) => h === k).length])), rationale, assetLog: assigner.log,
    transitions: transitions.map((t) => ({ i: t.index, type: t.type, d: t.d, implementation: t.implementation, degraded: t.degraded, notes: t.notes })),
    text: { planned: planned.items.length, dropped: planned.dropped.length }, sound: { events: sound.events.length, dropped: sound.dropped.length, notes: sound.notes }, warnings: [...warnings, ...sound.notes],
  };
  return { plan: tPlan, report };
}
