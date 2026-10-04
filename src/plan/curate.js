// CURATED DIRECTOR: makes deliberate editorial decisions for a short (20-30 s) piece from the real asset
// manifest and narration analysis. Deterministic and explainable: every choice is logged in `_decisions`.
//
// Editorial rules encoded here:
//  * The narration is the clock: scene cuts land on sentence ends / pauses; the piece ends ~1 s after the last word.
//  * Open and close on the strongest assets ("hero" = resolution, landscape, motion footage).
//  * Match assets to what is being said (filename/description keywords), never reuse before the pool is spent,
//    and alternate still/footage so the rhythm changes.
//  * Camera moves are subtle (style-bounded), never the same move twice in a row; opener pushes in, closer pulls out.
//  * Dissolves by default; at most one distinct transition, and only where the topic really changes.
//  * Text is sparse: a title, one piece of supporting information (a spoken number, else a key phrase), no overlaps,
//    and kept clear of the caption zone.

import { guessStyle, STYLE_ALIASES, STYLES } from '../motion/styles.js';
import { round } from '../core/time.js';
import { PLAN_VERSION } from './schema.js';
import { scoreAsset, tokens, statFromText } from './scaffold.js';
import { resolveOutput } from './output.js';

const MOTIONS = ['push_in', 'pan_left', 'pull_out', 'pan_right', 'drift', 'pan_up'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const STOP = new Set('the a an and or but if then than so as of at by for from in into on onto to up with without is are was were be been it its this that these those he she they we you i his her their our your not no do does did have has had will would can could should may might also just very more most over under after before when while which who what where why how there here about'.split(' '));

function jaccard(a, b) {
  const A = new Set(a); const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let i = 0; for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}

/** 0..1 "how good would this look as a hero shot": resolution, landscape orientation, motion footage. */
export function heroScore(a) {
  const w = a.meta?.width || 0; const h = a.meta?.height || 0;
  const mp = Math.min(1, (w * h) / (3840 * 2160));
  const landscape = w && h ? (w >= h ? 1 : 0.35) : 0.5;
  const motion = a.type === 'video' ? 1 : 0;
  return round(0.5 * mp + 0.3 * landscape + 0.2 * motion, 3);
}

function pickTitle({ title, brief, narration, name }) {
  if (title) return { text: title, why: 'given by the user' };
  const q = /["“]([^"”]{3,48})["”]/.exec(brief || '');
  if (q) return { text: q[1], why: 'quoted in the brief' };
  const freq = new Map();
  for (const s of narration?.sentences || []) for (const w of s.emphasis || []) freq.set(w, (freq.get(w) || 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[0].length > 2) return { text: top[0], why: 'most emphasised proper noun in the narration' };
  return { text: String(name || 'Untitled').replace(/[-_]+/g, ' '), why: 'project name' };
}

/** Candidate cut points (seconds): sentence ends, pause midpoints, speech-segment ends. */
function beatsOf(narration, total) {
  const b = [];
  for (const s of narration?.sentences || []) b.push(s.end);
  for (const p of narration?.pauses || []) b.push(p.at + p.duration / 2);
  for (const s of narration?.speech || []) b.push(s.end);
  return [...new Set(b.map((x) => round(x, 2)))].filter((t) => t > 1.5 && t < total - 1.5).sort((x, y) => x - y);
}

function chooseTotal(narration, target) {
  const notes = [];
  if (!narration) return { total: clamp(target, 20, 30), narrEnd: null, notes };
  const nd = narration.duration;
  const tail = 1.2;
  if (nd + tail <= 30 && nd + tail >= 20) return { total: round(nd + tail), narrEnd: null, notes };
  if (nd + tail < 20) { notes.push(`narration is only ${nd.toFixed(1)}s; padded to 20s with a held ending`); return { total: 20, narrEnd: null, notes }; }
  // too long: end the piece at the sentence/pause boundary nearest 28 s
  const cands = beatsOf(narration, 99).filter((t) => t <= 28.8 && t >= 20);
  const cut = cands.length ? cands[cands.length - 1] : 27;
  notes.push(`narration is ${nd.toFixed(1)}s; the demo uses the first ${cut.toFixed(1)}s, cut at a natural pause`);
  return { total: round(cut + 1.2), narrEnd: round(cut + 0.5), notes };
}

export function curatePlan({ name = 'demo', title = null, brief = '', style = null, manifest, narration = null, targetSeconds = 25, output = {}, captions = null }) {
  const decisions = [];
  const log = (m) => decisions.push(m);
  const styleName = style ? (STYLES[STYLE_ALIASES[style] || style] ? (STYLE_ALIASES[style] || style) : guessStyle(`${style} ${brief}`)) : guessStyle(`${brief} ${name}`);
  const st = STYLES[styleName];
  log(`Style "${styleName}": ${st.description}`);

  const allVisuals = manifest.assets.filter((a) => (a.type === 'image' || a.type === 'video') && !a.generated);
  // Orientation fit: full-bleed 'cover' of a portrait photo in a landscape frame throws most of the picture away.
  const dims = resolveOutput({ resolution: output.resolution || '1080p', aspect: output.aspect });
  const outAr = dims.width / dims.height;
  const lost = (a) => (a.meta?.width && a.meta?.height ? 1 - Math.min(a.meta.width / a.meta.height / outAr, outAr / (a.meta.width / a.meta.height)) : 0);
  let visuals = allVisuals.filter((a) => lost(a) <= 0.5);
  for (const a of allVisuals.filter((x) => lost(x) > 0.5)) log(`Excluded ${a.id}: its ${a.meta.width}x${a.meta.height} frame would lose ${(lost(a) * 100).toFixed(0)}% of the picture when filling a ${dims.width}x${dims.height} frame.`);
  if (visuals.length < 3 && allVisuals.length > visuals.length) { visuals = allVisuals; log('Too few well-fitting assets: the excluded ones are used after all (crop accepted).'); }
  const narrAsset = manifest.assets.find((a) => a.type === 'audio' && a.role === 'narration');
  const musicAsset = manifest.assets.filter((a) => a.type === 'audio' && a.role === 'music').sort((a, b) => (b.meta?.duration || 0) - (a.meta?.duration || 0))[0];
  const sfxAssets = manifest.assets.filter((a) => a.type === 'audio' && a.role === 'sfx');
  if (!visuals.length) throw new Error('no images or videos in the asset folder: nothing to edit');
  if (narrAsset && !narration) log('Narration asset present but not analysed: timing falls back to the visuals.');
  const useNarr = Boolean(narrAsset && narration);

  // ---------- timeline length ----------
  const { total, narrEnd, notes: lenNotes } = chooseTotal(useNarr ? narration : null, targetSeconds);
  for (const n of lenNotes) log(n);
  log(`Total length ${total}s (${useNarr ? 'driven by the narration' : 'no narration: set by target'}).`);

  // ---------- scene boundaries on beats ----------
  const N = clamp(Math.round(total / 7), 3, 5);
  const beats = useNarr ? beatsOf(narration, total) : [];
  const bounds = [0];
  for (let k = 1; k < N; k++) {
    const ideal = (k * total) / N;
    const near = beats.filter((t) => Math.abs(t - ideal) <= 3 && t > bounds[bounds.length - 1] + 3 && t < total - 3).sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0];
    bounds.push(round(near ?? ideal));
    log(`Cut ${k} at ${bounds[bounds.length - 1]}s ${near !== undefined ? '(on a sentence end / pause)' : '(no beat nearby: even split)'}.`);
  }
  bounds.push(total);

  const sentences = useNarr ? narration.sentences : [];
  const scenes = [];
  for (let i = 0; i < N; i++) {
    const s = bounds[i]; const e = bounds[i + 1];
    const sents = sentences.filter((x) => x.start < e && x.end > s);
    const words = [...new Set(sents.flatMap((x) => x.keywords || []))];
    scenes.push({ id: `S${String(i + 1).padStart(2, '0')}`, start: s, end: e, sents, words, text: sents.map((x) => x.text).join(' ') });
  }

  // ---------- asset assignment ----------
  const used = new Map(); const shotsPlan = [];
  const pool = () => visuals.slice();
  let prevType = null; let prevAsset = null;
  const heroOrder = pool().sort((a, b) => heroScore(b) - heroScore(a));
  const pickFor = (words, { hero = false, avoid = [] } = {}) => {
    const ranked = pool().filter((a) => !avoid.includes(a.id)).map((a) => {
      const kw = scoreAsset(a, words);
      const reuse = (used.get(a.id) || 0) * 10;
      const variety = prevType && a.type === prevType ? 0.6 : 0;
      return { a, score: kw * 2 + heroScore(a) * (hero ? 4 : 1) - reuse - variety, kw };
    }).sort((x, y) => y.score - x.score);
    return ranked[0];
  };

  const motionSeq = []; let lastMotion = null;
  const nextMotion = (role) => {
    if (role === 'open') return (lastMotion = 'push_in');
    if (role === 'close') return (lastMotion = 'pull_out');
    const options = MOTIONS.filter((m) => m !== lastMotion && !(m === 'push_in' && lastMotion === 'pull_out'));
    const pick = options[motionSeq.length % options.length];
    motionSeq.push(pick);
    return (lastMotion = pick);
  };

  const shotTarget = 4.4;
  scenes.forEach((sc, si) => {
    const len = sc.end - sc.start;
    const nShots = Math.max(1, Math.round(len / shotTarget));
    const clips = [];
    let t = 0;
    for (let k = 0; k < nShots; k++) {
      const role = si === 0 && k === 0 ? 'open' : si === scenes.length - 1 && k === nShots - 1 ? 'close' : 'mid';
      const pick = pickFor(sc.words, { hero: role !== 'mid' });
      const a = pick.a;
      used.set(a.id, (used.get(a.id) || 0) + 1);
      const end = k === nShots - 1 ? round(len) : round(Math.min(len, t + len / nShots));
      const need = end - t;
      const clip = { asset: a.id, start: round(t), end };
      let why = `${role === 'mid' ? 'best fit' : role === 'open' ? 'opening hero' : 'closing hero'} (keyword match ${pick.kw}, hero ${heroScore(a)}${used.get(a.id) > 1 ? ', REUSED: pool exhausted' : ''})`;
      if (a.type === 'video') {
        const dur = a.meta?.duration || 0;
        if (dur >= need + 0.8) {
          // first use: skip the unstable start; reuse: a different part of the clip so the same footage never repeats
          const frac = used.get(a.id) > 1 ? 0.6 : 0.18;
          clip.sourceIn = round(Math.min(dur - need - 0.4, Math.max(0.3, dur * frac)));
          why += used.get(a.id) > 1 ? `; different segment (${clip.sourceIn}s) so it does not repeat` : `; source in-point ${clip.sourceIn}s skips the unstable start`;
        }
        else if (dur > 0) { clip.speed = round(Math.max(0.6, dur / need)); if (dur / need < 0.6) clip.end = round(t + dur / 0.6); why += `; slowed to ${clip.speed}x to cover ${need.toFixed(1)}s`; }
        clip.motion = 'static';
      } else {
        clip.motion = nextMotion(role);
        if (role === 'mid' && used.get(a.id) > 1) clip.motion = lastMotion = nextMotion('mid'); // reused still: a different move than before
      }
      if (role === 'open') clip.fadeIn = 0; // handled by scene transition
      clips.push(clip);
      log(`${sc.id} shot ${k + 1}: ${a.id} [${a.type}] ${clip.motion} ${clip.start}-${clip.end}s - ${why}`);
      prevType = a.type; prevAsset = a.id; t = clip.end; // a clip shortened by a short source hands the remaining time to the next shot
    }
    // if a slowed video ended early, make the last clip fill the scene by holding (extend end)
    clips[clips.length - 1].end = round(len);
    sc.clips = clips;
  });

  // ---------- transitions ----------
  let lastDistinct = -99;
  const distinct = st.motion.transition && st.motion.transition !== 'dissolve' ? st.motion.transition : null;
  scenes.forEach((sc, i) => {
    if (i === 0) { sc.transition = { type: 'dissolve', duration: 1.0 }; log('S01: dissolve in from black (1.0s).'); return; }
    const sim = jaccard(scenes[i - 1].words, sc.words);
    const chapter = useNarr ? sim < 0.08 : i === Math.ceil(scenes.length / 2);
    if (chapter && distinct && sc.start - lastDistinct > 10) {
      sc.transition = { type: distinct, duration: st.motion.transitionDur }; lastDistinct = sc.start;
      log(`${sc.id}: ${distinct} - the topic changes (keyword overlap ${(sim * 100).toFixed(0)}%).`);
    } else {
      sc.transition = { type: 'dissolve', duration: round(clamp(st.motion.transitionDur || 0.8, 0.6, 1.0)) };
      log(`${sc.id}: dissolve ${sc.transition.duration}s${chapter ? ' (topic change, but this style has no distinct transition)' : ' (same thread of thought)'}.`);
    }
  });

  // ---------- typography ----------
  const tl = pickTitle({ title, brief, narration: useNarr ? narration : null, name });
  const capsOn = captions?.enabled ?? Boolean(useNarr && narration.transcript?.method && narration.transcript.method !== 'none');
  const subtitle = (brief || '').split(/[.\n]/)[0].replace(/^\s*(create|make|build)\s+(a|an|the)?\s*/i, '').trim();
  const first = scenes[0];
  first.graphics = [{ kind: 'title', text: tl.text, ...(subtitle && subtitle.length <= 70 ? { subtitle } : {}), start: 0.9, end: round(Math.min(first.end - first.start - 0.4, 5.2)) }];
  log(`Title "${tl.text}" (${tl.why}) at ${first.id} 0.9s - held ~4s so it is readable.`);

  let support = null;
  for (const sc of scenes.slice(1)) {
    for (const s of sc.sents) {
      const stat = statFromText(s.text);
      if (stat && stat.value > 0 && !support) {
        const at = clamp(s.start - sc.start, 0.3, Math.max(0.3, sc.end - sc.start - 3.2));
        support = { sc, g: { kind: 'stat', ...stat, label: stat.label || (s.keywords?.[0] ? s.keywords[0][0].toUpperCase() + s.keywords[0].slice(1) : ''), position: capsOn ? 'upper-left' : 'lower-left', start: round(at), end: round(Math.min(sc.end - sc.start - 0.2, at + 3.6)) } };
        log(`Stat "${stat.prefix || ''}${stat.value}${stat.suffix || ''}" in ${sc.id}: the narrator says the number at ${s.start}s, so the graphic arrives with it.`);
      }
    }
  }
  if (!support) { // no number spoken: highlight the strongest key phrase with a lower third
    const best = scenes.slice(1).map((sc) => ({ sc, s: sc.sents.find((x) => (x.emphasis || []).length) })).find((x) => x.s);
    if (best) {
      const phrase = best.s.emphasis[0];
      const at = clamp(best.s.start - best.sc.start, 0.3, Math.max(0.3, best.sc.end - best.sc.start - 3.2));
      support = { sc: best.sc, g: { kind: 'lower_third', title: phrase, subtitle: best.s.keywords?.[0] ? `${best.s.keywords[0]}` : undefined, position: capsOn ? 'upper-left' : 'lower-left', start: round(at), end: round(Math.min(best.sc.end - best.sc.start - 0.2, at + 3.2)) } };
      log(`Lower third "${phrase}" in ${best.sc.id}: strongest named entity in the narration.`);
    } else log('No spoken number or named entity: no supporting graphic (restraint over filler).');
  }
  for (const sc of scenes) sc.graphics ||= [];
  if (support) support.sc.graphics.push(support.g);

  for (const sc of scenes) sc.intent = {
    visual: sc.clips.map((c) => `${c.asset}(${c.motion})`).join(' -> '),
    text: sc.graphics.map((g) => g.kind).join(', ') || 'none',
    sfx: sc.transition.type === 'dissolve' ? 'none' : 'whoosh on the cut',
    music: sc.id === 'S01' ? 'bed fades in' : 'ducked under narration',
    narration: sc.text.slice(0, 160),
  };

  // ---------- audio ----------
  const audio = { music: [], sfx: [], autoSfx: true };
  if (useNarr) audio.narration = { asset: narrAsset.id, ...(narrEnd ? { end: narrEnd } : {}) };
  if (musicAsset) {
    audio.music.push({ asset: musicAsset.id, start: 0, end: total, gainDb: -22, duckDb: -11, fadeIn: 1.5, fadeOut: 2.5 });
    log(`Music ${musicAsset.id} at -22 dB, ducked a further 11 dB under speech, 1.5s fade in / 2.5s fade out.`);
  } else log('No music asset supplied: the piece is narration + sound design only.');
  log(sfxAssets.length ? `SFX: ${sfxAssets.length} supplied asset(s) are matched to transitions/titles by name.` : 'No SFX supplied: simple FFmpeg-synthesised hits will be used where needed (basic quality).');

  const plan = {
    version: PLAN_VERSION, title: tl.text, brief, style: styleName,
    output: { resolution: output.resolution || '1080p', aspect: output.aspect, fps: output.fps || 24, format: 'mp4', codec: 'h264', path: 'renders/final.mp4' },
    endFade: 1.0,
    scenes: scenes.map(({ id, start, end, intent, clips, graphics, transition }) => ({ id, start, end, intent, transition, clips, graphics })),
    audio,
    captions: capsOn ? { enabled: true, maxCharsPerLine: 34 } : { enabled: false },
    _decisions: decisions,
  };
  return plan;
}
