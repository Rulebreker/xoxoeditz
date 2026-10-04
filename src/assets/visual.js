// Visual understanding of project assets from a handful of tiny decoded frames (64x36 RGB): brightness, contrast,
// colour, the likely subject region (centre-surround saliency), motion energy over time and a near-duplicate hash.
// Read-only; results are cached by content fingerprint so re-analysis only happens for new/changed files.

import fs from 'node:fs';
import { runTool } from '../core/resolve-tool.js';
import { fingerprintFile } from './fingerprint.js';
import { readJson, writeJson } from '../core/paths.js';
import { round } from '../core/time.js';

export const FW = 64; export const FH = 36;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export async function decodeFrames(config, file, { still = false, fps = 2, maxFrames = 120, maxSeconds = 90 } = {}) {
  const args = ['-v', 'error', '-protocol_whitelist', 'file'];
  if (!still) args.push('-t', String(maxSeconds));
  args.push('-i', file, '-an', '-vf', still ? `scale=${FW}:${FH}:flags=area` : `fps=${fps},scale=${FW}:${FH}:flags=area`, '-frames:v', String(still ? 1 : maxFrames), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-');
  const r = await runTool(config, 'ffmpeg', args, { binary: true, timeoutMs: 5 * 60 * 1000, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(r.error);
  if (r.code !== 0 || !r.stdout.length) throw new Error(`cannot decode frames from ${file}: ${r.stderr.split('\n').slice(-2).join(' ')}`);
  const size = FW * FH * 3; const frames = [];
  for (let o = 0; o + size <= r.stdout.length; o += size) frames.push(r.stdout.subarray(o, o + size));
  return frames;
}

const gray = (f) => { const g = new Float32Array(FW * FH); for (let i = 0; i < g.length; i++) g[i] = (0.299 * f[i * 3] + 0.587 * f[i * 3 + 1] + 0.114 * f[i * 3 + 2]) / 255; return g; };

function boxBlur(g, r) {
  const out = new Float32Array(g.length);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    let s = 0; let n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx; const yy = y + dy; if (xx >= 0 && xx < FW && yy >= 0 && yy < FH) { s += g[yy * FW + xx]; n++; } }
    out[y * FW + x] = s / n;
  }
  return out;
}

/** Likely subject: connected region of strongest local contrast. Returns normalized {x,y,w,h,conf} (0..1). */
export function findSubject(g) {
  const blur = boxBlur(g, 4); const sal = new Float32Array(g.length); let sum = 0;
  for (let i = 0; i < g.length; i++) { sal[i] = Math.abs(g[i] - blur[i]); sum += sal[i]; }
  const mean = sum / sal.length; let v = 0; for (const s of sal) v += (s - mean) ** 2;
  const thr = mean + 0.9 * Math.sqrt(v / sal.length);
  const seen = new Uint8Array(sal.length); let best = null;
  for (let s = 0; s < sal.length; s++) {
    if (seen[s] || sal[s] < thr) continue;
    const stack = [s]; seen[s] = 1; let x0 = FW; let y0 = FH; let x1 = 0; let y1 = 0; let mass = 0;
    while (stack.length) {
      const i = stack.pop(); const x = i % FW; const y = (i / FW) | 0; mass += sal[i];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const xx = x + dx; const yy = y + dy; if (xx < 0 || yy < 0 || xx >= FW || yy >= FH) continue;
        const j = yy * FW + xx; if (!seen[j] && sal[j] >= thr) { seen[j] = 1; stack.push(j); }
      }
    }
    if (!best || mass > best.mass) best = { x0, y0, x1, y1, mass };
  }
  if (!best || sum === 0) return { x: 0.25, y: 0.2, w: 0.5, h: 0.6, conf: 0 }; // flat image: assume centre
  return { x: round(best.x0 / FW), y: round(best.y0 / FH), w: round((best.x1 - best.x0 + 1) / FW), h: round((best.y1 - best.y0 + 1) / FH), conf: round(clamp01(best.mass / sum)) };
}

export function hueName(h) { return h < 15 || h >= 345 ? 'red' : h < 45 ? 'orange' : h < 70 ? 'yellow' : h < 165 ? 'green' : h < 200 ? 'cyan' : h < 260 ? 'blue' : h < 300 ? 'purple' : 'pink'; }

export function aHash(g) { // 8x8 average hash as 16 hex chars
  const cell = new Float32Array(64);
  for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) {
    let s = 0; let n = 0;
    for (let y = Math.floor(cy * FH / 8); y < Math.floor((cy + 1) * FH / 8); y++) for (let x = cx * 8; x < (cx + 1) * 8; x++) { s += g[y * FW + x]; n++; }
    cell[cy * 8 + cx] = s / n;
  }
  const m = cell.reduce((a, b) => a + b, 0) / 64; let hex = '';
  for (let i = 0; i < 64; i += 4) hex += ((cell[i] > m ? 8 : 0) | (cell[i + 1] > m ? 4 : 0) | (cell[i + 2] > m ? 2 : 0) | (cell[i + 3] > m ? 1 : 0)).toString(16);
  return hex;
}
export function hamming(a, b) { let d = 0; for (let i = 0; i < a.length; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } } return d; }

/** Pure analysis of decoded frames. `fps` is the sampling rate used to decode (for the motion curve time base). */
export function analyzeFrames(frames, { fps = 2, isStill = false } = {}) {
  const mid = frames[Math.floor(frames.length / 2)];
  const g = gray(mid);
  const mean = g.reduce((a, b) => a + b, 0) / g.length;
  const std = Math.sqrt(g.reduce((a, b) => a + (b - mean) ** 2, 0) / g.length);
  let rgM = 0; let ybM = 0; let rg2 = 0; let yb2 = 0; let hx = 0; let hy = 0; let sat = 0;
  const n = FW * FH;
  for (let i = 0; i < n; i++) {
    const r = mid[i * 3]; const gg = mid[i * 3 + 1]; const b = mid[i * 3 + 2];
    const rg = r - gg; const yb = 0.5 * (r + gg) - b;
    rgM += rg; ybM += yb; rg2 += rg * rg; yb2 += yb * yb;
    const mx = Math.max(r, gg, b); const mn = Math.min(r, gg, b); const s = mx ? (mx - mn) / mx : 0; sat += s;
    if (s > 0.25 && mx > 40) { const h = Math.atan2(Math.sqrt(3) * (gg - b), 2 * r - gg - b); hx += Math.cos(h) * s; hy += Math.sin(h) * s; }
  }
  rgM /= n; ybM /= n;
  const colorfulness = clamp01((Math.sqrt(Math.max(0, rg2 / n - rgM * rgM) + Math.max(0, yb2 / n - ybM * ybM)) + 0.3 * Math.sqrt(rgM * rgM + ybM * ybM)) / 110);
  const hue = (hx || hy) ? ((Math.atan2(hy, hx) * 180 / Math.PI) + 360) % 360 : null;
  const subject = findSubject(g);

  let motion = { avg: 0, peak: 0, curve: [], bestWindow: null };
  if (!isStill && frames.length > 1) {
    const gs = frames.map(gray); const curve = [];
    for (let i = 1; i < gs.length; i++) { let d = 0; for (let k = 0; k < gs[i].length; k++) d += Math.abs(gs[i][k] - gs[i - 1][k]); curve.push(d / gs[i].length); }
    const avg = curve.reduce((a, b) => a + b, 0) / curve.length;
    const win = Math.max(1, Math.round(2 * fps)); let best = { s: 0, v: -1 };
    for (let s = 0; s + win <= curve.length; s++) { const v = curve.slice(s, s + win).reduce((a, b) => a + b, 0) / win; if (v > best.v) best = { s, v }; }
    motion = { avg: round(avg, 4), peak: round(Math.max(...curve), 4), curve: curve.map((c) => round(c, 4)), step: round(1 / fps), bestWindow: best.v >= 0 ? { start: round(best.s / fps), duration: round(win / fps), motion: round(best.v, 4) } : null };
  }
  const tags = [];
  tags.push(mean < 0.28 ? 'dark' : mean > 0.65 ? 'bright' : 'midtone');
  if (std < 0.08) tags.push('low-contrast'); else if (std > 0.28) tags.push('high-contrast');
  if (colorfulness > 0.3) tags.push('vivid'); else if (colorfulness < 0.08) tags.push('monochrome');
  if (hue !== null && colorfulness > 0.08) tags.push(hueName(hue));
  if (!isStill) tags.push(motion.avg > 0.06 ? 'high-motion' : motion.avg > 0.015 ? 'moderate-motion' : 'static-shot');
  return { brightness: round(mean), contrast: round(std), colorfulness: round(colorfulness), hue: hue === null ? null : Math.round(hue), saturation: round(sat / n), subject, motion, hash: aHash(g), tags };
}

export async function analyzeVisual(config, asset, { fps = 2 } = {}) {
  const still = asset.type === 'image' || asset.meta?.isStill;
  const frames = await decodeFrames(config, asset.path, { still, fps });
  return analyzeFrames(frames, { fps, isStill: still });
}

/**
 * Fill asset.visual for every image/video in a manifest, using/refreshing a fingerprint-keyed cache file.
 * Never throws for one bad file: the asset gets visual:null and a warning is returned.
 */
export async function ensureVisualAnalysis(config, manifest, cacheFile) {
  const cache = cacheFile ? readJson(cacheFile, {}) : {};
  const warnings = []; let analysed = 0; let reused = 0;
  for (const a of manifest.assets) {
    if (!['image', 'video'].includes(a.type)) continue;
    a.fingerprint ||= fingerprintFile(a.path);
    if (cache[a.fingerprint]) { a.visual = cache[a.fingerprint]; reused++; continue; }
    try { a.visual = await analyzeVisual(config, a); cache[a.fingerprint] = a.visual; analysed++; }
    catch (e) { a.visual = null; warnings.push(`${a.id}: visual analysis failed (${e.message})`); }
  }
  if (cacheFile && analysed) { fs.mkdirSync(cacheFile.replace(/[\\/][^\\/]+$/, ''), { recursive: true }); writeJson(cacheFile, cache); }
  // near-duplicates: same picture saved twice / re-encoded
  const vis = manifest.assets.filter((a) => a.visual?.hash);
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    if (hamming(vis[i].visual.hash, vis[j].visual.hash) <= 4 && vis[i].type === vis[j].type) { (vis[j].nearDuplicates ||= []).push(vis[i].id); (vis[i].nearDuplicates ||= []).push(vis[j].id); }
  }
  return { analysed, reused, warnings };
}
