# Persona Divergence Report

Generated: 2026-03-30T16:17:16.647Z

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
| Fast Paced | 0.2842 | 0.4449 | 0.2690 | 0.6044 | 0.1039 |
| Slow / Ambient | 0.2079 | 0.5714 | 0.3083 | 0.4996 | 0.2303 |
| Melodic | 0.2763 | 0.6206 | 0.4050 | 0.5732 | 0.2495 |
| Experimental | 0.2349 | 0.5700 | 0.3971 | 0.5120 | 0.3175 |
| Nostalgic | 0.2814 | 0.4951 | 0.2978 | 0.7652 | 0.1419 |

## Distribution Assertions

| Metric | Direction | Expected Persona | Actual Persona | Value | Passed |
|--------|-----------|-----------------|----------------|-------|--------|
| rhythmicDensity | highest | fast_paced | fast_paced | 0.2842 | PASS |
| rhythmicDensity | lowest | slow_ambient | slow_ambient | 0.2079 | PASS |
| experimentalTolerance | highest | experimental | experimental | 0.3175 | PASS |
| nostalgiaBias | highest | nostalgic | nostalgic | 0.7652 | PASS |
| melodicComplexity | highest | melodic | melodic | 0.6206 | PASS |

## Overlap Matrix

Max allowed overlap: 40%

| Persona A | Persona B | Shared Tracks | Overlap % | Status |
|-----------|-----------|---------------|-----------|--------|
| fast_paced | slow_ambient | 0 | 0% | PASS |
| fast_paced | melodic | 0 | 0% | PASS |
| fast_paced | experimental | 0 | 0% | PASS |
| fast_paced | nostalgic | 1 | 2% | PASS |
| slow_ambient | melodic | 7 | 14% | PASS |
| slow_ambient | experimental | 14 | 28% | PASS |
| slow_ambient | nostalgic | 0 | 0% | PASS |
| melodic | experimental | 11 | 22% | PASS |
| melodic | nostalgic | 0 | 0% | PASS |
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
| 1 | `C64Music/GAMES/S-Z/Sallys_Garden_preview.sid:1` | 0.5217 | Selected for Fast Paced: rhythmicDensity=0.313 (high, w=0.60); experimentalTolerance=0.119 (low, w=0.15) |
| 2 | `C64Music/MUSICIANS/Z/Zynthaxx/Ob-la-di_Ob-la-da.sid:1` | 0.5213 | Selected for Fast Paced: rhythmicDensity=0.304 (high, w=0.60); experimentalTolerance=0.101 (low, w=0.15) |
| 3 | `C64Music/GAMES/S-Z/Ship_BASIC.sid:1` | 0.5194 | Selected for Fast Paced: rhythmicDensity=0.311 (high, w=0.60); experimentalTolerance=0.133 (low, w=0.15) |
| 4 | `C64Music/MUSICIANS/L/Linde/Rotator_tune_2.sid:1` | 0.5194 | Selected for Fast Paced: rhythmicDensity=0.282 (high, w=0.60); experimentalTolerance=0.094 (low, w=0.15) |
| 5 | `C64Music/MUSICIANS/Y/Yuro/Jingle.sid:1` | 0.5154 | Selected for Fast Paced: rhythmicDensity=0.305 (high, w=0.60); experimentalTolerance=0.084 (low, w=0.15) |

### Slow / Ambient

| Rank | Track ID | Score | Explanation |
|------|----------|-------|-------------|
| 1 | `C64Music/DEMOS/M-R/Prophet64_Sequencer_Demo_2SID.sid:1` | 0.7639 | Selected for Slow / Ambient: rhythmicDensity=0.162 (low, w=0.60); melodicComplexity=0.608 (high, w=0.15) |
| 2 | `C64Music/GAMES/S-Z/Super_Mario_Bros_64_2SID.sid:27` | 0.7604 | Selected for Slow / Ambient: rhythmicDensity=0.139 (low, w=0.60); melodicComplexity=0.593 (high, w=0.15) |
| 3 | `C64Music/GAMES/S-Z/Super_Mario_Bros_64_2SID.sid:22` | 0.7602 | Selected for Slow / Ambient: rhythmicDensity=0.139 (low, w=0.60); melodicComplexity=0.593 (high, w=0.15) |
| 4 | `C64Music/MUSICIANS/M/MovieMovies1/Super_Mario_Bros_2SID.sid:1` | 0.7531 | Selected for Slow / Ambient: rhythmicDensity=0.184 (low, w=0.60); melodicComplexity=0.634 (high, w=0.15) |
| 5 | `C64Music/MUSICIANS/J/Jellica/Party_Bit_3SID.sid:1` | 0.7514 | Selected for Slow / Ambient: rhythmicDensity=0.185 (low, w=0.60); melodicComplexity=0.565 (high, w=0.15) |

### Melodic

| Rank | Track ID | Score | Explanation |
|------|----------|-------|-------------|
| 1 | `C64Music/MUSICIANS/M/MC_Lord/Outrage_end.sid:1` | 0.5944 | Selected for Melodic: melodicComplexity=0.625 (high, w=0.60); timbralRichness=0.453 (high, w=0.15) |
| 2 | `C64Music/GAMES/S-Z/Super_Mario_Bros_64_2SID.sid:37` | 0.5932 | Selected for Melodic: melodicComplexity=0.628 (high, w=0.60); timbralRichness=0.337 (high, w=0.15) |
| 3 | `C64Music/GAMES/S-Z/Super_Mario_Bros_64_2SID.sid:30` | 0.5932 | Selected for Melodic: melodicComplexity=0.628 (high, w=0.60); timbralRichness=0.337 (high, w=0.15) |
| 4 | `C64Music/MUSICIANS/B/Bayliss_Richard/Not_Future_Composer.sid:1` | 0.5911 | Selected for Melodic: melodicComplexity=0.633 (high, w=0.60); timbralRichness=0.451 (high, w=0.15) |
| 5 | `C64Music/DEMOS/M-R/Ron.sid:1` | 0.5909 | Selected for Melodic: melodicComplexity=0.631 (high, w=0.60); timbralRichness=0.452 (high, w=0.15) |

### Experimental

| Rank | Track ID | Score | Explanation |
|------|----------|-------|-------------|
| 1 | `C64Music/MUSICIANS/H/Hermit/Earmind_3SID.sid:1` | 0.4514 | Selected for Experimental: experimentalTolerance=0.398 (high, w=0.60); timbralRichness=0.411 (high, w=0.15) |
| 2 | `C64Music/MUSICIANS/M/MCH/Acid_Storm_3SID.sid:1` | 0.4457 | Selected for Experimental: experimentalTolerance=0.352 (high, w=0.60); nostalgiaBias=0.435 (low, w=0.10) |
| 3 | `C64Music/MUSICIANS/C/Chiummo_Gaetano/Waterfall_3SID.sid:1` | 0.4456 | Selected for Experimental: experimentalTolerance=0.356 (high, w=0.60); timbralRichness=0.370 (high, w=0.15) |
| 4 | `C64Music/GAMES/S-Z/Super_Mario_Bros_64_2SID.sid:25` | 0.4231 | Selected for Experimental: experimentalTolerance=0.354 (high, w=0.60); timbralRichness=0.388 (high, w=0.15) |
| 5 | `C64Music/MUSICIANS/S/Sidder/Boys_2SID.sid:1` | 0.4207 | Selected for Experimental: experimentalTolerance=0.329 (high, w=0.60); timbralRichness=0.426 (high, w=0.15) |

### Nostalgic

| Rank | Track ID | Score | Explanation |
|------|----------|-------|-------------|
| 1 | `C64Music/GAMES/S-Z/Session_instructions.sid:1` | 0.7543 | Selected for Nostalgic: nostalgiaBias=0.814 (high, w=0.60); melodicComplexity=0.623 (high, w=0.15) |
| 2 | `C64Music/GAMES/0-9/20_Tons.sid:1` | 0.7501 | Selected for Nostalgic: nostalgiaBias=0.850 (high, w=0.60); experimentalTolerance=0.103 (low, w=0.10) |
| 3 | `C64Music/DEMOS/A-F/Cannon_Fodder.sid:1` | 0.7469 | Selected for Nostalgic: nostalgiaBias=0.779 (high, w=0.60); melodicComplexity=0.607 (high, w=0.15) |
| 4 | `C64Music/GAMES/A-F/Brutally_Brainstorm.sid:1` | 0.7344 | Selected for Nostalgic: nostalgiaBias=0.814 (high, w=0.60); melodicComplexity=0.619 (high, w=0.15) |
| 5 | `C64Music/GAMES/M-R/Miner.sid:1` | 0.7329 | Selected for Nostalgic: nostalgiaBias=0.764 (high, w=0.60); melodicComplexity=0.633 (high, w=0.15) |
