import fs from 'node:fs';
import crypto from 'node:crypto';

/**
 * Fast content fingerprint for dedupe and caching: size + first/last 256 KB, SHA-1. Read-only.
 * (Not a security hash; two different files that agree on size and both ends are astronomically unlikely.)
 */
export function fingerprintFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const h = crypto.createHash('sha1');
    h.update(String(size));
    const chunk = 256 * 1024;
    const a = Buffer.alloc(Math.min(chunk, size));
    fs.readSync(fd, a, 0, a.length, 0);
    h.update(a);
    if (size > chunk) {
      const b = Buffer.alloc(Math.min(chunk, size - chunk));
      fs.readSync(fd, b, 0, b.length, Math.max(chunk, size - chunk));
      h.update(b);
    }
    return h.digest('hex').slice(0, 20);
  } finally { fs.closeSync(fd); }
}
