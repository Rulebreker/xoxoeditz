// EDIT TYPES are creative BEHAVIOUR PROFILES, not templates. A profile says how the piece should feel and move:
// how fast it cuts, whether it ramps speed, how the camera behaves, which transitions it trusts, how much text and
// sound design it wants, which colour treatment it uses and which kinds of shot it favours.
// The Director combines a profile with the user's prompt, the project assets and the universal library.
//
// "dials" are 0..1 knobs (0 = none/very calm, 1 = maximum). Everything else is descriptive data.

export const DIALS = ['intensity', 'cutFrequency', 'velocity', 'speedVariation', 'camera', 'motionBlur', 'effects', 'sfx', 'transitions', 'text', 'color', 'impact', 'beatSync', 'depth', 'music'];

const BASE = {
  dials: { intensity: 0.5, cutFrequency: 0.4, velocity: 0, speedVariation: 0.2, camera: 0.4, motionBlur: 0.3, effects: 0.3, sfx: 0.4, transitions: 0.35, text: 0.4, color: 0.5, impact: 0.3, beatSync: 0.5, depth: 0.3, music: 0.5 },
  pacing: { shotSeconds: [3, 6], phrasing: 'free', targetSeconds: 30, narrationFirst: false },
  velocity: { profile: null },
  camera: { rig: 'CAMERA_CINEMATIC' },
  transitions: { palette: [{ type: 'dissolve', w: 1 }], durationBeats: 1, hardCutShare: 0.2 },
  typography: { style: 'restrained', animations: ['fade', 'tracking_reveal'], titleCase: 'upper' },
  sfx: { prefer: { transition: ['SWOOSH', 'WHOOSH'], impact: ['IMPACT', 'HIT'], text: ['UI', 'TICK'], ambience: ['AMBIENCE'] }, layering: 1 },
  music: { genres: ['CINEMATIC'], bpmRange: [70, 130], duck: true },
  color: 'CINEMATIC',
  look: { grain: 0.3, vignette: 0.3, letterbox: false, glow: 0.2 },
  shots: { FULL_BLEED: 1, CROP_DETAIL: 0.3, '2_5D': 0.2, PARALLAX: 0.15, CAMERA: 0.3, PIP: 0, SPLIT_SCREEN: 0, TEXT_SCENE: 0.1, STAT_SCENE: 0.1, CALLOUT: 0.1, HUD_SCENE: 0, MAP_SCENE: 0, FREEZE_FRAME: 0.1, IMPACT_SCENE: 0.1, DARK_TITLE: 0.15, END_CARD: 0.3 },
  aspect: null,
  notes: [],
};

const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v;
  return out;
};
const T = (id, label, aliases, description, spec) => ({ id, label, aliases, description, ...merge(BASE, spec) });

export const EDIT_TYPES = Object.fromEntries([
  T('velocity', 'Velocity', ['velocity edit', 'speed ramp', 'speed-ramp', 'speedramp'], 'Beat-locked, aggressive speed variation: ramps, impact frames, whips, punch-ins, rhythmic type.', {
    dials: { intensity: 0.8, cutFrequency: 0.85, velocity: 0.9, speedVariation: 0.8, camera: 0.75, motionBlur: 0.8, effects: 0.55, sfx: 0.8, transitions: 0.75, text: 0.5, color: 0.6, impact: 0.8, beatSync: 0.9, depth: 0.2, music: 0.8 },
    pacing: { shotSeconds: [0.6, 2.4], phrasing: 'bars', targetSeconds: 30 }, velocity: { profile: 'VELOCITY_HARD' }, camera: { rig: 'CAMERA_VELOCITY' },
    transitions: { palette: [{ type: 'whip', w: 3 }, { type: 'zoom', w: 2 }, { type: 'flash', w: 1.5 }, { type: 'motion_blur', w: 1 }, { type: 'glitch', w: 0.5 }, { type: 'cut', w: 2 }], durationBeats: 0.5, hardCutShare: 0.45 },
    typography: { style: 'rhythmic', animations: ['scale_punch', 'glitch_reveal', 'word_reveal', 'slide'], titleCase: 'upper' },
    sfx: { prefer: { transition: ['WHOOSH', 'TRANSITION'], impact: ['IMPACT', 'HIT', 'BOOM'], riser: ['RISER', 'REVERSE'], text: ['UI', 'GLITCH'], ambience: [] }, layering: 2 },
    music: { genres: ['ACTION', 'TECHNO', 'PHONK'], bpmRange: [100, 175] }, color: 'CINEMATIC', look: { grain: 0.35, vignette: 0.4, glow: 0.35 },
    shots: { FULL_BLEED: 1, CROP_DETAIL: 0.7, '2_5D': 0.2, PARALLAX: 0.1, CAMERA: 0.6, SPLIT_SCREEN: 0.2, PIP: 0.12, FREEZE_FRAME: 0.5, IMPACT_SCENE: 0.7, TEXT_SCENE: 0.3, DARK_TITLE: 0.3, END_CARD: 0.4 },
    notes: ['cuts live on beats; speed changes anticipate impacts; no slideshow pacing'] }),
  T('cinematic', 'Cinematic', ['film', 'filmic', 'movie'], 'Slow, controlled, atmospheric: depth, restrained type, subtle sound design.', {
    dials: { intensity: 0.45, cutFrequency: 0.2, velocity: 0.1, speedVariation: 0.1, camera: 0.5, motionBlur: 0.4, effects: 0.3, sfx: 0.35, transitions: 0.25, text: 0.25, color: 0.7, impact: 0.2, beatSync: 0.4, depth: 0.6, music: 0.5 },
    pacing: { shotSeconds: [3.5, 8], phrasing: 'bars', targetSeconds: 40 }, velocity: { profile: 'VELOCITY_CINEMATIC' }, camera: { rig: 'CAMERA_CINEMATIC' },
    transitions: { palette: [{ type: 'dissolve', w: 4 }, { type: 'light', w: 1 }, { type: 'pull', w: 0.5 }, { type: 'cut', w: 2 }], durationBeats: 2, hardCutShare: 0.35 },
    typography: { style: 'restrained', animations: ['fade', 'tracking_reveal', 'blur_reveal', 'mask_reveal'] }, color: 'CINEMATIC', look: { grain: 0.4, vignette: 0.45, letterbox: true, glow: 0.25 },
    shots: { FULL_BLEED: 1, CROP_DETAIL: 0.3, '2_5D': 0.5, PARALLAX: 0.4, DARK_TITLE: 0.35, END_CARD: 0.5 } }),
  T('documentary', 'Documentary', ['doc', 'explainer', 'history'], 'Narration-first, evidence-driven: callouts, statistics, lower thirds, measured pacing.', {
    dials: { intensity: 0.4, cutFrequency: 0.25, velocity: 0, speedVariation: 0, camera: 0.35, motionBlur: 0.2, effects: 0.2, sfx: 0.25, transitions: 0.25, text: 0.65, color: 0.5, impact: 0.1, beatSync: 0.1, depth: 0.3, music: 0.3 },
    pacing: { shotSeconds: [3.5, 7], phrasing: 'sentences', targetSeconds: 60, narrationFirst: true }, camera: { rig: 'CAMERA_DOCUMENTARY' },
    transitions: { palette: [{ type: 'dissolve', w: 5 }, { type: 'cut', w: 2 }, { type: 'push', w: 0.5 }], durationBeats: 2, hardCutShare: 0.4 },
    typography: { style: 'informational', animations: ['fade', 'slide', 'mask_reveal', 'word_reveal'] }, color: 'DOCUMENTARY',
    sfx: { prefer: { transition: ['SWOOSH'], impact: ['IMPACT'], text: ['UI', 'TICK', 'DIGITAL'], ambience: ['AMBIENCE'] } }, music: { genres: ['DOCUMENTARY', 'CINEMATIC'], bpmRange: [60, 110] },
    shots: { FULL_BLEED: 1, CROP_DETAIL: 0.5, STAT_SCENE: 0.7, CALLOUT: 0.7, MAP_SCENE: 0.3, HUD_SCENE: 0, IMPACT_SCENE: 0, FREEZE_FRAME: 0, END_CARD: 0.4 } }),
  T('commercial', 'Commercial', ['advert', 'advertisement', 'ad', 'promo'], 'Hero shots, controlled camera, premium transitions, clean type and colour.', {
    dials: { intensity: 0.55, cutFrequency: 0.45, velocity: 0.2, speedVariation: 0.2, camera: 0.5, motionBlur: 0.5, effects: 0.4, sfx: 0.45, transitions: 0.45, text: 0.5, color: 0.7, impact: 0.3, beatSync: 0.7, depth: 0.5, music: 0.55 },
    pacing: { shotSeconds: [1.5, 4], phrasing: 'bars', targetSeconds: 30 }, camera: { rig: 'CAMERA_PRODUCT' },
    transitions: { palette: [{ type: 'zoom', w: 2 }, { type: 'dissolve', w: 2 }, { type: 'light', w: 1.5 }, { type: 'push', w: 1.5 }, { type: 'cut', w: 2 }], durationBeats: 1 },
    typography: { style: 'premium', animations: ['mask_reveal', 'tracking_reveal', 'slide', 'blur_reveal'] }, color: 'PREMIUM', music: { genres: ['CORPORATE', 'CINEMATIC'], bpmRange: [90, 130] },
    shots: { FULL_BLEED: 1, CROP_DETAIL: 0.8, '2_5D': 0.5, PARALLAX: 0.4, END_CARD: 0.8, TEXT_SCENE: 0.3 } }),
  T('automotive', 'Automotive', ['car', 'cars', 'auto'], 'Sleek motion, light sweeps, engine-driven sound, glossy colour.', {
    dials: { intensity: 0.65, cutFrequency: 0.55, velocity: 0.55, speedVariation: 0.5, camera: 0.65, motionBlur: 0.7, effects: 0.5, sfx: 0.6, transitions: 0.5, text: 0.4, color: 0.75, impact: 0.45, beatSync: 0.75, depth: 0.45, music: 0.65 },
    pacing: { shotSeconds: [1.2, 3.5], phrasing: 'bars', targetSeconds: 30 }, velocity: { profile: 'VELOCITY_CAR' }, camera: { rig: 'CAMERA_PRODUCT' },
    transitions: { palette: [{ type: 'whip', w: 2.5 }, { type: 'light', w: 2 }, { type: 'zoom', w: 1.5 }, { type: 'motion_blur', w: 1.5 }, { type: 'cut', w: 2 }], durationBeats: 0.75 },
    typography: { style: 'premium', animations: ['slide', 'mask_reveal', 'tracking_reveal'] }, color: 'AUTOMOTIVE', music: { genres: ['PHONK', 'TECHNO', 'ACTION', 'CINEMATIC'], bpmRange: [90, 150] },
    sfx: { prefer: { transition: ['WHOOSH', 'SWOOSH'], impact: ['IMPACT', 'HIT'], text: ['UI'], ambience: ['VEHICLE', 'MECHANICAL'] } }, shots: { FULL_BLEED: 1, CROP_DETAIL: 0.9, CAMERA: 0.7, '2_5D': 0.35 } }),
  T('military', 'Military', ['defense', 'defence', 'armed forces', 'aviation'], 'Stark and technical: HUD graphics, targeting overlays, restrained grade, heavy low end.', {
    dials: { intensity: 0.6, cutFrequency: 0.45, velocity: 0.45, speedVariation: 0.4, camera: 0.55, motionBlur: 0.5, effects: 0.45, sfx: 0.6, transitions: 0.4, text: 0.55, color: 0.7, impact: 0.55, beatSync: 0.6, depth: 0.35, music: 0.55 },
    pacing: { shotSeconds: [1.5, 4.5], phrasing: 'bars', targetSeconds: 40 }, velocity: { profile: 'VELOCITY_MILITARY' }, camera: { rig: 'CAMERA_ACTION' },
    transitions: { palette: [{ type: 'dissolve', w: 2 }, { type: 'flash', w: 1.5 }, { type: 'zoom', w: 1.5 }, { type: 'glitch', w: 1 }, { type: 'cut', w: 2 }], durationBeats: 1 },
    typography: { style: 'technical', animations: ['glitch_reveal', 'slide', 'character_reveal', 'mask_reveal'] }, color: 'MILITARY', look: { grain: 0.45, vignette: 0.5, letterbox: true },
    sfx: { prefer: { transition: ['WHOOSH'], impact: ['IMPACT', 'BOOM', 'HIT'], text: ['DIGITAL', 'UI', 'CLICK'], ambience: ['TENSION', 'AMBIENCE'] }, layering: 2 }, music: { genres: ['DARK', 'EPIC', 'ACTION'], bpmRange: [80, 150] },
    shots: { FULL_BLEED: 1, CROP_DETAIL: 0.7, HUD_SCENE: 0.7, CALLOUT: 0.6, STAT_SCENE: 0.5, MAP_SCENE: 0.3, IMPACT_SCENE: 0.5, '2_5D': 0.3 } }),
  T('sports', 'Sports', ['sport', 'athletic'], 'Kinetic, rhythmic, slow-motion hero moments, big impacts.', {
    dials: { intensity: 0.8, cutFrequency: 0.75, velocity: 0.8, speedVariation: 0.7, camera: 0.7, motionBlur: 0.75, effects: 0.5, sfx: 0.75, transitions: 0.65, text: 0.5, color: 0.65, impact: 0.75, beatSync: 0.85, depth: 0.2, music: 0.8 },
    pacing: { shotSeconds: [0.7, 2.6], phrasing: 'bars', targetSeconds: 30 }, velocity: { profile: 'VELOCITY_SPORT' }, camera: { rig: 'CAMERA_ACTION' },
    transitions: { palette: [{ type: 'whip', w: 3 }, { type: 'flash', w: 2 }, { type: 'zoom', w: 2 }, { type: 'cut', w: 2 }], durationBeats: 0.5 }, typography: { style: 'rhythmic', animations: ['scale_punch', 'slide', 'word_reveal'] },
    music: { genres: ['ACTION', 'HIP_HOP', 'EPIC'], bpmRange: [100, 170] }, shots: { FULL_BLEED: 1, CROP_DETAIL: 0.6, FREEZE_FRAME: 0.7, IMPACT_SCENE: 0.7, STAT_SCENE: 0.3 } }),
  T('music_video', 'Music video', ['music video', 'musicvideo', 'mv'], 'Beat-locked, visual-first, stylised effects and bold colour.', {
    dials: { intensity: 0.75, cutFrequency: 0.7, velocity: 0.6, speedVariation: 0.6, camera: 0.7, motionBlur: 0.6, effects: 0.75, sfx: 0.3, transitions: 0.7, text: 0.35, color: 0.8, impact: 0.55, beatSync: 0.95, depth: 0.4, music: 1 },
    pacing: { shotSeconds: [0.8, 3.5], phrasing: 'bars', targetSeconds: 60 }, velocity: { profile: 'VELOCITY_EDM' }, camera: { rig: 'CAMERA_VELOCITY' },
    transitions: { palette: [{ type: 'glitch', w: 2 }, { type: 'flash', w: 2 }, { type: 'whip', w: 2 }, { type: 'distortion', w: 1.5 }, { type: 'cut', w: 3 }], durationBeats: 0.5 },
    typography: { style: 'rhythmic', animations: ['glitch_reveal', 'kinetic', 'scale_punch'] }, color: 'VIBRANT', music: { genres: ['TECHNO', 'HIP_HOP', 'PHONK'], bpmRange: [90, 160] }, shots: { FULL_BLEED: 1, CROP_DETAIL: 0.7, SPLIT_SCREEN: 0.4, PIP: 0.3, FREEZE_FRAME: 0.4 } }),
  T('trailer', 'Trailer', ['teaser'], 'Build-and-hit structure: risers, silence, big impacts, title cards.', {
    dials: { intensity: 0.8, cutFrequency: 0.7, velocity: 0.6, speedVariation: 0.5, camera: 0.65, motionBlur: 0.6, effects: 0.5, sfx: 0.9, transitions: 0.55, text: 0.55, color: 0.7, impact: 0.9, beatSync: 0.8, depth: 0.4, music: 0.8 },
    pacing: { shotSeconds: [0.8, 3.5], phrasing: 'bars', targetSeconds: 45 }, velocity: { profile: 'VELOCITY_CINEMATIC' }, camera: { rig: 'CAMERA_ACTION' },
    transitions: { palette: [{ type: 'flash', w: 3 }, { type: 'dissolve', w: 1.5 }, { type: 'zoom', w: 2 }, { type: 'cut', w: 3 }], durationBeats: 0.75 }, typography: { style: 'restrained', animations: ['fade', 'tracking_reveal', 'scale_punch'] },
    sfx: { prefer: { transition: ['WHOOSH', 'REVERSE'], impact: ['BOOM', 'IMPACT', 'SUB'], riser: ['RISER', 'SWELL', 'TENSION'], text: ['IMPACT'] }, layering: 3 }, music: { genres: ['EPIC', 'DARK', 'ACTION'] },
    look: { grain: 0.4, vignette: 0.5, letterbox: true }, shots: { FULL_BLEED: 1, CROP_DETAIL: 0.5, DARK_TITLE: 0.8, IMPACT_SCENE: 0.8, END_CARD: 0.9, TEXT_SCENE: 0.5 } }),
  T('youtube', 'YouTube', ['yt', 'video essay'], 'Punchy and clear: fast cuts, zooms, bold captions, constant novelty.', {
    dials: { intensity: 0.7, cutFrequency: 0.75, velocity: 0.4, speedVariation: 0.4, camera: 0.6, motionBlur: 0.4, effects: 0.4, sfx: 0.6, transitions: 0.6, text: 0.7, color: 0.6, impact: 0.5, beatSync: 0.6, depth: 0.2, music: 0.6 },
    pacing: { shotSeconds: [1, 3.5], phrasing: 'free', targetSeconds: 60 }, transitions: { palette: [{ type: 'zoom', w: 2 }, { type: 'whip', w: 1.5 }, { type: 'cut', w: 4 }], durationBeats: 0.5 },
    typography: { style: 'bold', animations: ['scale_punch', 'word_reveal', 'slide'] }, color: 'VIBRANT', shots: { FULL_BLEED: 1, CROP_DETAIL: 0.6, TEXT_SCENE: 0.5, STAT_SCENE: 0.4, PIP: 0.2 } }),
  T('shorts', 'Shorts', ['short', 'tiktok', 'tik tok', 'vertical'], 'Vertical, instant hook, very fast, big captions.', {
    dials: { intensity: 0.8, cutFrequency: 0.85, velocity: 0.5, speedVariation: 0.5, camera: 0.65, motionBlur: 0.5, effects: 0.45, sfx: 0.65, transitions: 0.6, text: 0.8, color: 0.65, impact: 0.55, beatSync: 0.8, depth: 0.15, music: 0.7 },
    pacing: { shotSeconds: [0.6, 2.2], phrasing: 'free', targetSeconds: 25 }, transitions: { palette: [{ type: 'zoom', w: 2 }, { type: 'whip', w: 2 }, { type: 'flash', w: 1 }, { type: 'cut', w: 4 }], durationBeats: 0.5 },
    typography: { style: 'bold', animations: ['scale_punch', 'word_reveal'] }, color: 'VIBRANT', aspect: '9:16', shots: { FULL_BLEED: 1, TEXT_SCENE: 0.6, CROP_DETAIL: 0.5 } }),
  T('reel', 'Reel', ['reels', 'showreel', 'instagram'], 'Short, polished, trend-aware: tight rhythm and clean type.', {
    dials: { intensity: 0.65, cutFrequency: 0.7, velocity: 0.45, speedVariation: 0.4, camera: 0.55, motionBlur: 0.5, effects: 0.45, sfx: 0.5, transitions: 0.6, text: 0.5, color: 0.7, impact: 0.45, beatSync: 0.85, depth: 0.3, music: 0.7 },
    pacing: { shotSeconds: [0.8, 2.6], phrasing: 'bars', targetSeconds: 15 }, aspect: '9:16', color: 'PREMIUM', transitions: { palette: [{ type: 'whip', w: 2 }, { type: 'zoom', w: 2 }, { type: 'light', w: 1 }, { type: 'cut', w: 3 }], durationBeats: 0.5 } }),
  T('tech', 'Tech', ['technology', 'software', 'saas', 'explainer tech'], 'Clean and bright, UI sounds, HUD/grids, precise motion.', {
    dials: { intensity: 0.55, cutFrequency: 0.5, velocity: 0.2, speedVariation: 0.2, camera: 0.45, motionBlur: 0.3, effects: 0.55, sfx: 0.5, transitions: 0.5, text: 0.65, color: 0.6, impact: 0.3, beatSync: 0.7, depth: 0.4, music: 0.55 },
    pacing: { shotSeconds: [1.5, 4], phrasing: 'bars', targetSeconds: 40 }, camera: { rig: 'CAMERA_PRODUCT' }, transitions: { palette: [{ type: 'push', w: 2 }, { type: 'glitch', w: 1 }, { type: 'zoom', w: 1.5 }, { type: 'dissolve', w: 1.5 }, { type: 'cut', w: 2 }], durationBeats: 0.75 },
    typography: { style: 'technical', animations: ['slide', 'mask_reveal', 'character_reveal', 'glitch_reveal'] }, color: 'TECH', music: { genres: ['TECHNO', 'CORPORATE'], bpmRange: [95, 130] },
    sfx: { prefer: { transition: ['WHOOSH', 'DIGITAL'], impact: ['HIT'], text: ['UI', 'CLICK', 'DIGITAL', 'TICK'] } }, shots: { FULL_BLEED: 1, HUD_SCENE: 0.6, CALLOUT: 0.6, STAT_SCENE: 0.5, PIP: 0.4, SPLIT_SCREEN: 0.3 } }),
  T('corporate', 'Corporate', ['business', 'company', 'presentation'], 'Quiet confidence: clean cuts, gentle motion, clear type.', {
    dials: { intensity: 0.3, cutFrequency: 0.3, velocity: 0, speedVariation: 0, camera: 0.25, motionBlur: 0.15, effects: 0.1, sfx: 0.15, transitions: 0.25, text: 0.6, color: 0.4, impact: 0.05, beatSync: 0.5, depth: 0.15, music: 0.35 },
    pacing: { shotSeconds: [3, 6], phrasing: 'bars', targetSeconds: 45 }, transitions: { palette: [{ type: 'dissolve', w: 4 }, { type: 'push', w: 1 }, { type: 'cut', w: 3 }], durationBeats: 1.5 },
    typography: { style: 'restrained', animations: ['fade', 'slide', 'mask_reveal'] }, color: 'CLEAN', look: { grain: 0, vignette: 0.1, glow: 0 }, music: { genres: ['CORPORATE'], bpmRange: [85, 120] }, sfx: { prefer: { transition: ['SWOOSH'], impact: [], text: ['CLICK', 'UI'] } },
    shots: { FULL_BLEED: 1, CROP_DETAIL: 0.3, STAT_SCENE: 0.5, CALLOUT: 0.3, END_CARD: 0.6 } }),
  T('news', 'News', ['broadcast', 'report', 'journalism'], 'Informational and neutral: lower thirds, tickers, factual pacing.', {
    dials: { intensity: 0.4, cutFrequency: 0.4, velocity: 0, speedVariation: 0, camera: 0.2, motionBlur: 0.1, effects: 0.1, sfx: 0.25, transitions: 0.3, text: 0.8, color: 0.3, impact: 0.1, beatSync: 0.2, depth: 0.1, music: 0.3 },
    pacing: { shotSeconds: [2.5, 5], phrasing: 'sentences', targetSeconds: 45, narrationFirst: true }, camera: { rig: 'CAMERA_DOCUMENTARY' }, transitions: { palette: [{ type: 'cut', w: 4 }, { type: 'dissolve', w: 1 }, { type: 'push', w: 1 }], durationBeats: 1 },
    typography: { style: 'informational', animations: ['slide', 'fade', 'mask_reveal'] }, color: 'CLEAN', look: { grain: 0, vignette: 0, glow: 0 }, shots: { FULL_BLEED: 1, STAT_SCENE: 0.7, CALLOUT: 0.5, MAP_SCENE: 0.3 } }),
  T('action', 'Action', ['action edit'], 'Hard-hitting energy: shake, flashes, big impacts, aggressive sound.', {
    dials: { intensity: 0.85, cutFrequency: 0.8, velocity: 0.75, speedVariation: 0.7, camera: 0.85, motionBlur: 0.75, effects: 0.6, sfx: 0.85, transitions: 0.7, text: 0.4, color: 0.7, impact: 0.85, beatSync: 0.85, depth: 0.2, music: 0.8 },
    pacing: { shotSeconds: [0.6, 2.4], phrasing: 'bars', targetSeconds: 30 }, velocity: { profile: 'VELOCITY_HARD' }, camera: { rig: 'CAMERA_ACTION' },
    transitions: { palette: [{ type: 'whip', w: 2.5 }, { type: 'flash', w: 2.5 }, { type: 'zoom', w: 2 }, { type: 'glitch', w: 0.7 }, { type: 'cut', w: 2.5 }], durationBeats: 0.5 }, typography: { style: 'rhythmic', animations: ['scale_punch', 'glitch_reveal'] },
    color: 'DARK', music: { genres: ['ACTION', 'EPIC', 'TECHNO'], bpmRange: [100, 175] }, sfx: { prefer: { transition: ['WHOOSH'], impact: ['BOOM', 'IMPACT', 'HIT'], riser: ['RISER'], text: ['IMPACT'] }, layering: 3 },
    shots: { FULL_BLEED: 1, CROP_DETAIL: 0.7, IMPACT_SCENE: 0.8, FREEZE_FRAME: 0.5, CAMERA: 0.6 } }),
  T('fashion', 'Fashion', ['lookbook', 'beauty'], 'Stylish and rhythmic: crisp cuts, light leaks, elegant type.', {
    dials: { intensity: 0.55, cutFrequency: 0.5, velocity: 0.35, speedVariation: 0.35, camera: 0.5, motionBlur: 0.55, effects: 0.5, sfx: 0.3, transitions: 0.5, text: 0.4, color: 0.8, impact: 0.2, beatSync: 0.85, depth: 0.5, music: 0.7 },
    pacing: { shotSeconds: [1, 3], phrasing: 'bars', targetSeconds: 30 }, camera: { rig: 'CAMERA_PRODUCT' }, transitions: { palette: [{ type: 'light', w: 2.5 }, { type: 'zoom', w: 1.5 }, { type: 'dissolve', w: 1.5 }, { type: 'cut', w: 3 }], durationBeats: 0.75 },
    typography: { style: 'premium', animations: ['tracking_reveal', 'mask_reveal', 'blur_reveal'] }, color: 'PREMIUM', look: { grain: 0.3, vignette: 0.2, glow: 0.4 }, shots: { FULL_BLEED: 1, CROP_DETAIL: 0.9, '2_5D': 0.6, PARALLAX: 0.4, SPLIT_SCREEN: 0.3 } }),
  T('product', 'Product', ['product showcase', 'hero product'], 'Hero shots with controlled camera, glossy light, precise callouts.', {
    dials: { intensity: 0.5, cutFrequency: 0.4, velocity: 0.15, speedVariation: 0.15, camera: 0.5, motionBlur: 0.45, effects: 0.4, sfx: 0.4, transitions: 0.4, text: 0.5, color: 0.7, impact: 0.2, beatSync: 0.7, depth: 0.6, music: 0.5 },
    pacing: { shotSeconds: [1.5, 4], phrasing: 'bars', targetSeconds: 30 }, camera: { rig: 'CAMERA_PRODUCT' }, transitions: { palette: [{ type: 'light', w: 2 }, { type: 'dissolve', w: 2 }, { type: 'push', w: 1.5 }, { type: 'zoom', w: 1.5 }, { type: 'cut', w: 2 }], durationBeats: 1 },
    typography: { style: 'premium', animations: ['mask_reveal', 'tracking_reveal', 'slide'] }, color: 'PREMIUM', shots: { FULL_BLEED: 1, CROP_DETAIL: 1, '2_5D': 0.7, PARALLAX: 0.5, CALLOUT: 0.6, END_CARD: 0.8 } }),
  T('gaming', 'Gaming', ['game', 'esports'], 'Neon-edged, glitchy, high energy, UI sound language.', {
    dials: { intensity: 0.8, cutFrequency: 0.8, velocity: 0.6, speedVariation: 0.6, camera: 0.65, motionBlur: 0.55, effects: 0.75, sfx: 0.8, transitions: 0.7, text: 0.6, color: 0.8, impact: 0.7, beatSync: 0.85, depth: 0.2, music: 0.8 },
    pacing: { shotSeconds: [0.7, 2.6], phrasing: 'bars', targetSeconds: 30 }, camera: { rig: 'CAMERA_VELOCITY' }, velocity: { profile: 'VELOCITY_EDM' },
    transitions: { palette: [{ type: 'glitch', w: 3 }, { type: 'flash', w: 2 }, { type: 'whip', w: 2 }, { type: 'distortion', w: 1.5 }, { type: 'cut', w: 2 }], durationBeats: 0.5 },
    typography: { style: 'rhythmic', animations: ['glitch_reveal', 'scale_punch', 'character_reveal'] }, color: 'VIBRANT', music: { genres: ['TECHNO', 'ACTION', 'PHONK'] }, sfx: { prefer: { transition: ['GLITCH', 'WHOOSH'], impact: ['HIT', 'IMPACT'], text: ['UI', 'GLITCH', 'DIGITAL'] }, layering: 2 },
    shots: { FULL_BLEED: 1, HUD_SCENE: 0.7, SPLIT_SCREEN: 0.4, PIP: 0.4, FREEZE_FRAME: 0.4, IMPACT_SCENE: 0.5 } }),
  T('meme', 'Meme', ['memes', 'comedic', 'funny'], 'Abrupt, loud, deliberately blunt: hard cuts, zooms, big text, punchline hits.', {
    dials: { intensity: 0.85, cutFrequency: 0.9, velocity: 0.3, speedVariation: 0.4, camera: 0.5, motionBlur: 0.1, effects: 0.35, sfx: 0.9, transitions: 0.2, text: 0.9, color: 0.3, impact: 0.8, beatSync: 0.4, depth: 0.05, music: 0.4 },
    pacing: { shotSeconds: [0.5, 2.2], phrasing: 'free', targetSeconds: 20 }, transitions: { palette: [{ type: 'cut', w: 8 }, { type: 'zoom', w: 1 }, { type: 'flash', w: 1 }], durationBeats: 0.25, hardCutShare: 0.8 },
    typography: { style: 'bold', animations: ['scale_punch', 'slide'] }, color: 'VIBRANT', look: { grain: 0, vignette: 0, glow: 0 }, sfx: { prefer: { transition: ['HIT'], impact: ['HIT', 'BOOM'], text: ['HIT', 'UI'] } }, shots: { FULL_BLEED: 1, TEXT_SCENE: 0.8, FREEZE_FRAME: 0.7, IMPACT_SCENE: 0.6 } }),
  T('minimal', 'Minimal', ['clean', 'apple', 'apple-style', 'simple'], 'Quiet, spacious, precise: few elements, soft transitions, subtle sound.', {
    dials: { intensity: 0.25, cutFrequency: 0.2, velocity: 0, speedVariation: 0, camera: 0.2, motionBlur: 0.15, effects: 0.05, sfx: 0.12, transitions: 0.2, text: 0.25, color: 0.4, impact: 0, beatSync: 0.5, depth: 0.2, music: 0.3 },
    pacing: { shotSeconds: [3, 6], phrasing: 'bars', targetSeconds: 30 }, camera: { rig: 'CAMERA_PRODUCT' }, transitions: { palette: [{ type: 'dissolve', w: 4 }, { type: 'cut', w: 3 }], durationBeats: 2 },
    typography: { style: 'restrained', animations: ['fade', 'mask_reveal'] }, color: 'CLEAN', look: { grain: 0, vignette: 0, glow: 0.1 }, sfx: { prefer: { transition: ['SWOOSH'], impact: [], text: ['CLICK', 'TICK'] } }, music: { genres: ['AMBIENT', 'CORPORATE'], bpmRange: [70, 110] }, shots: { FULL_BLEED: 1, CROP_DETAIL: 0.5, END_CARD: 0.6 } }),
  T('dark', 'Dark', ['moody', 'noir', 'gritty'], 'Low-key, ominous: deep shadows, slow menace, sparse sharp hits.', {
    dials: { intensity: 0.55, cutFrequency: 0.35, velocity: 0.3, speedVariation: 0.3, camera: 0.5, motionBlur: 0.5, effects: 0.4, sfx: 0.5, transitions: 0.35, text: 0.3, color: 0.8, impact: 0.5, beatSync: 0.6, depth: 0.5, music: 0.6 },
    pacing: { shotSeconds: [2, 5.5], phrasing: 'bars', targetSeconds: 40 }, camera: { rig: 'CAMERA_CINEMATIC' }, transitions: { palette: [{ type: 'dissolve', w: 3 }, { type: 'flash', w: 1 }, { type: 'glitch', w: 0.8 }, { type: 'cut', w: 2.5 }], durationBeats: 1.5 },
    typography: { style: 'restrained', animations: ['fade', 'glitch_reveal', 'blur_reveal'] }, color: 'DARK', look: { grain: 0.55, vignette: 0.6, letterbox: true }, sfx: { prefer: { transition: ['WHOOSH', 'REVERSE'], impact: ['SUB', 'BOOM', 'IMPACT'], riser: ['TENSION', 'RISER'], ambience: ['TENSION', 'AMBIENCE'] } },
    music: { genres: ['DARK', 'EPIC', 'AMBIENT'] }, shots: { FULL_BLEED: 1, CROP_DETAIL: 0.5, '2_5D': 0.5, DARK_TITLE: 0.7, END_CARD: 0.5 } }),
  T('epic', 'Epic', ['grand', 'heroic', 'majestic'], 'Big and heroic: sweeping camera, huge hits, swelling music, bold titles.', {
    dials: { intensity: 0.8, cutFrequency: 0.5, velocity: 0.45, speedVariation: 0.5, camera: 0.8, motionBlur: 0.6, effects: 0.55, sfx: 0.8, transitions: 0.5, text: 0.5, color: 0.8, impact: 0.8, beatSync: 0.8, depth: 0.6, music: 0.9 },
    pacing: { shotSeconds: [1.5, 5], phrasing: 'bars', targetSeconds: 45 }, velocity: { profile: 'VELOCITY_CINEMATIC' }, camera: { rig: 'CAMERA_ACTION' },
    transitions: { palette: [{ type: 'light', w: 2 }, { type: 'flash', w: 2 }, { type: 'zoom', w: 2 }, { type: 'dissolve', w: 2 }, { type: 'cut', w: 1.5 }], durationBeats: 1 }, typography: { style: 'restrained', animations: ['tracking_reveal', 'blur_reveal', 'scale_punch'] },
    color: 'CINEMATIC', look: { grain: 0.35, vignette: 0.5, letterbox: true, glow: 0.45 }, music: { genres: ['EPIC', 'ACTION', 'CINEMATIC'] }, sfx: { prefer: { transition: ['WHOOSH', 'SWOOSH'], impact: ['BOOM', 'IMPACT', 'SUB'], riser: ['RISER', 'SWELL'], text: ['IMPACT'] }, layering: 3 },
    shots: { FULL_BLEED: 1, CROP_DETAIL: 0.5, '2_5D': 0.7, PARALLAX: 0.6, IMPACT_SCENE: 0.7, DARK_TITLE: 0.6, END_CARD: 0.8 } }),
].map((t) => [t.id, t]));

export const EDIT_TYPE_IDS = Object.keys(EDIT_TYPES);
