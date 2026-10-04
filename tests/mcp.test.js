import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolList, handleMessage } from '../src/mcp/server.js';
import { createContext } from '../src/app/services.js';
import { tmpDir, baseEnv } from './helpers/env.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'xoxo.js');

test('tool definitions are well-formed', () => {
  const tools = toolList();
  assert.ok(tools.length >= 12);
  for (const t of tools) {
    assert.match(t.name, /^xoxo_[a-z_]+$/);
    assert.ok(t.description.length > 20, t.name);
    assert.equal(t.inputSchema.type, 'object');
  }
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
});

test('handleMessage: initialize, list, call, unknown method', async () => {
  const ctx = createContext({ cwd: tmpDir(), env: baseEnv(), overrides: { transport: 'mock' } });
  const init = await handleMessage(ctx, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(init.result.serverInfo.name, 'xoxoeditz');
  assert.equal(await handleMessage(ctx, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const ops = await handleMessage(ctx, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'xoxo_ae_ops', arguments: {} } });
  assert.equal(ops.result.isError, false);
  assert.ok(JSON.parse(ops.result.content[0].text).data.keyframes);
  const call = await handleMessage(ctx, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'xoxo_ae_call', arguments: { op: 'comp_ensure', args: { name: 'X', width: 100, height: 100, fps: 24, duration: 1 }, dryRun: true } } });
  assert.equal(JSON.parse(call.result.content[0].text).success, true);
  const bad = await handleMessage(ctx, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(bad.result.isError, true);
  const unk = await handleMessage(ctx, { jsonrpc: '2.0', id: 5, method: 'bogus' });
  assert.equal(unk.error.code, -32601);
});

test('stdio server speaks newline-delimited JSON-RPC and keeps stdout clean', async () => {
  const child = spawn(process.execPath, [BIN, 'mcp'], { cwd: tmpDir(), env: { ...process.env, XOXO_TRANSPORT: 'mock' } });
  const out = [];
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { out.push(buf.slice(0, i)); buf = buf.slice(i + 1); } });
  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  for (let i = 0; i < 50 && out.length < 2; i++) await new Promise((r) => setTimeout(r, 100));
  child.kill();
  assert.equal(out.length, 2);
  for (const line of out) assert.doesNotThrow(() => JSON.parse(line), 'every stdout line is JSON');
  assert.ok(JSON.parse(out[1]).result.tools.some((t) => t.name === 'xoxo_edit'));
});
