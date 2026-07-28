# Persona Divergence Report

Generated: 2026-07-28T13:57:59.352Z

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
| Fast Paced | 0.5926 | 0.6379 | 0.3271 | 0.5724 | 0.2820 |
| Slow / Ambient | 0.1918 | 0.5516 | 0.4034 | 0.6086 | 0.2923 |
| Melodic | 0.4459 | 0.7187 | 0.4034 | 0.5412 | 0.3769 |
| Experimental | 0.4849 | 0.6559 | 0.4767 | 0.4781 | 0.4914 |
| Nostalgic | 0.3688 | 0.5454 | 0.3209 | 0.7461 | 0.2318 |

## Distribution Assertions

| Metric | Direction | Expected Persona | Actual Persona | Value | Passed |
|--------|-----------|-----------------|----------------|-------|--------|
| rhythmicDensity | highest | fast_paced | fast_paced | 0.5926 | PASS |
| rhythmicDensity | lowest | slow_ambient | slow_ambient | 0.1918 | PASS |
| experimentalTolerance | highest | experimental | experimental | 0.4914 | PASS |
| nostalgiaBias | highest | nostalgic | nostalgic | 0.7461 | PASS |
| melodicComplexity | highest | melodic | melodic | 0.7187 | PASS |

## Overlap Matrix

Max allowed overlap: 40%

| Persona A | Persona B | Shared Tracks | Overlap % | Status |
|-----------|-----------|---------------|-----------|--------|
| fast_paced | slow_ambient | 0 | 0% | PASS |
| fast_paced | melodic | 2 | 4% | PASS |
| fast_paced | experimental | 8 | 16% | PASS |
| fast_paced | nostalgic | 2 | 4% | PASS |
| slow_ambient | melodic | 5 | 10% | PASS |
| slow_ambient | experimental | 2 | 4% | PASS |
| slow_ambient | nostalgic | 7 | 14% | PASS |
| melodic | experimental | 18 | 36% | PASS |
| melodic | nostalgic | 2 | 4% | PASS |
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
| 1 | `C64Music/MUSICIANS/S/Speedball/Vangelis_My_Love.sid:1` | 0.6907 | Selected for Fast Paced: rhythmicDensity=0.660 (high, w=0.60); experimentalTolerance=0.198 (low, w=0.15) |
| 2 | `C64Music/MUSICIANS/N/Nebula/Drama.sid:1` | 0.6859 | Selected for Fast Paced: rhythmicDensity=0.650 (high, w=0.60); experimentalTolerance=0.214 (low, w=0.15) |
| 3 | `C64Music/DEMOS/S-Z/Trumpet_Fiesta.sid:1` | 0.6820 | Selected for Fast Paced: rhythmicDensity=0.644 (high, w=0.60); experimentalTolerance=0.313 (low, w=0.15) |
| 4 | `C64Music/MUSICIANS/W/Wayne/Knives_Intro.sid:1` | 0.6718 | Selected for Fast Paced: rhythmicDensity=0.725 (high, w=0.60); experimentalTolerance=0.407 (low, w=0.15) |
| 5 | `C64Music/MUSICIANS/E/Emil/Classic_Mix.sid:1` | 0.6718 | Selected for Fast Paced: rhythmicDensity=0.623 (high, w=0.60); experimentalTolerance=0.253 (low, w=0.15) |

### Slow / Ambient

| Rank | Track ID | Score | Explanation |
|------|----------|-------|-------------|
| 1 | `C64Music/MUSICIANS/W/Walbeehm_Benjamin/Evil_Dead.sid:1` | 0.7713 | Selected for Slow / Ambient: rhythmicDensity=0.147 (low, w=0.60); melodicComplexity=0.684 (high, w=0.15) |
| 2 | `C64Music/MUSICIANS/R/Roly/Electronic_Downscale.sid:1` | 0.7702 | Selected for Slow / Ambient: rhythmicDensity=0.221 (low, w=0.60); melodicComplexity=0.682 (high, w=0.15) |
| 3 | `C64Music/MUSICIANS/E/Eeben_Aleksi/Barbie_Girl.sid:1` | 0.7641 | Selected for Slow / Ambient: rhythmicDensity=0.211 (low, w=0.60); melodicComplexity=0.668 (high, w=0.15) |
| 4 | `C64Music/MUSICIANS/T/Triace/Happy_Yummy_Bear.sid:1` | 0.7620 | Selected for Slow / Ambient: rhythmicDensity=0.196 (low, w=0.60); melodicComplexity=0.686 (high, w=0.15) |
| 5 | `C64Music/GAMES/S-Z/Super_Mario_Bros_64_2SID.sid:1` | 0.7461 | Selected for Slow / Ambient: rhythmicDensity=0.143 (low, w=0.60); melodicComplexity=0.606 (high, w=0.15) |

### Melodic

| Rank | Track ID | Score | Explanation |
|------|----------|-------|-------------|
| 1 | `C64Music/MUSICIANS/A/Agemixer/Rapping_Radical_v2.sid:1` | 0.6922 | Selected for Melodic: melodicComplexity=0.813 (high, w=0.60); timbralRichness=0.296 (high, w=0.15) |
| 2 | `C64Music/MUSICIANS/A/Ahz_The_Demon/Mindblended.sid:1` | 0.6834 | Selected for Melodic: melodicComplexity=0.785 (high, w=0.60); timbralRichness=0.413 (high, w=0.15) |
| 3 | `C64Music/MUSICIANS/B/Bayliss_Richard/Summer_Timebooze_2SID.sid:1` | 0.6810 | Selected for Melodic: melodicComplexity=0.766 (high, w=0.60); timbralRichness=0.382 (high, w=0.15) |
| 4 | `C64Music/MUSICIANS/A/Acrouzet/A_Pointless_Quest_2SID.sid:1` | 0.6757 | Selected for Melodic: melodicComplexity=0.719 (high, w=0.60); timbralRichness=0.422 (high, w=0.15) |
| 5 | `C64Music/MUSICIANS/B/Booker/Stereo_Pendejo_2SID.sid:1` | 0.6703 | Selected for Melodic: melodicComplexity=0.701 (high, w=0.60); timbralRichness=0.487 (high, w=0.15) |

### Experimental

| Rank | Track ID | Score | Explanation |
|------|----------|-------|-------------|
| 1 | `C64Music/MUSICIANS/M/MCH/Acid_Storm_3SID.sid:1` | 0.6421 | Selected for Experimental: experimentalTolerance=0.646 (high, w=0.60); timbralRichness=0.590 (high, w=0.15) |
| 2 | `C64Music/MUSICIANS/P/Proton/Saunasolmuhumppa_2SID.sid:1` | 0.6332 | Selected for Experimental: experimentalTolerance=0.590 (high, w=0.60); timbralRichness=0.668 (high, w=0.15) |
| 3 | `C64Music/MUSICIANS/H/Hermit/Earmind_3SID.sid:1` | 0.6081 | Selected for Experimental: experimentalTolerance=0.707 (high, w=0.60); timbralRichness=0.501 (high, w=0.15) |
| 4 | `C64Music/MUSICIANS/D/D_V/3SID_Test_3SID.sid:1` | 0.6024 | Selected for Experimental: experimentalTolerance=0.660 (high, w=0.60); timbralRichness=0.566 (high, w=0.15) |
| 5 | `C64Music/DEMOS/S-Z/Sparkster-Lakeside_2SID.sid:1` | 0.5999 | Selected for Experimental: experimentalTolerance=0.530 (high, w=0.60); timbralRichness=0.536 (high, w=0.15) |

### Nostalgic

| Rank | Track ID | Score | Explanation |
|------|----------|-------|-------------|
| 1 | `C64Music/GAMES/M-R/Miner.sid:1` | 0.7641 | Selected for Nostalgic: nostalgiaBias=0.814 (high, w=0.60); experimentalTolerance=0.053 (low, w=0.10) |
| 2 | `C64Music/DEMOS/0-9/1988_Carat_tune_1.sid:1` | 0.7569 | Selected for Nostalgic: nostalgiaBias=0.801 (high, w=0.60); melodicComplexity=0.685 (high, w=0.15) |
| 3 | `C64Music/MUSICIANS/O/Odi/Oedipus.sid:1` | 0.7460 | Selected for Nostalgic: nostalgiaBias=0.752 (high, w=0.60); melodicComplexity=0.642 (high, w=0.15) |
| 4 | `C64Music/DEMOS/0-9/3-in-1_Demo.sid:1` | 0.7362 | Selected for Nostalgic: nostalgiaBias=0.778 (high, w=0.60); melodicComplexity=0.691 (high, w=0.15) |
| 5 | `C64Music/GAMES/G-L/Groessenwarnsinnig_Boulder_Dash.sid:1` | 0.7362 | Selected for Nostalgic: nostalgiaBias=0.768 (high, w=0.60); melodicComplexity=0.741 (high, w=0.15) |
