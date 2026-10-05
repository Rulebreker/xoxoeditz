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
| `TEXT_OUT_OF_FRAME` / `TEXT_OUTSIDE_SAFE` | Text wider than the frame / safe area (measured at the layer's rest time) | Auto-repaired by `text_fit` (re-wrap, then shrink the font, then re-clamp), then re-inspected; a repair counts only when re-inspection proves it. Shorten the text for best results |
| `Unable to set "allCaps". It is a readOnly attribute.` | After Effects 2026 made `TextDocument.allCaps` read-only | Fixed at the source: upper-casing is done on the string; `allCaps` is never written. Seeing it again means an old copy of the host bundle - `xoxo setup` |
| Many text layers named like the text (`J-29`, `J-28`, ...) stacked on top of each other | An older build created the layer, then failed before naming/timing it (every failed fallback left one behind) | Text layers are now created atomically and carry an ownership mark; QA reports leftovers as `TEXT_UNEXPECTED` and the repair (`layers_prune`) removes them. Re-run `xoxo edit` |
| `TEXT_OVERLAP` (error) | Two texts that may not share the frame are visible at once (e.g. two titles) | Fix `plan.json` text intervals (`start`/`end`), or set `allowOverlap: true` on the one you really want. Allowed pairs (title + lower third, title + caption, ...) only need separate areas |
| `MISSING_LAYER TXT_TITLE_01 / TXT_END_01` | A required title/end card could not be built | The build now fails loudly with the failed alternatives in `build-report.json`; the title/end card also has opacity / position / scale fallbacks and a plain static last resort |
| `current project has unsaved changes` / `PROJECT_DIRTY_USER` | After Effects has somebody else's project open with unsaved changes | XOXOEDITZ will not touch it. Save it in AE, or `xoxo project save` / `xoxo project close --save`; throw it away on purpose with `--discard`. `xoxo project status` explains the state |
| Render OK but verification fails | Wrong size/duration/black | Read `verification.checks`; run a `--preview --range` and look at the frames |
| `FFmpeg/FFprobe not found` in `doctor` | Not on PATH and no override seen by this process | Read the "tried" list in the message. `xoxo config set ffmpeg "<full path>"` (persistent) or set `XOXO_FFMPEG` in the *same* terminal that launches `claude`/`node`; `setx` only affects new terminals. Quotes/spaces/slashes are handled; `.cmd` shims are not |
| Everything fails after an AE crash | Stale listener / lock | `xoxo bridge stop`; restart After Effects; delete `.xoxo/bridge/jobs/*` |
| Works in `--dry-run`, fails for real | Simulator ≠ real AE | Attach `build-report.json`; check `Likely tweak points` in AE_INTEGRATION.md |
| `NO_REAL_BEATS` / "cutting to a virtual grid" | No music in the project or library, or it could not be decoded | Put a music file in the assets folder (role `music`), pass `--music FILE`, or add tracks to the library |
| No sound effects in the edit | No SFX library | `xoxo library starter` (generates a license-free pack) or point `XOXOEDITZ_ASSETS` at yours; or `--starter-sfx` |
| Creative QA `SLIDESHOW` / `LOW_TEMPLATE_VARIETY` after refinement | Too few distinct pictures | Add more footage; a new seed cannot invent assets (the report says "come from the inputs") |
| `motion amplitude reduced to N%` | The source has no spare pixels for that move | Use a higher-resolution source or a gentler `--set camera=…` |
| `speed map … reaches the end of its clip` | Clip shorter than the planned ramp | Add longer clips; the last frame holds meanwhile |
| Benchmark says **SIMULATED RUN** | You used `--dry-run` or `transport: mock` | Run without it on a machine with After Effects for the real benchmark |

