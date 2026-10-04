// Procedurally generated SFX via ffmpeg (no downloads, no licences): last-resort sound design when the
// user supplied no SFX. They are deliberately simple - supply real SFX for a premium result.

import fs from 'node:fs';
import path from 'node:path';
import { run } from '../core/exec.js';
import { ensureDir } from '../core/paths.js';

export const SYNTH = {
  whoosh: { args: ['-f', 'lavfi', '-i', 'anoisesrc=color=pink:duration=0.9:sample_rate=48000', '-af', 'highpass=f=300,lowpass=f=4500,afade=t=in:st=0:d=0.45,afade=t=out:st=0.45:d=0.45,volume=0.7'] },
  impact: { args: ['-f', 'lavfi', '-i', 'sine=frequency=52:duration=1.4:sample_rate=48000', '-af', 'afade=t=in:st=0:d=0.005,afade=t=out:st=0.06:d=1.34,lowpass=f=240,volume=1.4'] },
  riser: { args: ['-f', 'lavfi', '-i', 'anoisesrc=color=white:duration=3:sample_rate=48000', '-af', 'highpass=f=1200,lowpass=f=9000,afade=t=in:st=0:d=3,volume=0.5'] },
  tick: { args: ['-f', 'lavfi', '-i', 'sine=frequency=1800:duration=0.12:sample_rate=48000', '-af', 'afade=t=out:st=0.01:d=0.11,volume=0.5'] },
};

export async function synthesizeSfx(config, kind, outDir) {
  const def = SYNTH[kind];
  if (!def) throw new Error(`no synthesizer for "${kind}" (have: ${Object.keys(SYNTH).join(', ')})`);
  ensureDir(outDir);
  const out = path.join(outDir, `generated_sfx_${kind}.wav`);
  if (fs.existsSync(out) && fs.statSync(out).size > 1000) return out;
  const r = await run(config.ffmpeg, ['-v', 'error', '-y', ...def.args, '-ac', '2', '-ar', '48000', out], { timeoutMs: 60000 });
  if (r.error || r.code !== 0) throw new Error(`ffmpeg could not synthesize ${kind}: ${r.error || r.stderr}`);
  return out;
}
