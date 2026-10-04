import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, toAePath } from '../../core/paths.js';
import { sleep, launchDetached, run } from '../../core/exec.js';
import { buildHostBundle } from '../host-bundle.js';

async function waitForFile(file, timeoutMs, pollMs = 120) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fs.existsSync(file)) {
      // host writes tmp+rename, so existence means complete; retry parse once for slow disks
      for (let i = 0; i < 5; i++) {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { await sleep(60); }
      }
    }
    await sleep(pollMs);
  }
  return null;
}

/**
 * One-shot transport: every request launches `AfterFX -r job.jsx` (macOS: DoScriptFile). If After Effects is
 * already running the script runs inside that instance; otherwise After Effects is started first.
 * Needs nothing installed inside After Effects, only "Allow Scripts to Write Files and Access Network".
 */
export class CliTransport {
  constructor({ config, afterfx, platform = process.platform, appName = null, isRunning = async () => false, logger }) {
    this.name = 'cli';
    this.config = config; this.afterfx = afterfx; this.platform = platform; this.appName = appName;
    this.isRunning = isRunning; this.logger = logger;
    this.dir = ensureDir(path.join(config.bridgeDir, 'jobs'));
    this._bundle = null;
  }
  async available() {
    if (!this.afterfx) return { ok: false, reason: 'After Effects executable not found' };
    return { ok: true };
  }
  get bundle() { return (this._bundle ??= buildHostBundle()); }

  async send(request, { timeoutMs } = {}) {
    const id = request.id;
    const jobFile = path.join(this.dir, `${id}.job.json`);
    const scriptFile = path.join(this.dir, `${id}.jsx`);
    const resultFile = path.join(this.dir, `${id}.result.json`);
    fs.writeFileSync(jobFile, JSON.stringify(request));
    fs.writeFileSync(scriptFile, `${this.bundle}\nXOXO.runJobFile(${JSON.stringify(toAePath(jobFile))});\n`);

    const wasRunning = await this.isRunning();
    const launched = await this._launch(scriptFile);
    if (!launched.ok) {
      return { id, success: false, operation: request.op, error: `could not launch After Effects: ${launched.error}`, recoverable: true, code: 'LAUNCH_FAILED' };
    }
    const limit = timeoutMs ?? (wasRunning ? this.config.timeouts.callMs : this.config.timeouts.coldStartMs);
    const res = await waitForFile(resultFile, limit);
    if (!res) {
      return {
        id, success: false, operation: request.op, recoverable: true, code: 'TIMEOUT',
        error: `no response from After Effects within ${Math.round(limit / 1000)}s. Is a modal dialog open? Is "Allow Scripts to Write Files and Access Network" enabled? (job kept at ${jobFile})`,
      };
    }
    for (const f of [jobFile, scriptFile, resultFile]) { try { fs.unlinkSync(f); } catch { /* */ } }
    return res;
  }

  async _launch(scriptFile) {
    if (this.platform === 'darwin') {
      const app = this.appName || 'Adobe After Effects';
      const r = await run('osascript', ['-e', `tell application "${app}" to DoScriptFile "${scriptFile.replace(/"/g, '\\"')}"`], { timeoutMs: 30000 });
      return r.error || r.code !== 0 ? { ok: false, error: r.error || r.stderr } : { ok: true };
    }
    return launchDetached(this.afterfx, ['-r', scriptFile]);
  }
  async close() {}
}

/**
 * Persistent transport: talks to the XOXO listener running inside After Effects
 * (jsx bundle + XOXO.startListener). Fast (no launch per call), needs one-time setup.
 */
export class ListenerTransport {
  constructor({ config, logger }) {
    this.name = 'listener';
    this.config = config; this.logger = logger;
    this.dir = config.bridgeDir;
    this.inbox = ensureDir(path.join(this.dir, 'inbox'));
    this.outbox = ensureDir(path.join(this.dir, 'outbox'));
  }
  heartbeat() {
    try {
      const hb = JSON.parse(fs.readFileSync(path.join(this.dir, 'heartbeat.json'), 'utf8'));
      return { ...hb, ageMs: Date.now() - hb.t };
    } catch { return null; }
  }
  async available() {
    const hb = this.heartbeat();
    if (hb?.alive && hb.ageMs < 5000) return { ok: true, heartbeat: hb };
    return { ok: false, reason: hb ? `listener heartbeat stale (${Math.round(hb.ageMs / 1000)}s)` : 'listener not running' };
  }
  async send(request, { timeoutMs } = {}) {
    const id = request.id;
    const tmp = path.join(this.inbox, `${id}.tmp`);
    const req = path.join(this.inbox, `${id}.req.json`);
    const resFile = path.join(this.outbox, `${id}.res.json`);
    fs.writeFileSync(tmp, JSON.stringify(request));
    fs.renameSync(tmp, req);
    const res = await waitForFile(resFile, timeoutMs ?? this.config.timeouts.callMs);
    if (!res) {
      try { fs.unlinkSync(req); } catch { /* not yet consumed: withdraw it so it can't run late */ }
      return { id, success: false, operation: request.op, recoverable: true, code: 'TIMEOUT', error: 'listener did not answer in time' };
    }
    try { fs.unlinkSync(resFile); } catch { /* */ }
    return res;
  }
  async close() {}
}
