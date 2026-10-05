# Timeline plan (version 2)

The scene plan ([PLAN_FORMAT.md](PLAN_FORMAT.md)) describes narration-driven films as scenes of clips. A **timeline plan**
describes music/beat-driven edits as a flat list of shots on one master timeline. `plan.json` has `"mode": "timeline"`,
`"version": 2`. The Director writes it; you may edit it; `xoxo edit <project>` builds it; `validateTimeline` checks it.

```jsonc
{
  "version": 2, "mode": "timeline", "title": "J20_STEALTH", "editType": "velocity", "seed": 7, "quality": "final",
  "directive": { "dials": {…}, "sources": { "transitions": "config.overrides", … }, "colorProfile": "MILITARY", "rig": "CAMERA_VELOCITY", "velocityProfile": "VELOCITY_HARD" },
  "output": { "width": 1920, "height": 1080, "fps": 30 },
  "audio": { "music": [{ "asset": "LIB_TRACK…", "gainDb": -5, "fadeIn": 0.25, "fadeOut": 2.3, "bpm": 128 }],
             "sfxEvents": [{ "id": "SFX_001", "role": "big_impact", "assetId": "LIB_DEEP_BOOM_01_…", "at": 15.0, "why": "drop",
                             "fit": { "layers": [{ "start": 14.98, "sourceIn": 0, "sourceOut": 2.2, "stretch": 1, "fadeIn": 0.004, "fadeOut": 0.5, "gainDb": -9 }] } }] },
  "look": { "color": "MILITARY", "strength": 0.9, "grain": 0.3, "vignette": 0.4, "glow": 0.3, "letterbox": true },
  "beatMap": { "bpm": 128, "virtual": false, "beats": […], "drops": [15.0], "impacts": […], "sections": […] },
  "timeline": {
    "duration": 30, "fps": 30, "bpm": 128,
    "shots": [{ "id": "S03", "start": 3.75, "end": 5.2, "template": "CROP_DETAIL", "role": "detail",
                "layers": [{ "kind": "footage", "name": "S03_MAIN", "asset": "VID_…", "crop": {…}, "rect": {…},
                             "motion": [{ "type": "PUSH", "amount": 0.2, "curve": "ease-out-expo" }, { "type": "IMPACT", "at": 0.4, "amount": 0.08 }],
                             "remap": { "profile": "VELOCITY_HARD", "map": { "segments": […] }, "sourceIn": 3.1, "frameBlend": "pixel" } }],
                "text": […], "overlays": […], "camera": { "rig": "CAMERA_VELOCITY", "move": "punch-in", "family": "dolly" } }],
    "transitions": [{ "index": 2, "type": "whip", "d": 0.23, "cut": 5.2, "window": {…}, "motion": { "outgoing": […], "incoming": […] }, "sfx": { "role": "whip", "at": 5.2 } }]
  }
}
```

## Rules the validator enforces

* Shots are contiguous, start at 0, end at `timeline.duration`; ids and layer names are unique; no shot shorter than 2 frames.
* `transitions.length === shots.length - 1`; a transition fits inside half of the shorter neighbouring shot and is centred on the cut.
* A speed map lasts exactly as long as its shot; the source in-point exists in the clip.
* Templates must exist and be implemented (`MAP_SCENE` is a documented TODO and is refused).
* Footage assets, music and SFX must exist in the project manifest **or** the library; SFX events carry their fit plan.
* Motion primitive types must exist; the colour look must be one of the nine.
* Text: every item sits inside its shot (`at`/`start` ≥ shot start, `end` ≤ shot end), has a known role (`kind`), a unique id, and may not be
  visible together with a text it may not share the frame with (see SHOT_TEMPLATES.md ▸ Text kinds) unless `allowOverlap: true`.
  `normalizeTimeline` completes hand-written items: `start`/`end`/`duration`, `shotId`/`sceneId`, `role`, a deterministic `TXT_<ROLE>_<nn>` id,
  `required` (default false; the Director sets it for the title and end card) and a `layout` (safe-area fit).

## How a shot becomes layers

A shot extends half a transition earlier and later than its cut, so both layers cover the transition window. The
shot's camera moves **and** the transition's moves are sampled into one `scale`/`position`/`rotation` track; the
picture is lifted uniformly so no edge shows outside transitions (see [MOTION_AND_CAMERA.md](MOTION_AND_CAMERA.md)).
Each shot is one unit with alternatives `full → constant_speed → static → placeholder`, so a failing time-remap or effect
never leaves a hole. Layer z-order is re-established by a final `layers_reorder` unit.

## Incremental builds

`build-state.json` records a hash per unit, the names each unit owns and a structure hash. A second build reuses unchanged
units; editing one shot rebuilds only that shot; deleting or moving shots triggers a clean rebuild. The state is only
trusted when the saved `.aep` is exactly the one the last build produced (a simulator project is only reusable inside the
process that built it).
