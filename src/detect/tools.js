import { run } from '../core/exec.js';
import { runTool } from '../core/resolve-tool.js';

async function version(cmd, args, parse) {
  const r = await run(cmd, args, { timeoutMs: 8000 });
  if (r.error || r.code !== 0) return { available: false, path: cmd, error: r.error || (r.stderr || '').split('\n')[0] || `exit ${r.code}` };
  const text = (r.stdout || r.stderr).trim();
  return { available: true, path: cmd, version: parse ? parse(text) : text.split('\n')[0] };
}

/** Confirm a resolved managed tool really runs, and report where it came from. */
async function probeManaged(config, name, args, parse) {
  const r = config.tools?.[name];
  if (!r?.ok) return { available: false, path: null, source: null, error: r?.error || `${name} not resolved`, tried: r?.tried || [] };
  const out = await runTool(config, name, args, { timeoutMs: 8000 });
  if (out.error || out.code !== 0) {
    return { available: false, path: r.path, source: r.source, error: `${r.path} was found but did not run: ${out.error || (out.stderr || '').split('\n')[0] || 'exit ' + out.code}`, tried: r.tried };
  }
  const text = (out.stdout || out.stderr).trim();
  return { available: true, path: r.path, source: r.source, version: parse ? parse(text) : text.split('\n')[0], warnings: r.warnings, tried: r.tried };
}

export async function detectTools(config) {
  const ver = (t) => /version\s+(\S+)/.exec(t)?.[1] ?? t.split('\n')[0];
  const [ffmpeg, ffprobe, python, whisper] = await Promise.all([
    probeManaged(config, 'ffmpeg', ['-version'], ver),
    probeManaged(config, 'ffprobe', ['-version'], ver),
    (async () => {
      for (const c of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
        const r = await version(c, ['--version']);
        if (r.available) return r;
      }
      return { available: false, error: 'python not found' };
    })(),
    probeManaged(config, 'whisper', ['--help'], () => 'present'),
  ]);
  return {
    node: { available: true, path: process.execPath, version: process.version },
    ffmpeg, ffprobe, python, whisper,
  };
}

export async function detectGpu(platform = process.platform) {
  if (platform === 'win32') {
    const r = await run('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join "|"'], { timeoutMs: 10000 });
    if (!r.error && r.code === 0 && r.stdout.trim()) return r.stdout.trim().split('|');
  }
  const r = await run('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { timeoutMs: 8000 });
  if (!r.error && r.code === 0 && r.stdout.trim()) return r.stdout.trim().split('\n');
  return [];
}

export async function isAeRunning(platform = process.platform) {
  if (platform === 'win32') {
    const r = await run('tasklist', ['/FI', 'IMAGENAME eq AfterFX.exe', '/FO', 'CSV', '/NH'], { timeoutMs: 8000 });
    return !r.error && /AfterFX\.exe/i.test(r.stdout);
  }
  if (platform === 'darwin') {
    const r = await run('pgrep', ['-f', 'Adobe After Effects'], { timeoutMs: 5000 });
    return !r.error && r.code === 0 && r.stdout.trim().length > 0;
  }
  return false;
}
