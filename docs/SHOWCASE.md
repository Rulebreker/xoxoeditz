# Showcase: the first real autonomous edit

`xoxo showcase <name>` runs the whole pipeline on the media in `assets/` inside **your real After Effects** and produces a
20-30 s finished video plus an evidence-based report. It stops immediately (and says so in the report) if real After
Effects, `aerender`, FFmpeg or FFprobe are not reachable - it never substitutes the simulator.

```
node bin/xoxo.js doctor --connect                 # must be green first
node bin/xoxo.js showcase real-test --assets assets --title "My Title" --brief "what the video is about"
# optional: --target 25  --resolution 1080p|4k  --aspect 16:9|9:16  --style cinematic|tech|youtube|...  --script f.txt | --subtitles f.srt  --no-captions
```
Defaults: 1080p / 24 fps (use `--resolution 4k` for UHD), `renders/final.mp4`, title from `--title` > a quoted phrase in the
brief > the most emphasised name in the narration > the project name.

## Steps (all reported with timings)
1 preflight (real AE, scripting prefs, FFmpeg) → 2 project → 3 scan/classify/probe (+thumbnails) → 4 narration analysis
(script/SRT if present, Whisper if installed, else pauses) → 5 curated plan → 6 validate → 7 build in After Effects
(comps, imports, timeline, camera moves, transitions, title/text, captions, music + ducking, SFX, looks) → QA →
auto-repair → save `.aep` + versioned checkpoint → 8 `aerender` → FFmpeg H.264 → ffprobe verification.

## What it decides on its own (and logs in `edit-plan.json › _decisions`)
Length from the narration (20-30 s, trimmed at a pause if longer) · cuts on sentence ends/pauses · opener/closer = strongest
assets (resolution, orientation, footage) · assets matched to what is said · portrait media not forced into a landscape
frame · each asset used before any is repeated, reused footage uses a different segment · subtle camera moves, never the
same twice in a row · dissolves by default, one distinct transition only at a real topic change · a title, one supporting
graphic (a spoken number → animated stat, else the key named entity), kept out of the caption zone · music at −22 dB ducked
a further 11 dB under measured speech · SFX from your files, synthesised only if you have none.

## Output (`projects/<name>/`)
`<name>.aep` · `edit-plan.json` (+ `plan.json`) · `build-report.json` · `QA_REPORT.json` · `renders/final.mp4` ·
`REAL_EDIT_REPORT.md` (assets, scenes, effects *as executed*, fallbacks, audio, render settings, ffprobe verification,
QA, limitations). The report is written even on failure and says exactly which step failed.

## Limits to expect
The built-in director cannot *see* your pictures (it uses file names, descriptions in `assets.manifest.json`, resolution and
orientation). For the best result run it in a Claude Code session that opens the thumbnails (`/edit`), then refine
`plan.json` and re-run `xoxo edit` / `xoxo render`.
