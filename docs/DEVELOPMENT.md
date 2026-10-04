# Development

```
npm test             # ES3 lint of jsx/ + ALL suites (needs ffmpeg; ~5 min: media generation + full productions)
npm run test:fast    # everything except benchmark.test.js and produce.test.js (~1.5 min)
node scripts/gen-docs.js          # regenerate docs/EDIT_TYPES.md, EFFECTS.md, SHOT_TEMPLATES.md, CREATIVE_QA_CODES.md, BENCHMARK_CHECKLISTS.md
npm run lint:jsx     # just the ExtendScript ES3 check
node scripts/run-tests.js e2e     # run suites whose filename contains "e2e"
```
Zero runtime dependencies; `node:test` for tests. Node ≥ 20.

## Test layers
* `jsx-host.test.js` – host ops against the simulator (also proves the ES3 JSON polyfill).
* `bridge.test.js` – transports with a fake single-instance `AfterFX` (`tests/helpers/fake-afterfx.mjs`).
* `assets-narration.test.js`, `effects.test.js`, `examples.test.js`, `ops-doc.test.js`, `mcp.test.js`.
* `e2e.test.js` – scan → narration → plan → build → QA → repair → render (fake `aerender` + real FFmpeg) → verify.
* Autonomous engine: `library`, `sfx`, `director-input`, `beat` (synthetic ground truth), `velocity`, `camera`, `transitions`, `typography`,
  `compositing` (every stack is run through the real host scripts in the simulator), `director`, `timeline-build` (compile → execute → inspect,
  incremental builds), `produce` (folder → plan → built project, incl. the CLI), `creative-qa` (planted defects in plans and in FFmpeg-made
  videos), `tiers-memory`, `benchmark`, `docs` (generated tables must be fresh; every MCP tool and CLI command is documented).
* Real After Effects: `xoxo selftest` and `xoxo benchmark <name>` without `--dry-run` (manual, need the application).

## Conventions
* Every operation returns `{success, operation, …}`; never swallow errors; log with `ctx.logger`.
* Host ops idempotent; compile units idempotent; new alternatives go *after* the primary and the last one needs nothing.
* No machine-specific values in code. External programs only via `src/core/exec.js` (allowlist, no shell).
* Prefer extending the simulator over mocking inside tests, and only with documented API behaviour.
* Docs and `CLAUDE.md` change with behaviour. Unfinished work is marked `TODO` — never stubbed as working.

## Release checklist
`npm test` green · `node scripts/gen-docs.js` clean · `xoxo selftest` and `xoxo benchmark all` on a real After Effects · docs updated · no user paths/secrets in the diff.
