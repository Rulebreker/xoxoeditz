import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../core/paths.js';

export const JSX_DIR = path.join(REPO_ROOT, 'jsx');

/** Concatenate the host scripts (numeric order) into one self-contained ExtendScript bundle. */
export function buildHostBundle(dir = JSX_DIR) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsx')).sort();
  const parts = files.map((f) => `// ===== ${f} =====\n${fs.readFileSync(path.join(dir, f), 'utf8')}`);
  return `// XOXOEDITZ host bundle -- generated, do not edit. Source: jsx/*.jsx\n${parts.join('\n')}\n`;
}
