import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

export const FAKE_AE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fake-afterfx.mjs');
/** Tests that spawn shebang scripts as fake executables cannot run on Windows. */
export const NO_FAKE_EXE = process.platform === 'win32' ? 'fake executables need a POSIX shell' : false;
