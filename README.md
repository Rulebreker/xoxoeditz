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

## Known limits (honest list)

* Not yet validated in real After Effects (see status above). Property paths for text animators / shape trim paths
  and effect parameter names are the most likely things to need version-specific tweaks — each has a fallback.
* `map` graphics, parallax, freeze frames/time-remap, per-word caption emphasis, preset 3D camera rigs and Lumetri-based grading are **TODO** (3D cameras, mattes, masks and blend modes are reachable today through `advanced` ops).
* Whisper transcription is wired to the `openai-whisper` CLI's JSON output but has not been run against a real install.
* Quality of auto-synthesised SFX is basic; supply real SFX/music for premium results.
* Creative quality comes from Claude following the Director rules — the built-in baseline director is a draft.

## Docs
[Architecture](docs/ARCHITECTURE.md) · [Installation](docs/INSTALLATION.md) · [Plan format](docs/PLAN_FORMAT.md) ·
[AE integration](docs/AE_INTEGRATION.md) · [MCP](docs/MCP.md) · [Development](docs/DEVELOPMENT.md) ·
[Troubleshooting](docs/TROUBLESHOOTING.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

MIT licensed.
