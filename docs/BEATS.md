# Beat engine

`xoxo beats track.wav` (or the automatic step in `xoxo edit`) analyses music into a **beat map** — `beat_map.json` in the
project. Pure JavaScript, no dependencies: FFmpeg decodes to PCM, everything else is in `src/beat/`.

## What it finds

| Field | Meaning |
|-------|---------|
| `bpm`, `confidence`, `beatPeriod`, `tempoAlternatives`, `foldedFrom` | tempo, folded into 80–165 BPM (a half/double-time ambiguity is reported, not hidden) |
| `beats`, `downbeats`, `bars`, `phrases` | beat times; bar starts (chosen by low-band weight); per-bar energy/low-end; 4-bar phrases |
| `drops` | a loud, bass-heavy bar right after a much quieter one |
| `breaks` | runs of bars with almost no low end (a trailing run is the outro, not a break) |
| `rises` | climbing high-band energy leading into a drop (≤ 4 bars) |
| `impacts` | every drop plus the strongest low-band attacks ≥ 0.4 s apart, refined to the sample-level attack; `kind` = drop / downbeat / accent |
| `sections` | per-bar labels merged into runs: intro, build, break, drop, verse, outro |
| `energy` | per-second energy curve 0–1 |

How: STFT with spectral flux per band → onset envelope → autocorrelation tempo → comb-grid fit with least-squares phase/period
→ downbeats from the low-band weight of each beat position → structure from per-bar band energies.

## How the Director uses it

Cuts are chosen from beat-grid candidates (half-beats when the edit is intense), weighted towards downbeats and phrase
starts; **a shot always starts on a drop**; impacts become camera hits, flashes, freeze/impact speed maps and SFX; risers
end on the drop; breaks get longer shots; text hits land on grid points. Without music the Director cuts to a **virtual
grid** and says so in the report, in `NO_REAL_BEATS`, and in the benchmark.

## Honest limits

* Verified against **synthetic ground truth** (96 / 128 / 150 BPM tracks with known structure, lead-in silence, added noise) and
  on files with spaces in their paths. It has **not** been measured on a corpus of real music; expect trouble with rubato,
  tempo changes, swing-heavy or very sparse material, and 3/4 time (4/4 is assumed).
* Tempo is folded into 80–165 BPM, so a 70 BPM trap track is reported as 140 (`tempoAlternatives` lists both).
* "Drop" means a loud bass-heavy bar after a quiet one. A song whose energy rises gradually has none.
