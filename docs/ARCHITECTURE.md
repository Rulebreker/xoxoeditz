# Architecture

```
                      CLAUDE CODE  (CLAUDE.md, .claude/agents, .claude/commands)
                           │  MCP tools (xoxo_*)  or  CLI (xoxo …)
                           ▼
                 ┌───────────────────────┐
                 │  src/app/services.js  │   orchestrator: one function per workflow step
                 └───────────┬───────────┘
   DIRECTOR ──► plan.json    │
   (Claude + src/plan)       ▼
                 ┌───────────────────────┐        ┌──────────────────────┐
   EDITOR        │  src/ae/compile.js    │ units  │  src/ae/executor.js  │  RECOVERY
   MOTION  ────► │  plan → stages/units/ │ ─────► │  batch → diagnose →  │  (alternatives,
   SOUND         │  alternatives → ops   │        │  next alternative    │   retries)
   CAPTIONS      └───────────────────────┘        └──────────┬───────────┘
                                                             │ ops
                       ┌─────────────────────────────────────▼──────────┐
                       │ src/bridge/client.js  (structured results)      │
                       └───────┬──────────────┬──────────────┬───────────┘
                         listener         cli (AfterFX -r)    mock
                               │              │              │
                     ┌─────────▼──────────────▼───┐   ┌──────▼─────────────┐
                     │ jsx/*.jsx host in After    │   │ src/bridge/mock-ae │
                     │ Effects (ExtendScript ES3) │   │ (simulated DOM)    │
                     └─────────┬──────────────────┘   └────────────────────┘
                               ▼
        QA (src/qa) ◄── inspect ──┘          RENDER (src/render): aerender → FFmpeg | Media Encoder → ffprobe verify
```

## Design decisions

**ExtendScript host, not UI automation.** Mouse/keyboard automation breaks with resolution, theme, panel layout and
version. ExtendScript (`.jsx`) is After Effects' mature, documented scripting API and exposes everything we need.
*UXP:* not used; the transport/host split means a UXP host could replace `jsx/` without touching Node.

**File-based bridge.** Node ⇄ After Effects exchange JSON files (`<id>.job.json` → `<id>.result.json`, or
`inbox/` → `outbox/` for the listener). No sockets, no admin rights, no ports, works through the supported
`AfterFX -r` command line. Files are written tmp+rename so readers never see partial JSON.

**Typed ops + batching.** ~45 ops (`docs/AE_INTEGRATION.md`) with structured results `{success, error, code,
recoverable}`. `batch` runs many ops/unit-groups in one round trip because each CLI call can cost seconds.

**Compile, then execute.** The plan compiles into **stages → units → alternatives → ops**. A *unit* is the smallest
thing that can succeed or fail on its own (one clip, one graphic, one transition). Every unit starts by removing the
layers it will create, so **units are idempotent**: a retry after a timeout or a whole re-build never duplicates.

**Alternatives are the recovery mechanism.** Units list implementations best-first (e.g. text animator → layer
fade-up → plain fade; native glitch → jitter+flash → hard cut; footage → visible "MISSING" placeholder). The executor
advances to the next alternative when an op fails inside After Effects and records every step.

**Effect capability registry (`src/effects/registry.js`).** Each effect id has implementations with `requires`
(effects by match name *or* display name, plugins, fonts) and a `quality`. The resolver picks the best the machine
supports; the last implementation always requires nothing. `xoxo effects` prints the chains.

**Capabilities are discovered.** `src/detect` scans Adobe install roots per platform (no hard-coded paths), asks After
Effects for its installed effects and fonts, and writes `.xoxo/capabilities.json`. Host-derived facts from the
simulator are never persisted.

**QA is data.** Pure functions over `(plan, manifest, narration, inspect, build, report, caps)` → issues with codes and
`repairable` flags; `src/qa/repair.js` fixes what it can via ops, then QA runs again.

**Render.** After Effects (recent versions) renders H.264 through Media Encoder, so the default is `aerender` to a
lossless/ProRes intermediate (template names are enumerated from the install, not assumed) then FFmpeg H.264/H.265;
Media Encoder is the alternative. Output is verified with ffprobe (resolution, fps, duration, audio, not-black).

## Autonomous (timeline) mode

```
 prompt + edit.config.json ──► src/director/{prompt,config}.js ──► directive (type + 15 dials + sources)
 assets ──► src/assets (+ visual analysis)        library ──► src/library      music ──► src/beat ──► beat_map.json
                         └────────────────────────┬──────────────────────────┘
                                                  ▼
   src/director/direct.js   slots on the beat → transitions (src/transitions) → per shot: asset (assign.js), template
   (pure, seeded)           (src/compositing), camera (src/camera), velocity (src/velocity) → text (src/typography)
                            → sound (src/sfx) → look (src/color) → plan.json (version 2, docs/TIMELINE_PLAN.md)
                                                  │  refineDirection (src/creative-qa/refine.js): best of N seeds
                                                  ▼
   src/ae/compile-timeline.js  → the same stages/units/alternatives/ops → executor → QA (src/qa) → render
                                                  ▼
   src/creative-qa  (plan critique; render critique via FFmpeg)     src/memory (optional)     src/benchmark
```
Scene mode and timeline mode share everything below the compiler: executor, bridge, host scripts, QA, render, CLI. `buildProject`
and the services dispatch on `plan.mode`.

## Data model on disk

```
projects/<name>/
  assets.manifest.json    ids, types, roles, metadata, keywords, YOUR descriptions/overrides (preserved on re-scan)
  narration.json          duration, silences, speech, loudness, sentences, words, scenes
  plan.json               the edit plan (docs/PLAN_FORMAT.md)
  <name>.aep              the After Effects project;   versions/<name>_v001_build.aep …
  build-report.json       stages, fallbacks, errors, dropped optional elements
  QA_REPORT.json          {passed, errors, warnings, fallbacks_used, checks{8}, repairs}
  compiled-plan.json      normalized plan + compile metadata
  renders/  generated/  thumbs/  dryrun/ (simulator output; never mixed with real results)
  (timeline mode adds)  beat_map.json  DIRECTOR_REPORT.json  CREATIVE_QA.json  EDIT_REPORT.md  library.used.json
                        build-state.json (incremental builds)  BENCHMARK_REPORT.md  benchmark.json
  tiers are separate projects: <name>-draft/  <name>-preview/  <name>/
.xoxo/                    capabilities.json, bridge/, logs/*.jsonl, current.json, library/ (universal manifest), cache/ (visual analysis), memory.json, benchmarks/
```

## Extending
* New shot template: `src/compositing/templates.js` (+ weight in `src/edit-types/profiles.js`, + test; `node scripts/gen-docs.js`).
* New transition: `src/transitions/entries.js` (motion half + ops half, last link needs nothing) + `TRANSITION_META`.
* New text animation: `src/typography/entries.js` + the kinds that may use it in `engine.js`.
* New camera move / rig: `src/camera/rigs.js`; new primitive: `src/motion/primitives.js`.
* New edit type: `src/edit-types/profiles.js` (all ids are cross-checked by tests).
* New creative-QA check: `src/creative-qa/plan-checks.js` + a test that plants the defect.
* New graphic: `src/motion/graphics.js` builder + `GRAPHIC_KINDS` + validation + tests.
* New effect/fallback: `src/effects/registry.js` (last impl requires nothing) + test.
* New host op: `jsx/*.jsx` (ES3) + `src/bridge/ops-doc.js` + simulator support in `mock-ae.js` if needed + test.
