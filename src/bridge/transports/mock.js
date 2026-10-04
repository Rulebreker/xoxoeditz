import { createMockAE } from '../mock-ae.js';

/** In-process transport backed by the mock After Effects DOM. Used for --dry-run and tests. */
export class MockTransport {
  constructor(options = {}) {
    this.name = 'mock';
    this.mock = options.mock || createMockAE(options);
  }
  async available() { return { ok: true }; }
  async send(request) { return this.mock.call(request); }
  async close() {}
}
