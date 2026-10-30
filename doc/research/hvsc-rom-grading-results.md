# HVSC #85 ROM fidelity grading: full-run results (2026-10-30)

These are the results of grading every HVSC #85 subtune with the methodology in
[hvsc-rom-fidelity-grading.md](hvsc-rom-fidelity-grading.md), and of the
`sidromdep-1` list derived from them ([specification](../rom-dependency-list.md)).

## Run

| Item | Value |
|---|---|
| Scope | 61,157 files, 87,868 subtunes (HVSC #85, corpus `4b66fe03…`) |
| Lanes | SIDLite and reSIDfp, each with no ROMs and with KERNAL+BASIC, against the same engine with all three authentic ROMs |
| Methodology identity | `bf3b3efffe4cbe69c538b7d81aa1b84b5b8aa98a8dc312b00500062f57f7c90c` |
| Songlengths.md5 SHA-256 | `3f2bb5c14e3396fb20979cb017421386dc9e32162999974ad1e4f0a230dc397e` |
| Launcher | `scripts/rom-grade/run-full.sh`, 18 workers, i5-14600K |
| Wall time | 30,126 s (8.4 h), 587,017 CPU-seconds, 108% pool efficiency |
| Errors, unmeasured lanes | 0, 0 |

## Grade distribution (subtunes per lane)

| Lane | 0 | 1–127 | 128–191 | 192–249 | 250–253 | 254 | 255 |
|---|--:|--:|--:|--:|--:|--:|--:|
| SIDLite, no ROMs | 1,436 | 32 | 83 | 1,354 | 1,699 | 81,457 | 1,807 |
| SIDLite, KERNAL+BASIC | 0 | 0 | 0 | 1 | 0 | 0 | 87,867 |
| reSIDfp, no ROMs | 1,432 | 34 | 68 | 1,236 | 1,829 | 81,461 | 1,808 |
| reSIDfp, KERNAL+BASIC | 0 | 0 | 0 | 1 | 0 | 0 | 87,867 |

- **No ROMs:** 94.8% of subtunes play an identical register value sequence (254) or a bit-exact
  trace (255). 1.67% grade below the recommended skip threshold of 128, which matches the
  calibration estimate of 1.6% from the 320-job stratified benchmark. The grades are bimodal:
  1,432–1,436 subtunes per engine do not play at all (0), and only 32–34 fall between 1 and 127.
- **KERNAL+BASIC (no CHARGEN):** every subtune is bit-exact except one,
  `MUSICIANS/W/Wacek/Acid_Flashback.sid`, which reads the character ROM 159,503 times and grades
  242/243 (audio severity 0.04). It stays above the listing ceiling.
- **Engines agree:** 86,399 subtunes are at or above 128 on both engines and 1,465 are below 128 on
  both. Only 4 subtunes straddle the threshold (3 below it on SIDLite only, 1 on reSIDfp only).

Subtunes below 128 without ROMs, by file type and length stratum:

| Type | 0–30 s | 30–120 s | 120–300 s | 300 s+ |
|---|--:|--:|--:|--:|
| BASIC | 556 / 558 | 769 / 770 | 58 / 58 | 4 / 4 |
| PSID | 11 / 17,306 | 9 / 28,621 | 7 / 30,855 | 1 / 3,362 |
| RSID | 20 / 2,244 | 20 / 1,494 | 9 / 1,791 | 5 / 355 |
| multiSID | 0 / 50 | 0 / 107 | 0 / 265 | 0 / 28 |

BASIC tunes need the BASIC interpreter and almost never play without it. The handful of PSIDs
below 128 all diverge from the reference within their first 30 to 100 SID writes, at audio
severity 0.54 to 0.99, so they play different music. Several of them evidently derive data from
ROM contents. The trace classes are reported by `scripts/rom-grade/summarize.ts`. 507–508 lanes per
engine hit the 2,000,000-write trace cap (class X), so audio alone decided them.

## Checks during the run

- After 1,000, about 10,000 and about 61,000 subtunes, `summarize.ts` reported no anomalies. Every
  lane graded at or below 235 at the 1,000 mark was inspected by hand. The cases with identical
  values but cumulative tempo drift (for example `Disco_Trax_87_tune_2`, 159/161) sit above the
  skip threshold, as the design intends.
- The blind listening gate (gate 4) passed with no inversions: every pair graded 171–254 was
  rated "Same", and every audible grade-0 pair was rated "Broken".

## Derived `sidromdep-1` list

Generated with
`bun scripts/rom-dependency-list/generate.ts --results grading-results.jsonl --listing-ceiling 191 --recommended-min-grade 128 --songlengths Songlengths.md5`
and verified by `scripts/rom-dependency-list/verify.ts`, which round-trips all 87,868 graded subtunes.

| Item | Value |
|---|---|
| File | `data/exports/hvsc85-sidromdep-1.bin` (+ `.manifest.json`) |
| Size | 19,836 bytes (224 + 17 × 696 + 5 × 1,556) |
| Listed | 696 files, 1,556 subtunes (some lane ≤ 191); 86,312 unlisted (all lanes ≥ 192) |
| Below the recommended threshold (128) | 1,469 subtunes in at least one lane, in 628 files |
| bin SHA-256 | `cc1ede22deb7268cd5f0d56c00a13c3b8b0a5ec2f9d25b94f3f17d32b80437a7` |
| manifest SHA-256 | `712dcbd2f6aab4c1f39ad774f472b6f9c97cc73ea9b44d6d5bbe97968d77f9c0` |

The full per-subtune grades (`grading-results.jsonl`), the per-lane research export with trace
classes, features and window severities, and the run evidence are published in the
sidflow-data release `rom-audit-hvsc85-20261030`.
