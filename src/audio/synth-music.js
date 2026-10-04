// Procedural music with KNOWN structure (beat times, downbeats, breaks, drops) for tests and benchmarks.
// Deliberately simple (kick, snare, hats, bass, pad, riser) but musically structured, so the beat engine can be
// checked against ground truth and the benchmark has a real track with intro / build / break / drop / outro.

import fs from 'node:fs';
import { makeRng } from '../core/rng.js';
import { ensureDir } from '../core/paths.js';
import path from 'node:path';

export const DEFAULT_STRUCTURE = [
  { kind: 'intro', bars: 4 }, { kind: 'build', bars: 2 }, { kind: 'break', bars: 2 }, { kind: 'drop', bars: 8 }, { kind: 'verse', bars: 4 }, { kind: 'chorus', bars: 4 }, { kind: 'outro', bars: 2 },
];

export function writeWav(file, samples, sampleRate) {
  const n = samples.length; const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  ensureDir(path.dirname(file)); fs.writeFileSync(file, buf);
}

export function synthTrack({ bpm = 128, structure = DEFAULT_STRUCTURE, sampleRate = 22050, seed = 'track', leadIn = 0 } = {}) {
  const rng = makeRng('music', seed);
  const beat = 60 / bpm; const barLen = beat * 4;
  const bars = structure.reduce((a, s) => a + s.bars, 0);
  const total = leadIn + bars * barLen + 1.5; // tail
  const out = new Float32Array(Math.ceil(total * sampleRate));
  const add = (t0, fn, dur, amp) => { const s0 = Math.round(t0 * sampleRate); for (let i = 0; i < dur * sampleRate; i++) { const j = s0 + i; if (j >= out.length) break; out[j] += amp * fn(i / sampleRate); } };
  const kick = (t, amp) => add(t, (x) => Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-x * 35)) * x) * Math.exp(-x * 14), 0.28, amp);
  const snare = (t, amp) => add(t, (x) => (rng() * 2 - 1) * Math.exp(-x * 22) * 0.8 + Math.sin(2 * Math.PI * 190 * x) * Math.exp(-x * 18) * 0.4, 0.25, amp);
  const hat = (t, amp) => add(t, (x) => (rng() * 2 - 1) * Math.exp(-x * 90), 0.05, amp);
  const bass = (t, len, f, amp) => add(t, (x) => (Math.sin(2 * Math.PI * f * x) + 0.35 * Math.sin(2 * Math.PI * 2 * f * x)) * Math.min(1, x * 80) * Math.exp(-x * 0.6) * (x > len - 0.05 ? 0 : 1), len, amp);
  const pad = (t, len, amp) => add(t, (x) => (Math.sin(2 * Math.PI * 220 * x) + Math.sin(2 * Math.PI * 277.2 * x) + Math.sin(2 * Math.PI * 329.6 * x)) * Math.min(1, x * 3) * Math.min(1, (len - x) * 3), len, amp);
  const riser = (t, len, amp) => add(t, (x) => { const u = x / len; return (rng() * 2 - 1) * u * u * u; }, len, amp);

  const truth = { bpm, beats: [], downbeats: [], drops: [], breaks: [], sections: [], duration: total, sampleRate };
  let bar = 0;
  for (const sec of structure) {
    const secStart = leadIn + bar * barLen;
    truth.sections.push({ kind: sec.kind, start: secStart, end: secStart + sec.bars * barLen });
    if (sec.kind === 'drop') truth.drops.push(secStart);
    if (sec.kind === 'break') truth.breaks.push({ start: secStart, end: secStart + sec.bars * barLen });
    for (let b = 0; b < sec.bars; b++) {
      const bt = leadIn + (bar + b) * barLen;
      truth.downbeats.push(bt);
      for (let k = 0; k < 4; k++) {
        const t = bt + k * beat; truth.beats.push(t);
        const first = b === 0 && k === 0;
        switch (sec.kind) {
          case 'intro': hat(t + beat / 2, 0.12); if (k % 2 === 0) kick(t, 0.38); if (k === 0) bass(t, barLen * 0.9, 55, 0.22); break;
          case 'build': kick(t, 0.5 + 0.1 * b); hat(t, 0.15); hat(t + beat / 2, 0.15); if (k % 2 === 1) snare(t, 0.3 + 0.12 * b); if (k === 0) bass(t, barLen * 0.9, 55, 0.3); if (b === sec.bars - 1) { snare(t + beat / 2, 0.35); snare(t + beat * 0.75, 0.4); } break;
          case 'break': if (k === 0) { pad(t, barLen * 0.98, 0.12); riser(t, barLen, 0.28 + 0.22 * b); } else if (b === sec.bars - 1) riser(t, beat, 0.5); break;
          case 'chorus': case 'drop': kick(t, 0.95); hat(t + beat / 2, 0.2); hat(t + beat / 4, 0.1); if (k % 2 === 1) snare(t, 0.55); if (k === 0) bass(t, barLen * 0.92, 55, first ? 0.7 : 0.5); if (first && k === 0) { snare(t, 0.9); } break;
          case 'verse': kick(t, 0.7); if (k % 2 === 1) snare(t, 0.4); hat(t + beat / 2, 0.14); if (k === 0) bass(t, barLen * 0.9, 49, 0.38); break;
          case 'outro': if (k % 2 === 0) kick(t, 0.5 * (1 - (b * 4 + k) / (sec.bars * 4))); if (k === 0) pad(t, barLen, 0.1); break;
          default: break;
        }
      }
    }
    bar += sec.bars;
  }
  let peak = 0; for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.95) for (let i = 0; i < out.length; i++) out[i] *= 0.95 / peak;
  return { samples: out, sampleRate, truth };
}

export function writeTrack(file, spec = {}) {
  const t = synthTrack(spec);
  writeWav(file, t.samples, t.sampleRate);
  return t.truth;
}
