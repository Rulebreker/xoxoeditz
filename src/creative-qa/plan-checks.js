// CREATIVE QA, plan level. Pure: reads a timeline plan (plus the manifests and the beat map it was made from) and
// judges it the way an editor would on a first look - is this a slideshow, is the camera only ever zooming, does
// the sound design follow the picture, do the cuts land on the music? Every finding names the shot or the metric
// behind it, so a repair (or a person) knows what to change.
//
// This judges STRUCTURE. Whether the pictures themselves are good is for eyes: see the preview.

import { gridPoints } from '../beat/analyze.js';
import { hamming } from '../assets/visual.js';
import { EDIT_TYPES } from '../edit-types/index.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const stdev = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const TITLE_LIKE = new Set(['DARK_TITLE', 'END_CARD', 'TEXT_SCENE', 'STAT_SCENE', 'SLATE']);
const SOLID_OK = new Set(['TEXT_SCENE', 'STAT_SCENE', 'DARK_TITLE', 'END_CARD', 'SLATE']);

export const CATEGORIES = ['rhythm', 'motion', 'variety', 'transitions', 'sound', 'type', 'composition', 'pacing'];
const issue = (category, code, severity, message, extra = {}) => ({ category, code, severity, message, ...extra });

/**
 * @param {object} plan   timeline plan
 * @param {object} ctx    { manifest, library, tier? }
 * @returns {{ issues, metrics }}
 */
export function planChecks(plan, { manifest = null, library = null } = {}) {
  const out = []; const m = {};
  const tl = plan.timeline; const shots = tl.shots; const trs = tl.transitions; const n = shots.length;
  const et = EDIT_TYPES[plan.editType] || EDIT_TYPES.cinematic; const dials = plan.directive?.dials || et.dials;
  const fps = plan.output.fps; const dur = tl.duration;
  const assets = new Map([...(manifest?.assets || []), ...(library?.assets || [])].map((a) => [a.id, a]));
  const shotLen = shots.map((s) => s.end - s.start);

  // ---- rhythm ----
  const beats = plan.beatMap?.beats || [];
  const cuts = shots.slice(1).map((s) => s.start);
  const tol = Math.max(0.04, 1.6 / fps);
  const onBeat = cuts.filter((c) => beats.some((b) => Math.abs(b - c) <= tol));
  const half = beats.length > 1 ? gridPoints({ beats, beatPeriod: beats[1] - beats[0] }, 'half') : [];
  const onGrid = cuts.filter((c) => half.some((b) => Math.abs(b - c) <= tol));
  m.cutsOnBeat = cuts.length ? +(onGrid.length / cuts.length).toFixed(3) : 1;
  if (cuts.length >= 4 && dials.beatSync >= 0.5) {
    if (m.cutsOnBeat < 0.6) out.push(issue('rhythm', 'CUTS_OFF_BEAT', 'error', `only ${(m.cutsOnBeat * 100) | 0}% of the cuts land on the beat grid (beat sync dial ${dials.beatSync.toFixed(2)})`, { data: { ratio: m.cutsOnBeat } }));
    else if (m.cutsOnBeat < 0.8) out.push(issue('rhythm', 'CUTS_LOOSE', 'warning', `${(m.cutsOnBeat * 100) | 0}% of the cuts land on the beat grid; a beat-synced edit should be above 80%`, { data: { ratio: m.cutsOnBeat } }));
  }
  if (plan.beatMap?.virtual && dials.beatSync >= 0.6) out.push(issue('rhythm', 'NO_REAL_BEATS', 'warning', 'the cuts follow a virtual grid, not the music: supply a music track so the edit can really sync to it'));
  const drops = plan.beatMap?.drops || [];
  for (const d of drops) {
    if (!shots.some((s) => Math.abs(s.start - d) <= 2.5 / fps)) out.push(issue('rhythm', 'DROP_NOT_CUT', 'warning', `the drop at ${d.toFixed(2)}s has no cut on it`, { data: { at: d } }));
    if (plan.audio.sfxEvents.length && !plan.audio.sfxEvents.some((e) => Math.abs(e.at - d) <= 0.12 && ['big_impact', 'impact', 'drop', 'hit'].includes(e.role))) out.push(issue('sound', 'DROP_NO_SFX', 'warning', `no impact sound on the drop at ${d.toFixed(2)}s`, { data: { at: d } }));
  }

  // ---- pacing ----
  const [lo, hi] = et.pacing.shotSeconds; const med = median(shotLen);
  m.medianShot = +med.toFixed(2);
  const body = shotLen.slice(1, -1).length ? shotLen.slice(1, -1) : shotLen;
  if (n >= 6 && (median(body) < lo * 0.75 || median(body) > hi * 1.3)) out.push(issue('pacing', 'PACING_OFF', 'warning', `median shot is ${median(body).toFixed(2)}s but ${et.id} runs ${lo}–${hi}s`, { data: { median: median(body), range: [lo, hi] } }));
  const cv = body.length >= 8 ? stdev(body) / (mean(body) || 1) : 1;
  m.lengthVariation = +cv.toFixed(3);
  if (n >= 8 && cv < 0.12) out.push(issue('pacing', 'METRONOME', 'warning', 'every shot is almost the same length: the cut has no rhythm of its own'));
  shots.forEach((s, i) => { if (s.end - s.start < 0.2 && i > 0 && i < n - 1) out.push(issue('pacing', 'FLASH_SHOT', 'warning', `${s.id} lasts ${(s.end - s.start).toFixed(2)}s: too short to read`, { shot: s.id })); });

  // ---- motion ----
  const moves = shots.map((s) => s.camera).filter(Boolean);
  const families = new Set(moves.map((c) => c.family)); const distinctMoves = new Set(moves.map((c) => c.move));
  m.cameraMoves = distinctMoves.size; m.cameraFamilies = families.size;
  const moving = shots.filter((s) => !TITLE_LIKE.has(s.template));
  const motionless = moving.filter((s) => !s.camera && !s.layers.some((l) => l.motion?.length) && !s.layers.some((l) => l.remap));
  m.staticShare = moving.length ? +(motionless.length / moving.length).toFixed(3) : 0;
  if (moving.length >= 4 && m.staticShare > 0.35 && dials.camera >= 0.3) out.push(issue('motion', 'STATIC_SHOTS', 'warning', `${(m.staticShare * 100) | 0}% of the picture shots have no camera move and no speed change`, { data: { shots: motionless.map((s) => s.id) } }));
  if (moves.length >= 4 && [...families].every((f) => f === 'dolly' || f === 'static')) out.push(issue('motion', 'ZOOM_ONLY', dials.camera >= 0.5 ? 'error' : 'warning', 'the camera only ever pushes in or pulls out'));
  if (moves.length >= 6 && distinctMoves.size < Math.min(3, Math.ceil(moves.length / 3))) out.push(issue('motion', 'LOW_MOVE_VARIETY', 'warning', `only ${distinctMoves.size} distinct camera move(s) across ${moves.length} shots`));
  const withCam = shots.filter((s) => s.camera);
  for (let i = 1; i < withCam.length; i++) if (withCam[i].camera.move === withCam[i - 1].camera.move && withCam[i].camera.move !== 'explicit') out.push(issue('motion', 'REPEATED_MOVE', 'warning', `${withCam[i - 1].id} and ${withCam[i].id} both use "${withCam[i].camera.move}"`, { shot: withCam[i].id }));
  const remapped = shots.filter((s) => s.layers.some((l) => l.remap));
  m.speedRamped = remapped.length; const maps = new Set(remapped.map((s) => s.layers.find((l) => l.remap).remap.summary));
  m.speedMaps = maps.size;
  if (dials.velocity >= 0.4 && n >= 6) {
    if (remapped.length < Math.max(2, Math.floor(n * 0.3))) out.push(issue('motion', 'FEW_SPEED_RAMPS', 'warning', `a velocity edit (dial ${dials.velocity.toFixed(2)}) has speed ramps on only ${remapped.length} of ${n} shots`));
    if (remapped.length >= 3 && maps.size < Math.min(3, remapped.length)) out.push(issue('motion', 'SAME_SPEED_MAP', 'warning', 'the speed ramps are all the same shape'));
  }

  // ---- variety / slideshow ----
  const picture = shots.filter((s) => !TITLE_LIKE.has(s.template));
  const fb = picture.filter((s) => s.template === 'FULL_BLEED').length; m.fullBleedShare = picture.length ? +(fb / picture.length).toFixed(3) : 0;
  const tpl = new Set(shots.map((s) => s.template)); m.templates = tpl.size;
  const noSpeed = remapped.length === 0; const slideshow = picture.length >= 5 && m.fullBleedShare > 0.7 && families.size <= 2 && noSpeed;
  if (slideshow) out.push(issue('variety', 'SLIDESHOW', dials.intensity >= 0.45 ? 'error' : 'warning', 'this reads as a slideshow: full-frame stills/clips, little camera variety and no speed changes'));
  if (picture.length >= 8 && dials.effects >= 0.3 && tpl.size < 3) out.push(issue('variety', 'LOW_TEMPLATE_VARIETY', 'warning', `only ${tpl.size} kind(s) of shot in ${picture.length} picture shots`));
  for (let i = 3; i < n; i++) if (new Set(shots.slice(i - 3, i + 1).map((s) => s.template)).size === 1 && !TITLE_LIKE.has(shots[i].template) && shots[i].template !== 'FULL_BLEED') out.push(issue('variety', 'TEMPLATE_STREAK', 'warning', `four ${shots[i].template} shots in a row`, { shot: shots[i].id }));

  // ---- duplicates ----
  const mainOf = (s) => s.assets?.main;
  for (let i = 1; i < n; i++) {
    const a = mainOf(shots[i - 1]); const b = mainOf(shots[i]);
    if (a && b && a === b && !TITLE_LIKE.has(shots[i].template) && !TITLE_LIKE.has(shots[i - 1].template)) out.push(issue('variety', 'DUPLICATE_ADJACENT', 'error', `${shots[i - 1].id} and ${shots[i].id} show the same asset ${a}`, { shot: shots[i].id }));
    else if (a && b) { const ha = assets.get(a)?.visual?.hash; const hb = assets.get(b)?.visual?.hash; if (ha && hb && a !== b && hamming(ha, hb) <= 4 && !TITLE_LIKE.has(shots[i].template)) out.push(issue('variety', 'NEAR_DUPLICATE_ADJACENT', 'warning', `${shots[i - 1].id} and ${shots[i].id} look almost identical (${a} / ${b})`, { shot: shots[i].id })); }
  }
  const mains = picture.map(mainOf).filter(Boolean); const pool = new Set(mains);
  const firstRepeat = mains.findIndex((a, i) => mains.indexOf(a) !== i);
  const availablePool = (manifest?.assets || []).filter((a) => ['image', 'video'].includes(a.type)).length;
  if (firstRepeat >= 0 && firstRepeat < Math.min(availablePool, 8) - 1) out.push(issue('variety', 'EARLY_REUSE', 'warning', `${mains[firstRepeat]} is used again at picture shot ${firstRepeat + 1} before the pool of ${availablePool} assets is exhausted`));
  m.assetsUsed = pool.size;

  // ---- transitions ----
  const types = trs.map((t) => t.type); const nonCut = trs.filter((t) => t.type !== 'cut');
  m.transitionTypes = new Set(nonCut.map((t) => t.type)).size; m.transitionShare = trs.length ? +(nonCut.length / trs.length).toFixed(3) : 0;
  const palette = new Set(et.transitions.palette.map((p) => p.type));
  for (const t of nonCut) if (!palette.has(t.type) && !t.notes?.includes('forced by the plan')) out.push(issue('transitions', 'OFF_PALETTE', 'warning', `transition ${t.index + 1} (${t.type}) is not part of the ${et.id} vocabulary`, { data: { index: t.index } }));
  for (let i = 2; i < types.length; i++) if (types[i] !== 'cut' && types[i] === types[i - 1] && types[i] === types[i - 2]) out.push(issue('transitions', 'TRANSITION_REPEAT', 'warning', `three ${types[i]} transitions in a row`, { data: { index: i } }));
  if (nonCut.length >= 6 && m.transitionTypes < 2) out.push(issue('transitions', 'ONE_TRANSITION', 'warning', 'every transition is the same'));
  const degraded = nonCut.filter((t) => t.notes?.some((x) => /running as/.test(x)));
  m.degradedTransitions = degraded.length;
  if (nonCut.length >= 4 && degraded.length / nonCut.length > 0.5) out.push(issue('transitions', 'TRANSITIONS_DEGRADED', 'info', `${degraded.length} of ${nonCut.length} transitions run on fallbacks because effects are unavailable`));
  if (dials.transitions < 0.3 && m.transitionShare > 0.7) out.push(issue('transitions', 'OVER_TRANSITIONED', 'warning', `${(m.transitionShare * 100) | 0}% of cuts have a transition although the edit is meant to be restrained`));
  if (nonCut.some((t) => t.d > 2)) out.push(issue('transitions', 'LONG_TRANSITION', 'warning', 'a transition lasts more than 2 s'));

  // ---- sound ----
  const ev = plan.audio.sfxEvents; m.sfxEvents = ev.length; m.sfxPerSecond = +(ev.length / dur).toFixed(3);
  if (dials.sfx >= 0.5 && ev.length === 0) out.push(issue('sound', 'NO_SFX', 'warning', 'no sound effects although the sound-design dial is high (is there an SFX library?)'));
  if (ev.length) {
    if (m.sfxPerSecond > 1.8) out.push(issue('sound', 'SFX_TOO_DENSE', 'warning', `${m.sfxPerSecond} sound effects per second`));
    const times = [0, ...ev.map((e) => e.at), dur].sort((a, b) => a - b); const gap = Math.max(...times.slice(1).map((t, i) => t - times[i]));
    m.longestSfxGap = +gap.toFixed(2);
    if (dials.sfx >= 0.5 && gap > Math.max(8, dur * 0.3)) out.push(issue('sound', 'SFX_GAP', 'warning', `no sound effect for ${gap.toFixed(1)}s`));
    const hot = ev.filter((e) => e.fit.layers[0].gainDb > -4);
    if (hot.length) out.push(issue('sound', 'SFX_HOT', 'warning', `${hot.length} sound effect(s) are planned within 4 dB of full scale`));
    const music = plan.audio.music[0];
    if (music && ev.some((e) => assets.get(e.assetId)?.features && (assets.get(e.assetId).features.rmsDb + e.fit.layers[0].gainDb) > (music.gainDb ?? -10) - 6 + 18)) out.push(issue('sound', 'SFX_OVER_MUSIC', 'info', 'some SFX are louder than the music bed would suggest'));
    // every transition that should have a sound has one near its cut
    const missing = nonCut.filter((t) => t.sfx && !ev.some((e) => Math.abs(e.at - t.cut) <= 0.12));
    if (dials.sfx >= 0.5 && nonCut.length >= 4 && missing.length / nonCut.length > 0.5) out.push(issue('sound', 'TRANSITIONS_SILENT', 'info', `${missing.length} of ${nonCut.length} transitions have no sound`));
  }
  if (plan.audio.music.length === 0 && dials.music >= 0.3) out.push(issue('sound', 'NO_MUSIC', 'warning', 'the edit has no music'));
  const musicM = plan.audio.music[0]; if (musicM && musicM.gainDb > -3) out.push(issue('sound', 'MUSIC_TOO_LOUD', 'warning', `the music bed sits at ${musicM.gainDb} dB`));

  // ---- type ----
  const texts = shots.flatMap((s) => s.text.map((t) => ({ ...t, shot: s.id })));
  m.textItems = texts.length; m.textCharsPerSecond = +(texts.reduce((a, t) => a + t.text.replace(/\s/g, '').length, 0) / dur).toFixed(3);
  if (m.textCharsPerSecond > 10) out.push(issue('type', 'TEXT_DENSE', 'warning', `${m.textCharsPerSecond} characters of on-screen text per second`));
  for (const t of texts) if (t.layout && t.layout.fits === false) out.push(issue('type', 'TEXT_DOES_NOT_FIT', 'error', `"${t.text}" does not fit the safe area`, { shot: t.shot }));
  const anims = texts.map((t) => t.animation); for (let i = 2; i < anims.length; i++) if (anims[i] === anims[i - 1] && anims[i] === anims[i - 2]) out.push(issue('type', 'TEXT_ANIM_REPEAT', 'warning', `three ${anims[i]} text animations in a row`));
  const words = texts.map((t) => t.text.toUpperCase()); const dupWords = words.filter((w, i) => words.indexOf(w) !== i && w.length > 2 && !/^[A-Z]\d+/.test(w));
  if (dupWords.length > 2) out.push(issue('type', 'TEXT_REPEATED', 'warning', `the same text appears ${dupWords.length + 1} times`));
  if (dials.text >= 0.35 && n >= 6 && texts.length === 0) out.push(issue('type', 'NO_TEXT', 'info', 'no on-screen text at all'));
  if (et.typography.style === 'rhythmic' && texts.length && !texts.some((t) => ['kinetic', 'scale_punch', 'glitch_reveal', 'word_reveal'].includes(t.animation))) out.push(issue('type', 'TEXT_NOT_RHYTHMIC', 'info', 'the type does not move like the edit does'));

  // ---- composition ----
  const compositing = shots.filter((s) => ['CROP_DETAIL', '2_5D', 'PARALLAX', 'PIP', 'SPLIT_SCREEN', 'HUD_SCENE', 'CALLOUT'].includes(s.template));
  m.compositingShots = compositing.length;
  if (picture.length >= 8 && dials.depth + dials.effects >= 0.6 && compositing.length === 0) out.push(issue('composition', 'NO_COMPOSITING', 'info', 'no cropped, layered or picture-in-picture shots'));
  for (const s of shots) {
    if (!SOLID_OK.has(s.template)) for (const l of s.layers) if (l.kind === 'solid' && (l.opacity ?? 100) >= 50) out.push(issue('composition', 'ACCIDENTAL_BOX', 'error', `${s.id}/${l.name}: an opaque solid in a ${s.template} shot would cover the picture`, { shot: s.id }));
    const hasPicture = s.layers.some((l) => l.kind === 'footage'); const hasText = s.text.length > 0;
    if (!hasPicture && !hasText && s.template !== 'SLATE') out.push(issue('composition', 'EMPTY_SHOT', 'error', `${s.id} would show nothing`, { shot: s.id }));
    if (s.template === 'SLATE') out.push(issue('composition', 'SLATE_SHOT', 'warning', `${s.id} is a dark slate (no asset was available)`, { shot: s.id }));
    for (const l of s.layers) {
      if (l.kind !== 'footage') continue;
      const a = assets.get(l.asset); const w = a?.meta?.width || a?.width; if (!w) continue;
      const cropW = l.crop?.w ?? 1; const mag = plan.output.width / (w * cropW);
      if (l.rect && l.rect.w < 1) continue;
      if (mag > 2.2) out.push(issue('composition', 'SOFT_CROP', 'warning', `${s.id}/${l.name}: ${l.asset} is magnified ${mag.toFixed(1)}x by its crop`, { shot: s.id, data: { magnification: mag } }));
    }
    if (s.layers.some((l) => l.kind === 'footage' && l.crop) && s.layers.some((l) => l.crop && (l.crop.w < 0.18 || l.crop.h < 0.18))) out.push(issue('composition', 'TIGHT_CROP', 'warning', `${s.id}: a crop narrower than 18% of the frame`, { shot: s.id }));
  }
  if (plan.look?.letterbox && Math.abs(plan.output.width / plan.output.height - 16 / 9) > 0.2) out.push(issue('composition', 'LETTERBOX_ON_WIDE', 'warning', 'letterbox bars on an already wide frame'));

  return { issues: out, metrics: m };
}
