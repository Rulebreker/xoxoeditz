import { makeRequest, normalizeResponse } from './protocol.js';
import { MockTransport } from './transports/mock.js';
import { CliTransport, ListenerTransport } from './transports/files.js';
import { findAfterEffects } from '../detect/adobe.js';
import { isAeRunning } from '../detect/tools.js';
import { nullLogger } from '../core/logger.js';

/**
 * Pick a transport. Order for `auto`: live listener -> one-shot CLI -> error (mock only when asked for).
 */
export async function selectTransport(config, { logger = nullLogger, mock = null, install = undefined } = {}) {
  const want = config.transport;
  if (mock || want === 'mock') return new MockTransport(mock ? { mock } : {});

  if (want === 'auto' || want === 'listener') {
    const l = new ListenerTransport({ config, logger });
    if ((await l.available()).ok) return l;
    if (want === 'listener') throw new Error('transport "listener" requested but no live listener found. Run `xoxo bridge install`, then File > Scripts > Run Script File > .xoxo/bridge/listener.jsx in After Effects.');
  }
  if (want === 'auto' || want === 'cli') {
    const inst = install === undefined ? findAfterEffects({ extraRoots: config.extraAdobeRoots, explicit: config.aePath })[0] : install;
    const afterfx = inst?.afterfx;
    const t = new CliTransport({ config, afterfx, appName: inst?.name, isRunning: () => isAeRunning(), logger });
    if ((await t.available()).ok) return t;
  }
  throw new Error('No way to reach After Effects: it was not found and no listener is running. Run `xoxo doctor`, set XOXO_AE_PATH, or use --dry-run to use the built-in simulator.');
}

export class Bridge {
  constructor(transport, { config, logger = nullLogger }) {
    this.transport = transport; this.config = config; this.logger = logger;
    this.history = [];
  }
  get transportName() { return this.transport.name; }

  async call(op, args = {}, { timeoutMs } = {}) {
    if (op === 'raw_eval' && !this.config.allowRawEval) {
      return { success: false, operation: op, error: 'raw_eval is disabled. Set "allowRawEval": true in xoxo.config.json to enable arbitrary ExtendScript.', recoverable: false, code: 'DISABLED' };
    }
    const req = makeRequest(op, args, { rawEval: Boolean(this.config.allowRawEval) });
    const t0 = Date.now();
    let res;
    try {
      res = normalizeResponse(await this.transport.send(req, { timeoutMs }), op);
    } catch (e) {
      res = { id: req.id, success: false, operation: op, error: e.message, recoverable: true, code: 'TRANSPORT_ERROR' };
    }
    this.logger[res.success ? 'debug' : 'warn'](`bridge ${op}`, { ok: res.success, ms: Date.now() - t0, transport: this.transport.name, error: res.error });
    this.history.push({ op, ok: res.success, error: res.error, ms: Date.now() - t0 });
    return res;
  }

  /** Run units (atomic groups of ops) in one round trip. */
  async batch(units, { stopOnError = false, timeoutMs } = {}) {
    return this.call('batch', { units, stopOnError }, { timeoutMs });
  }

  async ping() { return this.call('ping', {}, { timeoutMs: this.transport.name === 'cli' ? this.config.timeouts.coldStartMs : 15000 }); }
  async close() { await this.transport.close?.(); }
}

export async function createBridge(config, opts = {}) {
  const transport = await selectTransport(config, opts);
  return new Bridge(transport, { config, logger: opts.logger });
}
