# Development

```
npm test             # ES3 lint of jsx/ + all suites (needs ffmpeg; ~25 s)
npm run lint:jsx     # just the ExtendScript ES3 check
node scripts/run-tests.js e2e     # run suites whose filename contains "e2e"
```
Zero runtime dependencies; `node:test` for tests. Node ≥ 20.

## Test layers
* `jsx-host.test.js` – host ops against the simulator (also proves the ES3 JSON polyfill).
* `bridge.test.js` – transports with a fake single-instance `AfterFX` (`tests/helpers/fake-afterfx.mjs`).
* `assets-narration.test.js`, `effects.test.js`, `examples.test.js`, `ops-doc.test.js`, `mcp.test.js`.
* `e2e.test.js` – scan → narration → plan → build → QA → repair → render (fake `aerender` + real FFmpeg) → verify.
* Real After Effects: `xoxo selftest` (manual, needs the application).

## Conventions
* Every operation returns `{success, operation, …}`; never swallow errors; log with `ctx.logger`.
* Host ops idempotent; compile units idempotent; new alternatives go *after* the primary and the last one needs nothing.
* No machine-specific values in code. External programs only via `src/core/exec.js` (allowlist, no shell).
* Prefer extending the simulator over mocking inside tests, and only with documented API behaviour.
* Docs and `CLAUDE.md` change with behaviour. Unfinished work is marked `TODO` — never stubbed as working.

## Release checklist
`npm test` green · `xoxo selftest` on a real After Effects · docs updated · no user paths/secrets in the diff.
