import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAE } from '../src/bridge/mock-ae.js';
import { OPS_DOC } from '../src/bridge/ops-doc.js';

test('every host op is documented, and every documented op exists', () => {
  const ops = createMockAE().run('Object.keys(XOXO.ops).join(",")').split(',').sort();
  assert.deepEqual(Object.keys(OPS_DOC).sort(), ops);
  for (const [name, d] of Object.entries(OPS_DOC)) assert.ok(d.args && d.doc && d.group, `${name} doc incomplete`);
});
