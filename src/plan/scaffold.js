// BASELINE DIRECTOR: a deterministic first-draft edit plan from the manifest, narration analysis and brief.
// It is a starting point that Claude (the creative Director) is expected to read, judge and improve — not a
// substitute for creative judgement. It is also what `xoxo auto` uses when no one is steering.

import { guessStyle, STYLE_ALIASES, STYLES } from '../motion/styles.js';
import { round } from '../core/time.js';
import { PLAN_VERSION } from './schema.js';

const MOTION_CYCLE = ['push_in', 'pan_left', 'pull_out', 'pan_right', 'drift', 'push_in', 'pan_up'];

export const tokens = (s) => String(s).toLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/g) || [];

export function scoreAsset(asset, words) {
  const kw = new Set([...(asset.keywords || []), ...tokens(asset.description || '')]);
  let s = 0;
  for (const w of words) if (kw.has(w)) s += 2; else for (const k of kw) if (k.length > 3 && (w.startsWith(k) || k.startsWith(w))) { s += 1; break; }
  return s;
}

/** "Mach 2.0" -> {prefix:'Mach ', value:2, decimals:1}; "2,100 km/h" -> {value:2100, suffix:' km/h'} */
export function statFromText(text) {
  const mach = /\bMach\s*(\d+(?:\.\d+)?)/i.exec(text);
  if (mach) return { prefix: 'Mach ', value: Number(mach[1]), decimals: (mach[1].split('.')[1] || '').length, suffix: '', label: 'Top speed' };
  const m = /(\d[\d,]*(?:\.\d+)?)\s?(km\/h|kph|mph|km|kilometers?|meters?|m|kg|tons?|tonnes?|%|knots?|ft|feet|miles?|years?)\b/i.exec(text);
  if (m) {
    const value = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(value)) return null;
    const unit = m[2].toLowerCase();
    return { value, decimals: (m[1].split('.')[1] || '').length, suffix: unit === '%' ? '%' : ` ${m[2]}`, label: '' };
  }
  return null;
}

export function scaffoldPlan({ title, brief = '', style = null, manifest, narration = null, output = {}, captions = null, maxStats = 1 }) {
  const styleName = style ? (STYLES[STYLE_ALIASES[style] || style] ? (STYLE_ALIASES[style] || style) : guessStyle(`${style} ${brief}`)) : guessStyle(brief);
  const visuals = manifest.assets.filter((a) => (a.type === 'image' || a.type === 'video'));
  const narr = manifest.assets.find((a) => a.type === 'audio' && a.role === 'narration');
  const music = manifest.assets.filter((a) => a.type === 'audio' && a.role === 'music');
  const notes = [];

  // ---- scene skeleton ----
  let scenes;
  if (narration?.scenes?.length) {
    scenes = narration.scenes.map((s) => ({ id: s.id, start: s.start, end: s.end, text: s.text, sentenceIds: s.sentenceIds }));
  } else {
    scenes = []; let t = 0; let i = 1;
    const base = narration?.duration;
    for (const a of visuals) {
      const dur = a.type === 'video' ? Math.min(a.meta?.duration || 6, 8) : 5;
      scenes.push({ id: `S${String(i++).padStart(2, '0')}`, start: round(t), end: round(t + dur), text: '', preassigned: a.id });
      t += dur;
      if (base && t >= base) break;
    }
    if (!scenes.length) scenes = [{ id: 'S01', start: 0, end: base || 10, text: '' }];
    if (base) scenes[scenes.length - 1].end = round(base);
    notes.push(narration ? 'No transcript: scenes follow the visuals, not the words.' : 'No narration: scenes follow the visuals.');
  }
  // contiguous timeline: close gaps, start at 0, end at narration end
  scenes[0].start = 0;
  for (let i = 1; i < scenes.length; i++) scenes[i].start = scenes[i - 1].end;
  if (narration?.duration) scenes[scenes.length - 1].end = round(Math.max(scenes[scenes.length - 1].end, narration.duration));

  // ---- assign visuals ----
  const used = new Map(); // id -> count
  const pool = () => visuals.slice().sort((a, b) => (used.get(a.id) || 0) - (used.get(b.id) || 0));
  let motionIdx = 0;
  const outScenes = scenes.map((s, si) => {
    const len = s.end - s.start;
    const words = [...new Set(tokens(s.text))];
    const wantClips = Math.max(1, Math.round(len / 5));
    const clips = []; const taken = new Set();
    for (let k = 0; k < wantClips && visuals.length; k++) {
      let best = null;
      if (k === 0 && s.preassigned) best = visuals.find((a) => a.id === s.preassigned);
      if (!best) {
        const ranked = pool().filter((a) => !taken.has(a.id)).map((a) => ({ a, sc: scoreAsset(a, words) - (used.get(a.id) || 0) * 3 })).sort((x, y) => y.sc - x.sc);
        best = ranked[0]?.a || pool()[0];
      }
      if (!best) break;
      taken.add(best.id); used.set(best.id, (used.get(best.id) || 0) + 1);
      const cs = round((len / wantClips) * k); const ce = round(k === wantClips - 1 ? len : (len / wantClips) * (k + 1));
      const clip = { asset: best.id, start: cs, end: ce };
      if (best.type === 'image') clip.motion = MOTION_CYCLE[motionIdx++ % MOTION_CYCLE.length];
      else { clip.motion = 'static'; if (best.meta?.duration && ce - cs > best.meta.duration) { clip.speed = round(best.meta.duration / (ce - cs)); } }
      clips.push(clip);
    }
    const graphics = [];
    if (si === 0) graphics.push({ kind: 'title', text: title, subtitle: brief ? brief.split(/[.\n]/)[0].slice(0, 70) : undefined, start: 0.6, end: Math.min(len - 0.3, 6) });
    if (s.sentenceIds && narration) {
      const sents = narration.sentences.filter((x) => s.sentenceIds.includes(x.id));
      let stats = 0;
      for (const sent of sents) {
        if (stats >= maxStats) break;
        const st = statFromText(sent.text);
        if (st && st.value > 0 && sent.start - s.start + 3 <= len + 0.5) {
          graphics.push({ kind: 'stat', ...st, label: st.label || sent.keywords?.[0]?.replace(/^./, (c) => c.toUpperCase()) || '', start: round(Math.max(0, sent.start - s.start)), end: round(Math.min(len, sent.start - s.start + 4)), position: 'lower-left' });
          stats++;
        }
      }
    }
    return {
      id: s.id, start: s.start, end: s.end,
      intent: { visual: clips.map((c) => c.asset).join(' → ') || 'TBD', text: graphics.map((g) => g.kind).join(', '), sfx: '', music: '', narration: s.text.slice(0, 160) },
      clips, graphics,
      ...(si > 0 ? { transition: { type: undefined } } : {}),
    };
  });
  for (const s of outScenes) if (s.transition && s.transition.type === undefined) delete s.transition;

  const plan = {
    version: PLAN_VERSION, title, brief, style: styleName,
    output: { resolution: output.resolution || '4k', aspect: output.aspect, fps: output.fps || 24, format: output.format || 'mp4', codec: output.codec || 'h264', ...(output.width ? { width: output.width, height: output.height } : {}) },
    scenes: outScenes,
    audio: {
      ...(narr ? { narration: { asset: narr.id } } : {}),
      music: music[0] ? [{ asset: music[0].id, gainDb: -20, duckDb: -10, fadeIn: 2, fadeOut: 3 }] : [],
      sfx: [], autoSfx: true,
    },
    captions: captions ?? { enabled: Boolean(narration && narration.transcript?.method && narration.transcript.method !== 'none') },
    endFade: 1.0,
    _scaffold: { generatedBy: 'xoxo baseline director', notes: [...notes, 'First draft: review scene breaks, asset choices, graphics and transitions, then refine.'] },
  };
  return plan;
}
