# Contributing

Thanks for helping! Bug reports are most useful with `projects/<name>/build-report.json`, `QA_REPORT.json`, the
output of `xoxo doctor --connect`, and your After Effects version/OS.

1. Fork, branch, `npm test` must pass (see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)).
2. Keep changes small and tested; real-After-Effects behaviour changes need a note on how you verified them.
3. `jsx/` stays ES3. Don't add runtime dependencies without discussion.
4. No media, `.aep`, secrets or personal paths in commits.
5. Security issues: see [SECURITY.md](SECURITY.md).

Good first contributions: verified After Effects match names / parameter fixes, new graphic templates, new style packs,
effect fallback implementations, macOS validation, a UXP host.
