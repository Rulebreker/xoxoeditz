import { runTool } from '../core/resolve-tool.js';
import { round } from '../core/time.js';

/**
 * Decode any audio file to mono float samples via the resolved FFmpeg (read-only; the source is never touched).
 * Returns { samples: Float32Array, sampleRate } or throws with the real reason.
 */
export async function decodePcm(config, file, { sampleRate = 22050, maxSeconds = 0, startSeconds = 0 } = {}) {
  const args = ['-v', 'error', '-protocol_whitelist', 'file'];
  if (startSeconds) args.push('-ss', String(startSeconds));
  args.push('-i', file);
  if (maxSeconds) args.push('-t', String(maxSeconds));
  args.push('-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', '-');
  const r = await runTool(config, 'ffmpeg', args, { binary: true, timeoutMs: 10 * 60 * 1000, maxBuffer: 1024 * 1024 * 1024 });
  if (r.error) throw new Error(r.error);
  if (r.code !== 0) throw new Error(`ffmpeg could not decode ${file}: ${r.stderr.split('\n').slice(-2).join(' ')}`);
  const buf = r.stdout;
  const n = Math.floor(buf.length / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(i * 2) / 32768;
  return { samples, sampleRate };
}

const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

/** Cheap descriptors of a short sound: loudness, where its transient is, how fast it attacks, brightness, tail. */
export function describeSound(samples, sampleRate) {
  const n = samples.length;
  if (!n) return { duration: 0, rmsDb: -120, peakDb: -120, peakTime: 0, attack: 0, tail: 0, brightness: 0, crest: 0 };
  let peak = 0; let peakIdx = 0; let sum = 0; let zc = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) { peak = a; peakIdx = i; }
    sum += samples[i] * samples[i];
    if (i && (samples[i] >= 0) !== (samples[i - 1] >= 0)) zc++;
  }
  const rms = Math.sqrt(sum / n);
  // envelope in 5 ms blocks
  const blk = Math.max(1, Math.round(sampleRate * 0.005));
  const env = [];
  for (let i = 0; i < n; i += blk) { let m = 0; for (let j = i; j < Math.min(n, i + blk); j++) m = Math.max(m, Math.abs(samples[j])); env.push(m); }
  const ePeak = Math.max(...env);
  const firstOver = env.findIndex((v) => v >= 0.9 * ePeak);
  const firstAny = env.findIndex((v) => v >= 0.1 * ePeak);
  let lastOver = 0; for (let i = env.length - 1; i >= 0; i--) if (env[i] >= ePeak * 0.01) { lastOver = i; break; } // -40 dB
  return {
    duration: round(n / sampleRate), rmsDb: round(db(rms), 1), peakDb: round(db(peak), 1), peakTime: round(peakIdx / sampleRate),
    attack: round(Math.max(0, firstOver - firstAny) * blk / sampleRate), tail: round(lastOver * blk / sampleRate),
    brightness: round(Math.min(1, (zc / (n / sampleRate)) / 6000)), // zero-crossing rate -> 0 (rumble) .. 1 (hiss)
    crest: round(db(peak) - db(rms), 1),
  };
}
