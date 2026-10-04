import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpDir, testConfig } from './helpers/env.js';
import { hasFfmpeg } from './helpers/media.js';
import { fft } from '../src/beat/fft.js';
import { synthTrack, writeTrack, writeWav, DEFAULT_STRUCTURE } from '../src/audio/synth-music.js';
import { analyzeSamples, analyzeBeats, virtualBeatMap, gridPoints, snapToGrid, nearest, sectionAt, energyAt } from '../src/beat/analyze.js';

test('FFT: a pure tone lands in the right bin; Parseval holds', () => {
  const n = 1024; const re = new Float64Array(n); const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 64 * i) / n);
  const e0 = re.reduce((a, v) => a + v * v, 0);
  fft(re, im);
  const mag = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
  assert.equal(mag.indexOf(Math.max(...mag)), 64);
  const e1 = Array.from({ length: n }, (_, k) => re[k] ** 2 + im[k] ** 2).reduce((a, v) => a + v, 0) / n;
  assert.ok(Math.abs(e0 - e1) / e0 < 1e-9);
});

const closeTo = (list, truth, tol) => truth.filter((t) => list.some((x) => Math.abs(x - t) <= tol)).length / truth.length;

for (const bpm of [96, 128, 150]) {
  test(`beat map @ ${bpm} BPM: tempo, beat positions (<= 25 ms), downbeats, drops, breaks, rises, impacts, sections`, () => {
    const { samples, sampleRate, truth } = synthTrack({ bpm, seed: `t${bpm}` });
    const m = analyzeSamples(samples, sampleRate);
    assert.ok(Math.abs(m.bpm - bpm) < 0.6, `bpm ${m.bpm} vs ${bpm}`);
    assert.ok(m.confidence > 0.5, `confidence ${m.confidence}`);
    const beatHit = closeTo(m.beats, truth.beats, 0.025);
    assert.ok(beatHit >= 0.97, `${(beatHit * 100).toFixed(0)}% of true beats within 25 ms`);
    assert.ok(closeTo(m.downbeats, truth.downbeats, 0.03) >= 0.95, 'downbeats found (bar starts)');
    assert.ok(m.downbeats.length >= truth.downbeats.length - 1 && m.downbeats.length <= truth.downbeats.length + 1);
    assert.equal(m.drops.length, truth.drops.length, `drops ${m.drops.map((d) => d.t)} vs ${truth.drops}`);
    for (const d of truth.drops) assert.ok(m.drops.some((x) => Math.abs(x.t - d) < 60 / bpm), `drop near ${d.toFixed(2)}`);
    assert.equal(m.breaks.length, 1); assert.ok(Math.abs(m.breaks[0].start - truth.breaks[0].start) < 60 / bpm && Math.abs(m.breaks[0].end - truth.breaks[0].end) < 60 / bpm);
    assert.ok(m.rises.length >= 1 && m.rises.some((r) => Math.abs(r.end - truth.drops[0]) < 0.05), 'a rise leads into the first drop');
    assert.ok(m.impacts.some((i) => i.kind === 'drop' && Math.abs(i.t - truth.drops[0]) < 0.06), 'the first drop is an impact');
    assert.ok(m.impacts.every((i, k, a) => !k || i.t - a[k - 1].t >= 0.4));
    const kinds = new Set(m.sections.map((s) => s.kind)); for (const k of ['intro', 'break', 'drop']) assert.ok(kinds.has(k), `section ${k} in ${[...kinds]}`);
    assert.equal(sectionAt(m, truth.drops[0] + 1).kind, 'drop'); assert.equal(sectionAt(m, truth.breaks[0].start + 0.5).kind, 'break');
    assert.ok(energyAt(m, truth.drops[0] + 2) > energyAt(m, truth.breaks[0].start + 1), 'drop is louder than the break');
    assert.ok(m.phrases.length >= 4 && m.phrases[0].bars === 4);
  });
}

test('beat map handles lead-in silence, non-zero first beat and very short audio', () => {
  const { samples, sampleRate, truth } = synthTrack({ bpm: 120, leadIn: 0.37, seed: 'lead' });
  const m = analyzeSamples(samples, sampleRate);
  assert.ok(Math.abs(m.bpm - 120) < 0.6);
  assert.ok(closeTo(m.beats, truth.beats, 0.03) >= 0.95, 'beats found despite a 0.37 s offset');
  const tiny = analyzeSamples(new Float32Array(22050), 22050);
  assert.equal(tiny.bpm, null); assert.match(tiny.note, /too short/);
  const noise = new Float32Array(22050 * 20); let s = 1; for (let i = 0; i < noise.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; noise[i] = ((s / 4294967296) - 0.5) * 0.05; }
  const nm = analyzeSamples(noise, 22050);
  assert.ok(nm.confidence < 0.5, `random noise is not claimed to have a steady beat (conf ${nm.confidence})`);
});

test('grid helpers: subdivisions, snapping, nearest; virtual map is flagged', () => {
  const { samples, sampleRate } = synthTrack({ bpm: 120, seed: 'grid' });
  const m = analyzeSamples(samples, sampleRate);
  const half = gridPoints(m, 'half'); assert.equal(half.length, m.beats.length * 2);
  assert.equal(gridPoints(m, 'bar').length, m.downbeats.length);
  const t = m.beats[8] + 0.07; assert.ok(Math.abs(snapToGrid(m, t, 'beat') - m.beats[8]) < 1e-9);
  assert.equal(snapToGrid(m, t, 'beat', 0.01), t, 'no snap beyond maxDistance');
  assert.equal(nearest(m.downbeats, m.downbeats[3] + 0.02).value, m.downbeats[3]);
  const v = virtualBeatMap({ bpm: 100, duration: 20 });
  assert.equal(v.virtual, true); assert.equal(v.beats[1] - v.beats[0], 0.6); assert.equal(v.downbeats.length, Math.ceil(v.beats.length / 4)); assert.match(v.note, /virtual/);
});

test('analyzeBeats end to end: WAV on disk (spaces in path) -> ffmpeg decode -> beat_map.json', { skip: !hasFfmpeg }, async () => {
  const cfg = testConfig({}); const dir = path.join(tmpDir(), 'my music (v2)'); const file = path.join(dir, 'track 128.wav');
  const truth = writeTrack(file, { bpm: 128, seed: 'disk', sampleRate: 44100 });
  const out = path.join(dir, 'beat_map.json');
  const m = await analyzeBeats(cfg, file, { outFile: out });
  assert.ok(Math.abs(m.bpm - 128) < 0.6);
  assert.ok(closeTo(m.beats, truth.beats, 0.025) >= 0.97);
  assert.equal(m.drops.length, truth.drops.length);
  const saved = JSON.parse((await import('node:fs')).readFileSync(out, 'utf8'));
  assert.equal(saved.bpm, m.bpm); assert.ok(saved.source.fingerprint);
  assert.ok(['beats', 'downbeats', 'bars', 'drops', 'rises', 'breaks', 'impacts', 'bpm'].every((k) => k in saved), 'spec fields present');
  await assert.rejects(() => analyzeBeats(cfg, path.join(dir, 'missing.wav')), /could not decode|No such file/);
});

test('structure is configurable (no drop -> no drops reported)', () => {
  const { samples, sampleRate } = synthTrack({ bpm: 124, structure: [{ kind: 'verse', bars: 12 }], seed: 'flat' });
  const m = analyzeSamples(samples, sampleRate);
  assert.ok(Math.abs(m.bpm - 124) < 0.6); assert.equal(m.drops.length, 0); assert.equal(m.breaks.length, 0);
  writeWav(path.join(tmpDir(), 'x.wav'), new Float32Array(100), 8000);
  assert.ok(DEFAULT_STRUCTURE.length >= 6);
});
