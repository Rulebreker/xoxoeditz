import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './paths.js';
import { resolveAllTools } from './resolve-tool.js';

const bool = (v) => v === '1' || v === 'true' || v === 'yes';

export const DEFAULTS = {
  workspace: '.xoxo',
  projectsDir: 'projects',
  assetsDir: 'assets',
  bridgeDir: null, // default: <workspace>/bridge
  transport: 'auto', // auto | listener | cli | mock
  aePath: null, // explicit AfterFX binary OR install root
  aerenderPath: null,
  mediaEncoderPath: null,
  // null = not set explicitly. Resolution (config -> XOXO_* env -> PATH) happens in src/core/resolve-tool.js.
  ffmpeg: null,
  ffprobe: null,
  whisper: null,
  // What to do when After Effects has ANOTHER XOXOEDITZ project open with unsaved changes: 'save' (default) | 'discard'.
  // This never applies to somebody else's project - those are only ever discarded by an explicit --discard.
  dirtyXoxoPolicy: 'save',
  allowRawEval: false, // lets Claude run arbitrary ExtendScript. Off by default.
  allowInstall: false, // unattended plugin/software install. Off by default; see docs.
  libraryRoot: null, // universal asset library (XOXOEDITZ_ASSETS); env XOXOEDITZ_ASSETS / XOXO_LIBRARY
  extraAdobeRoots: [],
  logLevel: 'info',
  timeouts: { callMs: 120000, coldStartMs: 300000, renderMs: 6 * 3600 * 1000 },
};

export function loadConfig({ cwd = REPO_ROOT, env = process.env, overrides = {} } = {}) {
  let fileCfg = {};
  const cfgPath = env.XOXO_CONFIG || path.join(cwd, 'xoxo.config.json');
  try { fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { /* optional */ }

  const cfg = { ...DEFAULTS, ...fileCfg, ...overrides, timeouts: { ...DEFAULTS.timeouts, ...(fileCfg.timeouts || {}), ...(overrides.timeouts || {}) } };

  if (env.XOXO_AE_PATH) cfg.aePath = env.XOXO_AE_PATH;
  if (env.XOXO_AERENDER_PATH) cfg.aerenderPath = env.XOXO_AERENDER_PATH;
  // XOXO_FFMPEG / XOXO_FFPROBE / XOXO_WHISPER are read by the tool resolver, below the explicit config value.
  if (env.XOXO_LIBRARY || env.XOXOEDITZ_ASSETS) cfg.libraryRoot = env.XOXO_LIBRARY || env.XOXOEDITZ_ASSETS;
  if (env.XOXO_TRANSPORT) cfg.transport = env.XOXO_TRANSPORT;
  if (env.XOXO_BRIDGE_DIR) cfg.bridgeDir = env.XOXO_BRIDGE_DIR;
  if (env.XOXO_WORKSPACE) cfg.workspace = env.XOXO_WORKSPACE;
  if (env.XOXO_LOG_LEVEL) cfg.logLevel = env.XOXO_LOG_LEVEL;
  if (env.XOXO_ALLOW_RAW_EVAL !== undefined) cfg.allowRawEval = bool(env.XOXO_ALLOW_RAW_EVAL);
  if (env.XOXO_ALLOW_INSTALL !== undefined) cfg.allowInstall = bool(env.XOXO_ALLOW_INSTALL);

  const abs = (p) => (path.isAbsolute(p) ? p : path.join(cwd, p));
  cfg.root = cwd;
  cfg.workspace = abs(cfg.workspace);
  cfg.projectsDir = abs(cfg.projectsDir);
  cfg.assetsDir = abs(cfg.assetsDir);
  cfg.bridgeDir = cfg.bridgeDir ? abs(cfg.bridgeDir) : path.join(cfg.workspace, 'bridge');
  cfg.logDir = path.join(cfg.workspace, 'logs');
  // library: explicit setting, else ./XOXOEDITZ_ASSETS next to the repo when it exists
  if (!cfg.libraryRoot && fs.existsSync(path.join(cwd, 'XOXOEDITZ_ASSETS'))) cfg.libraryRoot = 'XOXOEDITZ_ASSETS';
  cfg.libraryRoot = cfg.libraryRoot ? abs(cfg.libraryRoot) : null;
  cfg.libraryDir = path.join(cfg.workspace, 'library');
  cfg.libraryManifest = path.join(cfg.libraryDir, 'universal-assets.manifest.json');
  cfg.memoryFile = path.join(cfg.workspace, 'memory.json');
  cfg.capabilitiesFile = path.join(cfg.workspace, 'capabilities.json');
  cfg.tools = resolveAllTools(cfg, env); // { ffmpeg, ffprobe, whisper } -> { ok, path, source, tried, ... }
  return cfg;
}
