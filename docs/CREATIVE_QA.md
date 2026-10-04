# Creative QA, refinement, tiers and memory

QA in `QA_REPORT.json` asks "is the *project* sound?" (layers exist, text in frame, audio ducked …). **Creative QA**
asks what an editor would ask on a first look: *is this a slideshow? is the camera only ever zooming? do the cuts land on the
music? is there a sound on the drop? are two shots the same picture?* → `CREATIVE_QA.json`.

## Two levels

| Level | Needs | Examples |
|-------|-------|----------|
| **plan** (`xoxo critique`) | only `plan.json` | slideshow, zoom-only, static shots, repeated move, speed-ramp variety, cuts off the beat, drop with no cut / no hit, SFX gaps/density/level, transition repeats and palette violations, text density / fit / repeats, duplicate or near-duplicate neighbours, accidental boxes, blank shots, soft or tight crops, metronome pacing |
| **render** (`xoxo critique --render FILE`, automatic after a real render) | an actual video | black frames, frozen picture, unplanned letterbox bars, clipping, quiet or weak mix, silent stretches, missing audio stream, planned hard cuts that are not visible, sudden changes where none was planned |

The render checks compare with the **plan's intentions**: black in a dark title, a still text scene and a planned freeze frame
are not defects. All FFmpeg calls go through the single tool resolver (`shell:false`). Full list of codes:
[CREATIVE_QA_CODES.md](CREATIVE_QA_CODES.md).

Each finding belongs to a category (rhythm, motion, variety, transitions, sound, type, composition, pacing, render) and
lowers that category's score; the overall score weighs the average and the worst category (so one catastrophic area is not
hidden by seven good ones). The score compares attempts; it is not a measure of taste.

## Refinement

* `refineDirection` — generate-and-test on the plan: direct with seeds *s, s+1, …*, critique each, keep the best (fewest
  errors, then highest score). It stops as soon as a cut passes, and **stops early when nothing a new seed could change is wrong**
  (a pool of two photos cannot be fixed by reshuffling; the report says so). `xoxo edit` runs it (4 rounds; 2 for drafts).
* `previewLoop` — the render loop: render a preview → critique pixels and sound → re-direct only for findings a new cut could
  fix → rebuild → repeat; returns the best attempt, not the last. Rendering is injected, so it is unit-tested with fakes; it has
  **not** been run against real renders.

## Draft / preview / final

Three **separate projects** so a throw-away draft never touches a final: `<name>-draft` (~480p, no grain/glow/vignette/letterbox,
frame blending and motion blur off), `<name>-preview` (720p, the full look), `<name>` (full resolution).
`xoxo promote <name> --to final` copies the approved plan, scales every pixel value exactly (text layout, blur radii, widths)
and asks for a normal build — the editorial content (cuts, shots, camera, speed, SFX) is identical by construction, which the tests assert.

## Memory

Optional, local, on by default: `.xoxo/memory.json` holds **ids, ratings, counts and run summaries only — never file paths or
media**. `xoxo memory like|dislike <id>` nudges future choices; sounds and clips used in the last three productions are slightly
avoided so consecutive videos don't all open with the same whoosh. Memory biases the Director's scores; it never overrides
relevance. Off with `"memory": false` (edit.config.json), `XOXO_MEMORY=0`, or `xoxo memory reset`. Simulator runs are not recorded.
