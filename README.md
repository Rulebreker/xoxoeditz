# XOXOEDITZ

**Assets + a plain-English brief → a finished video, built inside your own Adobe After Effects by Claude Code.**

XOXOEDITZ is an open-source autonomous editing agent. You clone it, open a terminal in the folder, start
[Claude Code](https://claude.com/claude-code), drop in your footage / images / narration and say what you want. The
agent inspects your machine, connects to After Effects, analyses your media and narration, writes an edit plan,
builds the project (compositions, timeline, camera moves, typography, motion graphics, transitions, SFX, music
ducking, captions, look), checks its own work, repairs problems, renders, and verifies the output file. You never
open After Effects.

```
cd xoxoeditz
claude
> Create a 7-minute cinematic J-20 documentary. Use the narration in assets/narration.wav and the images and
> footage in assets/. Serious, premium. Animated specs, callouts, sound design, pro typography. Export 4K 16:9.
```

> **Status — read this.** Everything in the pipeline is covered by an automated test-suite that runs against a
> built-in *simulator* of the After Effects scripting DOM plus real FFmpeg media. The ExtendScript host has **not yet
> been validated inside a real After Effects** by this repository's author (it was built on a machine without
> one). The first thing a new user should do is run `xoxo doctor --connect` and `xoxo selftest`; they exercise the
> real application end-to-end and tell you precisely what works on your version. See
> [docs/AE_INTEGRATION.md](docs/AE_INTEGRATION.md#verification-status).

## Two ways to work

**Autonomous (V4)** — one command, music/beat-driven edits:

```
xoxo edit --assets "D:\Projects\J20\INPUT" --type velocity --prompt "aggressive J20 stealth fighter edit, military look, 30 seconds" --output "D:\Projects\J20\OUTPUT"
```
It scans your media, finds the beat of your music (or the best track in your universal library), cuts on the beat, ramps
speed into impacts, picks camera moves, transitions, type and sound effects, builds the project in After Effects, checks its
own work (project QA *and* creative QA: slideshow? zoom-only? cuts off the beat?), repairs, renders and verifies. 23 edit
types, an optional `edit.config.json`, draft/preview/final tiers. Start at **[docs/V4.md](docs/V4.md)**.

**Directed (Claude as the editor)** — narration-driven films: you describe, Claude writes `plan.json` scene by scene using
the subagents in `.claude/agents/` (below).

## What it does

| Stage | What happens |
|-------|--------------|
| Detect | OS, After Effects install/version, `aerender`, Media Encoder, FFmpeg, Python, Whisper, fonts, plugins, installed effects — **discovered, never assumed** → `.xoxo/capabilities.json` |
| Understand | Classifies every asset (video/image/audio/music/SFX/fonts/subtitles/scripts), probes metadata, finds narration pauses/speech/loudness, aligns a script or SRT, proposes scenes |
| Direct | Claude (using the subagents in `.claude/agents/`) writes `plan.json`: scenes timed to the narration, assets matched by meaning, graphics, transitions, sound intent |
| Edit | Compiles the plan into idempotent After Effects work: folders, imports, `COMP_MASTER` + `COMP_SCENE_nn`, camera moves, text/shape graphics, transitions, audio with narration-aware ducking, captions, grade/grain/vignette/letterbox |
| Recover | Every step has fallbacks (native effect → simpler equivalent → hard cut); failures are diagnosed, retried with the next alternative, and reported |
| Verify | Eight QA checks → `QA_REPORT.json`; auto-repairs out-of-frame text, missing layers, un-ducked music, muted narration… |
| Render | `aerender` → lossless/ProRes → FFmpeg H.264/H.265, or Media Encoder; output verified with ffprobe (size, fps, duration, audio, not-black) |

Output defaults to 3840×2160 / 16:9 / 24 fps but any of 720p…8K, 9:16, 1:1, 2.39:1 works.

## Quick start (Windows)

1. Install **After Effects** (2022+ recommended), **Node.js 20+**, **FFmpeg** (`winget install Gyan.FFmpeg`), **Git** and **Claude Code**.
2. In After Effects: *Edit ▸ Preferences ▸ Scripting & Expressions ▸ ☑ Allow Scripts to Write Files and Access Network*.
3. ```
   git clone https://github.com/Rulebreker/xoxoeditz && cd xoxoeditz
   npm run setup          # installs the bridge scripts and runs the doctor
   node bin/xoxo.js doctor --connect      # FFmpeg not on PATH? node bin/xoxo.js config set ffmpeg "<path to ffmpeg.exe>"  (same for ffprobe)
   node bin/xoxo.js selftest      # builds + renders a tiny project in the real After Effects
   claude
   ```
4. Put your media in `assets/`, tell Claude what you want.

macOS is supported on a best-effort basis (untested); Linux works for everything except real After Effects
(dry-runs, tests, CI). Full details: [docs/INSTALLATION.md](docs/INSTALLATION.md).

## First real test
`node bin/xoxo.js showcase real-test --assets assets --brief "..."` builds, QA's, renders and verifies a 20-30 s edit in your real After Effects and writes `REAL_EDIT_REPORT.md` - see [docs/SHOWCASE.md](docs/SHOWCASE.md).

## Commands

```
xoxo doctor [--connect]      xoxo new <name>            xoxo assets [--thumbs]     xoxo narration [--script f]
xoxo plan --scaffold|--validate|--show    xoxo edit [--dry-run]    xoxo verify    xoxo render [--preview --range a:b]
xoxo status    xoxo auto <name> --assets dir --brief "…"    xoxo effects    xoxo bridge install|ping|ops|call
xoxo selftest    xoxo sfx <kind>    xoxo mcp    xoxo setup    xoxo detect    xoxo config        (all take --json)

# autonomous engine (docs/V4.md)
xoxo edit --assets DIR --type T --prompt "…" [--output DIR --quality draft|preview|final --set velocity=0.8 --dry-run]
xoxo direct [project]    xoxo beats AUDIO    xoxo library init|scan|starter|search "fast transition"
xoxo critique [project]    xoxo promote PROJECT --to final    xoxo memory show|like|dislike|reset
xoxo benchmark velocity|cinematic|documentary|commercial|all [--dry-run]
xoxo project status|save|close     # what's open in After Effects, who owns it; --discard only when YOU want a foreign unsaved project dropped
```
Claude Code also gets the same capabilities as MCP tools (`xoxo_*`, see [docs/MCP.md](docs/MCP.md)).

## How it controls After Effects

ExtendScript (`jsx/`) — After Effects' stable, documented scripting API — runs *inside* the application as a small
set of typed, idempotent operations. Node talks to it through a file-based bridge: either one-shot (`AfterFX -r`, no
setup) or a live listener (faster). No mouse automation, no screen coordinates; it doesn't care about your monitor,
theme, panel layout or AE version. Details and limits: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/AE_INTEGRATION.md](docs/AE_INTEGRATION.md).

## Safety

Assets are untrusted data and never executed. External programs are spawned without a shell from an allowlist.
Raw script evaluation is off by default. Nothing is downloaded or installed without your approval. No keys or paths
are hard-coded; nothing user-specific is committed. See [SECURITY.md](SECURITY.md).

## Verification status of the autonomous engine

Tested automatically, deterministically, against the simulator and real FFmpeg media: the prompt/config interpreter, beat
engine (synthetic ground truth), speed maps, motion/camera maths (edge coverage fuzzed), transitions, typography, compositing,
SFX search + fit, the Director, creative QA (plan, and render checks on FFmpeg clips with planted defects), tiers, memory,
incremental builds, and four benchmarks. **Not yet verified in a real After Effects:** time remap, track mattes, the new
effects' parameter names, word-level text animators, 4K performance. **Not tested on real music:** the beat engine.
`xoxo benchmark velocity` (without `--dry-run`) is the one command that settles the first; see [docs/V4.md](docs/V4.md#what-is-verified-and-how).

## Known limits (honest list)

* Not yet validated in real After Effects (see status above). Property paths for text animators / shape trim paths
  and effect parameter names are the most likely things to need version-specific tweaks — each has a fallback.
* `map` graphics / `MAP_SCENE` (needs map data), per-word caption emphasis, preset 3D camera rigs, precomp-per-panel PIP/split motion and Lumetri-based grading are **TODO** (3D cameras, mattes, masks and blend modes are reachable today through `advanced` ops).
* Whisper transcription is wired to the `openai-whisper` CLI's JSON output but has not been run against a real install.
* Quality of auto-synthesised SFX is basic; supply real SFX/music for premium results.
* Creative quality comes from Claude following the Director rules — the built-in baseline director is a draft.

## Docs
[Autonomous engine](docs/V4.md) · [Edit types](docs/EDIT_TYPES.md) · [Library](docs/LIBRARY.md) · [Beats](docs/BEATS.md) · [Velocity](docs/VELOCITY.md) · [Motion & camera](docs/MOTION_AND_CAMERA.md) · [Shots, effects](docs/SHOT_TEMPLATES.md) · [Timeline plan](docs/TIMELINE_PLAN.md) · [Creative QA](docs/CREATIVE_QA.md) · [Benchmarks](docs/BENCHMARKS.md) ·
[Architecture](docs/ARCHITECTURE.md) · [Installation](docs/INSTALLATION.md) · [Plan format](docs/PLAN_FORMAT.md) ·
[AE integration](docs/AE_INTEGRATION.md) · [MCP](docs/MCP.md) · [Development](docs/DEVELOPMENT.md) ·
[Troubleshooting](docs/TROUBLESHOOTING.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

MIT licensed.
