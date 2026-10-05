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

**Autonomous engine, additionally unverified in real After Effects:** `time_remap` (Time Remapping enable/keys/frame blending),
`layers_reorder` on 100+ layers, `track_matte`, `mask_add` on cropped footage, text animator `Based On = Words`
(`ADBE Text Range Type2`), and the parameter names used for `ADBE Motion Blur` (Directional Blur: `Direction`, `Blur Length`),
`CC Radial Fast Blur` (`Type`, `Amount`), `ADBE Exposure2`, `ADBE Wave Warp`, `ADBE Ramp`, `ADBE HUE SATURATION`
(`Master Saturation`), `ADBE Brightness & Contrast 2`. All are wrapped in fallbacks. `xoxo benchmark velocity` exercises every one.

If something fails on your version, `build-report.json` shows the exact op and AE error; please open an issue with
that report. Likely tweak points: `jsx/40_anim.jsx` (`text_reveal`), `jsx/30_layers.jsx` (shape groups), effect
match names in `src/effects/registry.js` (display-name lookup already softens this).

## Host operations added for the autonomous engine
`time_remap` (comp time → source time keys, frame blending, motion blur), `layers_reorder` (set z-order), `layers_remove`
(idempotent cleanup, optionally by prefix), mask `ellipse`/`inverted`, `text_reveal unit:"words"`; `inspect` now reports
position / scale / mask count for every layer. Full list: `xoxo bridge ops`.

## Text and project-state host operations (text/timeline engine fix)
`layer_add_text` is atomic (a failure removes the half-built layer), applies name / in / out / ownership mark (`Layer.comment`:
`XOXO|k=text|role=TITLE|id=TXT_TITLE_01|shot=S01|rest=1.25`) before any styling, upper-cases the *string* for `caps:"upper"` and never writes the
read-only `TextDocument.allCaps` (After Effects 2026). `text_fit` fits a text layer into a pixel box from `sourceRectAtTime` measured at
the layer's rest time; `layers_prune` removes generated layers the plan no longer wants (plus unmarked text layers named after their own
text - orphans of failed builds); `keyframes` accepts `relative:true` (offsets from the fitted position). `inspect` reports text bounds
measured at rest, `restTime`, `keyRange` and the ownership `mark`. `project_status` / `project_mark` / `project_close` implement the
project-ownership policy in `src/ae/project.js` (an `XOXO_META` folder item carries `XOXOEDITZ|v=1|project=<name>`).
**These host changes are validated only against the simulator** - run `xoxo selftest` (and a short real edit) on a machine with After
Effects; likely tweak points: `jsx/30_layers.jsx` (`text_fit`, `layers_prune`), `jsx/70_inspect.jsx` (`restTime`, `keyRange`).

## Adding a host operation
1. Implement in the right `jsx/NN_*.jsx` with `XOXO.op("name", function (a) {…})`; validate args with `XOXO.need`;
   throw `XOXO.err(message, CODE, recoverable)`; keep it idempotent.
2. Document in `src/bridge/ops-doc.js`. 3. If it needs DOM the simulator lacks, extend `mock-ae.js` only with what the
   Scripting Guide documents. 4. Test in `tests/jsx-host.test.js`. 5. `npm test`.
