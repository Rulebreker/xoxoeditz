# Velocity engine

A velocity edit is variable speed: slow into a hit, snap away, freeze, rewind, ramp. The engine represents speed as a
**speed map** — a list of segments `{dur, from, to, curve}` — whose integral is the source position. Any shape (smooth
ramps, exponential snaps, freezes, reverse stutters) is expressible, and exact: positions are integrated segment by segment,
so a freeze is a true discontinuity, not a smear.

```
speed map (what the Director chooses)  →  position table (exact integral)  →  time-remap keys (every 2 frames on ramps)
```

* **Profiles** — `VELOCITY_SOFT … INSANE`, `CINEMATIC`, `TRAP`, `PHONK`, `EDM`, `SPORT`, `CAR`, `MILITARY`: speed range, ramp
  lengths, curves, how often an impact occurs, reverse chance (table in [SHOT_TEMPLATES.md](SHOT_TEMPLATES.md#velocity-profiles)).
* **Curves** — ease families, expo, smoothstep, bezier, overshoot, anticipation, elastic, spring, impact, custom
  (`src/motion/curves.js`); the same vocabulary drives camera motion and text animation.
* **Variation** — a seeded planner picks a pattern and curve that differ from the previous shot's, jitters the speeds, and
  clamps to the profile; a 12-shot edit has 12 different maps (the benchmark checks it).
* **Pre-impact slow-down → freeze (2–4 frames) → post-impact snap** is generated as a unit and, for `IMPACT_SCENE`/`FREEZE_FRAME`
  shots, placed so the freeze starts *exactly* on the beat (`buildImpactMap`, `buildFreezeMap`).
* **Fitting** — `fitToSource` slows a map down (never below 0.45× of its shape) so it fits the clip; otherwise the Director
  picks another clip, and a warning is raised when it cannot.
* **Handles** — a shot's layer starts half a transition earlier and ends half a transition later; the remap extends the ends
  at the boundary speed so transitions have footage to show.
* **In After Effects** — the `time_remap` host op enables Time Remapping, replaces the default keys, sets in/out, and sets frame
  blending (`pixel` for slowed parts, `mix` otherwise) and motion blur.

## Limits

* Stills cannot be time-remapped; they get camera moves only (the Director does not pretend otherwise).
* If a map runs past the end of its clip the last frame holds and the build warns.
* Pixel-motion frame blending is slow to render; the draft tier turns it off.
* The `time_remap` op, frame-blending flags and motion blur behaviour are exercised against the simulator, **not** real After Effects yet.
