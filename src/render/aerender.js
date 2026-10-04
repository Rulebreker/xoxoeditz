import { spawn } from 'node:child_process';
import { isAllowedExecutable } from '../core/exec.js';

/** Build aerender arguments (flags per the After Effects command-line reference). Frames are 0-based comp frames. */
export function buildAerenderArgs({ project, comp, output, rsTemplate, omTemplate, startFrame, endFrame, verbose = 'ERRORS_AND_PROGRESS' }) {
  const a = ['-project', project, '-comp', comp, '-output', output];
  if (rsTemplate) a.push('-RStemplate', rsTemplate);
  if (omTemplate) a.push('-OMtemplate', omTemplate);
  if (startFrame !== undefined) a.push('-s', String(startFrame));
  if (endFrame !== undefined) a.push('-e', String(endFrame));
  a.push('-v', verbose);
  return a;
}

export function parseAerenderLine(line) {
  const p = /PROGRESS:\s+(\d+):(\d+):(\d+):(\d+)\s+\((\d+)\)/.exec(line);
  if (p) return { type: 'progress', frame: Number(p[5]) };
  if (/PROGRESS:\s+Finished composition/i.test(line)) return { type: 'finished' };
  if (/aerender ERROR|After Effects error|Error:/i.test(line)) return { type: 'error', message: line.trim() };
  return null;
}

/** Run aerender, streaming progress. Never throws. */
export function runAerender(exe, args, { onProgress = () => {}, timeoutMs = 6 * 3600 * 1000 } = {}) {
  return new Promise((resolve) => {
    if (!isAllowedExecutable(exe)) return resolve({ code: -1, errors: [`executable not on allowlist: ${exe}`], frames: 0 });
    const errors = []; let frames = 0; let finished = false; let tail = '';
    let child;
    try { child = spawn(exe, args, { shell: false, windowsHide: true }); } catch (e) { return resolve({ code: -1, errors: [e.message], frames: 0 }); }
    const timer = setTimeout(() => { errors.push(`aerender exceeded ${Math.round(timeoutMs / 1000)}s`); child.kill('SIGKILL'); }, timeoutMs);
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        tail = (tail + '\n' + line).slice(-4000);
        const ev = parseAerenderLine(line);
        if (ev?.type === 'progress') { frames = Math.max(frames, ev.frame + 1); onProgress({ frame: ev.frame }); }
        else if (ev?.type === 'finished') finished = true;
        else if (ev?.type === 'error') errors.push(ev.message);
      }
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, errors: [e.code === 'ENOENT' ? `not found: ${exe}` : e.message], frames }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, errors, frames, finished, tail }); });
  });
}
