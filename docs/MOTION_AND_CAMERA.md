# Motion, camera and depth

## Motion primitives

A primitive is a small pure function of time returning a *delta*: image translation (fraction of the frame), scale
multiplier, rotation. 14 exist — PUSH, PULL, DRIFT, ORBIT, PAN, TILT, WHIP, SHAKE, BOUNCE, IMPACT, REVEAL, FOLLOW, TRACK,
PARALLAX (table with descriptions in [SHOT_TEMPLATES.md](SHOT_TEMPLATES.md#motion-primitives-composable-into-one-keyframe-track)).
They are plain JSON (`{"type":"PUSH","amount":0.12,"curve":"ease-out-expo","at":0.4,"dur":0.6}`) so they live in
`plan.json` and can be hand-edited. **They compose**: offsets and rotation add, scales multiply, and the sum is sampled
*once* into a single `scale`/`position`/`rotation` keyframe track — a push-in, a beat impact, a shake and a transition whip
share one set of keyframes instead of fighting over the same property. Shake is seeded: the same plan always shakes the same way.

## Edges never show

Moving a picture around a frame exposes its edge. `buildCameraTrack` therefore:

1. computes, for every sampled frame, the smallest scale that keeps the whole comp rectangle covered (corner test, including rotation
   and the off-centre position of cropped layers);
2. if that exceeds the rig's `maxLift` (1.15 documentary … 1.6 action), **reduces the move's amplitude** by bisection and records
   `motion amplitude reduced to N%` — it never exceeds the cap and never lets an edge show;
3. otherwise lifts the picture uniformly by the (small) required factor — so the move keeps its shape;
4. exempts transition moves inside their window (the neighbouring shot covers the picture there);
5. simplifies with Ramer-Douglas-Peucker (≈2 px at 4K) so a 3 s push is ~10 keys, not 72;
6. reports `upscale` (>1.5× magnification warns about softness) and `motionBlur` (peak speed > 45 % of the frame per second).

This is fuzzed in the tests over every primitive and several aspect ratios and source sizes: `verifyCoverage` reads the
finished keyframes back and finds nothing uncovered.

## Camera rigs

A rig is a personality; the planner picks moves from it with weights, history and a seed. Moves never repeat within two shots,
consecutive shots prefer different *families* (dolly, pan, drift, orbit, follow, reveal, whip, impact, handheld …), direction
alternates, beat impacts become `IMPACT` hits (at most 3 per shot, ≥ 0.25 s apart), subjects found by the saliency analysis
steer `FOLLOW`/focus pushes, and an explicit `motion` in the plan (`push_in`, `pan_left` …) always wins exactly as written.

| Rig | Character |
|-----|-----------|
| CAMERA_CINEMATIC | slow weighty dolly / arc / drift, long easing, gentle handheld on intense shots |
| CAMERA_VELOCITY | punch-ins, whips, slides, shake on impacts, ease-out-expo |
| CAMERA_DOCUMENTARY | observational Ken Burns, subject-aware, no shake, no whips |
| CAMERA_PRODUCT | smooth orbits and pushes to detail, subject-focused, no shake |
| CAMERA_ACTION | constant handheld, hard pushes, whips, big hits |

## 2.5D and parallax (without a depth map)

With a flat picture the engine fakes depth by stacking copies of the *same* footage: a softened background that moves little
and a feathered cut-out around the detected subject that moves and pushes more (`planParallax`). The subject comes from a
saliency analysis of a 64×36 decode; if its confidence is below 0.3 or it fills the frame, the plan **falls back to a single
layer and says why** instead of cutting a random rectangle out of the picture. Crops that would magnify a source more than 2.2×
are flagged as `SOFT_CROP`.

## Limits

* A mask lives in layer space, so a masked layer's window moves with the layer: PIP and split-screen panels are placed
  statically (they slide in, then hold). Moving the picture *inside* a fixed window needs a precomp per panel — TODO.
* The 2.5D cut-out is a feathered ellipse around a saliency box. It is not a rotoscope; thin or complex subjects will show it.
* Transitions on multi-layer shots act on every full-frame layer; a track-matte wipe can only matte one, so the linear-wipe
  version (default) is used whenever the effect exists.
* Everything here is verified against the simulator, **not** real After Effects.
