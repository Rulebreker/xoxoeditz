// Seeded randomness: "controlled variation" must be reproducible (same seed -> same edit) so builds are
// idempotent and bugs can be reproduced.

export function hashSeed(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function makeRng(...seedParts) {
  const next = mulberry32(hashSeed(...seedParts));
  const rng = () => next();
  rng.range = (lo, hi) => lo + (hi - lo) * next();
  rng.int = (lo, hi) => Math.floor(rng.range(lo, hi + 1));
  rng.pick = (arr) => arr[Math.floor(next() * arr.length)];
  rng.chance = (p) => next() < p;
  rng.weighted = (items, weightOf = (x) => x.w) => {
    const total = items.reduce((a, b) => a + Math.max(0, weightOf(b)), 0);
    if (total <= 0) return items[Math.floor(next() * items.length)];
    let r = next() * total;
    for (const it of items) { r -= Math.max(0, weightOf(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  };
  rng.fork = (...more) => makeRng(...seedParts, ...more);
  return rng;
}
