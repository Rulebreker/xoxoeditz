# MCP server

`node bin/xoxo.js mcp` is a dependency-free MCP server (stdio, newline-delimited JSON-RPC 2.0, protocol
`2024-11-05`, echoes the client's version). `.mcp.json` registers it for Claude Code automatically.

| Tool | Purpose |
|------|---------|
| `xoxo_doctor`, `xoxo_detect`, `xoxo_effects` | environment, capability registry, fallback chains |
| `xoxo_new_project`, `xoxo_scan_assets`, `xoxo_analyze_narration` | project, asset manifest (+thumbnails), narration analysis |
| `xoxo_scaffold_plan`, `xoxo_validate_plan`, `xoxo_plan_format` | baseline plan, validation, format reference |
| `xoxo_edit`, `xoxo_verify`, `xoxo_render`, `xoxo_status` | build + QA, QA only, render + verify, pipeline status |
| `xoxo_ae_call`, `xoxo_ae_ops` | low-level host operations and their reference |
| `xoxo_produce` | **autonomous edit**: assets + type + prompt → scan, beats, Director, build, QA, render, report |
| `xoxo_direct`, `xoxo_beats` | re-run only the Director (another seed = another cut); analyse any track |
| `xoxo_library_search` | semantic search of the universal asset library with reasons |
| `xoxo_critique`, `xoxo_promote`, `xoxo_memory` | creative QA (plan / render), draft→preview→final promotion, local taste memory |
| `xoxo_benchmark` | the four professional benchmarks with machine-checked checklists |

Results are JSON text: `{success, operation, data | error, recoverable}`; `isError` is set when `success` is false. The server
keeps one simulator instance per process so repeated `dryRun` calls behave like a persistent application. stdout carries
protocol only; logs go to `.xoxo/logs/`. Tools run sequentially because After Effects is single-threaded.

Manual test: `printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | node bin/xoxo.js mcp`.
