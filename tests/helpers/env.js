import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/core/config.js';

process.env.XOXO_TEST_ALLOW = [process.env.XOXO_TEST_ALLOW, 'fake-afterfx.mjs', 'fake-aerender.mjs'].filter(Boolean).join(',');

export function tmpDir(prefix = 'xoxo-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** An isolated workspace: own config, bridge dir, projects dir. */
export function testConfig(overrides = {}) {
  const root = tmpDir();
  const cfg = loadConfig({ cwd: root, env: {}, overrides: { transport: 'mock', ...overrides } });
  fs.mkdirSync(cfg.workspace, { recursive: true });
  return cfg;
}

export const FAKE_AE = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'fake-afterfx.mjs');
