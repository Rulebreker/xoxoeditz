# Installation

## Requirements
| Need | Notes |
|------|-------|
| Adobe After Effects | A licensed install. 2022+ recommended (`app.fonts` needs 24.0+, otherwise fonts fall back to Arial). |
| Node.js ≥ 20 | https://nodejs.org — no `npm install` needed; the project has zero dependencies. |
| FFmpeg + FFprobe | `winget install Gyan.FFmpeg` / `brew install ffmpeg` / apt. Asset probing, narration analysis, H.264 output, verification. |
| Claude Code | https://claude.com/claude-code |
| Optional | Adobe Media Encoder (alternative renderer), `whisper` CLI (transcription), Python (not required). |

## Steps (Windows)
1. **Allow scripts to write files** — After Effects ▸ *Edit ▸ Preferences ▸ Scripting & Expressions* ▸ ☑ *Allow Scripts to Write Files and Access Network*. (The bridge communicates through files; without this nothing works. `xoxo doctor` detects it.)
2. Clone and set up:
   ```
   git clone https://github.com/Rulebreker/xoxoeditz
   cd xoxoeditz
   npm run setup
   ```
   `setup` writes the bridge scripts to `.xoxo/bridge/` and runs the doctor.
3. Verify with the real application:
   ```
   node bin/xoxo.js doctor --connect     # may launch After Effects (up to a few minutes cold)
   node bin/xoxo.js selftest             # tiny project: build, QA, render
   ```
4. `claude` in the repository folder. Accept the project MCP server (`.mcp.json`) when asked.

## Optional: live listener (faster)
The default one-shot transport launches `AfterFX -r script.jsx` per call (works with no install). For lots of small
calls the listener is quicker: in After Effects ▸ *File ▸ Scripts ▸ Run Script File…* ▸ `.xoxo/bridge/listener.jsx`.
To start it automatically: `node bin/xoxo.js setup --startup` (writes a loader into `Scripts/Startup`; needs
permission to write to the install folder — run the terminal as Administrator once).

## Configuration
Everything is auto-detected. Override only if needed, in `xoxo.config.json` (git-ignored; template:
`examples/xoxo.config.example.json`) or environment variables:

| Setting | Env var | Meaning |
|---------|---------|---------|
| `aePath` | `XOXO_AE_PATH` | `AfterFX.exe` or the `Adobe After Effects 20xx` folder (if installed somewhere unusual) |
| `aerenderPath` | `XOXO_AERENDER_PATH` | explicit `aerender` |
| `ffmpeg` / `ffprobe` | `XOXO_FFMPEG` / `XOXO_FFPROBE` | binaries not on PATH |
| `transport` | `XOXO_TRANSPORT` | `auto` (default) · `listener` · `cli` · `mock` |
| `bridgeDir` | `XOXO_BRIDGE_DIR` | where job files live |
| `allowRawEval` | `XOXO_ALLOW_RAW_EVAL=1` | allow arbitrary ExtendScript (**off**) |
| (root folder) | `XOXO_ROOT` | where `assets/`, `projects/`, `.xoxo/` live (default: the repository) |

## macOS / Linux
macOS: discovery and the AppleScript launch path exist but are **untested**. Linux: no After Effects; use
`--dry-run` (simulator) — useful for plan development, CI and the test-suite.
