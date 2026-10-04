import fs from 'node:fs';
import path from 'node:path';
import { run } from '../core/exec.js';
import { ensureDir, writeJson } from '../core/paths.js';
import { round } from '../core/time.js';

// ---------- audio measurement (ffmpeg) ----------
export function parseSilenceDetect(stderr) {
  const silences = [];
  let open = null;
  for (const line of stderr.split(/\r?\n/)) {
    let m = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (m) { open = Math.max(0, Number(m[1])); continue; }
    m = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/.exec(line);
    if (m) { silences.push({ start: open ?? Math.max(0, Number(m[1]) - Number(m[2])), end: Number(m[1]), duration: Number(m[2]) }); open = null; }
  }
  if (open !== null) silences.push({ start: open, end: null, duration: null });
  return silences;
}

export function parseVolumeDetect(stderr) {
  const mean = /mean_volume:\s*(-?[\d.]+)\s*dB/.exec(stderr);
  const max = /max_volume:\s*(-?[\d.]+)\s*dB/.exec(stderr);
  return { meanDb: mean ? Number(mean[1]) : null, maxDb: max ? Number(max[1]) : null };
}

export async function measureAudio(config, file, { noiseDb = -35, minSilence = 0.35 } = {}) {
  const r = await run(config.ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilence},volumedetect`, '-f', 'null', '-'], { timeoutMs: 10 * 60 * 1000 });
  if (r.error) throw new Error(`ffmpeg unavailable: ${r.error}`);
  const dur = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(r.stderr);
  const duration = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null;
  const silences = parseSilenceDetect(r.stderr);
  for (const s of silences) if (s.end === null && duration) { s.end = duration; s.duration = duration - s.start; }
  return { duration, silences: silences.filter((s) => s.end !== null), ...parseVolumeDetect(r.stderr) };
}

/** Complement of the silences: where someone is actually talking. */
export function speechSegments(duration, silences, minLen = 0.15) {
  const segs = [];
  let cur = 0;
  for (const s of silences) {
    if (s.start - cur >= minLen) segs.push({ start: round(cur), end: round(s.start) });
    cur = Math.max(cur, s.end);
  }
  if (duration - cur >= minLen) segs.push({ start: round(cur), end: round(duration) });
  return segs;
}

// ---------- transcripts ----------
const tsToSec = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(String(ms).padEnd(3, '0')) / 1000;

export function parseSubtitles(text) {
  const cues = [];
  const blocks = text.replace(/\r/g, '').replace(/^WEBVTT.*\n/, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim().length);
    const i = lines.findIndex((l) => /-->/.test(l));
    if (i < 0) continue;
    const m = /(?:(\d+):)?(\d+):(\d+)[,.](\d+)\s*-->\s*(?:(\d+):)?(\d+):(\d+)[,.](\d+)/.exec(lines[i]);
    if (!m) continue;
    const start = tsToSec(m[1] || 0, m[2], m[3], m[4]);
    const end = tsToSec(m[5] || 0, m[6], m[7], m[8]);
    const t = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (t) cues.push({ start, end, text: t });
  }
  return cues;
}

export function splitSentences(text) {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  const parts = clean.split(/(?<=[.!?…])["')\]]?\s+|\n{2,}/).map((s) => s.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  return parts;
}

/**
 * Align a plain-text script to audio *heuristically*: sentence boundaries are placed by character share
 * along the speech-only timeline, then snapped to real pauses. Good enough to drive pacing; prefer SRT/Whisper.
 */
export function alignScript(sentences, duration, silences) {
  const speech = speechSegments(duration, silences);
  const total = speech.reduce((a, s) => a + (s.end - s.start), 0) || duration;
  const chars = sentences.map((s) => s.length);
  const sum = chars.reduce((a, b) => a + b, 0) || 1;
  const at = (p) => { // position p in [0,total] of speech-time -> absolute time
    let left = p;
    for (const s of speech) { const l = s.end - s.start; if (left <= l) return s.start + left; left -= l; }
    return duration;
  };
  const out = [];
  let acc = 0; let prevEnd = speech[0]?.start ?? 0;
  sentences.forEach((text, i) => {
    acc += chars[i];
    let end = at((acc / sum) * total);
    if (i < sentences.length - 1) {
      const near = silences.filter((s) => Math.abs(s.start - end) < 1.0 && s.start > prevEnd + 0.3).sort((a, b) => Math.abs(a.start - end) - Math.abs(b.start - end))[0];
      if (near) end = near.start;
    } else end = speech[speech.length - 1]?.end ?? duration;
    out.push({ start: round(prevEnd), end: round(end), text });
    const nextSpeech = speech.find((s) => s.end > end + 0.05);
    prevEnd = nextSpeech ? Math.max(end, nextSpeech.start) : end;
  });
  return out;
}

export async function transcribeWithWhisper(config, audioFile, outDir, { model = 'base', language = null } = {}) {
  ensureDir(outDir);
  const args = [audioFile, '--model', model, '--output_format', 'json', '--word_timestamps', 'True', '--output_dir', outDir, '--verbose', 'False'];
  if (language) args.push('--language', language);
  const r = await run(config.whisper, args, { timeoutMs: 60 * 60 * 1000 });
  if (r.error || r.code !== 0) throw new Error(`whisper failed: ${r.error || r.stderr.split('\n').slice(-3).join(' ')}`);
  const jf = path.join(outDir, path.basename(audioFile).replace(/\.[^.]+$/, '') + '.json');
  const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
  return (j.segments || []).map((s) => ({
    start: s.start, end: s.end, text: String(s.text).trim(),
    words: (s.words || []).map((w) => ({ start: w.start, end: w.end, text: String(w.word).trim() })),
  }));
}

// ---------- understanding ----------
const STOP = new Set('a an the and or but if then than so as of at by for from in into on onto to up with without is are was were be been being it its this that these those he she they we you i his her their our your not no do does did have has had will would can could should may might also just very more most over under after before when while which who whom whose what where why how there here about against between through during per'.split(' '));

export function analyzeSentence(text) {
  const words = text.match(/[A-Za-z][A-Za-z'’-]+|\d[\d,.]*/g) || [];
  const keywords = [...new Set(words.map((w) => w.toLowerCase()).filter((w) => !STOP.has(w) && w.length > 2 && !/^\d/.test(w)))];
  const stats = [];
  const re = /(\bMach\s*\d+(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?\s?(?:km\/h|kph|mph|km|kilometers?|meters?|m|kg|tons?|tonnes?|%|percent|years?|hours?|minutes?|seconds?|knots?|ft|feet|miles?|billion|million|thousand)\b)|(\b(?:19|20)\d\d\b)/gi;
  let m;
  while ((m = re.exec(text))) stats.push(m[0].trim());
  const emphasis = [...new Set([...(text.match(/\b[A-Z][a-zA-Z0-9-]{2,}\b/g) || []).filter((w, i, arr) => !(text.startsWith(w) && arr.indexOf(w) === 0)), ...stats])];
  const mood = /\b(danger|war|threat|attack|missile|weapon|combat|fear|strike)\b/i.test(text) ? 'tense'
    : /\b(breakthrough|success|first|record|triumph|achiev|innovat)\w*/i.test(text) ? 'triumphant' : 'neutral';
  return { keywords, stats, emphasis, mood };
}

/**
 * Group sentences into scenes. Breaks prefer long pauses; scene length stays within [min,max].
 */
export function groupScenes(sentences, { min = 4, target = 10, max = 18 } = {}) {
  const scenes = [];
  let cur = [];
  const flush = () => { if (cur.length) { scenes.push(cur); cur = []; } };
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    cur.push(s);
    const len = cur[cur.length - 1].end - cur[0].start;
    const next = sentences[i + 1];
    const gap = next ? next.start - s.end : Infinity;
    if (!next) break;
    if (len >= max || (len >= target && gap >= 0.3) || (len >= min && gap >= 1.2)) flush();
  }
  flush();
  if (scenes.length > 1) { // fold a too-short tail into the previous scene
    const last = scenes[scenes.length - 1];
    if (last[last.length - 1].end - last[0].start < min) { scenes[scenes.length - 2].push(...last); scenes.pop(); }
  }
  return scenes.map((group, i) => ({
    id: `S${String(i + 1).padStart(2, '0')}`,
    start: group[0].start, end: group[group.length - 1].end,
    text: group.map((g) => g.text).join(' '),
    sentenceIds: group.map((g) => g.id),
  }));
}

/**
 * Full narration analysis. Inputs (all optional except audio): srt/vtt file, plain script text, or whisper.
 */
export async function analyzeNarration(config, { audio, subtitles = null, script = null, transcribe = false, outDir = null, noiseDb = -35 }) {
  const m = await measureAudio(config, audio, { noiseDb });
  const duration = m.duration;
  const speech = speechSegments(duration, m.silences);
  let sentences = []; let method = 'none'; let confidence = 0; let words = null;

  if (subtitles) {
    const cues = parseSubtitles(fs.readFileSync(subtitles, 'utf8'));
    sentences = cues.map((c) => ({ start: round(c.start), end: round(c.end), text: c.text })); method = 'subtitle-file'; confidence = 0.95;
  } else if (transcribe) {
    const segs = await transcribeWithWhisper(config, audio, outDir || path.join(config.workspace, 'whisper'));
    sentences = segs.map((s) => ({ start: round(s.start), end: round(s.end), text: s.text })); method = 'whisper'; confidence = 0.85;
    words = segs.flatMap((s) => s.words);
  } else if (script) {
    const text = fs.existsSync(script) ? fs.readFileSync(script, 'utf8') : script;
    sentences = alignScript(splitSentences(text), duration, m.silences); method = 'script-heuristic'; confidence = 0.5;
  }
  sentences = sentences.map((s, i) => ({ id: `T${String(i + 1).padStart(3, '0')}`, ...s, ...analyzeSentence(s.text) }));

  const pauses = m.silences.filter((s) => s.duration >= 0.8).map((s) => ({ at: round(s.start), duration: round(s.duration) }));
  const scenes = sentences.length ? groupScenes(sentences) : [];
  const result = {
    file: audio, duration: round(duration), loudness: { meanDb: m.meanDb, maxDb: m.maxDb, clipping: m.maxDb !== null && m.maxDb >= -0.1 },
    silenceThresholdDb: noiseDb, silences: m.silences.map((s) => ({ start: round(s.start), end: round(s.end), duration: round(s.duration) })),
    speech, pauses, transcript: { method, confidence }, sentences, scenes, words,
    notes: method === 'none'
      ? ['No transcript provided. Pass --script <txt>, --subtitles <srt|vtt>, or --transcribe (needs the `whisper` CLI) for text-aware timing; pause-based timing only.']
      : method === 'script-heuristic' ? ['Sentence timing is estimated from the script and the speech/pause pattern. Prefer SRT/Whisper for frame-accurate sync.'] : [],
  };
  if (outDir) writeJson(path.join(outDir, 'narration.json'), result);
  return result;
}
