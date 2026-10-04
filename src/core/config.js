import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './paths.js';

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
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  whisper: 'whisper',
  allowRawEval: false, // lets Claude run arbitrary ExtendScript. Off by default.
  allowInstall: false, // unattended plugin/software install. Off by default; see docs.
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
  if (env.XOXO_FFMPEG) cfg.ffmpeg = env.XOXO_FFMPEG;
  if (env.XOXO_FFPROBE) cfg.ffprobe = env.XOXO_FFPROBE;
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
  cfg.capabilitiesFile = path.join(cfg.workspace, 'capabilities.json');
  return cfg;
}
