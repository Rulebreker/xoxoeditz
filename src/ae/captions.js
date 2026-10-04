import { round } from '../core/time.js';

/**
 * Turn timed text into caption chunks (<= maxChars per line, <= maxLines lines).
 * Word timings are used when present; otherwise each sentence is split proportionally.
 */
export function buildCaptionChunks({ sentences = [], words = null }, { maxChars = 38, maxLines = 2, minDur = 0.6, maxDur = 5 } = {}) {
  const chunks = [];
  const push = (start, end, text) => {
    if (!text.replace(/\s+/g, '')) return;
    end = Math.max(end, start + minDur);
    chunks.push({ start: round(start), end: round(Math.min(end, start + maxDur)), text });
  };
  const wrap = (txt) => {
    const out = []; let line = '';
    for (const w of txt.replace(/\s+/g, ' ').trim().split(' ')) {
      if ((line + ' ' + w).trim().length > maxChars && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
    }
    if (line) out.push(line);
    return out;
  };
  if (words && words.length) {
    let cur = []; let s = null;
    const flush = () => { if (cur.length) { push(s, cur[cur.length - 1].end, wrap(cur.map((w) => w.text).join(' ')).join('\n')); cur = []; s = null; } };
    for (const w of words) {
      if (s === null) s = w.start;
      const next = [...cur, w].map((x) => x.text).join(' ');
      if (cur.length && (wrap(next).length > maxLines || w.start - s > maxDur)) { flush(); s = w.start; }
      cur.push(w);
      if (/[.!?]$/.test(w.text)) flush();
    }
    flush();
  } else {
    for (const s of sentences) {
      const lines = wrap(s.text);
      const groups = [];
      for (let i = 0; i < lines.length; i += maxLines) groups.push(lines.slice(i, i + maxLines));
      const total = groups.reduce((a, g) => a + g.join(' ').length, 0) || 1;
      let t = s.start;
      for (const g of groups) {
        const share = (g.join(' ').length / total) * (s.end - s.start);
        push(t, t + share, g.join('\n'));
        t += share;
      }
    }
  }
  for (let i = 0; i < chunks.length - 1; i++) if (chunks[i].end > chunks[i + 1].start) chunks[i].end = Math.max(chunks[i].start + 0.2, chunks[i + 1].start);
  return chunks;
}
