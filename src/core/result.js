// Structured status for every major operation. Nothing in XOXOEDITZ fails silently:
// callers get { success, operation, ... } and decide whether to recover.

export function ok(operation, data = {}, extra = {}) {
  return { success: true, operation, ...extra, data };
}

export function fail(operation, error, extra = {}) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    operation,
    error: message,
    recoverable: extra.recoverable ?? true,
    ...(extra.code ? { code: extra.code } : {}),
    ...(extra.data !== undefined ? { data: extra.data } : {}),
  };
}

/** Run fn and convert throws into a failed result. */
export async function attempt(operation, fn, extra = {}) {
  try {
    const out = await fn();
    if (out && typeof out === 'object' && 'success' in out) return out;
    return ok(operation, out);
  } catch (e) {
    return fail(operation, e, extra);
  }
}
