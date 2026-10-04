---
description: Turn the assets in ./assets plus a brief into a finished After Effects video
argument-hint: <project-name> "<creative brief>"
---
Create a video with XOXOEDITZ.

Project name and brief: $ARGUMENTS

Follow CLAUDE.md §2 exactly: `xoxo_doctor` → `xoxo_new_project` → `xoxo_scan_assets` (thumbs:true; LOOK at the
thumbnails and describe each asset in the manifest) → `xoxo_analyze_narration` → `xoxo_scaffold_plan` → **rewrite
plan.json as the Director** → `xoxo_validate_plan` → `xoxo_edit` (dry-run first if unsure) → preview render and
review the frames → fix and rebuild → final `xoxo_render`. Finish by reporting: the output path, what was built,
every fallback used, and anything that needs the user's attention. Do not stop at the first error — diagnose and
recover first (CLAUDE.md §5).
