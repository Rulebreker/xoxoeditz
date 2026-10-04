# Benchmarks

Four professional briefs, each with a machine-checked checklist ([BENCHMARK_CHECKLISTS.md](BENCHMARK_CHECKLISTS.md)):

| Benchmark | The brief in one line |
|-----------|----------------------|
| `velocity` | aggressive military velocity edit, beat-locked, hard speed ramps, kinetic type, impacts on every drop |
| `cinematic` | slow, weighty, letterboxed, long dissolves, deep slow-motion, subtle sound |
| `documentary` | calm and observational, plain cuts and dissolves, no speed ramps, natural colour, minimal sound |
| `commercial` | premium, controlled, professional mode, hero details, light/zoom transitions, brand end card |

```
xoxo benchmark velocity --dry-run     # simulator: seconds, no After Effects needed
xoxo benchmark velocity               # REAL: needs After Effects; renders and verifies the video
xoxo benchmark all --dry-run
xoxo benchmark velocity --assets "D:\MyFootage"      # judge the engine on your own material
```

Output: `projects/benchmark-<name>/` with `plan.json`, the `.aep`, `QA_REPORT.json`, `CREATIVE_QA.json`, `beat_map.json`,
`DIRECTOR_REPORT.json`, `EDIT_REPORT.md`, `BENCHMARK_REPORT.md` (the checklist with the evidence for each line), `benchmark.json`,
and — on a real run — `renders/`.

## Inputs

Self-contained and generated, nothing is downloaded: procedural moving clips (each with a moving "subject" block, so the
saliency, crop and 2.5D logic have something to find), stills, a synthetic music track with a *known* structure
(intro / build / break / drop / verse / chorus / outro) and the generated SFX starter pack. They exercise the engine; they
are not good-looking footage. For a judgement of taste, pass your own `--assets`.

## Honest reporting

Every criterion is `pass`, `fail` or `skipped` with its reason. On the simulator the render criteria are always `skipped` —
a benchmark run with `--dry-run` can never claim a video exists, and its report starts with **SIMULATED RUN**. The checklists
are tested for non-vacuity: the documentary's output fails the velocity checklist and vice versa.

## What the benchmarks settle

| Run | Proves | Does not prove |
|-----|--------|----------------|
| `--dry-run` | the Director produced a plan that satisfies the brief; the compiler's ops are accepted by the real host scripts in the simulator; QA and creative QA pass | anything about real After Effects, rendering, or how it looks |
| real | the above **plus** time-remap, mattes, effects, text animators, z-order and 4K performance in your After Effects; the render passes ffprobe verification and render-level creative QA | whether you like it |

If a real run fails, `build-report.json` names the exact op and After Effects error — open an issue with it.
