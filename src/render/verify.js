import fs from 'node:fs';
import { run } from '../core/exec.js';
import { parseFfprobe } from '../assets/probe.js';

export function parseBlackDetect(stderr) {
  const out = [];
  const re = /black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g;
  let m;
  while ((m = re.exec(stderr))) out.push({ start: Number(m[1]), end: Number(m[2]), duration: Number(m[3]) });
  return out;
}

/**
 * Verify a rendered file against expectations. Returns {passed, checks[], probe}. Needs ffprobe; without it,
 * only existence and size are checked (and the result says so).
 */
export async function verifyRender(config, file, expect = {}) {
  const checks = [];
  const add = (name, ok, detail, severity = 'error') => checks.push({ name, ok, detail, severity });
  if (!fs.existsSync(file)) { add('exists', false, `${file} does not exist`); return { passed: false, checks }; }
  const size = fs.statSync(file).size;
  add('size', size > 10_000, `${(size / 1e6).toFixed(2)} MB`);
  const r = await run(config.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 120000 });
  if (r.error || r.code !== 0) {
    add('probe', false, `ffprobe unavailable or failed (${r.error || r.stderr.split('\n')[0]}); content could not be verified`, 'warning');
    return { passed: checks.every((c) => c.ok || c.severity === 'warning'), checks, probe: null };
  }
  const meta = parseFfprobe(JSON.parse(r.stdout));
  add('video-stream', Boolean(meta.width), meta.width ? `${meta.width}x${meta.height} ${meta.videoCodec} @ ${meta.fps}fps` : 'no video stream');
  if (expect.width) add('resolution', meta.width === expect.width && meta.height === expect.height, `${meta.width}x${meta.height} (expected ${expect.width}x${expect.height})`);
  if (expect.fps) add('fps', Math.abs((meta.fps || 0) - expect.fps) < 0.6, `${meta.fps} (expected ${expect.fps})`);
  if (expect.duration) {
    const tol = Math.max(1, expect.duration * 0.02);
    add('duration', Math.abs((meta.duration || 0) - expect.duration) <= tol, `${meta.duration}s (expected ${expect.duration.toFixed(2)}s ±${tol.toFixed(2)})`);
  }
  if (expect.audio) add('audio-stream', meta.hasAudio, meta.hasAudio ? `${meta.audioCodec} ${meta.audioChannels}ch` : 'no audio stream although the plan has audio');
  if (expect.blackCheck !== false && meta.width) {
    const b = await run(config.ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', 'blackdetect=d=1:pic_th=0.98:pix_th=0.04', '-f', 'null', '-'], { timeoutMs: 15 * 60 * 1000 });
    if (!b.error) {
      const black = parseBlackDetect(b.stderr);
      const total = black.reduce((a, x) => a + x.duration, 0);
      const frac = meta.duration ? total / meta.duration : 0;
      add('not-black', frac < 0.9, `${(frac * 100).toFixed(0)}% of the video is black`);
      if (frac >= 0.2 && frac < 0.9) add('black-sections', false, `${black.length} black sections totalling ${total.toFixed(1)}s`, 'warning');
    }
  }
  return { passed: checks.every((c) => c.ok || c.severity === 'warning'), checks, probe: meta };
}

export async function extractFrames(config, video, times, outDir, { width = 960 } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const made = [];
  for (const t of times) {
    const out = `${outDir}/frame_${String(Math.round(t * 1000)).padStart(7, '0')}ms.jpg`;
    const r = await run(config.ffmpeg, ['-v', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', `scale=${width}:-2`, out], { timeoutMs: 60000 });
    if (!r.error && r.code === 0 && fs.existsSync(out)) made.push({ time: t, file: out });
  }
  return made;
}
