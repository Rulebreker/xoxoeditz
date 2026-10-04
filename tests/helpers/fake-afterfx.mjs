#!/usr/bin/env node
// Test double for AfterFX.exe. Behaves like the real single-instance application:
//   fake-afterfx -r script.jsx
// If an instance is alive the script is forwarded to it; otherwise this process becomes the instance
// (after an optional simulated cold start), runs scripts inside the mock AE DOM, and idles out.
import fs from 'node:fs';
import path from 'node:path';
import { createMockAE } from '../../src/bridge/mock-ae.js';

const state = process.env.FAKE_AE_STATE;
if (!state) { console.error('FAKE_AE_STATE required'); process.exit(2); }
fs.mkdirSync(path.join(state, 'queue'), { recursive: true });
const args = process.argv.slice(2);
const script = args[args.indexOf('-r') + 1];
const pidFile = path.join(state, 'pid');
const alive = () => {
  try { const pid = Number(fs.readFileSync(pidFile, 'utf8')); process.kill(pid, 0); return pid !== process.pid; } catch { return false; }
};
const enqueue = (s) => fs.writeFileSync(path.join(state, 'queue', `${Date.now()}-${Math.random().toString(16).slice(2)}.q`), s);

if (alive()) { if (script) enqueue(script); process.exit(0); }

fs.writeFileSync(pidFile, String(process.pid));
fs.appendFileSync(path.join(state, 'launches.log'), `${new Date().toISOString()} launch\n`);
if (script) enqueue(script);
const cold = Number(process.env.FAKE_AE_COLD_MS || 0);
const mock = createMockAE({ allowFileAccess: process.env.FAKE_AE_NO_FILE_ACCESS !== '1' });
let idleSince = Date.now();
const start = Date.now();

const tick = () => {
  if (fs.existsSync(path.join(state, 'quit'))) { try { fs.unlinkSync(pidFile); } catch { /* */ } process.exit(0); }
  if (Date.now() - start >= cold) {
    const q = fs.readdirSync(path.join(state, 'queue')).sort();
    for (const f of q) {
      const qf = path.join(state, 'queue', f);
      const s = fs.readFileSync(qf, 'utf8'); fs.unlinkSync(qf);
      try {
        if (process.env.FAKE_AE_NO_FILE_ACCESS === '1') continue; // simulate scripts unable to write results
        mock.run(fs.readFileSync(s, 'utf8'), s);
      } catch (e) { fs.appendFileSync(path.join(state, 'errors.log'), `${e.stack}\n`); }
      idleSince = Date.now();
    }
    mock.pump(Date.now());
  }
  if (Date.now() - idleSince > 30000) { try { fs.unlinkSync(pidFile); } catch { /* */ } process.exit(0); }
  setTimeout(tick, 40);
};
tick();
