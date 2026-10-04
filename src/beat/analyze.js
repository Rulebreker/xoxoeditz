// BEAT ENGINE: PCM -> beat_map.json.  Pure JavaScript DSP (no Python, no native deps):
//   spectral-flux onset envelope -> autocorrelation tempo prior -> comb-filter grid fit (global BPM + phase)
//   -> sample-level onset refinement + least-squares grid -> downbeats from low-band weight -> bars/phrases
//   -> energy per bar -> drops / breaks / rises / impacts / sections.
// Best on steady-tempo material (EDM, trap, phonk, most pop/rock). Tempo changes and rubato lower `confidence`.

import fs from 'node:fs';
import path from 'node:path';
import { fft, hann } from './fft.js';
import { decodePcm } from '../audio/pcm.js';
import { fingerprintFile } from '../assets/fingerprint.js';
import { ensureDir, writeJson } from '../core/paths.js';
import { round } from '../core/time.js';

export const N = 1024; export const HOP = 256;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

export function features(samples, sr) {
  const nFrames = Math.max(0, Math.floor((samples.length - N) / HOP) + 1);
  const win = hann(N); const re = new Float64Array(N); const im = new Float64Array(N);
  const binHz = sr / N; const kLow = Math.max(2, Math.floor(160 / binHz)); const kMid = Math.floor(2500 / binHz); const kTop = Math.min(N / 2, Math.floor(9000 / binHz));
  const flux = new Float32Array(nFrames); const fluxLow = new Float32Array(nFrames);
  const low = new Float32Array(nFrames); const mid = new Float32Array(nFrames); const high = new Float32Array(nFrames); const rms = new Float32Array(nFrames);
  let prev = new Float64Array(N / 2 + 1);
  for (let f = 0; f < nFrames; f++) {
    const o = f * HOP; let e = 0;
    for (let i = 0; i < N; i++) { const v = samples[o + i]; re[i] = v * win[i]; im[i] = 0; e += v * v; }
    rms[f] = Math.sqrt(e / N);
    fft(re, im);
    const mag = new Float64Array(N / 2 + 1);
    let fl = 0; let fll = 0; let el = 0; let em = 0; let eh = 0;
    for (let k = 1; k <= N / 2; k++) {
      const m = Math.hypot(re[k], im[k]); mag[k] = Math.log1p(100 * m);
      const d = mag[k] - prev[k];
      if (k <= kTop && d > 0) { fl += d; if (k <= kLow) fll += d; }
      const p = m * m; if (k <= kLow) el += p; else if (k <= kMid) em += p; else eh += p;
    }
    flux[f] = fl; fluxLow[f] = fll; low[f] = Math.sqrt(el) / N; mid[f] = Math.sqrt(em) / N; high[f] = Math.sqrt(eh) / N; prev = mag;
  }
  return { nFrames, fps: sr / HOP, flux, fluxLow, low, mid, high, rms };
}

export function onsetEnvelope(ft) {
  const norm = (a) => { const p = pct(Array.from(a), 0.95) || 1; return Array.from(a, (v) => v / p); };
  const a = norm(ft.flux); const b = norm(ft.fluxLow);
  const raw = a.map((v, i) => v + 1.5 * b[i]);
  const w = Math.round(ft.fps * 0.5); const out = new Float32Array(raw.length);
  const cum = [0]; for (const v of raw) cum.push(cum[cum.length - 1] + v);
  for (let i = 0; i < raw.length; i++) { const lo = Math.max(0, i - w); const hi = Math.min(raw.length, i + w + 1); out[i] = Math.max(0, raw[i] - (cum[hi] - cum[lo]) / (hi - lo)); }
  const sm = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) sm[i] = 0.25 * (out[i - 1] || 0) + 0.5 * out[i] + 0.25 * (out[i + 1] || 0);
  return sm;
}

export function interp(env, x) { if (x < 0 || x >= env.length - 1) return 0; const i = Math.floor(x); const f = x - i; return env[i] * (1 - f) + env[i + 1] * f; }

export function estimateTempo(env, fps, bpmRange = [60, 200]) {
  const lmin = Math.floor((fps * 60) / bpmRange[1]); const lmax = Math.ceil((fps * 60) / bpmRange[0]);
  const ac = new Float64Array(lmax * 2 + 2);
  for (let L = 1; L < ac.length && L < env.length / 2; L++) { let s = 0; for (let i = 0; i + L < env.length; i++) s += env[i] * env[i + L]; ac[L] = s / (env.length - L); }
  let best = { L: lmin, s: -1 };
  for (let L = lmin; L <= lmax; L++) {
    const bpm = (fps * 60) / L; const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.8) ** 2);
    const s = (ac[L] + 0.5 * (ac[2 * L] || 0) + 0.25 * (ac[Math.round(L / 2)] || 0)) * prior;
    if (s > best.s) best = { L, s };
  }
  return (fps * 60) / best.L;
}

/** Best (bpm, phase) comb over the whole envelope; returns fractional-frame period and phase. */
export function fitGrid(env, fps, bpm0) {
  let best = { score: -1, bpm: bpm0, phase: 0 };
  for (let bpm = bpm0 * 0.97; bpm <= bpm0 * 1.03 + 1e-9; bpm += 0.1) {
    const P = (fps * 60) / bpm;
    for (let ph = 0; ph < P; ph += 0.5) {
      let s = 0;
      for (let x = ph; x < env.length - 1; x += P) s += Math.max(interp(env, x), 0.85 * interp(env, x - 1), 0.85 * interp(env, x + 1));
      if (s > best.score) best = { score: s, bpm, phase: ph };
    }
  }
  return best;
}

/** Sharpest energy rise within +-win seconds of t, at ~1.5 ms resolution (removes the FFT's timing blur). */
function refineOnset(samples, sr, t, win = 0.07) {
  const blk = Math.max(1, Math.round(sr * 0.0015));
  const a = Math.max(0, Math.floor((t - win) * sr)); const b = Math.min(samples.length - blk * 2, Math.floor((t + win) * sr));
  if (b <= a) return { t, strength: 0 };
  let prev = 0; for (let j = 0; j < blk; j++) prev += Math.abs(samples[a + j]); prev /= blk;
  let best = { d: 0, i: a };
  for (let i = a + blk; i < b; i += blk) { let e = 0; for (let j = 0; j < blk; j++) e += Math.abs(samples[i + j]); e /= blk; const d = e - prev; if (d > best.d) best = { d, i }; prev = e; }
  return { t: best.i / sr, strength: best.d };
}

function bandMean(ft, from, to, key) { const a = Math.max(0, Math.floor(from * ft.fps)); const b = Math.min(ft.nFrames, Math.ceil(to * ft.fps)); let s = 0; let n = 0; for (let i = a; i < b; i++) { s += ft[key][i]; n++; } return n ? s / n : 0; }

/**
 * @param {Float32Array} samples mono
 * @returns {object} beat map (see docs/BEAT_MAP.md)
 */
export function analyzeSamples(samples, sr, { bpmRange = [60, 200], preferredRange = [80, 165] } = {}) {
  const duration = samples.length / sr;
  const ft = features(samples, sr);
  if (ft.nFrames < 200) return emptyMap(duration, 'too short to analyse (< 3 s)');
  const env = onsetEnvelope(ft);
  const bpm0 = estimateTempo(env, ft.fps, bpmRange);
  let grid = fitGrid(env, ft.fps, bpm0);
  // octave folding: dance/pop tempos live in ~80-165 BPM; a grid at half or double that is the same music read in
  // half/double time. Fold into the preferred range (the other reading is reported as an alternative).
  const [prefLo, prefHi] = preferredRange;
  const rawBpm = grid.bpm;
  if (grid.bpm < prefLo && grid.bpm * 2 <= bpmRange[1]) grid = fitGrid(env, ft.fps, grid.bpm * 2);
  else if (grid.bpm > prefHi && grid.bpm / 2 >= bpmRange[0]) grid = fitGrid(env, ft.fps, grid.bpm / 2);
  const P0 = (ft.fps * 60) / grid.bpm; const centre = (N / 2) / sr; // frame -> seconds of the window centre

  // refine every grid beat to the sample-level attack, then least-squares the grid through them
  const idx = []; const ts = []; let strong = 0; let tested = 0;
  for (let k = 0, x = grid.phase; x < ft.nFrames; k++, x += P0) {
    const tt = (x * HOP) / sr + centre - 0.012;
    const r = refineOnset(samples, sr, tt);
    tested++;
    if (r.strength > 0.004) { idx.push(k); ts.push(r.t); strong++; }
  }
  if (idx.length < 8) return emptyMap(duration, 'no steady beat found');
  const fit = (ids, vs) => { const n = ids.length; const mi = mean(ids); const mv = mean(vs); let sxx = 0; let sxy = 0; for (let i = 0; i < n; i++) { sxx += (ids[i] - mi) ** 2; sxy += (ids[i] - mi) * (vs[i] - mv); } const P = sxy / sxx; return { P, t0: mv - P * mi }; };
  let { P, t0 } = fit(idx, ts);
  const keep = idx.map((k, i) => Math.abs(ts[i] - (t0 + P * k)) < 0.04);
  const ids2 = idx.filter((_, i) => keep[i]); const ts2 = ts.filter((_, i) => keep[i]);
  if (ids2.length >= 8) ({ P, t0 } = fit(ids2, ts2));
  const confidence = round(Math.min(1, (ids2.length / Math.max(1, tested)) * (strong / Math.max(1, tested)) * 1.15), 2);
  const bpm = round(60 / P, 2);

  // ---- beats (extend the fitted grid over the whole file) ----
  const first = Math.ceil((0 - t0) / P - 1e-9);
  const beats = []; for (let k = first; t0 + k * P < duration - 0.05; k++) beats.push({ t: t0 + k * P, k });

  // ---- downbeats: which of 4 phases carries the most low-band weight just after the beat ----
  const phaseScore = [0, 0, 0, 0]; const phaseN = [0, 0, 0, 0];
  for (const b of beats) { const ph = ((b.k % 4) + 4) % 4; phaseScore[ph] += bandMean(ft, b.t, b.t + 0.45 * P, 'low') + 0.5 * bandMean(ft, b.t - 0.02, b.t + 0.1, 'rms'); phaseN[ph]++; }
  const avg = phaseScore.map((s, i) => (phaseN[i] ? s / phaseN[i] : 0));
  const dbPhase = avg.indexOf(Math.max(...avg));
  const sortedAvg = [...avg].sort((a, b) => b - a);
  const dbConfidence = round(sortedAvg[0] > 0 ? Math.max(0, (sortedAvg[0] - sortedAvg[1]) / sortedAvg[0]) : 0, 2);
  const downbeats = beats.filter((b) => ((b.k % 4) + 4) % 4 === dbPhase).map((b) => b.t);

  // ---- bars, energy per bar ----
  const bars = downbeats.map((t, i) => ({ index: i, start: t, end: downbeats[i + 1] ?? t + 4 * P }));
  for (const b of bars) { b.low = bandMean(ft, b.start, b.end, 'low'); b.rms = bandMean(ft, b.start, b.end, 'rms'); b.high = bandMean(ft, b.start, b.end, 'high'); }
  const lowAll = bars.map((b) => b.low); const gp = pct(lowAll, 0.9) || 1e-9; const rmsP = pct(bars.map((b) => b.rms), 0.9) || 1e-9;

  // ---- drops: loud bar right after a much quieter one ----
  const drops = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = mean([bars[i - 1].low, bars[Math.max(0, i - 2)].low]); const prevR = mean([bars[i - 1].rms, bars[Math.max(0, i - 2)].rms]);
    const loud = bars[i].low >= 0.55 * gp; const jump = prev <= 0.45 * bars[i].low || prevR * 1.8 <= bars[i].rms;
    if (loud && jump && bars[i].rms >= 0.5 * rmsP && (!drops.length || bars[i].start - drops.at(-1).t > 4 * 4 * P * 0.5)) drops.push({ t: bars[i].start, bar: i, strength: round(Math.min(1, bars[i].low / gp), 2) });
  }

  // ---- breaks: runs of bars with almost no low end (a trailing run is the outro, not a break) ----
  const breaks = []; let runStart = -1;
  for (let i = 0; i <= bars.length; i++) {
    const quiet = i < bars.length && bars[i].low < 0.28 * gp;
    if (quiet && runStart < 0) runStart = i;
    if (!quiet && runStart >= 0) { if (i < bars.length) breaks.push({ start: bars[runStart].start, end: bars[i].start, bars: i - runStart }); runStart = -1; }
  }

  // ---- rises: high-band energy climbing into a drop ----
  const rises = [];
  for (const d of drops) {
    let s = d.bar;
    for (let r = d.bar - 1; r >= Math.max(0, d.bar - 4); r--) { if (bars[r].high <= bars[r + 1 > d.bar - 1 ? d.bar - 1 : r + 1].high * 1.1 + 1e-12) s = r; else break; }
    const startBar = s <= d.bar - 1 ? s : d.bar - 1;
    if (startBar >= 0 && d.bar - startBar >= 1 && bars[d.bar - 1].high >= 1.3 * bars[startBar].high) rises.push({ start: bars[startBar].start, end: d.t, bars: d.bar - startBar });
  }

  // ---- impacts: every drop is one (refined to its sample-level attack), then the strongest low-band attacks, >= 0.4 s apart ----
  const impacts = drops.map((d) => ({ t: d.t, strength: 1, kind: 'drop' })); // a drop is a bar boundary: its time is the downbeat
  const cand = []; for (let i = 2; i < ft.nFrames - 2; i++) { const v = ft.fluxLow[i]; if (v > ft.fluxLow[i - 1] && v >= ft.fluxLow[i + 1]) cand.push({ i, v }); }
  const vmax = Math.max(...cand.map((c) => c.v), 1e-9);
  for (const c of cand.sort((a, b) => b.v - a.v)) {
    if (c.v < 0.45 * vmax || impacts.length >= Math.max(8, Math.floor(duration / 2))) break;
    const tt = (c.i * HOP) / sr + centre - 0.012; const r = refineOnset(samples, sr, tt, 0.05);
    if (impacts.every((m) => Math.abs(m.t - r.t) >= 0.4)) {
      const nearDrop = drops.find((d) => Math.abs(d.t - r.t) < 0.08); const nearDown = downbeats.find((d) => Math.abs(d - r.t) < 0.08);
      impacts.push({ t: r.t, strength: round(c.v / vmax, 2), kind: nearDrop ? 'drop' : nearDown ? 'downbeat' : 'accent' });
    }
  }
  impacts.sort((a, b) => a.t - b.t);

  // ---- sections: label every bar, then merge runs. Priority: break > build > drop (and its aftermath) > intro/verse/outro ----
  const firstEvent = Math.min(...[drops[0]?.bar, ...breaks.map((br) => bars.findIndex((b) => b.start >= br.start - 1e-6)), ...rises.map((r) => bars.findIndex((b) => b.start >= r.start - 1e-6))].filter((v) => v !== undefined && v >= 0), bars.length);
  const labels = bars.map((b, i) => {
    if (breaks.some((br) => b.start >= br.start - 1e-6 && b.start < br.end - 1e-6)) return 'break';
    if (rises.some((r) => b.start >= r.start - 1e-6 && b.start < r.end - 1e-6)) return 'build';
    if (i < firstEvent) return 'intro';
    const sinceDrop = drops.filter((d) => d.bar <= i).length > 0;
    return sinceDrop ? (b.low >= 0.5 * gp ? 'drop' : 'outro') : 'verse';
  });
  const result = [];
  labels.forEach((kind, i) => {
    const start = i === 0 ? 0 : bars[i].start; const last = result.at(-1);
    if (last && last.kind === kind) last.end = round(i === labels.length - 1 ? duration : bars[i].end, 3);
    else result.push({ kind, start: round(start, 3), end: round(i === labels.length - 1 ? duration : bars[i].end, 3) });
  });

  // ---- energy curve (per second, 0..1) ----
  const rmsMax = Math.max(...Array.from(ft.rms), 1e-9); const energy = [];
  for (let t = 0; t < duration; t += 1) energy.push({ t, v: round(bandMean(ft, t, Math.min(duration, t + 1), 'rms') / rmsMax, 3) });

  return {
    version: 1, virtual: false, duration: round(duration, 3), bpm, tempoAlternatives: [round(bpm / 2, 2), round(bpm * 2, 2)], foldedFrom: Math.abs(rawBpm - bpm) > 1 ? round(rawBpm, 2) : null, confidence, downbeatConfidence: dbConfidence, beatPeriod: round(P, 5), firstBeat: round(beats[0]?.t ?? 0, 4),
    beats: beats.map((b) => round(b.t, 4)), downbeats: downbeats.map((t) => round(t, 4)),
    bars: bars.map((b) => ({ index: b.index, start: round(b.start, 4), end: round(b.end, 4), energy: round(b.rms / rmsP, 2), low: round(b.low / gp, 2) })),
    phrases: bars.filter((_, i) => i % 4 === 0).map((b, i) => ({ index: i, start: round(b.start, 4), end: round(bars[Math.min(bars.length - 1, b.index + 3)].end, 4), bars: Math.min(4, bars.length - b.index) })),
    drops: drops.map((d) => ({ ...d, t: round(d.t, 4) })), breaks: breaks.map((b) => ({ ...b, start: round(b.start, 4), end: round(b.end, 4) })), rises: rises.map((r) => ({ ...r, start: round(r.start, 4), end: round(r.end, 4) })),
    impacts: impacts.map((m) => ({ ...m, t: round(m.t, 4) })), sections: result, energy,
  };
}

function emptyMap(duration, reason) {
  return { version: 1, virtual: false, duration: round(duration, 3), bpm: null, confidence: 0, beats: [], downbeats: [], bars: [], phrases: [], drops: [], breaks: [], rises: [], impacts: [], sections: [], energy: [], note: reason };
}

/** A regular grid for pieces without music, flagged `virtual` so nothing pretends to be analysis. */
export function virtualBeatMap({ bpm = 120, duration = 30, firstBeat = 0 } = {}) {
  const P = 60 / bpm; const beats = []; for (let t = firstBeat; t < duration - 0.05; t += P) beats.push(round(t, 4));
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  const bars = downbeats.map((t, i) => ({ index: i, start: t, end: round(downbeats[i + 1] ?? t + 4 * P, 4), energy: 0.5, low: 0.5 }));
  return { version: 1, virtual: true, duration, bpm, confidence: 0, beatPeriod: round(P, 5), firstBeat, beats, downbeats, bars, phrases: bars.filter((_, i) => i % 4 === 0).map((b, i) => ({ index: i, start: b.start, end: bars[Math.min(bars.length - 1, b.index + 3)].end, bars: 4 })), drops: [], breaks: [], rises: [], impacts: [], sections: [{ kind: 'verse', start: 0, end: duration }], energy: [], note: 'virtual grid: no music was analysed' };
}

/** Decode + analyse + (optionally) write beat_map.json. */
export async function analyzeBeats(config, file, { outFile = null, maxSeconds = 0 } = {}) {
  const { samples, sampleRate } = await decodePcm(config, file, { sampleRate: 22050, maxSeconds });
  const map = analyzeSamples(samples, sampleRate);
  map.source = { file, fingerprint: (() => { try { return fingerprintFile(file); } catch { return null; } })() };
  if (outFile) { ensureDir(path.dirname(outFile)); writeJson(outFile, map); }
  return map;
}

// ---------- helpers the Director uses ----------
export function nearest(list, t) { let best = null; let d = Infinity; for (const x of list) { const dd = Math.abs((x.t ?? x) - t); if (dd < d) { d = dd; best = x; } } return best === null ? null : { value: best.t ?? best, distance: d }; }

/** Grid points: 'beat' | 'half' (8ths) | 'quarter' (16ths) | 'bar' | 'phrase'. */
export function gridPoints(map, resolution = 'beat') {
  if (resolution === 'bar') return map.downbeats.slice();
  if (resolution === 'phrase') return map.phrases.map((p) => p.start);
  const sub = resolution === 'half' ? 2 : resolution === 'quarter' ? 4 : 1;
  const out = []; const P = map.beatPeriod || (map.beats[1] - map.beats[0]);
  for (const b of map.beats) for (let i = 0; i < sub; i++) out.push(round(b + (P * i) / sub, 4));
  return out;
}

export function snapToGrid(map, t, resolution = 'beat', maxDistance = Infinity) {
  const n = nearest(gridPoints(map, resolution), t);
  return n && n.distance <= maxDistance ? n.value : t;
}

export function energyAt(map, t) { const e = map.energy; if (!e.length) return 0.5; const i = Math.min(e.length - 1, Math.max(0, Math.floor(t))); return e[i].v; }

export function sectionAt(map, t) { return map.sections.find((s) => t >= s.start && t < s.end) || null; }
