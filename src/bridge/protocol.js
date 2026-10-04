import crypto from 'node:crypto';

export const newId = () => `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

export function makeRequest(op, args = {}, flags = {}) {
  return { id: newId(), op, args, flags };
}

/** A unit is an ordered list of ops that succeed or fail together. */
export function unit(id, ops, label = id) {
  return { id, label, ops: ops.map((o) => (Array.isArray(o) ? { op: o[0], args: o[1] || {} } : o)) };
}

export function normalizeResponse(res, op) {
  if (!res || typeof res !== 'object') {
    return { success: false, operation: op, error: 'empty or malformed response from host', recoverable: true, code: 'BAD_RESPONSE' };
  }
  return res;
}
