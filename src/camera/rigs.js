// CAMERA RIGS: a rig is a *personality* for camera work. Given a shot (duration, role, beats, impacts, subject) it
// chooses a move - or a short stack of moves - from motion primitives. Choices are weighted, seeded and
// history-aware, so a run of shots varies (no back-to-back repeats, directions alternate) yet is reproducible.

import { makeRng } from '../core/rng.js';
import { lerp } from '../motion/curves.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const centre = { x: 0.5, y: 0.5 };
const hasSubject = (shot) => shot.subject && (shot.subject.conf ?? 0) >= 0.25;
const subjectCentre = (shot) => (hasSubject(shot) ? { x: clamp(shot.subject.x + shot.subject.w / 2, 0.2, 0.8), y: clamp(shot.subject.y + shot.subject.h / 2, 0.2, 0.8) } : centre);

/** Beat/impact-linked camera hits for any rig: at most 3 per shot, at least 0.25 s apart, scaled by the rig's `hits` strength. */
function impactHits(shot, rig, rng) {
  const out = []; let last = -1;
  for (const at of (shot.impacts || []).filter((t) => t >= 0 && t < shot.dur - 0.05)) {
    if (out.length >= 3 || at - last < 0.25) continue; last = at;
    const a = (0.035 + 0.07 * shot.intensity) * rig.hits;
    out.push({ type: 'IMPACT', at: +at.toFixed(3), amount: +a.toFixed(4), dir: rng.pick([90, 270, 0, 180]), rollSign: rng.chance(0.5) ? 1 : -1, tag: 'beat' });
  }
  return out;
}

// Each move: { name, family, weight(shot, rig), build(shot, a, rng, sign) -> primitive specs }
// `a` is the amount for this shot (rig range × intensity × duration factor); `sign` alternates left/right between shots.
const M = {
  push: (curveName = 'smootherstep') => ({ name: 'push', family: 'dolly', weight: () => 3, build: (s, a) => [{ type: 'PUSH', amount: a, curve: curveName, focus: hasSubject(s) ? subjectCentre(s) : null }] }),
  pull: (curveName = 'smootherstep') => ({ name: 'pull', family: 'dolly', weight: () => 2, build: (s, a) => [{ type: 'PULL', amount: a, curve: curveName, focus: hasSubject(s) ? subjectCentre(s) : null }] }),
  drift: { name: 'drift', family: 'drift', weight: () => 2, build: (s, a, r, sign) => [{ type: 'DRIFT', amount: a * 0.9, dir: sign > 0 ? r.range(10, 35) : r.range(145, 170), curve: 'linear' }] },
  pan: (curveName = 'ease-in-out') => ({ name: 'pan', family: 'pan', weight: (s) => (s.dur >= 1 ? 2 : 1), build: (s, a, r, sign) => [{ type: 'PAN', amount: a * 1.4, dir: sign > 0 ? 0 : 180, curve: curveName }] }),
  tilt: { name: 'tilt', family: 'pan', weight: (s) => (s.isPortrait ? 2 : 1), build: (s, a, r, sign) => [{ type: 'TILT', amount: a * 1.2, dir: sign > 0 ? 0 : 180 }] },
  orbit: { name: 'orbit', family: 'orbit', weight: (s) => (s.dur >= 2.5 ? 1.6 : 0.2), build: (s, a, r, sign) => [{ type: 'ORBIT', amount: a * 0.75, sweep: 75 * sign, phase: -35 * sign, roll: 1.1, curve: 'smootherstep' }] },
  follow: { name: 'follow', family: 'follow', weight: (s) => (hasSubject(s) ? 3.5 : 0), build: (s, a) => [{ type: 'FOLLOW', amount: a, subject: subjectCentre(s), strength: 0.55, curve: 'ease-in-out' }] },
  reveal: { name: 'reveal', family: 'reveal', weight: (s) => (s.index === 0 || s.role === 'hero' ? 2.5 : 0.5), build: (s, a) => [{ type: 'REVEAL', amount: a * 1.6, focus: hasSubject(s) ? subjectCentre(s) : null }] },
  pushDrift: { name: 'push+drift', family: 'combo', weight: () => 1.5, build: (s, a, r, sign) => [{ type: 'PUSH', amount: a * 0.8, curve: 'ease-in-out' }, { type: 'DRIFT', amount: a * 0.7, dir: sign > 0 ? 15 : 165 }] },
  handheld: (amp) => ({ name: 'handheld', family: 'handheld', weight: (s) => 0.4 + s.intensity * 1.2, build: (s, a, r) => [{ type: 'PUSH', amount: a * 0.6, curve: 'ease-in-out' }, { type: 'SHAKE', amount: amp, freq: r.range(1.6, 2.8), decay: 0, roll: 25, seed: r.int(1, 9999) }] }),
  punchIn: { name: 'punch-in', family: 'dolly', weight: () => 3, build: (s, a) => [{ type: 'PUSH', amount: a, dur: Math.min(s.dur, 0.7), curve: 'ease-out-expo' }] },
  pushHard: { name: 'push-hard', family: 'dolly', weight: () => 2.5, build: (s, a) => [{ type: 'PUSH', amount: a * 1.2, curve: 'ease-in-out-expo' }] },
  pullSnap: { name: 'pull-snap', family: 'dolly', weight: () => 1.6, build: (s, a) => [{ type: 'PULL', amount: a, dur: Math.min(s.dur, 0.8), curve: 'ease-out-expo' }] },
  slide: { name: 'slide', family: 'pan', weight: () => 1.6, build: (s, a, r, sign) => [{ type: 'PAN', amount: a * 1.6, dir: sign > 0 ? 0 : 180, curve: 'ease-in-out-expo' }] },
  whipIn: { name: 'whip-in', family: 'whip', weight: (s) => (s.index > 0 ? 2.2 : 0), build: (s, a, r, sign) => [{ type: 'WHIP', mode: 'in', dur: 0.18, amount: 0.3 + a, dir: sign > 0 ? 0 : 180 }, { type: 'PUSH', amount: a * 0.5, curve: 'ease-out' }] },
  whipOut: { name: 'whip-out', family: 'whip', weight: (s) => (s.hasNext && s.dur > 0.5 ? 1.5 : 0), build: (s, a, r, sign) => [{ type: 'PUSH', amount: a * 0.5, curve: 'ease-in' }, { type: 'WHIP', mode: 'out', at: Math.max(0, s.dur - 0.16), dur: 0.16, amount: 0.3 + a, dir: sign > 0 ? 0 : 180 }] },
  bounce: { name: 'bounce', family: 'bounce', weight: (s) => (s.dur > 0.6 ? 1 : 0), build: (s, a) => [{ type: 'BOUNCE', amount: a * 0.6 }] },
  shakeHit: (amp) => ({ name: 'shake-hit', family: 'impact', weight: (s) => ((s.impacts || []).length ? 3 : 0.6), build: (s, a, r) => { const at = (s.impacts || [])[0] ?? Math.min(0.15, s.dur * 0.2); return [{ type: 'PUSH', amount: a * 0.5, curve: 'ease-out' }, { type: 'IMPACT', at, amount: a * 0.6, dir: r.pick([90, 270]) }, { type: 'SHAKE', at, dur: Math.min(0.45, s.dur - at), amount: amp, freq: r.range(9, 13), decay: 1.5, seed: r.int(1, 9999) }]; } }),
  held: { name: 'held', family: 'static', weight: () => 0.35, build: () => [{ type: 'DRIFT', amount: 0.012, dir: 20 }] },
};

export const RIGS = {
  CAMERA_CINEMATIC: { id: 'CAMERA_CINEMATIC', doc: 'Slow, weighty dolly and arc moves with long easing; occasional gentle handheld on intense shots.', amount: [0.06, 0.16], maxLift: 1.22, hits: 0.4, nextBias: 0.7,
    moves: [M.push(), M.pull(), M.drift, M.orbit, M.follow, M.reveal, M.pushDrift, M.handheld(0.004), M.held] },
  CAMERA_VELOCITY: { id: 'CAMERA_VELOCITY', doc: 'Punchy: fast ease-out-expo pushes, whips, slides, beat impacts and decaying shake.', amount: [0.14, 0.32], maxLift: 1.5, hits: 1.2, nextBias: 1,
    moves: [M.punchIn, M.pushHard, M.pullSnap, M.slide, M.whipIn, M.whipOut, M.shakeHit(0.014), M.bounce, M.follow, M.pan('ease-in-out-expo')] },
  CAMERA_DOCUMENTARY: { id: 'CAMERA_DOCUMENTARY', doc: 'Observational: slow subject-aware Ken Burns, steady pans and tilts, nothing flashy.', amount: [0.05, 0.12], maxLift: 1.15, hits: 0.1, nextBias: 0.5,
    moves: [M.follow, M.push('ease-in-out'), M.pan(), M.tilt, M.drift, M.pull('ease-in-out'), M.held] },
  CAMERA_PRODUCT: { id: 'CAMERA_PRODUCT', doc: 'Clean and deliberate: smooth orbits and pushes to detail, subject-focused, no shake.', amount: [0.06, 0.14], maxLift: 1.2, hits: 0.3, nextBias: 0.6,
    moves: [M.orbit, M.follow, M.push('smootherstep'), M.reveal, M.pushDrift, M.pull('smootherstep'), M.pan('smootherstep')] },
  CAMERA_ACTION: { id: 'CAMERA_ACTION', doc: 'Aggressive: constant handheld, hard pushes with overshoot, whips, big beat impacts.', amount: [0.16, 0.36], maxLift: 1.6, hits: 1.6, nextBias: 1,
    moves: [M.handheld(0.01), M.pushHard, M.punchIn, M.whipIn, M.whipOut, M.shakeHit(0.02), M.slide, M.bounce, M.pullSnap] },
};

export const RIG_NAMES = Object.keys(RIGS);
export function getRig(id) { const r = RIGS[String(id || '').toUpperCase()]; if (!r) throw new Error(`unknown camera rig "${id}" (known: ${RIG_NAMES.join(', ')})`); return r; }

/** Names a hand-written plan may use instead of a rig decision ('motion': 'push_in') -> primitive stacks. */
export const LEGACY = {
  push_in: (a) => [{ type: 'PUSH', amount: a }], pull_out: (a) => [{ type: 'PULL', amount: a }],
  pan_left: (a) => [{ type: 'PAN', amount: a * 1.4, dir: 180 }], pan_right: (a) => [{ type: 'PAN', amount: a * 1.4, dir: 0 }],
  pan_up: (a) => [{ type: 'TILT', amount: a * 1.2, dir: 180 }], pan_down: (a) => [{ type: 'TILT', amount: a * 1.2, dir: 0 }],
  drift: (a) => [{ type: 'DRIFT', amount: a }], static: () => [],
};

export class CameraPlanner {
  /**
   * @param {object} o { rig, seed, intensity (0..1 default), avoid: how many previous moves to avoid repeating (2) }
   */
  constructor({ rig = 'CAMERA_CINEMATIC', seed = 'camera', intensity = 0.5, avoid = 2 } = {}) {
    this.rig = getRig(rig); this.rng = makeRng('camera', this.rig.id, seed); this.intensity = intensity; this.avoid = avoid;
    this.history = []; this.sign = this.rng.chance(0.5) ? 1 : -1; this.count = 0;
  }

  /**
   * @param {object} shot { dur, role?, index?, hasNext?, impacts?: [s], subject?, isStill?, isPortrait?, intensity?, motion? (override) }
   * @returns {{ move, family, specs, amount, maxLift, sign, description }}
   */
  plan(shot) {
    const rig = this.rig; const rng = this.rng.fork(`shot${this.count}`);
    const s = { index: this.count, impacts: [], intensity: this.intensity, ...shot };
    s.intensity = clamp(s.intensity, 0, 1);
    const durFactor = clamp(Math.sqrt(s.dur / 3), 0.55, 1.5);
    const amount = +(lerp(rig.amount[0], rig.amount[1], s.intensity) * durFactor).toFixed(4);
    this.count += 1;
    let move; let specs;
    if (s.motion && LEGACY[s.motion]) { move = { name: s.motion, family: 'explicit' }; specs = LEGACY[s.motion](amount); } // an explicit override always wins
    else {
      const recent = this.history.slice(-this.avoid);
      const cands = rig.moves.map((m) => {
        let w = m.weight(s, rig); if (w <= 0) return null;
        if (recent.some((h) => h.name === m.name)) w *= 0.04;              // practically never repeat a move within `avoid` shots
        else if (recent.length && recent[recent.length - 1].family === m.family) w *= 0.45; // and prefer a different family
        return { m, w };
      }).filter(Boolean);
      const chosen = cands.length ? rng.weighted(cands).m : M.held;
      this.sign = -this.sign; // alternate direction shot to shot
      move = chosen; specs = chosen.build(s, amount, rng, this.sign);
    }
    if (!s.motion) specs = specs.concat(impactHits(s, rig, rng));
    const entry = { name: move.name, family: move.family };
    this.history.push(entry);
    return { move: move.name, family: move.family, specs, amount, maxLift: rig.maxLift, sign: this.sign, rig: rig.id, description: `${rig.id}: ${move.name}${specs.some((p) => p.tag === 'beat') ? ' + beat hits' : ''} (${amount})` };
  }
}
