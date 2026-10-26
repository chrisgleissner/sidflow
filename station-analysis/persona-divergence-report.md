# Persona Divergence Report

Generated: 2026-10-26T14:19:33.421Z

## Architecture

Parallel independent model: each persona independently scores ALL tracks and selects its top 50.
NO cross-persona filtering. NO intersection. NO allAccepted requirement.

## Personas

| # | ID | Label |
|---|-------|-------|
| 1 | fast_paced | Fast Paced |
| 2 | slow_ambient | Slow / Ambient |
| 3 | melodic | Melodic |
| 4 | experimental | Experimental |
| 5 | nostalgic | Nostalgic |

## Distribution Summary

| Persona | avgRhythmicDensity | avgMelodicComplexity | avgTimbralRichness | avgNostalgiaBias | avgExperimentalTolerance |
|---------|-------------------|---------------------|-------------------|-----------------|------------------------|
| Fast Paced | 0.5944 | 0.6339 | 0.3232 | 0.5672 | 0.2800 |
| Slow / Ambient | 0.2120 | 0.6128 | 0.3379 | 0.5901 | 0.2490 |
| Melodic | 0.4276 | 0.7165 | 0.3936 | 0.5536 | 0.3494 |
| Experimental | 0.4886 | 0.6496 | 0.4745 | 0.4828 | 0.4876 |
| Nostalgic | 0.3716 | 0.5783 | 0.3251 | 0.7602 | 0.2441 |

## Distribution Assertions

| Metric | Direction | Expected Persona | Actual Persona | Value | Passed |
|--------|-----------|-----------------|----------------|-------|--------|
| rhythmicDensity | highest | fast_paced | fast_paced | 0.5944 | PASS |
| rhythmicDensity | lowest | slow_ambient | slow_ambient | 0.2120 | PASS |
| experimentalTolerance | highest | experimental | experimental | 0.4876 | PASS |
| nostalgiaBias | highest | nostalgic | nostalgic | 0.7602 | PASS |
| melodicComplexity | highest | melodic | melodic | 0.7165 | PASS |

## Overlap Matrix

Max allowed overlap: 40%

| Persona A | Persona B | Shared Tracks | Overlap % | Status |
|-----------|-----------|---------------|-----------|--------|
| fast_paced | slow_ambient | 0 | 0% | PASS |
| fast_paced | melodic | 2 | 4% | PASS |
| fast_paced | experimental | 9 | 18% | PASS |
| fast_paced | nostalgic | 1 | 2% | PASS |
| slow_ambient | melodic | 8 | 16% | PASS |
| slow_ambient | experimental | 2 | 4% | PASS |
| slow_ambient | nostalgic | 4 | 8% | PASS |
| melodic | experimental | 15 | 30% | PASS |
| melodic | nostalgic | 5 | 10% | PASS |
| experimental | nostalgic | 0 | 0% | PASS |

## Anti-Collapse Validation

- All stations independent: YES (parallel model, no sequential filtering)
- No station is derived from intersection: YES (each persona scores full pool)
- Overlap valid (all pairs <= 40%): YES
- Distribution valid (leader assertions): YES

## Per-Persona Top 5 Tracks

### Fast Paced

| Rank | Track ID | Score | Explanation |
|------|----------|-------|-------------|
| 1 | `C64Music/MUSICIANS/S/Speedball/Vangelis_My_Love.sid:1` | 0.6952 | Selected for Fast Paced: rhythmicDensity=0.668 (high, w=0.60); experimentalTolerance=0.196 (low, w=0.15) |
| 2 | `C64Music/MUSICIANS/N/Nebula/Drama.sid:1` | 0.6882 | Selected for Fast Paced: rhythmicDensity=0.654 (high, w=0.60); experimentalTolerance=0.212 (low, w=0.15) |
| 3 | `C64Music/DEMOS/S-Z/Trumpet_Fiesta.sid:1` | 0.6815 | Selected for Fast Paced: rhythmicDensity=0.643 (high, w=0.60); experimentalTolerance=0.312 (low, w=0.15) |
| 4 | `C64Music/MUSICIANS/E/Emil/Classic_Mix.sid:1` | 0.6744 | Selected for Fast Paced: rhythmicDensity=0.628 (high, w=0.60); experimentalTolerance=0.253 (low, w=0.15) |
| 5 | `C64Music/MUSICIANS/W/Wayne/Knives_Intro.sid:1` | 0.6742 | Selected for Fast Paced: rhythmicDensity=0.729 (high, w=0.60); experimentalTolerance=0.405 (low, w=0.15) |

### Slow / Ambient

| Rank | Track ID | Score | Explanation |
|------|----------|-------|-------------|
| 1 | `C64Music/MUSICIANS/W/Walbeehm_Benjamin/Evil_Dead.sid:1` | 0.7819 | Selected for Slow / Ambient: rhythmicDensity=0.145 (low, w=0.60); melodicComplexity=0.681 (high, w=0.15) |
| 2 | `C64Music/GAMES/S-Z/Super_Mario_Bros_64_2SID.sid:9` | 0.7800 | Selected for Slow / Ambient: rhythmicDensity=0.140 (low, w=0.60); melodicComplexity=0.647 (high, w=0.15) |
| 3 | `C64Music/MUSICIANS/E/Eeben_Aleksi/Barbie_Girl.sid:1` | 0.7752 | Selected for Slow / Ambient: rhythmicDensity=0.210 (low, w=0.60); melodicComplexity=0.666 (high, w=0.15) |
| 4 | `C64Music/MUSICIANS/R/Roly/Electronic_Downscale.sid:1` | 0.7697 | Selected for Slow / Ambient: rhythmicDensity=0.221 (low, w=0.60); melodicComplexity=0.679 (high, w=0.15) |
| 5 | `C64Music/MUSICIANS/T/Triace/Happy_Yummy_Bear.sid:1` | 0.7633 | Selected for Slow / Ambient: rhythmicDensity=0.193 (low, w=0.60); melodicComplexity=0.685 (high, w=0.15) |

### Melodic

| Rank | Track ID | Score | Explanation |
|------|----------|-------|-------------|
| 1 | `C64Music/MUSICIANS/A/Agemixer/Rapping_Radical_v2.sid:1` | 0.6912 | Selected for Melodic: melodicComplexity=0.811 (high, w=0.60); timbralRichness=0.295 (high, w=0.15) |
| 2 | `C64Music/MUSICIANS/A/Ahz_The_Demon/Mindblended.sid:1` | 0.6830 | Selected for Melodic: melodicComplexity=0.785 (high, w=0.60); timbralRichness=0.413 (high, w=0.15) |
| 3 | `C64Music/MUSICIANS/B/Booker/Stereo_Pendejo_2SID.sid:1` | 0.6803 | Selected for Melodic: melodicComplexity=0.699 (high, w=0.60); timbralRichness=0.486 (high, w=0.15) |
| 4 | `C64Music/MUSICIANS/B/Bayliss_Richard/Summer_Timebooze_2SID.sid:1` | 0.6796 | Selected for Melodic: melodicComplexity=0.764 (high, w=0.60); timbralRichness=0.381 (high, w=0.15) |
| 5 | `C64Music/MUSICIANS/H/HTD/Katastrof.sid:1` | 0.6782 | Selected for Melodic: melodicComplexity=0.805 (high, w=0.60); timbralRichness=0.311 (high, w=0.15) |

### Experimental

| Rank | Track ID | Score | Explanation |
|------|----------|-------|-------------|
| 1 | `C64Music/MUSICIANS/M/MCH/Acid_Storm_3SID.sid:1` | 0.6407 | Selected for Experimental: experimentalTolerance=0.643 (high, w=0.60); timbralRichness=0.589 (high, w=0.15) |
| 2 | `C64Music/MUSICIANS/P/Proton/Saunasolmuhumppa_2SID.sid:1` | 0.6313 | Selected for Experimental: experimentalTolerance=0.587 (high, w=0.60); timbralRichness=0.666 (high, w=0.15) |
| 3 | `C64Music/MUSICIANS/H/Hermit/Earmind_3SID.sid:1` | 0.6081 | Selected for Experimental: experimentalTolerance=0.707 (high, w=0.60); timbralRichness=0.501 (high, w=0.15) |
| 4 | `C64Music/MUSICIANS/D/D_V/3SID_Test_3SID.sid:1` | 0.6012 | Selected for Experimental: experimentalTolerance=0.658 (high, w=0.60); timbralRichness=0.564 (high, w=0.15) |
| 5 | `C64Music/DEMOS/S-Z/Sparkster-Lakeside_2SID.sid:1` | 0.5990 | Selected for Experimental: experimentalTolerance=0.528 (high, w=0.60); timbralRichness=0.535 (high, w=0.15) |

### Nostalgic

| Rank | Track ID | Score | Explanation |
|------|----------|-------|-------------|
| 1 | `C64Music/DEMOS/0-9/3-in-1_Demo.sid:1` | 0.7758 | Selected for Nostalgic: nostalgiaBias=0.828 (high, w=0.60); melodicComplexity=0.689 (high, w=0.15) |
| 2 | `C64Music/GAMES/G-L/Groessenwarnsinnig_Boulder_Dash.sid:1` | 0.7756 | Selected for Nostalgic: nostalgiaBias=0.818 (high, w=0.60); melodicComplexity=0.740 (high, w=0.15) |
| 3 | `C64Music/DEMOS/0-9/1988_Carat_tune_1.sid:1` | 0.7658 | Selected for Nostalgic: nostalgiaBias=0.801 (high, w=0.60); melodicComplexity=0.633 (high, w=0.15) |
| 4 | `C64Music/GAMES/M-R/Miner.sid:1` | 0.7638 | Selected for Nostalgic: nostalgiaBias=0.814 (high, w=0.60); experimentalTolerance=0.052 (low, w=0.10) |
| 5 | `C64Music/MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid:12` | 0.7592 | Selected for Nostalgic: nostalgiaBias=0.857 (high, w=0.60); experimentalTolerance=0.089 (low, w=0.10) |
