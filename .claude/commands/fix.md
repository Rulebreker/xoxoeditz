---
description: Diagnose and repair a failed build, QA or render
argument-hint: [what went wrong]
---
Something failed: $ARGUMENTS

Read `projects/<name>/build-report.json`, `QA_REPORT.json` and `.xoxo/logs/`. Apply DETECT → DIAGNOSE → REPAIR → RETRY →
VERIFY → FALLBACK. Fix at the source (plan/asset/config), rebuild with `xoxo_edit`, re-verify. Report root cause,
fix, and any residual risk.
