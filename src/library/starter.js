// Starter library: license-free, procedurally generated SFX (FFmpeg lavfi) laid out in the standard structure.
// Basic quality by design. It exists so XOXOEDITZ works out of the box, in tests and in benchmarks;
// serious work should use a real library (just point XOXOEDITZ_ASSETS at it).

import fs from 'node:fs';
import path from 'node:path';
import { runTool } from '../core/resolve-tool.js';
import { ensureDir } from '../core/paths.js';

const noise = (color, d) => `anoisesrc=color=${color}:duration=${d}:sample_rate=48000:seed=7`; // seeded: the pack is reproducible
const expr = (e, d) => `aevalsrc='${e}':d=${d}:s=48000`;

// sub = folder under SFX/, file = name, in = lavfi inputs, af = filter on the (single/mixed) result, tags = extra tags
export const RECIPES = [
  { sub: 'WHOOSH', file: 'fast_whoosh_01', tags: ['fast', 'high-energy'], in: [noise('pink', 0.6)], af: 'highpass=f=500,lowpass=f=8000,afade=t=in:d=0.22,afade=t=out:st=0.22:d=0.38,volume=0.8' },
  { sub: 'WHOOSH', file: 'fast_whoosh_02', tags: ['fast', 'airy'], in: [noise('white', 0.5)], af: 'highpass=f=1200,lowpass=f=9000,afade=t=in:d=0.18,afade=t=out:st=0.2:d=0.3,volume=0.6' },
  { sub: 'WHOOSH', file: 'slow_whoosh_01', tags: ['slow', 'smooth'], in: [noise('pink', 1.6)], af: 'lowpass=f=3500,afade=t=in:d=0.8,afade=t=out:st=0.8:d=0.8,volume=0.7' },
  { sub: 'SWOOSH', file: 'smooth_swoosh_01', tags: ['smooth', 'soft'], in: [noise('brown', 1.2)], af: 'lowpass=f=2200,afade=t=in:d=0.55,afade=t=out:st=0.55:d=0.65,volume=1.2' },
  { sub: 'IMPACT', file: 'cinematic_impact_01', tags: ['cinematic', 'big'], in: ['sine=frequency=52:duration=1.5:sample_rate=48000', noise('pink', 0.25)], fc: '[0]afade=t=out:st=0.05:d=1.45,lowpass=f=260[s];[1]lowpass=f=1200,afade=t=out:d=0.25[n];[s][n]amix=inputs=2:duration=longest:normalize=0,volume=1.6' },
  { sub: 'IMPACT', file: 'soft_impact_01', tags: ['soft', 'low'], in: ['sine=frequency=70:duration=0.9:sample_rate=48000'], af: 'afade=t=out:st=0.03:d=0.87,lowpass=f=220,volume=1.0' },
  { sub: 'HIT', file: 'punch_hit_01', tags: ['punch', 'camera', 'short'], in: ['sine=frequency=110:duration=0.35:sample_rate=48000', noise('white', 0.06)], fc: '[0]afade=t=out:st=0.02:d=0.33[s];[1]lowpass=f=3000,afade=t=out:d=0.06[n];[s][n]amix=inputs=2:duration=longest:normalize=0,volume=1.4' },
  { sub: 'BOOM', file: 'deep_boom_01', tags: ['deep', 'big', 'explosion'], in: ['sine=frequency=38:duration=2.2:sample_rate=48000'], af: 'afade=t=out:st=0.05:d=2.15,lowpass=f=140,volume=2.2' },
  { sub: 'SUB', file: 'sub_drop_01', tags: ['drop', 'low'], in: [expr('0.9*sin(2*PI*(90*t-35*t*t))*exp(-1.3*t)', 1.6)], af: 'volume=1.4' },
  { sub: 'RISER', file: 'noise_riser_01', tags: ['build', 'tension'], in: [noise('white', 3)], af: 'highpass=f=1200,lowpass=f=9000,afade=t=in:d=3,volume=0.6' },
  { sub: 'SWELL', file: 'dark_swell_01', tags: ['dark', 'cinematic'], in: [expr('0.25*(sin(2*PI*110*t)+sin(2*PI*131*t)+sin(2*PI*165*t))*sin(PI*t/3.2)', 3.2)], af: 'volume=1.2' },
  { sub: 'REVERSE', file: 'reverse_riser_01', tags: ['reverse', 'build'], in: [noise('pink', 2)], af: 'highpass=f=800,afade=t=in:d=2,areverse,volume=0.8' },
  { sub: 'TENSION', file: 'dark_drone_01', tags: ['dark', 'drone', 'ominous'], in: [expr('0.3*(sin(2*PI*55*t)+sin(2*PI*58*t))*(0.8+0.2*sin(2*PI*0.5*t))', 4)], af: 'afade=t=in:d=1,afade=t=out:st=3:d=1' },
  { sub: 'GLITCH', file: 'digital_glitch_01', tags: ['digital', 'distortion', 'short'], in: [expr('0.4*sin(2*PI*(800+600*sin(40*t))*t)*gt(sin(55*t),0)', 0.5)], af: 'afade=t=out:st=0.35:d=0.15' },
  { sub: 'DIGITAL', file: 'data_chirp_01', tags: ['electronic', 'tech', 'technical'], in: [expr('0.3*sin(2*PI*(1000+2500*t)*t)', 0.35)], af: 'afade=t=out:st=0.2:d=0.15' },
  { sub: 'UI', file: 'ui_blip_01', tags: ['interface', 'technical', 'digital', 'electronic'], in: ['sine=frequency=1400:duration=0.09:sample_rate=48000'], af: 'afade=t=out:st=0.01:d=0.08,volume=0.5' },
  { sub: 'CLICK', file: 'soft_click_01', tags: ['ui'], in: [noise('white', 0.02)], af: 'highpass=f=2500,afade=t=out:d=0.02,volume=0.7' },
  { sub: 'TICK', file: 'counter_tick_01', tags: ['counter', 'ui'], in: ['sine=frequency=1800:duration=0.12:sample_rate=48000'], af: 'afade=t=out:st=0.01:d=0.11,volume=0.5' },
  { sub: 'CAMERA', file: 'camera_shutter_01', tags: ['shutter', 'movement'], in: [noise('white', 0.12)], af: 'highpass=f=2000,afade=t=out:st=0.03:d=0.09,volume=0.8' },
  { sub: 'MECHANICAL', file: 'servo_whirr_01', tags: ['machine', 'motor'], in: [expr('0.3*sin(2*PI*(300+300*t)*t)*(0.7+0.3*sin(2*PI*14*t))', 0.9)], af: 'afade=t=in:d=0.1,afade=t=out:st=0.6:d=0.3' },
  { sub: 'VEHICLE', file: 'engine_pass_01', tags: ['engine', 'pass-by', 'car'], in: [noise('brown', 2.4)], af: 'lowpass=f=900,tremolo=f=18:d=0.6,afade=t=in:d=1.0,afade=t=out:st=1.2:d=1.2,volume=2.0' },
  { sub: 'WEAPON', file: 'rifle_shot_01', tags: ['gun', 'shot'], in: [noise('white', 0.08), 'sine=frequency=80:duration=0.5:sample_rate=48000'], fc: '[0]afade=t=out:d=0.08[n];[1]afade=t=out:st=0.02:d=0.48[s];[n][s]amix=inputs=2:duration=longest:normalize=0,volume=1.3' },
  { sub: 'FOOTSTEP', file: 'boot_step_01', tags: ['foley', 'steps'], in: [noise('brown', 0.12)], af: 'lowpass=f=500,afade=t=out:d=0.12,volume=2.0' },
  { sub: 'AMBIENCE', file: 'room_tone_01', tags: ['bed', 'atmosphere'], in: [noise('brown', 6)], af: 'lowpass=f=500,volume=0.35,afade=t=in:d=1,afade=t=out:st=5:d=1' },
];

/**
 * Generate the starter SFX pack into root/SFX/<SUB>/ (skipping files that exist). Returns the written files.
 * `only` limits it to a subset of recipe file names (tests keep it small).
 */
export async function generateStarterSfx(config, root, { only = null } = {}) {
  const written = [];
  for (const r of RECIPES) {
    if (only && !only.includes(r.file)) continue;
    const dir = ensureDir(path.join(root, 'SFX', r.sub));
    const out = path.join(dir, `${r.file}.wav`);
    if (!fs.existsSync(out)) {
      const args = ['-v', 'error', '-y'];
      for (const i of r.in) args.push('-f', 'lavfi', '-i', i);
      if (r.fc) args.push('-filter_complex', r.fc); else if (r.af) args.push('-af', r.af);
      args.push('-ac', '2', '-ar', '48000', out);
      const res = await runTool(config, 'ffmpeg', args, { timeoutMs: 60000 });
      if (res.error || res.code !== 0) throw new Error(`could not synthesise ${r.file}: ${res.error || res.stderr.split('\n').slice(-2).join(' ')}`);
    }
    fs.writeFileSync(path.join(dir, `${r.file}.json`), JSON.stringify({ tags: r.tags, generated: true }, null, 2));
    written.push(out);
  }
  return written;
}
