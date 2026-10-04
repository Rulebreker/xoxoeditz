import { fx } from '../effects/fx.js';

const GAUSS = fx('ADBE Gaussian Blur 2', 'Gaussian Blur'); const BOX = fx('ADBE Fast Box Blur', 'Fast Box Blur');
const blurOp = (matchName, tag) => (c, r) => [['layer_effect_add', { comp: c.comp, layer: c.layer, matchName: r.effects[matchName], name: 'Blur', tag, params: matchName === BOX.matchName ? { 'Blur Radius': c.amount ?? 12 } : { Blurriness: c.amount ?? 12 } }]];

/** Soft background blur for depth layers, with a fallback chain that ends on "no blur" (the layer is just left sharp). */
export const COMPOSITING_ENTRIES = {
  'vfx.blur': { category: 'vfx', description: 'Background blur for depth separation.', implementations: [
    { id: 'gaussian', quality: 1, requires: { effects: [GAUSS] }, build: blurOp(GAUSS.matchName, 'blur') },
    { id: 'box', quality: 0.7, requires: { effects: [BOX] }, build: blurOp(BOX.matchName, 'blur') },
    { id: 'none', quality: 0, requires: {}, build: () => [] },
  ] },
};
