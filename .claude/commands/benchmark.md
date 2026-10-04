---
description: Run the professional benchmarks (velocity, cinematic, documentary, commercial)
argument-hint: <velocity|cinematic|documentary|commercial|all> [dry-run]
---
Run `xoxo_benchmark` with: $ARGUMENTS

Without `dry-run` this drives the REAL After Effects and renders; with it, the simulator (render criteria are reported as skipped).
Report each criterion's result with its evidence from BENCHMARK_REPORT.md, quote the failing ones, diagnose them
(CLAUDE.md §5) and fix at the source. Never summarise a simulated run as a real one.
