// Shared fixtures for Director / creative-QA / tier tests: a project manifest with visual analysis, the starter SFX
// library plus two music tracks, a real beat map from the synthetic track, and the effect list of a full machine.
import { tmpDir, testConfig } from './env.js';
import { generateStarterSfx } from '../../src/library/starter.js';
import { scanLibrary } from '../../src/library/scan.js';
import { synthTrack } from '../../src/audio/synth-music.js';
import { analyzeSamples } from '../../src/beat/analyze.js';
import { resolveDirective } from '../../src/director/config.js';

export const NAMES = ['ADBE Motion Blur', 'CC Radial Fast Blur', 'ADBE Exposure2', 'ADBE Wave Warp', 'ADBE Turbulent Displace', 'ADBE Ramp', 'ADBE Linear Wipe', 'ADBE Tint', 'ADBE HUE SATURATION', 'ADBE Brightness & Contrast 2'];
export const CAPS = { effects: { known: true, byMatchName: Object.fromEntries(NAMES.map((n) => [n, { displayName: n }])) } };

export function projectManifest(n = 12, { videoShare = 0.75, w = 3840, h = 2160 } = {}) {
  const assets = [];
  for (let i = 0; i < n; i++) {
    const video = i < Math.round(n * videoShare);
    const hash = ((i + 1) * 2654435761 >>> 0).toString(16).padStart(8, '0') + ((i + 1) * 40503 >>> 0).toString(16).padStart(8, '0');
    assets.push({ id: `${video ? 'VID' : 'IMG'}_ASSET_${String(i + 1).padStart(2, '0')}`, type: video ? 'video' : 'image', role: 'broll', relPath: `${video ? 'clip' : 'photo'}${i + 1}.${video ? 'mp4' : 'jpg'}`, path: `/x/${i}`, description: ['stealth fighter jet on the apron at dawn', 'close detail of canopy and fuselage panel', 'wide shot of airbase hangars'][i % 3], keywords: [], meta: { width: w, height: h, duration: video ? 14 + (i % 4) * 4 : 0, fps: 24, hasAudio: video, isStill: !video },
      visual: { brightness: 0.2 + ((i * 37) % 70) / 100, contrast: 0.1 + ((i * 13) % 25) / 100, colorfulness: ((i * 11) % 50) / 100, hue: (i * 47) % 360, saturation: 0.4, subject: { x: 0.3 + (i % 3) * 0.1, y: 0.25, w: 0.22, h: 0.4, conf: i % 4 === 3 ? 0.1 : 0.6 }, motion: { avg: 0.01 + (i % 5) * 0.02, peak: 0.1, curve: [], bestWindow: { start: 1.5 + (i % 3), duration: 2, motion: 0.05 } }, hash, tags: [] } });
  }
  return { assets };
}

let libP; export function library() {
  return libP ||= (async () => {
    const cfg = testConfig({}); const root = tmpDir(); await generateStarterSfx(cfg, root);
    const m = await scanLibrary(cfg, root);
    m.assets.push({ id: 'LIB_TRACK_TECHNO_128', type: 'music', file: 'MUSIC/TECHNO/track.wav', path: '/lib/track.wav', category: 'MUSIC', subcategory: 'TECHNO', genre: 'TECHNO', bpm: 128, energy: 0.85, intensity: 0.8, duration: 64, tags: ['techno'], recommended_for: ['velocity'] });
    m.assets.push({ id: 'LIB_TRACK_AMBIENT_70', type: 'music', file: 'MUSIC/AMBIENT/t.wav', path: '/lib/t.wav', category: 'MUSIC', subcategory: 'AMBIENT', genre: 'AMBIENT', bpm: 70, energy: 0.2, intensity: 0.2, duration: 80, tags: ['ambient'], recommended_for: ['documentary'] });
    return m;
  })();
}
let mapP; export const beatMap = () => mapP ||= (() => { const t = synthTrack({ bpm: 128, seed: 'dir', sampleRate: 22050 }); return analyzeSamples(t.samples, t.sampleRate); })();
export const directive = (o = {}) => resolveDirective({ type: o.type || 'velocity', prompt: o.prompt ?? 'Make a velocity edit "J20 STEALTH" 30 seconds, military, aggressive', config: o.config || {}, overrides: o.overrides || {} });
