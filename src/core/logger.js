import fs from 'node:fs';
import path from 'node:path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

/** JSONL file logger (+ optional stderr echo; stdout is reserved for CLI/MCP output). */
export function createLogger({ dir, level = 'info', echo = false, name = 'xoxo' } = {}) {
  const min = LEVELS[level] ?? 20;
  let file = null;
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      file = path.join(dir, `${name}-${new Date().toISOString().slice(0, 10)}.jsonl`);
    } catch { file = null; }
  }
  const emit = (lvl, msg, data) => {
    if ((LEVELS[lvl] ?? 20) < min) return;
    const rec = { t: new Date().toISOString(), level: lvl, msg, ...(data ? { data } : {}) };
    if (file) { try { fs.appendFileSync(file, JSON.stringify(rec) + '\n'); } catch { /* logging must never throw */ } }
    if (echo) process.stderr.write(`[${lvl}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}\n`);
  };
  return {
    file,
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
  };
}

export const nullLogger = { file: null, debug() {}, info() {}, warn() {}, error() {} };
