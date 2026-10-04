#!/usr/bin/env node
// Test double for aerender: reads the (mock) .aep JSON, then produces a real video with ffmpeg so the
// transcode + verification stages run on genuine media.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const a = process.argv.slice(2);
const arg = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const project = arg('-project'); const comp = arg('-comp'); const out = arg('-output');
if (process.env.FAKE_AERENDER_FAIL) { console.log('aerender ERROR: simulated failure'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(project, 'utf8'));
const c = data.items.find((i) => i.name === comp);
if (!c) { console.log(`aerender ERROR: composition ${comp} not found`); process.exit(2); }
const fps = c.fps || 24;
const s = arg('-s') !== undefined ? Number(arg('-s')) : 0;
const e = arg('-e') !== undefined ? Number(arg('-e')) : Math.round(c.duration * fps) - 1;
const dur = (e - s + 1) / fps;
const w = Math.min(c.width, Number(process.env.FAKE_AERENDER_MAXW || 640)); const h = Math.round((w * c.height) / c.width / 2) * 2;
const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=${fps}`, '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', String(dur), '-c:v', 'mpeg4', '-q:v', '3', '-c:a', out.endsWith('.mp4') ? 'aac' : 'pcm_s16le', '-shortest', out.replace(/\.[^.]+$/, '') + (out.endsWith('.mp4') ? '.mp4' : '.mov')]);
if (r.status !== 0) { console.log('aerender ERROR: ' + r.stderr); process.exit(3); }
const total = e - s + 1;
for (let f = 0; f < total; f += Math.max(1, Math.floor(total / 5))) console.log(`PROGRESS:  0:00:00:${String(f).padStart(2, '0')} (${f + 1}): 0 Seconds`);
console.log(`PROGRESS: Finished composition "${comp}".`);
