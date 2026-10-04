---
description: Autonomous music/beat-driven edit (velocity, cinematic, commercial, ...) from a folder of media
argument-hint: <assets folder> <edit type> "<brief>" [output folder]
---
Make an edit with the autonomous XOXOEDITZ engine.

Arguments: $ARGUMENTS

1. `xoxo_doctor` (fix every ✗). If the user has no SFX library, pass `starterSfx:true` and say the sounds are generated placeholders.
2. Run `xoxo_produce` with `assets`, `type`, `prompt` (the user's own words, unedited), `output`. Use `dryRun:true` first if After Effects may not be reachable.
3. Read `projects/<name>/EDIT_REPORT.md` and `CREATIVE_QA.json`. Say plainly what was simulated, what fell back, what the QA found.
4. Look at it: `xoxo_render preview:true` and open the extracted frames (Read tool). Judge pacing, cropping, type, colour.
5. Iterate without starting over: `xoxo_direct seed:N` for another cut, `overrides` for dials, or edit `plan.json` and `xoxo_edit` (incremental).
6. When approved: `xoxo_promote to:final`, build, `xoxo_render`. Report the output path, every fallback, and anything unverified.

Never call a `--dry-run` result finished: it renders nothing. See docs/V4.md.
