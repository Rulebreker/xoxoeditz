# `plan.json` — the edit plan

The plan is the contract between the **Director** (Claude) and the **Editor** (`src/ae/compile.js`). It says *what the
video is*; XOXOEDITZ turns it into After Effects work. Validate with `xoxo plan --validate` (errors are written to be
fixable). Times are **seconds**; scene-local times (clips, graphics) are relative to the scene start; `audio` times
are on the master timeline. Asset ids come from `assets.manifest.json` (`IMG_*`, `VID_*`, `NARR_*`, `MUSIC_*`, `SFX_*`).

```jsonc
{
  "version": 1,
  "title": "CHENGDU J-20",                 // required; names files + the title card
  "brief": "…",                            // free text, kept for reference
  "style": "military-documentary",         // pack name/alias, or an object (below)
  "output": { "resolution": "4k", "aspect": "16:9", "fps": 24, "format": "mp4", "codec": "h264", "bitrateMbps": 60 },
  "look": { "grain": true, "vignette": 35, "grade": 20, "glow": false, "letterbox": false },
  "endFade": 1.0,                          // seconds of fade-to-black at the end (0 = none)
  "scenes": [ /* ≥ 1, contiguous */ ],
  "audio":  { /* narration, music, sfx, autoSfx */ },
  "captions": { "enabled": true }
}
```

## `output`
`resolution`: `720p | 1080p | 1440p | 4k | 8k` (the 16:9 quality tier; default **4k** = 3840×2160).
`aspect`: `16:9 | 9:16 | 1:1 | 2.39:1 | vertical | square | cinematic | W:H`. Vertical keeps the tier as the *short* side
(4k + 9:16 → 2160×3840). Explicit `width`/`height` override both. `fps` default 24. `codec`: `h264 | h265 | prores`.
`path` (optional) is relative to the project folder; default `renders/<title>_<w>x<h>.mp4`.

## `style`
String: `cinematic-documentary`, `premium-commercial`, `military-documentary`, `tech-explainer`, `minimal-corporate`,
`fast-youtube` (aliases like `military`, `youtube`, `corporate`). Or an object that extends a pack:
```json
{ "extends": "tech-explainer", "colors": { "accent": "#ff6a00" }, "fonts": { "display": ["Bahnschrift"] },
  "type": { "titleCase": "upper" }, "motion": { "transition": "slide", "transitionDur": 0.5 }, "look": { "grain": false } }
```
Fonts are PostScript names tried in order; the first one *installed in After Effects* wins (`list_fonts`), ending in Arial.

## `scenes[]`
```jsonc
{ "id": "S01", "start": 0, "end": 12.5,
  "intent": { "visual": "…", "text": "…", "sfx": "…", "music": "…" },    // documentation only
  "transition": { "type": "dissolve", "duration": 0.8 },                  // INTO this scene
  "clips": [ { "asset": "IMG_J20_FRONT", "start": 0, "end": 6, "motion": "push_in" } ],
  "graphics": [ { "kind": "title", "text": "CHENGDU J-20", "start": 0.6, "end": 5 } ] }
```
Scenes must be contiguous (`start` = previous `end`; gaps warn, overlaps are errors). `transition.type`:
`dissolve | dip_to_black | slide | zoom_punch | wipe | glitch | cut`. Overlapping types extend the previous scene by the
transition duration. Fancy types degrade through fallback chains when effects are missing (`xoxo effects`).

### `clips[]`
`asset` (video/image) · `start`,`end` (scene-local; default whole scene) · `sourceIn` (seconds into the source) ·
`speed` (2 = twice as fast) · `fit` `cover|contain|none` (default cover) · `motion` `static|push_in|pull_out|pan_left|
pan_right|pan_up|pan_down|drift` (default push_in for stills, static for video) · `keepAudio` (default false: b-roll is
muted under narration) · `opacity` · `fadeIn`/`fadeOut`. Clips are stacked in order; later = on top.
The validator warns when a video clip would run past its source length.

### `graphics[]` — all have `kind`, `start`, `end` (scene-local), optional `position`
Positions: `center top-center bottom-center lower-left lower-right upper-left upper-right left-center right-center`.

| kind | fields | notes |
|------|--------|-------|
| `title` | `text`, `subtitle?`, `scale?` | display font, accent rule draws on |
| `subtitle` | `text` | body font, bottom-centre by default |
| `lower_third` | `title` (or `text`), `subtitle?` | accent bar + name/role, lower-left |
| `callout` | `text`, `target?` `{x,y}` 0–1 | leader line draws from the label to the target point |
| `stat` | `value`, `prefix?`, `suffix?`, `decimals?`, `label?` | animated count-up (expression); static-number fallback |
| `bar_chart` | `items:[{label,value}]`, `unit?`, `title?` | bars grow, highest highlighted |
| `highlight_box` | `rect:[x,y,w,h]` 0–1 | outlined emphasis box |
| `timeline` | `items:[{label,date}]` (≥ 2) | line draws, nodes pop in sequence |
| `hud_corners` | `rect?` 0–1 | animated corner brackets |
| `kinetic` | `text` | large typewriter-style reveal |
| `map` | — | **not implemented** (warning). Use a map image clip + `callout`/`highlight_box`. |

## `audio`
```jsonc
{ "narration": { "asset": "NARR_NARRATION", "gainDb": 0 },
  "music": [ { "asset": "MUSIC_MAIN", "start": 0, "end": null, "gainDb": -20, "duckDb": -10, "fadeIn": 2, "fadeOut": 3, "duckUnderNarration": true } ],
  "sfx":   [ { "asset": "SFX_WHOOSH_01", "at": 12.4, "gainDb": -8 } ],
  "autoSfx": true }
```
Music is ducked using the narration's measured speech segments. Short music is looped with 0.25 s fades. With
`autoSfx` (default) the edit adds whooshes on moving transitions and hits on titles/stats using your SFX assets
(matched by id/keyword) or, if you have none, basic FFmpeg-synthesised sounds (reported in the notes).

## `captions`
`{ "enabled": true, "maxCharsPerLine": 38, "font": "ArialMT", "color": "#ffffff" }`. Needs a timed transcript
(SRT/VTT → exact, Whisper → word-accurate, script → approximate). Captions are outlined for legibility.
TODO: per-word emphasis colouring.

## `advanced` (scene-level and plan-level)
Escape hatch for anything the plan vocabulary doesn't cover but the host can do (cameras, 3D layers, blend modes, track
mattes, masks, expressions, markers, effects...). A block is a list of **typed host ops** (`xoxo bridge ops`), run inside
the idempotent build; `comp` defaults to the scene's composition (`"$COMP"`) — use `"$MASTER"` for the master. `raw_eval`
is never allowed here.
```json
{ "id": "S03", "start": 20, "end": 30, "clips": [{ "asset": "IMG_J20_FRONT" }],
  "advanced": [ { "label": "3D camera push", "optional": true, "ops": [
      { "op": "layers_remove", "args": { "names": ["CAM_MAIN"] } },
      { "op": "layer_add_camera", "args": { "name": "CAM_MAIN" } },
      { "op": "keyframes", "args": { "layer": "CAM_MAIN", "prop": "position", "ease": "easeInOut",
          "keys": [{ "t": 0, "v": [960, 540, -1600] }, { "t": 10, "v": [960, 540, -1200] }] } } ] } ] }
```
Include your own `layers_remove` so re-running stays idempotent. Not-yet-exposed: freeze frames / time remap (TODO).

## Layer naming (what you'll see in After Effects)
`COMP_MASTER`, `COMP_SCENE_01…`, scene layers `SC_S01…`, footage layers = asset id (`IMG_J20_FRONT`), `TXT_TITLE_1`,
`SHP_TITLE_RULE_1`, `TXT_LT_NAME_1`, `NARR_MAIN`, `MUSIC_MAIN`, `SFX_WHOOSH_01_1`, `CAP_0001…`, `ADJ_GRADE`, `ADJ_GRAIN`.
Project folders: `00_MASTER`, `10_SCENES`, `20_FOOTAGE/{Video,Stills}`, `30_AUDIO`.
