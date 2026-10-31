# HVSC #85 ROM fidelity grading: full-run results (2026-10-31)

These are the results of grading every HVSC #85 subtune with the methodology in
[hvsc-rom-fidelity-grading.md](hvsc-rom-fidelity-grading.md), and of the
`sidromdep-1` list derived from them ([specification](../rom-dependency-list.md)). They come from the
second, corrected run; see [Superseded first run](#superseded-first-run) for what changed.

## Run

| Item | Value |
|---|---|
| Scope | 61,157 files, 87,868 subtunes (HVSC #85, corpus `4b66fe03…`) |
| Lanes | SIDLite and reSIDfp, each with no ROMs and with KERNAL+BASIC, against the same engine with all three authentic ROMs |
| Methodology identity | `f256dd987eb81af427731400b505c4470e6c423aa0f583198f5f99171a3b4d83` |
| Songlengths.md5 SHA-256 | `3f2bb5c14e3396fb20979cb017421386dc9e32162999974ad1e4f0a230dc397e` |
| Run commit | `ae90b9c` (PR #113) |
| Launcher | `scripts/rom-grade/run-full.sh`, 18 workers, i5-14600K |
| Wall time | 30,581 s (8.5 h), 591,595 CPU-seconds, 108% pool efficiency |
| Errors, unmeasured lanes | 0, 0 |

## Grade distribution (subtunes per lane)

| Lane | 0 | 1–127 | 128–191 | 192–249 | 250–253 | 254 | 255 |
|---|--:|--:|--:|--:|--:|--:|--:|
| SIDLite, no ROMs | 1,437 | 30 | 46 | 1,328 | 1,941 | 81,279 | 1,807 |
| SIDLite, KERNAL+BASIC | 0 | 0 | 0 | 1 | 0 | 0 | 87,867 |
| reSIDfp, no ROMs | 1,432 | 34 | 40 | 1,192 | 2,080 | 81,282 | 1,808 |
| reSIDfp, KERNAL+BASIC | 0 | 0 | 0 | 1 | 0 | 0 | 87,867 |

- **No ROMs:** 94.6% of subtunes play an identical register value sequence (254) or a bit-exact
  trace (255). 1.67% grade below the recommended skip threshold of 128, which matches the
  calibration estimate of 1.6% from the 320-job stratified benchmark. The grades are bimodal:
  1,432–1,437 subtunes per engine do not play at all (0), and only 30–34 fall between 1 and 127.
- **KERNAL+BASIC (no CHARGEN):** every subtune is bit-exact except one,
  `MUSICIANS/W/Wacek/Acid_Flashback.sid`, which reads the character ROM 159,503 times and grades
  242/243 (audio severity 0.04). It stays above the listing ceiling.
- **Engines agree:** 86,400 subtunes are at or above 128 on both engines and 1,465 are below 128 on
  both. Only 3 subtunes straddle the threshold (2 below it on SIDLite only, 1 on reSIDfp only).

Subtunes below 128 without ROMs, by file type and length stratum:

| Type | 0–30 s | 30–120 s | 120–300 s | 300 s+ |
|---|--:|--:|--:|--:|
| BASIC | 556 / 558 | 769 / 770 | 58 / 58 | 4 / 4 |
| PSID | 11 / 17,306 | 9 / 28,621 | 7 / 30,855 | 1 / 3,362 |
| RSID | 20 / 2,244 | 19 / 1,494 | 9 / 1,791 | 5 / 355 |
| multiSID | 0 / 50 | 0 / 107 | 0 / 265 | 0 / 28 |

BASIC tunes need the BASIC interpreter and almost never play without it. The handful of PSIDs
below 128 play different music from the reference, and several of them evidently derive data from
ROM contents. The trace classes are reported by `scripts/rom-grade/summarize.ts`. 507–508 lanes per
engine hit the 2,000,000-write trace cap (class X), so audio alone decided them.

## Checks

- Before the run, the revised methodology was qualified on 2,961 targeted subtunes (the null set of
  trace-proven same-music lanes, the positive set of every lane below 128, and the re-timing lanes);
  see [the grading design](hvsc-rom-fidelity-grading.md). The calibration gates were re-run under
  the identity above.
- After the run, `summarize.ts` reported no anomalies, and all 61,157 graded SID files were
  re-hashed: every SHA-256 equals the one the run recorded.
- The blind listening gate (gate 4, 2026-10-30) passed with no inversions: every pair graded 171–254
  was rated "Same", and every audible grade-0 pair was rated "Broken". Grades are threshold
  independent, so a listening result could only have moved the consumer thresholds.
- Cases with identical values but cumulative tempo drift (for example `Disco_Trax_87_tune_2`,
  159/161) sit above the skip threshold, as the design intends.

## Derived `sidromdep-1` list

Generated with
`bun scripts/rom-dependency-list/generate.ts --results grading-results.jsonl --listing-ceiling 191 --recommended-min-grade 128 --songlengths Songlengths.md5`
and verified by `scripts/rom-dependency-list/verify.ts`, which round-trips all 87,868 graded subtunes.

| Item | Value |
|---|---|
| File | `data/exports/hvsc85-sidromdep-1.bin` (+ `.manifest.json`) |
| Size | 19,228 bytes (224 + 17 × 672 + 5 × 1,516) |
| Listed | 672 files, 1,516 subtunes (some lane ≤ 191); 86,352 unlisted (all lanes ≥ 192) |
| Below the recommended threshold (128) | 1,468 subtunes in at least one lane, in 627 files |
| bin SHA-256 | `c1923e490825ebbdfcd2d5c83f837e129c629d1eb222df1029c063afa19f1be6` |
| manifest SHA-256 | `bc3bd291064420cf6e0feb93dee55a8dc6393fa0edc57ded111cc35fcf94b482` |

The full per-subtune grades (`grading-results.jsonl`), the per-lane research export with trace
classes, features and window severities, and the run evidence are published in the
sidflow-data release `rom-grading-hvsc85-20261031`.

## Superseded first run

A first full run on 2026-10-30 (methodology `bf3b3eff…`, release `rom-audit-hvsc85-20261030`) is
superseded. An adversarial review found that lock-step audio comparison graded pure re-timing as
broken, that near-floor noise saturated window severity, and that the 254 shortcut on digitized
samples was unvalidated. After the fixes and a qualification on 2,961 targeted subtunes, all 87,868
subtunes were graded again. The first run's list had 696 files, 1,556 subtunes and 19,836 bytes,
with 1,469 subtunes in 628 files below 128. In the second run `DEMOS/A-F/Funky_Drummer.sid` #1 left
the below-128 set: it writes the same register values with about 0.07% tempo drift, which lock-step
comparison had graded 127. 39 subtunes left the 128–191 band for above 191, and nothing moved down.
