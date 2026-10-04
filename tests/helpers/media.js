import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

export const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const ff = (args) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};

/** Speech-like fixture: tone bursts separated by silences (durations in seconds). */
export function makeSpeechLike(file, pattern = [[2, true], [1.2, false], [3, true], [0.5, false], [2, true]]) {
  const inputs = []; const parts = [];
  pattern.forEach(([d, tone], i) => {
    inputs.push('-f', 'lavfi', '-t', String(d), '-i', tone ? `sine=frequency=${200 + i * 40}:sample_rate=44100` : 'anullsrc=r=44100:cl=mono');
    parts.push(`[${i}:a]`);
  });
  ff([...inputs, '-filter_complex', `${parts.join('')}concat=n=${pattern.length}:v=0:a=1[a]`, '-map', '[a]', '-ac', '1', file]);
  return file;
}

export function makeImage(file, w = 1920, h = 1080, color = 'blue') {
  ff(['-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`, '-frames:v', '1', file]);
  return file;
}

export function makeVideo(file, { w = 640, h = 360, dur = 3, fps = 24, withAudio = true } = {}) {
  const args = ['-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=${fps}`];
  if (withAudio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100');
  args.push('-t', String(dur), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast');
  if (withAudio) args.push('-c:a', 'aac', '-shortest');
  args.push(file);
  ff(args);
  return file;
}

export function makeAssetFolder(root) {
  fs.mkdirSync(path.join(root, 'sfx'), { recursive: true });
  fs.mkdirSync(path.join(root, 'images'), { recursive: true });
  makeImage(path.join(root, 'images', 'j20_front.jpg'), 1920, 1080, 'darkblue');
  makeImage(path.join(root, 'images', 'j20_cockpit.png'), 1280, 720, 'gray');
  makeImage(path.join(root, 'images', 'map_china.jpg'), 1000, 1000, 'green');
  makeVideo(path.join(root, 'broll_runway.mp4'), { dur: 4 });
  makeSpeechLike(path.join(root, 'narration.wav'));
  makeSpeechLike(path.join(root, 'sfx', 'whoosh_01.wav'), [[0.8, true]]);
  makeSpeechLike(path.join(root, 'music_main.mp3'), [[20, true]]);
  return root;
}
