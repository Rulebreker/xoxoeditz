import { spawn } from 'node:child_process';
import path from 'node:path';

// Allowlist of external programs XOXOEDITZ may launch. Everything is spawned WITHOUT a shell.
const ALLOWED = new Set([
  'ffmpeg', 'ffprobe', 'aerender', 'afterfx', 'adobe media encoder', 'whisper', 'faster-whisper',
  'python', 'python3', 'py', 'node', 'nvidia-smi', 'powershell', 'pwsh', 'osascript', 'pgrep',
  'tasklist', 'reg', 'where', 'which', 'system_profiler', 'lspci',
]);

export function isAllowedExecutable(cmd) {
  const base = path.basename(String(cmd)).toLowerCase().replace(/\.(exe|cmd|bat|app)$/i, '');
  if (ALLOWED.has(base)) return true;
  // Tests inject fake binaries via XOXO_TEST_ALLOW (comma-separated basenames).
  const extra = (process.env.XOXO_TEST_ALLOW || '').split(',').filter(Boolean);
  return extra.includes(base);
}

/**
 * Run an allowlisted executable. Never throws: resolves {code, stdout, stderr, error?, timedOut?}.
 */
export function run(cmd, args = [], { timeoutMs = 30000, cwd, input, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    if (!isAllowedExecutable(cmd)) {
      resolve({ code: -1, stdout: '', stderr: '', error: `executable not on allowlist: ${cmd}` });
      return;
    }
    let child;
    try {
      child = spawn(cmd, args, { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: '', error: e.message });
      return;
    }
    let stdout = ''; let stderr = ''; let timedOut = false; let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch { /* */ } }, timeoutMs);
    child.stdout.on('data', (d) => { if (stdout.length < maxBuffer) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < maxBuffer) stderr += d; });
    child.on('error', (e) => finish({ code: -1, stdout, stderr, error: e.code === 'ENOENT' ? `not found: ${cmd}` : e.message }));
    child.on('close', (code) => finish({ code: code ?? -1, stdout, stderr, timedOut }));
    if (input) child.stdin.end(input); else child.stdin.end();
  });
}

/** Start a long-running program detached (used to launch After Effects). */
export function launchDetached(cmd, args = []) {
  if (!isAllowedExecutable(cmd)) return { ok: false, error: `executable not on allowlist: ${cmd}` };
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: false });
    child.on('error', () => {});
    child.unref();
    return { ok: true, pid: child.pid };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
