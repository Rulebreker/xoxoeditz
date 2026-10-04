# After Effects integration

## How a call travels
1. Node builds a request `{id, op, args, flags}` and writes `<id>.job.json` (one-shot) or `inbox/<id>.req.json` (listener).
2. **One-shot:** a generated script `<id>.jsx` = host bundle + `XOXO.runJobFile("<job>")` is run with
   `AfterFX -r <id>.jsx` (macOS: AppleScript `DoScriptFile`). If After Effects is running the script runs in that
   instance, otherwise After Effects is started first (cold start can take minutes → `timeouts.coldStartMs`).
   **Listener:** the loaded host polls `inbox/` with `app.scheduleTask` and writes `outbox/<id>.res.json`.
3. The host executes inside an undo group, returns `{id, success, data|error, code, recoverable, durationMs}`.
4. Node polls for the result file. A missing result becomes `TIMEOUT` with the most likely causes.

Job files are parsed with a safe JSON parser (`jsx/00_polyfills.jsx`) — never `eval`.

## Host operations
Authoritative list with arguments: `node bin/xoxo.js bridge ops` or MCP `xoxo_ae_ops` (generated from
`src/bridge/ops-doc.js`; a test fails if a host op is undocumented). Groups: project · comp · layer · anim · effects ·
render · qa · meta.

Conventions: comps/layers by **name**; times in seconds; colours `#rrggbb`; `set_property`/`keyframes` accept
`position|scale|rotation|opacity|anchor|audioLevels|timeRemap|sourceText` or a `Group/Name` path of match or display
names. Ease between keys: `linear|easeOut|easeIn|easeInOut` (influence-based `KeyframeEase`).

## ExtendScript rules (enforced by `npm run lint:jsx`)
ES3 only — no `let/const`, arrows, template strings, `Array.map/forEach/filter`, `Object.keys`, trailing commas.
Use `XOXO.each/map/has`. Reading a property that does not exist throws: use `XOXO.prop()` (clear error) instead.

## Required application settings
*Preferences ▸ Scripting & Expressions ▸ Allow Scripts to Write Files and Access Network.* `ping` reports it as
`scriptsMayWriteFiles`. Modal dialogs in After Effects (missing fonts/plugins on open, "save changes?") block scripts:
projects are created by XOXOEDITZ so this is rare; if it happens, dismiss the dialog.

## Verification status
What each layer of evidence covers:

| Area | Evidence |
|------|----------|
| Node logic: discovery, assets, narration, plan, compile, executor, QA, repair, render, CLI, MCP | Automated tests, real FFmpeg media |
| Host op *logic* (idempotency, timing maths, batching, error codes, ES3 syntax) | Automated tests against `src/bridge/mock-ae.js`, a model of the scripting DOM written from the After Effects Scripting Guide |
| File-bridge transports (one-shot cold start/forwarding, listener, timeouts, missing-permission failure) | Automated tests with a fake single-instance `AfterFX` |
| **Behaviour inside real After Effects** (property match names, text animator & shape trim paths, effect parameter names, `Allow Scripts…` detection, template names, `aerender` flags, Windows launch semantics) | **Not yet verified by the author.** Written against the documented API; risky spots are wrapped in fallbacks. Run `xoxo doctor --connect` and `xoxo selftest`. |

If something fails on your version, `build-report.json` shows the exact op and AE error; please open an issue with
that report. Likely tweak points: `jsx/40_anim.jsx` (`text_reveal`), `jsx/30_layers.jsx` (shape groups), effect
match names in `src/effects/registry.js` (display-name lookup already softens this).

## Adding a host operation
1. Implement in the right `jsx/NN_*.jsx` with `XOXO.op("name", function (a) {…})`; validate args with `XOXO.need`;
   throw `XOXO.err(message, CODE, recoverable)`; keep it idempotent.
2. Document in `src/bridge/ops-doc.js`. 3. If it needs DOM the simulator lacks, extend `mock-ae.js` only with what the
   Scripting Guide documents. 4. Test in `tests/jsx-host.test.js`. 5. `npm test`.
