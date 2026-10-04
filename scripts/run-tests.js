#!/usr/bin/env node
// Cross-platform test runner (no shell globbing; works on Node 20+ and Windows cmd).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tests');
const filter = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js') && (!filter || f.includes(filter))).map((f) => path.join('tests', f));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
