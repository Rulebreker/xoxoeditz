# Troubleshooting

Start with `node bin/xoxo.js doctor --connect`. Logs: `.xoxo/logs/xoxo-<date>.jsonl` (add `-v` to echo). Per-project:
`projects/<name>/build-report.json`, `QA_REPORT.json`.

| Symptom | Cause | Fix |
|---------|-------|-----|
| `TIMEOUT … no response from After Effects` | "Allow Scripts to Write Files and Access Network" is off | Enable it (Preferences ▸ Scripting & Expressions) |
| same | A modal dialog is open in After Effects (missing font/plugin, save prompt) | Dismiss it; re-run — builds are idempotent |
| same on first call | Cold start slower than `coldStartMs` | Start After Effects first, or raise `timeouts.coldStartMs` |
| `After Effects not found` | Non-standard install location | Set `XOXO_AE_PATH` to `AfterFX.exe` or the install folder |
| `No way to reach After Effects` | Not installed / not found and no listener | Install; or use `--dry-run` |
| `aerender` missing | Stripped install | `XOXO_AERENDER_PATH`; or Media Encoder (`xoxo render --ame`) |
| `no suitable output module template` | Install lacks Lossless/ProRes/H.264 templates | Run `xoxo bridge call rq_templates`; add a ProRes/Lossless output module template in AE |
| Fonts fall back to Arial | AE < 24.0 can't list fonts, or the font isn't installed | Install the font; set `style.fonts` |
| `EFFECT_UNAVAILABLE` / fallbacks in report | Effect not installed or name differs by language | Expected; see `xoxo effects`. Quality drops, project still builds |
| `EXPRESSION_ERROR` | Legacy expression engine / version | Fallback keeps a static value; switch project to the JavaScript engine |
| `PLACEHOLDER_PRESENT` | Asset missing/moved/unsupported | Fix the file, `xoxo assets`, `xoxo edit` |
| `TEXT_OUT_OF_FRAME` | Long text | Auto-repaired (scale/move); shorten for best results |
| Render OK but verification fails | Wrong size/duration/black | Read `verification.checks`; run a `--preview --range` and look at the frames |
| `FFmpeg/FFprobe not found` in `doctor` | Not on PATH and no override seen by this process | Read the "tried" list in the message. `xoxo config set ffmpeg "<full path>"` (persistent) or set `XOXO_FFMPEG` in the *same* terminal that launches `claude`/`node`; `setx` only affects new terminals. Quotes/spaces/slashes are handled; `.cmd` shims are not |
| Everything fails after an AE crash | Stale listener / lock | `xoxo bridge stop`; restart After Effects; delete `.xoxo/bridge/jobs/*` |
| Works in `--dry-run`, fails for real | Simulator ≠ real AE | Attach `build-report.json`; check `Likely tweak points` in AE_INTEGRATION.md |
