import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createBridge, selectTransport } from '../src/bridge/client.js';
import { installBridge } from '../src/bridge/install.js';
import { testConfig, tmpDir, FAKE_AE } from './helpers/env.js';
import { sleep } from '../src/core/exec.js';

const states = [];
function freshState(extra = {}) {
  const dir = tmpDir('fakeae-');
  states.push(dir);
  process.env.FAKE_AE_STATE = dir;
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
  return dir;
}
after(async () => {
  for (const s of states) { try { fs.writeFileSync(path.join(s, 'quit'), '1'); } catch { /* */ } }
  await sleep(150);
  for (const k of ['FAKE_AE_COLD_MS', 'FAKE_AE_NO_FILE_ACCESS']) delete process.env[k];
});

test('mock transport: bridge call, batch, raw_eval gating', async () => {
  const cfg = testConfig({ transport: 'mock' });
  const b = await createBridge(cfg);
  assert.equal(b.transportName, 'mock');
  assert.equal((await b.ping()).success, true);
  const r = await b.batch([{ id: 'u', ops: [{ op: 'folder_ensure', args: { path: 'X' } }] }]);
  assert.equal(r.data.allSucceeded, true);
  const raw = await b.call('raw_eval', { code: '1' });
  assert.equal(raw.code, 'DISABLED');
  const cfg2 = testConfig({ transport: 'mock', allowRawEval: true });
  const b2 = await createBridge(cfg2);
  assert.equal((await b2.call('raw_eval', { code: '40+2' })).data.value, '42');
});

test('cli transport: cold start, then forwarding to the running instance', async () => {
  const state = freshState({ FAKE_AE_COLD_MS: '300' });
  const cfg = testConfig({ transport: 'cli', aePath: FAKE_AE, timeouts: { callMs: 8000, coldStartMs: 15000, renderMs: 1000 } });
  const b = await createBridge(cfg);
  assert.equal(b.transportName, 'cli');
  const t0 = Date.now();
  const first = await b.ping();
  assert.equal(first.success, true, first.error);
  assert.ok(Date.now() - t0 >= 250, 'cold start was simulated');
  // state persists inside the "running" application between calls
  assert.equal((await b.call('comp_ensure', { name: 'C1', width: 640, height: 360, fps: 24, duration: 2 })).success, true);
  const info = await b.call('project_info');
  assert.deepEqual(info.data.comps, ['C1']);
  const launches = fs.readFileSync(path.join(state, 'launches.log'), 'utf8').trim().split('\n');
  assert.equal(launches.length, 1, 'application launched exactly once');
  assert.deepEqual(fs.readdirSync(path.join(cfg.bridgeDir, 'jobs')), [], 'job files cleaned up');
  await b.close();
});

test('cli transport: unanswered job reports TIMEOUT with the actionable cause', async () => {
  freshState({ FAKE_AE_NO_FILE_ACCESS: '1' });
  const cfg = testConfig({ transport: 'cli', aePath: FAKE_AE, timeouts: { callMs: 900, coldStartMs: 900, renderMs: 1000 } });
  const b = await createBridge(cfg);
  const r = await b.call('ping');
  assert.equal(r.success, false);
  assert.equal(r.code, 'TIMEOUT');
  assert.match(r.error, /Allow Scripts to Write Files/);
  assert.equal(r.recoverable, true);
  delete process.env.FAKE_AE_NO_FILE_ACCESS;
});

test('listener transport: install, start inside the app, auto-selected over cli', async () => {
  const state = freshState();
  const cfg = testConfig({ transport: 'auto', aePath: FAKE_AE, timeouts: { callMs: 8000, coldStartMs: 8000, renderMs: 1000 } });
  const inst = installBridge(cfg);
  assert.ok(fs.existsSync(inst.listenerFile));
  assert.match(fs.readFileSync(inst.listenerFile, 'utf8'), /XOXO\.startListener\(/);

  // Start the "application" running the listener script, like File > Scripts > Run Script File.
  const child = spawn(FAKE_AE, ['-r', inst.listenerFile], { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  for (let i = 0; i < 60; i++) {
    if (fs.existsSync(path.join(cfg.bridgeDir, 'heartbeat.json'))) break;
    await sleep(100);
  }
  const t = await selectTransport(cfg);
  assert.equal(t.name, 'listener');
  const b = await createBridge(cfg);
  const r = await b.call('comp_ensure', { name: 'LST', width: 320, height: 180, fps: 24, duration: 1 });
  assert.equal(r.success, true, r.error);
  assert.deepEqual((await b.call('project_info')).data.comps, ['LST']);
  assert.equal(fs.readdirSync(path.join(cfg.bridgeDir, 'inbox')).length, 0);
  assert.equal(fs.existsSync(path.join(state, 'launches.log')) && fs.readFileSync(path.join(state, 'launches.log'), 'utf8').trim().split('\n').length, 1);
});

test('selectTransport explains how to proceed when nothing is reachable', async () => {
  const cfg = testConfig({ transport: 'auto' });
  await assert.rejects(() => selectTransport(cfg, { install: null }), /No way to reach After Effects/);
});

test('startup installer reports missing Startup folder without throwing', () => {
  const cfg = testConfig();
  const r = installBridge(cfg, { install: { startupDir: null }, startup: true });
  assert.equal(r.startup.ok, false);
  const dir = tmpDir();
  const r2 = installBridge(cfg, { install: { startupDir: dir }, startup: true });
  assert.equal(r2.startup.ok, true);
  assert.match(fs.readFileSync(r2.startup.file, 'utf8'), /#include ".*listener\.jsx"/);
});
