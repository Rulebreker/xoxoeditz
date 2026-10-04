import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../scripts/gen-docs.js';
import { TOOLS } from '../src/mcp/server.js';
import { EDIT_TYPE_IDS } from '../src/edit-types/index.js';
import { TEMPLATE_NAMES } from '../src/compositing/templates.js';
import { BENCHMARK_IDS } from '../src/benchmark/specs.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('generated reference docs are fresh (run `node scripts/gen-docs.js` after changing profiles, effects, templates, rigs or checks)', () => {
  for (const [rel, text] of Object.entries(generate())) assert.equal(read(rel), text, `${rel} is stale`);
});

test('documentation covers the code: every MCP tool, every edit type, every template, every benchmark and every CLI command is documented', () => {
  const mcp = read('docs/MCP.md');
  for (const t of TOOLS) assert.ok(mcp.includes(t.name), `docs/MCP.md does not mention ${t.name}`);
  const types = read('docs/EDIT_TYPES.md'); for (const id of EDIT_TYPE_IDS) assert.ok(types.includes(`**${id}**`), `edit type ${id} missing from docs/EDIT_TYPES.md`);
  const shots = read('docs/SHOT_TEMPLATES.md'); for (const t of TEMPLATE_NAMES) assert.ok(shots.includes(`**${t}**`), `template ${t} missing`);
  const bench = read('docs/BENCHMARKS.md'); for (const b of BENCHMARK_IDS) assert.ok(bench.includes(`| \`${b}\``), `benchmark ${b} missing from docs/BENCHMARKS.md`);
  const help = read('src/cli/index.js'); const cmds = [...help.matchAll(/^\s{6}case '([a-z-]+)':/gm)].map((m) => m[1]);
  const readme = read('README.md') + read('docs/V4.md') + read('docs/INSTALLATION.md') + read('docs/SHOWCASE.md') + read('docs/DEVELOPMENT.md') + read('docs/MCP.md');
  for (const c of cmds) if (!['help', 'produce', 'selftest', 'sfx', 'bridge', 'config', 'setup', 'detect', 'effects', 'status', 'new', 'assets', 'narration', 'plan', 'verify', 'render', 'auto', 'showcase', 'mcp', 'doctor', 'project'].includes(c)) assert.ok(readme.includes(`xoxo ${c}`), `CLI command "${c}" is not documented`);
});

test('every relative link in the docs points at a file that exists', () => {
  const files = ['README.md', 'CLAUDE.md', ...fs.readdirSync(path.join(root, 'docs')).map((f) => `docs/${f}`)].filter((f) => f.endsWith('.md'));
  const bad = [];
  for (const f of files) {
    const text = read(f);
    for (const m of text.matchAll(/\]\((?!https?:|mailto:|#)([^)#\s]+)(?:#[^)]*)?\)/g)) {
      const target = path.resolve(path.dirname(path.join(root, f)), m[1]);
      if (!fs.existsSync(target)) bad.push(`${f} -> ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the docs do not over-claim: the autonomous engine is documented as unverified in real After Effects', () => {
  const v4 = read('docs/V4.md'); assert.match(v4, /Not verified/); assert.match(v4, /simulator/);
  assert.match(read('docs/BENCHMARKS.md'), /SIMULATED RUN/); assert.match(read('README.md'), /Not yet verified in a real After Effects/);
  assert.match(read('docs/BEATS.md'), /synthetic ground truth/); assert.match(read('docs/MOTION_AND_CAMERA.md'), /\*\*not\*\* real After Effects/);
});
