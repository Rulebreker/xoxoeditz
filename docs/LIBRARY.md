# The universal asset library

One folder of production resources that every project can draw on: sound effects, music, overlays, graphics, fonts,
LUTs, presets, transitions, textures, AE templates. It is **read-only** to XOXOEDITZ: nothing in it is modified, executed,
or deleted, and nothing is downloaded into it.

Point XOXOEDITZ at it with `XOXOEDITZ_ASSETS` (alias `XOXO_LIBRARY`), `"libraryRoot"` in `xoxo.config.json`, or by
putting a folder named `XOXOEDITZ_ASSETS` next to the repo. `xoxo library init [dir]` creates the tree and a README.

```
XOXOEDITZ_ASSETS/
  SFX/        WHOOSH IMPACT RISER HIT SWOOSH CAMERA TRANSITION GLITCH DIGITAL UI BOOM SUB TENSION AMBIENCE WEAPON MECHANICAL VEHICLE FOOTSTEP CLICK TICK REVERSE SWELL
  MUSIC/      CINEMATIC ACTION DOCUMENTARY TECHNO CORPORATE DARK EPIC PHONK HIP_HOP AMBIENT
  OVERLAYS/   FILM LIGHT DUST SMOKE FIRE PARTICLES ENERGY GLITCH
  GRAPHICS/   HUD GRIDS TARGETING TECH ARROWS CALLOUTS LOWER_THIRDS
  FONTS/  LUTS/  PRESETS/  TRANSITIONS/  TEXTURES/  AE_TEMPLATES/
```

## Scanning

`xoxo library scan` writes `.xoxo/library/universal-assets.manifest.json`. It is incremental (unchanged files are reused by
size + mtime + content fingerprint), detects duplicates, and **measures** audio rather than trusting names:

| Field | Source |
|-------|--------|
| `category`, `subcategory` | the folder |
| `tags` | folder + file name (split on case and digits: `Whoosh03` → whoosh) + measured traits (`short`, `long`, `bright`, `low`, `sharp`, `soft`) + sidecar |
| `duration`, `sampleRate`, `channels`, `resolution` | ffprobe |
| `features` | decoded PCM: `rmsDb`, `peakDb`, `peakTime` (where the transient is), `attack`, `tail`, `brightness`, `crest` |
| `energy`, `intensity` | measured loudness / attack / brightness blended with category priors; music: tempo too |
| `recommended_for`, `preferred_edit_types`, `preferred_transition`, `genre` | category priors, overridable |
| `description` | generated one-liner |
| `id` | `LIB_<NAME>_<fingerprint5>` — stable across moves |

Add a sidecar next to any file to override: `fast_whoosh_03.json`
```json
{ "tags": ["aggressive"], "description": "tearing air whoosh", "energy": 0.8, "genre": "", "recommended_for": ["velocity"], "preferred_transition": "whip" }
```
Overrides survive re-scans. A `.json` sidecar is never scanned as an asset.

## Searching

`xoxo library search "fast transition"` ranks sounds by meaning, with the reasons:

* the query is expanded with synonyms (whoosh ≈ swoosh ≈ swish ≈ sweep ≈ whip …) at lower weight; spec phrases map to intents
  ("fast transition" → whoosh/fast/transition, "technical UI" → digital/click/ui/electronic, "camera punch" → camera/movement/hit);
* each *concept* counts once through its best-matching synonym in its best field (category > tag > file name > description), so a
  long synonym list never dilutes a good match;
* context adds energy and intensity fit, duration fit, edit-type affinity, preferred categories, a usage-history penalty
  (diversity) and a small memory term. Ties are broken by id, never by chance; the Director's pick among near-ties is seeded.

## Smart fit

`planSfxFit` decides, per event, which part of the file plays and where: impacts/whooshes start early enough that the
measured transient lands exactly on the visual event; risers *end* on the event (and have their head cut if that would start
before 0); long sounds are trimmed with a fade; the level is normalised by measured loudness, ordered by role and capped so
the sound's own peak stays under −6 dBFS; stretch is limited to ±8 % (pitch moves with it in After Effects); big events get a
layered companion (sub under an impact, air tail after a whoosh). All of it is layer in/out + level keyframes —
non-destructive. `makeFitVersion` can write a trimmed copy into the cache when a standalone file is needed.

## The starter pack

`xoxo library starter [dir]` (or `--starter-sfx` on `xoxo edit`) **generates** 24 license-free sounds with FFmpeg — whooshes,
impacts, risers, booms, UI blips, glitches, ambience … — offline and deterministic. They are placeholders that make the
whole pipeline work out of the box; replace or extend them with real sound design for a premium result.

## Project folders

`xoxo project init <dir>` creates `INPUT/ AUDIO/ OUTPUT/ CACHE/ REPORTS/` anywhere you like. Sources are only ever read.
