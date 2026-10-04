/** Declare a native After Effects effect requirement by match name, with a display-name fallback for lookup. */
export const fx = (matchName, displayName) => ({ matchName, displayName });
export const T = (t, v) => ({ t, v });
export const key = (comp, layer, prop, keys, ease = 'easeOut') => ['keyframes', { comp, layer, prop, keys, ease }];
