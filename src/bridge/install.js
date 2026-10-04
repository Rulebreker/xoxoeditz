import fs from 'node:fs';
import path from 'node:path';
import { buildHostBundle } from './host-bundle.js';
import { ensureDir, toAePath } from '../core/paths.js';

/**
 * Write the host bundle + listener script into the bridge dir. Optionally drop a tiny loader into After
 * Effects' Scripts/Startup so the listener starts with the application (needs write access to the install).
 */
export function installBridge(config, { install = null, startup = false } = {}) {
  const dir = ensureDir(config.bridgeDir);
  ensureDir(path.join(dir, 'inbox')); ensureDir(path.join(dir, 'outbox')); ensureDir(path.join(dir, 'jobs'));
  const bundle = buildHostBundle();
  const hostFile = path.join(dir, 'host.jsx');
  const listenerFile = path.join(dir, 'listener.jsx');
  fs.writeFileSync(hostFile, bundle);
  fs.writeFileSync(listenerFile, `${bundle}\nXOXO.startListener(${JSON.stringify(toAePath(dir))});\n`);
  const out = { dir, hostFile, listenerFile, startup: null };

  if (startup) {
    if (!install?.startupDir) {
      out.startup = { ok: false, error: 'After Effects Scripts/Startup folder not found' };
    } else {
      const loader = path.join(install.startupDir, 'xoxo_listener.jsx');
      const src = `// XOXOEDITZ listener loader (installed by \`xoxo bridge install --startup\`)\n#include ${JSON.stringify(toAePath(listenerFile))}\n`;
      try { fs.writeFileSync(loader, src); out.startup = { ok: true, file: loader }; }
      catch (e) { out.startup = { ok: false, error: `${e.code || e.message} — run your terminal as Administrator, or load listener.jsx manually (File > Scripts > Run Script File)` }; }
    }
  }
  return out;
}

export function stopListenerFile(config) {
  fs.writeFileSync(path.join(config.bridgeDir, 'STOP'), 'stop');
}
