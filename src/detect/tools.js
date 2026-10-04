import { run } from '../core/exec.js';

async function version(cmd, args, parse) {
  const r = await run(cmd, args, { timeoutMs: 8000 });
  if (r.error || r.code !== 0) return { available: false, path: cmd, error: r.error || (r.stderr || '').split('\n')[0] || `exit ${r.code}` };
  const text = (r.stdout || r.stderr).trim();
  return { available: true, path: cmd, version: parse ? parse(text) : text.split('\n')[0] };
}

export async function detectTools(config) {
  const [ffmpeg, ffprobe, python, whisper] = await Promise.all([
    version(config.ffmpeg, ['-version'], (t) => /version\s+(\S+)/.exec(t)?.[1] ?? t.split('\n')[0]),
    version(config.ffprobe, ['-version'], (t) => /version\s+(\S+)/.exec(t)?.[1] ?? t.split('\n')[0]),
    (async () => {
      for (const c of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
        const r = await version(c, ['--version']);
        if (r.available) return r;
      }
      return { available: false, error: 'python not found' };
    })(),
    version(config.whisper, ['--help'], () => 'present'),
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
