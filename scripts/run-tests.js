#!/usr/bin/env node
// Cross-platform test runner (no shell globbing; works on Node 20+ and Windows cmd).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tests');
// --fast skips the suites that generate media and run whole productions (~3 min together); CI and releases run everything.
const HEAVY = ['benchmark.test.js', 'produce.test.js'];
const fast = process.argv.includes('--fast');
const filter = process.argv.slice(2).find((a) => !a.startsWith('--'));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js') && (!filter || f.includes(filter)) && !(fast && HEAVY.includes(f))).map((f) => path.join('tests', f));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
