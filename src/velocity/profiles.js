// VELOCITY PROFILES: how aggressively a clip's speed changes. A pattern is a sequence of speed "nodes";
// the engine ramps between them with the profile's curves and varies every pattern a little, so no two
// shots get the same curve. 'impact' marks a freeze/hit; negative speeds are reverse segments.

export const VELOCITY_PROFILES = {
  VELOCITY_SOFT:      { label: 'Soft',      minSpeed: 0.7,  maxSpeed: 1.3, rampDur: [0.5, 1.2],  curves: ['ease-in-out', 'ease-out', 'smoothstep'],                      shotSeconds: [2.5, 5],   impactEvery: 14, camera: 0.3,  motionBlur: 0.3,  sfx: 0.3,  transitions: 0.3,  reverse: 0,    patterns: [[1, 0.8, 1.15, 1], [1, 0.75, 1], [0.9, 1.2, 1]] },
  VELOCITY_MEDIUM:    { label: 'Medium',    minSpeed: 0.5,  maxSpeed: 1.8, rampDur: [0.3, 0.8],  curves: ['ease-in-out', 'ease-out', 'ease-in-expo'],                    shotSeconds: [1.5, 3.5], impactEvery: 8,  camera: 0.5,  motionBlur: 0.5,  sfx: 0.5,  transitions: 0.5,  reverse: 0,    patterns: [[1, 0.5, 1.4, 0.8, 1.2], [0.6, 1, 1.6, 1], [1.2, 0.6, 1.7, 1]] },
  VELOCITY_HARD:      { label: 'Hard',      minSpeed: 0.35, maxSpeed: 2.5, rampDur: [0.2, 0.55], curves: ['ease-in-expo', 'ease-out-expo', 'ease-in-out-cubic', 'overshoot:0.1'], shotSeconds: [1, 2.6],   impactEvery: 4,  camera: 0.75, motionBlur: 0.75, sfx: 0.75, transitions: 0.7,  reverse: 0.05, patterns: [[0.35, 1, 2.5, 0.5, 'impact', 1.5], [1, 0.4, 2.2, 1, 'impact', 0.6, 1.8], [2, 0.35, 1.2, 2.5, 'impact', 1]] },
  VELOCITY_INSANE:    { label: 'Insane',    minSpeed: 0.2,  maxSpeed: 4,   rampDur: [0.12, 0.4], curves: ['ease-in-expo', 'ease-out-expo', 'ease-in-out-expo', 'overshoot:0.18', 'spring:0.2,2'], shotSeconds: [0.6, 1.8], impactEvery: 2.5, camera: 0.95, motionBlur: 0.95, sfx: 0.95, transitions: 0.9, reverse: 0.18, patterns: [[0.2, 3, 0.3, 4, 'impact', 0.25, 3.5, 0.6], [1, 0.2, 4, 0.25, 2.5, 'impact', 3], [3.5, 0.25, 'impact', 2, 0.3, 4]] },
  VELOCITY_CINEMATIC: { label: 'Cinematic', minSpeed: 0.25, maxSpeed: 1.4, rampDur: [0.8, 2],    curves: ['ease-in-out', 'smootherstep', 'ease-in-out-cubic'],           shotSeconds: [2.5, 6],   impactEvery: 9,  camera: 0.5,  motionBlur: 0.6,  sfx: 0.4,  transitions: 0.3,  reverse: 0,    patterns: [[1, 0.3, 1], [0.5, 1, 1.2, 0.6], [1.2, 0.4, 0.9, 'impact', 0.5]] },
  VELOCITY_TRAP:      { label: 'Trap',      minSpeed: 0.4,  maxSpeed: 2.2, rampDur: [0.15, 0.5], curves: ['overshoot:0.12', 'ease-in-expo', 'bezier:0.7,0,0.2,1'],       shotSeconds: [0.8, 2.4], impactEvery: 3.5, camera: 0.7, motionBlur: 0.7,  sfx: 0.7,  transitions: 0.65, reverse: 0.1,  patterns: [[1, 0.4, 'impact', 2, 0.5, 1], [0.5, 1, 2.2, 0.6, 'impact', 1.4]] },
  VELOCITY_PHONK:     { label: 'Phonk',     minSpeed: 0.4,  maxSpeed: 2.8, rampDur: [0.15, 0.5], curves: ['ease-in-expo', 'overshoot:0.15', 'ease-out-cubic'],           shotSeconds: [0.7, 2.2], impactEvery: 3,  camera: 0.8,  motionBlur: 0.8,  sfx: 0.8,  transitions: 0.7,  reverse: 0.1,  patterns: [[0.5, 1.4, 0.4, 2.4, 'impact', 1], [1, 0.4, 2.8, 0.7, 'impact', 1.8], [2, 0.5, 'impact', 2.6, 0.6]] },
  VELOCITY_EDM:       { label: 'EDM',       minSpeed: 0.6,  maxSpeed: 2.2, rampDur: [0.25, 0.7], curves: ['ease-in-out-cubic', 'ease-out-expo', 'smoothstep'],           shotSeconds: [0.8, 2.4], impactEvery: 4,  camera: 0.7,  motionBlur: 0.65, sfx: 0.65, transitions: 0.7,  reverse: 0.05, patterns: [[1, 0.6, 1, 2, 'impact', 1.2], [1.5, 0.5, 1.5, 2.2], [0.7, 1.8, 0.7, 2]] },
  VELOCITY_SPORT:     { label: 'Sport',     minSpeed: 0.25, maxSpeed: 2,   rampDur: [0.2, 0.6],  curves: ['ease-in-out', 'ease-out-expo', 'ease-in-cubic'],              shotSeconds: [1, 2.8],   impactEvery: 4,  camera: 0.7,  motionBlur: 0.75, sfx: 0.7,  transitions: 0.6,  reverse: 0.03, patterns: [[1, 0.25, 'impact', 1.8, 1], [1.4, 0.3, 1, 2], [1, 0.5, 'impact', 0.3, 1.6]] },
  VELOCITY_CAR:       { label: 'Car',       minSpeed: 0.4,  maxSpeed: 2.4, rampDur: [0.3, 0.8],  curves: ['ease-in-out-cubic', 'ease-out-expo', 'smootherstep'],         shotSeconds: [1.2, 3],   impactEvery: 6,  camera: 0.65, motionBlur: 0.85, sfx: 0.6,  transitions: 0.55, reverse: 0,    patterns: [[1, 0.5, 1.8, 0.7, 1.4], [0.7, 1.5, 2.2, 1], [1.6, 0.5, 2.4, 1]] },
  VELOCITY_MILITARY:  { label: 'Military',  minSpeed: 0.4,  maxSpeed: 2,   rampDur: [0.25, 0.7], curves: ['ease-in-out-cubic', 'ease-out-expo', 'ease-in-expo'],         shotSeconds: [1.2, 3.2], impactEvery: 5,  camera: 0.6,  motionBlur: 0.6,  sfx: 0.7,  transitions: 0.45, reverse: 0,    patterns: [[1, 0.5, 1.2, 'impact', 0.8, 1.4], [0.6, 1, 0.5, 1.6], [1.5, 0.4, 'impact', 1.2]] },
};

export const VELOCITY_PROFILE_IDS = Object.keys(VELOCITY_PROFILES);

/** Map free words to a profile ("insane", "cinematic velocity", "fast but clean"...). Used when the prompt names none. */
export function profileForDials({ velocity = 0.5, speedVariation = 0.5, cutFrequency = 0.5 }, hint = null) {
  if (hint && VELOCITY_PROFILES[hint]) return hint;
  const v = (velocity * 0.5 + speedVariation * 0.3 + cutFrequency * 0.2);
  if (v < 0.2) return 'VELOCITY_SOFT'; if (v < 0.4) return 'VELOCITY_MEDIUM'; if (v < 0.7) return 'VELOCITY_HARD'; return 'VELOCITY_INSANE';
}
