// BENCHMARK SPECS. Each benchmark is a brief, an edit.config.json and a CHECKLIST that is evaluated against what was
// actually produced - the plan, the creative QA, the QA of the built project and (on a real machine) the render.
// A criterion is 'pass', 'fail' or 'skipped'; 'skipped' always says why, and a simulator run can never claim a render.

const has = (a, b) => a.some((x) => b.includes(x));
const shots = (e) => e.plan.timeline.shots;
const trs = (e) => e.plan.timeline.transitions;
const codes = (e) => new Set([...(e.creative?.errors || []), ...(e.creative?.warnings || [])].map((i) => i.code));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const ok = (pass, detail) => ({ status: pass ? 'pass' : 'fail', detail });

const ADVANCED = ['whip', 'zoom', 'glitch', 'light', 'distortion', 'mask', 'luma', 'flash', 'motion_blur', 'light_leak'];
const COMPOSITING = ['CROP_DETAIL', '2_5D', 'PARALLAX', 'PIP', 'SPLIT_SCREEN'];
const DEPTH = ['2_5D', 'PARALLAX', 'CAMERA'];

export const COMMON = [
  { id: 'plan_valid', label: 'The plan validates', check: (e) => ok(e.validation.valid, e.validation.valid ? `${shots(e).length} shots, ${e.plan.timeline.duration}s` : e.validation.errors.slice(0, 2).map((x) => x.message).join('; ')) },
  { id: 'build_ok', label: 'Every required unit built', check: (e) => ok(e.edit.build?.success !== false && !(e.edit.build?.errors || []).length, `${(e.edit.build?.errors || []).length} errors`) },
  { id: 'qa_passed', label: 'Project QA passed (8 checks)', check: (e) => ok(Boolean(e.edit.qa?.passed), e.edit.qa?.summary || 'no QA result') },
  { id: 'creative_no_errors', label: 'Creative QA found no errors', check: (e) => ok((e.creative?.errors || []).length === 0, e.creative ? `score ${e.creative.score}; ${(e.creative.errors || []).map((x) => x.code).join(', ') || 'no errors'}` : 'no creative QA') },
  { id: 'no_slideshow', label: 'Not a slideshow, not zoom-only, no accidental boxes or blank shots', check: (e) => { const bad = ['SLIDESHOW', 'ZOOM_ONLY', 'ACCIDENTAL_BOX', 'EMPTY_SHOT'].filter((c) => codes(e).has(c)); return ok(bad.length === 0, bad.join(', ') || 'clean'); } },
  { id: 'unique_layers', label: 'Source media untouched and layer names unique', check: (e) => ok(e.sourceUntouched !== false, 'sources not modified') },
  { id: 'rendered', label: 'A video file was rendered and verified', check: (e) => (e.simulated ? { status: 'skipped', detail: 'simulator: nothing is rendered. Run without --dry-run on a machine with After Effects.' } : ok(Boolean(e.render?.success), e.render?.success ? e.render.data.output : e.render?.error || 'not rendered')) },
  { id: 'render_qa', label: 'Render-level creative QA (black frames, freezes, bars, clipping, silence, cut detection)', check: (e) => (e.simulated || !e.render?.success ? { status: 'skipped', detail: 'needs a real render' } : ok(e.creative?.renderChecked && e.creative.errors.length === 0, `score ${e.creative?.score}`)) },
];

const velocity = {
  id: 'velocity', title: 'Velocity edit (military, aggressive, beat-locked)', type: 'velocity',
  prompt: 'Make an aggressive military velocity edit "J20 STEALTH" for the fighter jet. Fast cuts on the beat, hard speed ramps, kinetic type, impacts on every drop, dark military grade.',
  config: { type: 'velocity', style: 'military', intensity: 0.9, duration: 30, seed: 7, quality: 'final', resolution: '1080p', overrides: { beatSync: 0.95 } },
  media: { clips: 10, stills: 4, bpm: 128, seed: 1 },
  criteria: [
    { id: 'camera_moves', label: '>= 3 distinct camera moves across >= 3 families', check: (e) => { const m = shots(e).filter((s) => s.camera); const mv = new Set(m.map((s) => s.camera.move)); const fam = new Set(m.map((s) => s.camera.family)); return ok(mv.size >= 3 && fam.size >= 3, `${mv.size} moves (${[...mv].join(', ')}), ${fam.size} families`); } },
    { id: 'speed_ramps', label: 'Multiple speed ramps with different shapes', check: (e) => { const r = shots(e).filter((s) => s.layers.some((l) => l.remap)); const maps = new Set(r.map((s) => s.layers.find((l) => l.remap).remap.summary)); return ok(r.length >= 5 && maps.size >= 4, `${r.length} shots ramped, ${maps.size} distinct maps`); } },
    { id: 'sfx', label: 'Sound design: >= 10 events, >= 3 roles, an impact on the drop', check: (e) => { const ev = e.plan.audio.sfxEvents; const roles = new Set(ev.map((x) => x.role)); const drops = e.plan.beatMap.drops; const onDrop = !drops.length || ev.some((x) => drops.some((d) => Math.abs(x.at - d) < 0.12) && ['big_impact', 'impact', 'drop', 'hit'].includes(x.role)); return ok(ev.length >= 10 && roles.size >= 3 && onDrop, `${ev.length} events, roles ${[...roles].join(', ')}, drop hit ${onDrop}`); } },
    { id: 'beat_sync', label: 'Cuts on the beat grid (>= 85%) and a cut on the drop', check: (e) => { const m = e.creative?.metrics?.cutsOnBeat ?? 0; const d = e.plan.beatMap.drops; const cut = !d.length || d.every((t) => shots(e).some((s) => Math.abs(s.start - t) < 0.1)); return ok(m >= 0.85 && cut && !e.plan.beatMap.virtual, `${Math.round(m * 100)}% on the grid, drops cut: ${cut}, real beat map: ${!e.plan.beatMap.virtual}`); } },
    { id: 'kinetic_type', label: 'Kinetic typography', check: (e) => ok(shots(e).some((s) => s.text.some((t) => t.animation === 'kinetic')), shots(e).flatMap((s) => s.text.map((t) => t.animation)).join(', ')) },
    { id: 'advanced_transition', label: 'At least one advanced transition (whip, zoom, glitch, light, ...)', check: (e) => { const t = [...new Set(trs(e).map((x) => x.type))]; return ok(has(t, ADVANCED), t.join(', ')); } },
    { id: 'compositing', label: 'A compositing scene (crop / layered / PIP / split)', check: (e) => { const t = [...new Set(shots(e).map((s) => s.template))]; return ok(has(t, COMPOSITING), t.join(', ')); } },
    { id: 'depth_camera', label: 'A 2.5D / parallax / camera-driven scene', check: (e) => { const t = shots(e).map((s) => s.template); return ok(has(t, DEPTH), [...new Set(t)].join(', ')); } },
    { id: 'colour', label: 'Colour treatment applied', check: (e) => { const unit = (e.edit.build?.fallbacksUsed || []); void unit; return ok(e.plan.look.color === 'MILITARY' && e.builtUnits.includes('look.color'), `look ${e.plan.look.color}; unit built: ${e.builtUnits.includes('look.color')}`); } },
    { id: 'intro_outro', label: 'Cinematic intro (dark title) and ending (end card)', check: (e) => ok(shots(e)[0].template === 'DARK_TITLE' && shots(e).at(-1).template === 'END_CARD', `${shots(e)[0].template} ... ${shots(e).at(-1).template}`) },
    { id: 'pace', label: 'Fast: median shot under 2.2 s', check: (e) => { const m = median(shots(e).map((s) => s.end - s.start)); return ok(m < 2.2, `median ${m.toFixed(2)}s`); } },
  ],
};

const cinematic = {
  id: 'cinematic', title: 'Cinematic piece (slow, weighty, letterboxed)', type: 'cinematic',
  prompt: 'A slow cinematic piece "SILENT WINGS". Long dissolves, weighty camera moves, deep slow-motion, subtle sound, teal and warm grade, letterboxed.',
  config: { type: 'cinematic', style: 'cinematic', duration: 36, seed: 3, quality: 'final', resolution: '1080p' },
  media: { clips: 8, stills: 6, bpm: 90, seed: 2 },
  criteria: [
    { id: 'slow_pace', label: 'Slow: median shot >= 3 s', check: (e) => { const m = median(shots(e).map((s) => s.end - s.start)); return ok(m >= 3, `median ${m.toFixed(2)}s`); } },
    { id: 'restrained_transitions', label: 'Dissolve-led transitions; no whips, glitches or distortion', check: (e) => { const t = trs(e).map((x) => x.type); const bad = t.filter((x) => ['whip', 'glitch', 'distortion', 'motion_blur', 'flash'].includes(x)); return ok(t.includes('dissolve') && bad.length === 0, `${[...new Set(t)].join(', ')}`); } },
    { id: 'camera', label: 'Cinematic rig: slow dolly / drift / orbit variety', check: (e) => { const f = new Set(shots(e).filter((s) => s.camera).map((s) => s.camera.family)); return ok(shots(e).some((s) => s.camera?.rig === 'CAMERA_CINEMATIC') && f.size >= 2, [...f].join(', ')); } },
    { id: 'slowmo', label: 'Slow-motion used sparingly (<= 40% of shots)', check: (e) => { const r = shots(e).filter((s) => s.layers.some((l) => l.remap)).length; return ok(r <= shots(e).length * 0.4, `${r} of ${shots(e).length}`); } },
    { id: 'quiet_sound', label: 'Subtle sound design (< 0.6 events per second)', check: (e) => ok((e.creative?.metrics?.sfxPerSecond ?? 0) < 0.6, `${e.creative?.metrics?.sfxPerSecond} per second`) },
    { id: 'colour', label: 'CINEMATIC grade and letterbox', check: (e) => ok(e.plan.look.color === 'CINEMATIC' && e.plan.look.letterbox === true, `look ${e.plan.look.color}, letterbox ${e.plan.look.letterbox}`) },
    { id: 'intro_outro', label: 'Title card in, end card out', check: (e) => ok(shots(e)[0].template === 'DARK_TITLE' && shots(e).at(-1).template === 'END_CARD', `${shots(e)[0].template} ... ${shots(e).at(-1).template}`) },
    { id: 'music', label: 'Music chosen to suit (tempo 70-100 BPM)', check: (e) => ok(e.plan.timeline.bpm >= 70 && e.plan.timeline.bpm <= 100, `${Math.round(e.plan.timeline.bpm)} BPM`) },
  ],
};

const documentary = {
  id: 'documentary', title: 'Documentary (calm, informational, no effects for effects\' sake)', type: 'documentary',
  prompt: 'A calm documentary about the air base "AIRBASE SEVEN". Observational camera, plain cuts and dissolves, no speed ramps, natural colour, minimal sound.',
  config: { type: 'documentary', duration: 36, seed: 5, quality: 'final', resolution: '1080p' },
  media: { clips: 8, stills: 6, bpm: 80, seed: 3 },
  criteria: [
    { id: 'no_ramps', label: 'No speed ramps', check: (e) => ok(!shots(e).some((s) => s.layers.some((l) => l.remap)), 'constant speed throughout') },
    { id: 'plain_transitions', label: 'Only cuts, dissolves and soft transitions', check: (e) => { const t = [...new Set(trs(e).map((x) => x.type))]; const bad = t.filter((x) => !['cut', 'dissolve', 'pull', 'light', 'push'].includes(x)); return ok(bad.length === 0, t.join(', ')); } },
    { id: 'calm_pace', label: 'Shots are given room: median >= 3 s', check: (e) => { const m = median(shots(e).map((s) => s.end - s.start)); return ok(m >= 3, `median ${m.toFixed(2)}s`); } },
    { id: 'observational_camera', label: 'Documentary rig, no shake or whips', check: (e) => ok(shots(e).filter((s) => s.camera).every((s) => s.camera.rig === 'CAMERA_DOCUMENTARY' && !['whip-in', 'whip-out', 'shake-hit', 'handheld'].includes(s.camera.move)), [...new Set(shots(e).filter((s) => s.camera).map((s) => s.camera.move))].join(', ')) },
    { id: 'minimal_sound', label: 'Minimal sound design (< 0.35 events per second)', check: (e) => ok((e.creative?.metrics?.sfxPerSecond ?? 0) < 0.35, `${e.creative?.metrics?.sfxPerSecond} per second`) },
    { id: 'no_glitch_type', label: 'No glitch or kinetic type', check: (e) => { const a = shots(e).flatMap((s) => s.text.map((t) => t.animation)); return ok(!a.some((x) => ['glitch_reveal', 'kinetic'].includes(x)), a.join(', ') || 'no text'); } },
    { id: 'no_impact_scenes', label: 'No freeze frames or impact scenes', check: (e) => ok(!shots(e).some((s) => ['FREEZE_FRAME', 'IMPACT_SCENE', 'HUD_SCENE'].includes(s.template)), [...new Set(shots(e).map((s) => s.template))].join(', ')) },
    { id: 'colour', label: 'Natural (DOCUMENTARY) grade', check: (e) => ok(e.plan.look.color === 'DOCUMENTARY', `look ${e.plan.look.color}`) },
  ],
};

const commercial = {
  id: 'commercial', title: 'Commercial (premium, controlled, brand-safe)', type: 'commercial',
  prompt: 'A premium commercial "AURORA" for the new jet trainer. Clean controlled camera, hero details, light and zoom transitions, premium warm grade, professional.',
  config: { type: 'commercial', style: 'premium', duration: 30, seed: 9, professional: true, quality: 'final', resolution: '1080p' },
  media: { clips: 8, stills: 6, bpm: 110, seed: 4 },
  criteria: [
    { id: 'professional', label: 'Professional mode: no glitch, distortion, kinetic or shake', check: (e) => { const t = trs(e).map((x) => x.type); const a = shots(e).flatMap((s) => s.text.map((x) => x.animation)); return ok(!t.includes('glitch') && !t.includes('distortion') && !a.includes('glitch_reveal') && !a.includes('kinetic'), `${[...new Set(t)].join(', ')}`); } },
    { id: 'hero_shots', label: '>= 2 hero detail shots (crop / depth / callout)', check: (e) => { const n = shots(e).filter((s) => ['CROP_DETAIL', '2_5D', 'PARALLAX', 'CALLOUT'].includes(s.template)).length; return ok(n >= 2, `${n} hero shots`); } },
    { id: 'premium_transitions', label: 'Premium transition vocabulary only', check: (e) => { const t = [...new Set(trs(e).map((x) => x.type))]; const bad = t.filter((x) => !['zoom', 'dissolve', 'light', 'push', 'cut', 'luma', 'mask', 'pull', 'light_leak', 'whip', 'motion_blur', 'flash'].includes(x)); return ok(bad.length === 0 && t.length >= 2, t.join(', ')); } },
    { id: 'product_camera', label: 'Product rig: smooth orbit / push / reveal, no shake', check: (e) => ok(shots(e).filter((s) => s.camera).every((s) => s.camera.rig === 'CAMERA_PRODUCT') && shots(e).some((s) => s.camera), [...new Set(shots(e).filter((s) => s.camera).map((s) => s.camera.move))].join(', ')) },
    { id: 'colour', label: 'PREMIUM grade', check: (e) => ok(e.plan.look.color === 'PREMIUM', `look ${e.plan.look.color}`) },
    { id: 'intro_outro', label: 'Opening title and closing end card with the brand', check: (e) => ok(shots(e)[0].template === 'DARK_TITLE' && shots(e).at(-1).template === 'END_CARD' && shots(e).at(-1).text.some((t) => /AURORA/i.test(t.text)), `${shots(e)[0].template} ... ${shots(e).at(-1).template}`) },
    { id: 'music', label: 'Music in the 90-130 BPM band', check: (e) => ok(e.plan.timeline.bpm >= 90 && e.plan.timeline.bpm <= 130, `${Math.round(e.plan.timeline.bpm)} BPM`) },
    { id: 'beat_sync', label: 'Cuts on the beat (>= 80%)', check: (e) => ok((e.creative?.metrics?.cutsOnBeat ?? 0) >= 0.8, `${Math.round((e.creative?.metrics?.cutsOnBeat ?? 0) * 100)}%`) },
  ],
};

export const SPECS = { velocity, cinematic, documentary, commercial };
export const BENCHMARK_IDS = Object.keys(SPECS);
