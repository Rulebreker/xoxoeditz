import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir } from './helpers/env.js';
import { hasFfmpeg, makeAssetFolder } from './helpers/media.js';
import { asciiJson } from '../src/core/paths.js';
import { lintSource } from '../scripts/lint-jsx.js';
import { CliTransport } from '../src/bridge/transports/files.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'xoxo.js');
const xoxo = (root, args, extraEnv = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, XOXO_ROOT: root, XOXO_TRANSPORT: 'auto', ...extraEnv } });

test('asciiJson escapes non-ASCII so generated .jsx is encoding-proof', () => {
  const s = asciiJson('C:/Users/José Müller/日本/x.json');
  assert.match(s, /^"[\x00-\x7f]*"$/);
  assert.equal(JSON.parse(s), 'C:/Users/José Müller/日本/x.json');
  assert.ok(lintSource('x.jsx', '// caf\u00e9').some((p) => /non-ASCII/.test(p)));
});

test('one-shot job script embeds an ASCII-only job path', async () => {
  const root = tmpDir();
  const dir = path.join(root, 'José');
  fs.mkdirSync(dir, { recursive: true });
  let launched = null;
  const t = new CliTransport({ config: { bridgeDir: dir, timeouts: { callMs: 50, coldStartMs: 50 } }, afterfx: '/bin/true', platform: 'linux' });
  t._launch = async (script) => { launched = fs.readFileSync(script, 'utf8'); return { ok: true }; };
  await t.send({ id: 'abc', op: 'ping', args: {} }, { timeoutMs: 50 });
  assert.match(launched, /XOXO\.runJobFile\("[\x00-\x7f]*"\)/);
  assert.match(launched, /Jos\\u00e9/);
  assert.ok(!/[^\x00-\x7f]/.test(launched), 'entire generated script is ASCII');
});

test('cli: help, unknown command, doctor exits non-zero without After Effects', () => {
  const root = tmpDir();
  assert.match(xoxo(root, ['help']).stdout, /autonomous After Effects/);
  const unk = xoxo(root, ['frobnicate']);
  assert.equal(unk.status, 2);
  const d = xoxo(root, ['doctor', '--json']);
  const j = JSON.parse(d.stdout);
  assert.equal(j.operation, 'doctor');
  assert.ok(j.data.checks.some((c) => c.name === 'Node.js' && c.status === 'ok'));
});

test('cli: auto --dry-run end to end, status, plan validation errors are printed', { skip: !hasFfmpeg }, () => {
  const root = tmpDir();
  const assets = makeAssetFolder(path.join(root, 'media'));
  fs.writeFileSync(path.join(assets, 'script.txt'), 'A short test narration. It has two sentences, and a third.');
  const r = xoxo(root, ['auto', 'smoke', '--assets', assets, '--brief', 'tech explainer', '--resolution', '720p', '--dry-run', '--script', path.join(assets, 'script.txt')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /QA PASSED/);
  const st = xoxo(root, ['status', 'smoke']).stdout;
  assert.match(st, /dry-run/);
  assert.match(st, /not built/);
  // break the plan and look at the error output
  const pp = path.join(root, 'projects', 'smoke', 'plan.json');
  const plan = JSON.parse(fs.readFileSync(pp, 'utf8'));
  plan.scenes[0].clips[0].asset = 'NOPE';
  fs.writeFileSync(pp, JSON.stringify(plan));
  const v = xoxo(root, ['plan', 'smoke', '--validate']);
  assert.equal(v.status, 1);
  assert.match(v.stdout, /unknown asset "NOPE"/);
  const e = xoxo(root, ['effects', '--json']);
  assert.equal(JSON.parse(e.stdout).success, true);
});

test('cli: new/assets/narration/plan scaffold flow with --json', { skip: !hasFfmpeg }, () => {
  const root = tmpDir();
  const assets = makeAssetFolder(path.join(root, 'media'));
  const run = (...a) => JSON.parse(xoxo(root, [...a, '--json']).stdout);
  assert.equal(run('new', 'p1', '--assets', assets).success, true);
  const scan = run('assets', 'p1');
  assert.equal(scan.success, true);
  assert.ok(scan.data.assets.some((a) => a.id === 'NARR_NARRATION'));
  const nar = run('narration', 'p1');
  assert.equal(nar.success, true);
  assert.equal(nar.data.transcript.method, 'none');
  const plan = run('plan', 'p1', '--scaffold', '--title', 'T', '--brief', 'military documentary');
  assert.equal(plan.success, true);
  assert.equal(plan.data.style, 'military-documentary');
  const again = run('plan', 'p1', '--scaffold');
  assert.equal(again.success, false);
  assert.match(again.error, /already exists/);
});
