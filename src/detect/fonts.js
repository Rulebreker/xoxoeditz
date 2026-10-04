import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function fontDirs({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    const win = env.WINDIR || env.SystemRoot || 'C:\\Windows';
    return [path.join(win, 'Fonts'), env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts') : null].filter(Boolean);
  }
  if (platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library', 'Fonts')];
  return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.fonts'), path.join(home, '.local', 'share', 'fonts')];
}

/**
 * Cheap font inventory from font *file names* (family guesses). The authoritative list of
 * PostScript names comes from After Effects itself (`list_fonts` bridge op) when available.
 */
export function scanFontFiles(opts = {}, fsx = fs, limit = 20000) {
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 4 || files.length > limit) return;
    let entries; try { entries = fsx.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.(ttf|otf|ttc|woff2?)$/i.test(e.name)) files.push(e.name.replace(/\.[^.]+$/, ''));
    }
  };
  for (const d of fontDirs(opts)) walk(d, 0);
  return [...new Set(files)].sort();
}

export const hasFontLike = (fontFiles, needle) => fontFiles.some((f) => f.toLowerCase().replace(/[\s_-]/g, '').includes(String(needle).toLowerCase().replace(/[\s_-]/g, '')));
