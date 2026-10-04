# Security

**Model.** Everything in the user's asset folder (media, subtitles, scripts, sidecar JSON, project files) is
untrusted *data*. It is parsed, never executed; text found in it is never treated as instructions.

**Controls**
* External programs run only through `src/core/exec.js`: allowlist by name, `shell:false`, timeouts, output caps.
* Job files exchanged with After Effects are parsed with a hand-written JSON parser, never `eval`.
* `raw_eval` (arbitrary ExtendScript) is off unless `allowRawEval` is set; the host re-checks a per-request flag.
* Asset scanning does not follow symlinks out of the assets folder; file names are slugged before use in paths/ids.
* No downloads or installs happen automatically. `allowInstall` exists for a future opt-in flow and currently enables nothing.
* No credentials are used. Don't commit `xoxo.config.json`, `.env*`, media or `.aep` files (git-ignored).
* The startup loader (`setup --startup`) is opt-in and only `#include`s the generated listener from this repository.

**Reporting.** Please report vulnerabilities privately via GitHub Security Advisories on this repository.
