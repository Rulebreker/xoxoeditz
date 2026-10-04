// Self-contained benchmark inputs: moving procedural clips (each with a bright moving "subject" so the saliency and
// crop/2.5D logic have something to find), stills, and a music track with a known structure. Nothing is downloaded and
// no external media is needed. They are deliberately plain - the benchmark tests the ENGINE, not anyone's footage;
// pass your own folder with --assets to benchmark with real material.
//
// Patterns are generated small and scaled up (a 1280x720 geq takes ~15 s per clip; at 320x180 it takes ~1 s).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTool } from '../core/resolve-tool.js';
import { makeRng } from '../core/rng.js';
import { ensureDir } from '../core/paths.js';
import { writeTrack, DEFAULT_STRUCTURE } from '../audio/synth-music.js';

export const MEDIA_VERSION = 3;

function pattern(rng) {
  const f = () => Math.round(rng.range(18, 70)); const s = () => rng.range(0.4, 1.8).toFixed(2);
  return `geq=r='128+127*sin(X/${f()}+T*${s()}+${rng.range(0, 6).toFixed(2)})':g='128+127*sin(Y/${f()}+T*${s()}+${rng.range(0, 6).toFixed(2)})':b='128+127*sin((X+Y)/${f()}+T*${s()}+${rng.range(0, 6).toFixed(2)})'`;
}
function blob(rng, w, h) {
  const bw = rng.range(0.14, 0.24); const bh = rng.range(0.28, 0.45); const x0 = rng.range(0.22, 0.5); const y0 = rng.range(0.16, 0.34);
  return `drawbox=x='iw*${x0.toFixed(3)}+iw*${rng.range(0.03, 0.12).toFixed(3)}*sin(t*${rng.range(0.6, 2).toFixed(2)})':y='ih*${y0.toFixed(3)}+ih*0.04*cos(t*${rng.range(0.6, 2).toFixed(2)})':w=iw*${bw.toFixed(3)}:h=ih*${bh.toFixed(3)}:color=white@0.93:t=fill`;
  void w; void h;
}
async function ff(config, args) {
  const r = await runTool(config, 'ffmpeg', ['-v', 'error', '-y', ...args], { timeoutMs: 300000 });
  if (r.error || r.code !== 0) throw new Error(`ffmpeg failed: ${r.error || r.stderr.slice(0, 300)}`);
}

export async function makeClip(config, file, { seed, dur = 12, w = 1280, h = 720, fps = 24, audio = false }) {
  const rng = makeRng('bench-clip', seed);
  const vf = `${pattern(rng)},scale=${w}:${h}:flags=bicubic,${blob(rng, w, h)},eq=saturation=${rng.range(0.7, 1.6).toFixed(2)}:contrast=${rng.range(0.9, 1.3).toFixed(2)},hue=h=${Math.round(rng.range(0, 360))},format=yuv420p`;
  const args = ['-f', 'lavfi', '-i', `color=c=black:s=320x180:r=${fps}:d=${dur}`];
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=${200 + (seed % 5) * 60}:sample_rate=44100`);
  args.push('-vf', vf, '-t', String(dur), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24');
  if (audio) args.push('-c:a', 'aac', '-shortest'); else args.push('-an');
  args.push(file);
  await ff(config, args);
}
export async function makeStill(config, file, { seed, w = 1280, h = 720 }) {
  const rng = makeRng('bench-still', seed);
  const vf = `${pattern(rng)},scale=${w}:${h}:flags=bicubic,${blob(rng, w, h)},hue=h=${Math.round(rng.range(0, 360))},format=yuvj420p`;
  await ff(config, ['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=1:d=1', '-vf', vf, '-frames:v', '1', file]);
}

/**
 * @param {object} config
 * @param {string} dir     input folder to fill
 * @param {object} spec    { clips, stills, bpm, seed, musicBars? }
 */
export async function makeBenchmarkInputs(config, dir, spec) {
  const marker = path.join(dir, '.benchmark-inputs.json');
  try { const m = JSON.parse(fs.readFileSync(marker, 'utf8')); if (m.version === MEDIA_VERSION && m.spec === JSON.stringify(spec.media)) return { dir, reused: true }; } catch { /* regenerate */ }
  fs.rmSync(dir, { recursive: true, force: true }); ensureDir(path.join(dir, 'audio'));
  const m = spec.media;
  const jobs = [];
  for (let i = 0; i < m.clips; i++) jobs.push(() => makeClip(config, path.join(dir, `clip_${String(i + 1).padStart(2, '0')}.mp4`), { seed: m.seed * 100 + i, dur: 10 + (i % 4) * 2, audio: i % 3 === 0 }));
  for (let i = 0; i < m.stills; i++) jobs.push(() => makeStill(config, path.join(dir, `still_${String(i + 1).padStart(2, '0')}.jpg`), { seed: m.seed * 100 + 50 + i }));
  const width = Math.max(1, Math.min(4, Math.floor((os.cpus().length || 2) / 2)));
  for (let i = 0; i < jobs.length; i += width) await Promise.all(jobs.slice(i, i + width).map((j) => j())); // a few at a time: x264 is multi-threaded already
  writeTrack(path.join(dir, 'audio', `music_${m.bpm}bpm.wav`), { bpm: m.bpm, seed: `bench-${m.seed}`, structure: m.structure || DEFAULT_STRUCTURE });
  fs.writeFileSync(path.join(dir, 'edit.config.json'), JSON.stringify(spec.config, null, 2) + '\n');
  fs.writeFileSync(marker, JSON.stringify({ version: MEDIA_VERSION, spec: JSON.stringify(spec.media), at: new Date().toISOString() }));
  return { dir, reused: false };
}
