/**
 * Look up an effect in the registry of installed effects by match name first, then display name
 * (display names are localized, match names are not — so match name wins). Returns the real matchName or null.
 */
export function findEffect(caps, { matchName, displayName }) {
  const e = caps?.effects;
  if (!e?.known) return null;
  if (e.byMatchName[matchName]) return matchName;
  if (displayName) {
    for (const [mn, info] of Object.entries(e.byMatchName)) if (info.displayName === displayName) return mn;
  }
  return null;
}
