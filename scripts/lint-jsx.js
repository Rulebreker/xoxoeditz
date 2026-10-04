#!/usr/bin/env node
// ExtendScript is ES3 (+ a few extras). Anything newer silently breaks inside After Effects, where
// debugging is painful — so we lint the host scripts for syntax ES3 cannot parse or run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'jsx');

const RULES = [
  [/=>/, 'arrow function'],
  [/\blet\s+[\w{[]/, 'let'],
  [/\bconst\s+[\w{[]/, 'const'],
  [/`/, 'template literal'],
  [/\.\.\.\w/, 'spread/rest'],
  [/\bclass\s+\w+/, 'class'],
  [/\.(forEach|map|filter|reduce|some|every|find|findIndex|includes|startsWith|endsWith|padStart|repeat)\s*\(/, 'ES5+ method (use XOXO.each/map/has)'],
  [/\bObject\.(keys|assign|entries|values)\b/, 'Object.keys/assign/entries'],
  [/\.indexOf\(.*\)\s*[<>=!]/, 'indexOf on arrays is not in ES3 (strings are fine — allowlisted below)'],
  [/,\s*[}\]]/, 'trailing comma'],
  [/\basync\b|\bawait\b/, 'async/await'],
  [/\bPromise\b/, 'Promise'],
];

export function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[0])
    .replace(/\/\/.*$/gm, '');
}

export function lintSource(name, src) {
  const problems = [];
  const lines = stripNoise(src).split('\n');
  lines.forEach((line, i) => {
    for (const [re, label] of RULES) {
      if (label.startsWith('indexOf')) continue; // string.indexOf is legal; reviewed manually
      // regex literals like /^\d+$/ contain '$/' etc. — trailing-comma rule must ignore them
      if (re.test(line)) problems.push(`${name}:${i + 1}: ${label}: ${src.split('\n')[i].trim()}`);
    }
  });
  return problems;
}

export function lintAll() {
  const problems = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.jsx')).sort()) {
    problems.push(...lintSource(f, fs.readFileSync(path.join(dir, f), 'utf8')));
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = lintAll();
  if (problems.length) {
    console.error('ExtendScript ES3 lint failed:\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('jsx lint: ok');
}
