import fs from 'node:fs';
import { runTool } from '../core/resolve-tool.js';

function parseRate(r) {
  if (!r || r === '0/0') return null;
  const [n, d] = String(r).split('/').map(Number);
  if (!d) return n || null;
  return Math.round((n / d) * 1000) / 1000;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export function aspectOf(w, h) {
  if (!w || !h) return null;
  const g = gcd(w, h);
  const r = w / h;
  const known = [[16 / 9, '16:9'], [9 / 16, '9:16'], [4 / 3, '4:3'], [3 / 4, '3:4'], [1, '1:1'], [2.39, '2.39:1'], [21 / 9, '21:9'], [3 / 2, '3:2'], [2 / 3, '2:3']];
  for (const [v, label] of known) if (Math.abs(r - v) < 0.02) return label;
  return `${w / g}:${h / g}`;
}

/** Parse the `ffprobe -print_format json` output into XOXO's metadata shape. */
export function parseFfprobe(json) {
  const streams = json.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = streams.find((s) => s.codec_type === 'audio');
  const fmt = json.format || {};
  const meta = { container: fmt.format_name || null };
  const dur = Number(fmt.duration ?? v?.duration ?? a?.duration);
  meta.duration = Number.isFinite(dur) ? Math.round(dur * 1000) / 1000 : null;
  if (v) {
    let w = v.width; let h = v.height;
    const rot = Number((v.tags && v.tags.rotate) || (v.side_data_list || []).find((s) => s.rotation !== undefined)?.rotation || 0);
    if (Math.abs(rot) % 180 === 90) [w, h] = [h, w];
    Object.assign(meta, { width: w, height: h, fps: parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate), videoCodec: v.codec_name, pixelFormat: v.pix_fmt, rotation: rot || 0 });
    meta.aspect = aspectOf(w, h);
    meta.orientation = w === h ? 'square' : (w > h ? 'landscape' : 'portrait');
    const frames = Number(v.nb_frames);
    const imageFormat = /image2|png_pipe|jpeg_pipe|webp_pipe|gif|tiff_pipe|bmp_pipe|svg_pipe/.test(fmt.format_name || '');
    meta.isStill = imageFormat && !(fmt.format_name === 'gif' && frames > 1) || (Number.isFinite(frames) && frames === 1 && !meta.duration);
  }
  if (a) Object.assign(meta, { audioCodec: a.codec_name, audioChannels: a.channels, sampleRate: Number(a.sample_rate) || null });
  if (meta.isStill) meta.duration = null;
  meta.hasVideo = Boolean(v);
  meta.hasAudio = Boolean(a);
  return meta;
}

/** Minimal image-header reader so image sizes work even without ffprobe. */
export function readImageSize(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(32);
    fs.readSync(fd, head, 0, 32, 0);
    if (head.toString('latin1', 1, 4) === 'PNG') return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    if (head.toString('latin1', 0, 3) === 'GIF') return { width: head.readUInt16LE(6), height: head.readUInt16LE(8) };
    if (head[0] === 0xff && head[1] === 0xd8) {
      const st = fs.fstatSync(fd);
      const buf = Buffer.alloc(Math.min(st.size, 1 << 20));
      fs.readSync(fd, buf, 0, buf.length, 0);
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    if (head.toString('latin1', 0, 2) === 'BM') return { width: head.readInt32LE(18), height: Math.abs(head.readInt32LE(22)) };
  } catch { /* fall through */ } finally { if (fd !== undefined) fs.closeSync(fd); }
  return null;
}

export async function probeFile(file, type, config) {
  const r = await runTool(config, 'ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 60000 });
  if (!r.error && r.code === 0) {
    try { return { ...parseFfprobe(JSON.parse(r.stdout)), probe: 'ffprobe' }; } catch { /* fall back */ }
  }
  const meta = { probe: 'fallback', probeError: r.error || (r.stderr || '').split('\n')[0] || 'ffprobe failed' };
  if (type === 'image') {
    const size = readImageSize(file);
    if (size) Object.assign(meta, size, { aspect: aspectOf(size.width, size.height), orientation: size.width === size.height ? 'square' : (size.width > size.height ? 'landscape' : 'portrait'), isStill: true, hasVideo: true, hasAudio: false, duration: null });
  }
  return meta;
}
