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

## FFmpeg / FFprobe not on PATH
All FFmpeg/FFprobe (and optional Whisper) use goes through one resolver (`src/core/resolve-tool.js`). It tries, in order:

1. **explicit config** - `"ffmpeg"` / `"ffprobe"` in `xoxo.config.json` (easiest: `xoxo config set ffmpeg "<full path>"`)
2. **environment** - `XOXO_FFMPEG` / `XOXO_FFPROBE`
3. **PATH**
4. otherwise a clear failure that lists what was tried and why each was rejected.

A value may be the `.exe` (or extension-less), the `bin` folder, or the install folder; paths with spaces, forward or back
slashes, and surrounding quotes are fine. A candidate must exist and be directly executable (`.cmd`/`.bat` shims are
rejected: programs are always started without a shell). If a higher-priority source is invalid the next one is used and
`xoxo doctor` says so. `xoxo doctor` prints the path actually in use and where it came from.

```
:: Windows cmd (this terminal only; `setx` applies to terminals opened afterwards)
set XOXO_FFMPEG=C:\tools\ffmpeg\bin\ffmpeg.exe
set XOXO_FFPROBE=C:\tools\ffmpeg\bin\ffprobe.exe
# PowerShell
$env:XOXO_FFMPEG = "C:\tools\ffmpeg\bin\ffmpeg.exe"
$env:XOXO_FFPROBE = "C:\tools\ffmpeg\bin\ffprobe.exe"
# or save it once, validated, for every future terminal / Claude Code session:
node bin/xoxo.js config set ffmpeg "C:\tools\ffmpeg\bin\ffmpeg.exe"
node bin/xoxo.js config set ffprobe "C:\tools\ffmpeg\bin\ffprobe.exe"
```
Claude Code and the MCP server read the environment when they start: restart them after changing variables, or use `config set`.

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
| `ffmpeg` / `ffprobe` / `whisper` | `XOXO_FFMPEG` / `XOXO_FFPROBE` / `XOXO_WHISPER` | binaries not on PATH (precedence: config > env > PATH; see above) |
| `transport` | `XOXO_TRANSPORT` | `auto` (default) · `listener` · `cli` · `mock` |
| `bridgeDir` | `XOXO_BRIDGE_DIR` | where job files live |
| `allowRawEval` | `XOXO_ALLOW_RAW_EVAL=1` | allow arbitrary ExtendScript (**off**) |
| (root folder) | `XOXO_ROOT` | where `assets/`, `projects/`, `.xoxo/` live (default: the repository) |

## macOS / Linux
macOS: discovery and the AppleScript launch path exist but are **untested**. Linux: no After Effects; use
`--dry-run` (simulator) — useful for plan development, CI and the test-suite.
