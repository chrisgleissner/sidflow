
## Trace classes as implemented

`trace-core.ts` (`classify`) evaluates the rules in this order; the first that applies wins. Traces are cut at the observation horizon
(reference at `horizon x clock`, variant at the same time shifted by the constant start offset when it is under 20,000 cycles).
Clock is PAL unless the header declares NTSC (what libsidplayfp plays).

| class | rule |
|---|---|
| X | no claim from the trace: reference or variant failed with a non-CPU engine error, or a native trace overflowed its 2,000,000-write buffer (`trace-truncated`); audio decides |
| A | identical (chip, address, value, cycle) sequence and identical error text (a reference that jams identically is A) |
| G | variant has at most 32 writes and the reference at least 8 more (initialisation only) |
| H | variant stops on an illegal instruction, the reference does not, and the first value divergence is within the first half of the horizon |
| I | one trace is a value prefix of the other and the signed cumulative drift at the last matched write exceeds 10 ms |
| B | identical value sequence and write count; subclass by max drift after the start offset: <=63 cycles, <=1 ms, <=2 ms, >2 ms |
| C | alignment leaves at most max(8, 0.1% of the longer trace) writes unmatched (extra or missing, trailing or interior) |
| F | first value divergence after 50% of the horizon |
| D | earlier divergence, min/max write count >= 0.9 and alignment similarity >= 0.5 |
| E | earlier divergence otherwise (counts differ by more than 10%, or fewer than half of the reference writes align) |

Grade 255 needs class A with complete traces; grade 254 needs class B with equal error text and max drift <= T (2 ms: 1,970 PAL / 2,045 NTSC cycles).
The KERNAL+BASIC lane of a program that never reads CHARGEN is identical to the reference by construction (the audit's rule) and is
graded 255 without rendering (`chargen-unread`).

Alignment similarity is the longest common subsequence of (chip, address, value) divided by the reference write count. Common prefix and suffix are
stripped; the middle is aligned with Myers' O(ND) algorithm (exact when D <= 2,000, expected O(n + D^2)); beyond that a time-synchronous block alignment
(1,500-write blocks, D <= 3,000 each, a deterministic 250M-step budget) returns a lower bound and `alignmentExact` is false.

## Audio severity as implemented, and why it differs from listener-v1

2,048-frame windows (42.7 ms at the audit's 48 kHz; the design's 46.4 ms is the same 2,048 frames at 44.1 kHz), listener-v1 preprocessing (per channel, 2:1 averaging,
DC removal, Hann, 1,024-point FFT), about third-octave bands (listener-v1's 1.26 ratio, so the lowest bands are single bins). Per (channel, band) the level above a
-60 dBFS white-noise floor is compared in dB: `e = ramp(|L_ref - L_var|)` with a 3 dB dead zone saturating at 15 dB; the distance of silence is `ramp(L_ref)`;
`s_w = min(1, mean(e) / mean(e_silence))` over bands active in either signal; windows below -60 dBFS on both sides are skipped; `Q = 1 - mean(s_w)`; `G = max(1, round(253 Q))`, 0 if Q < 1/506.

My first implementation used bin magnitudes inside each band (the listener-v1 form). It scored a pure 13-cycle re-timing (Jasam, bit-for-bit the same values) at
median s_w 0.059, p95 0.20, max 0.28, which would have failed gate 2 on the first lane tried. Cause: in the upper bands the bin magnitudes are dominated by the
resampler's aliasing products, whose per-bin realisation changes with the sample phase (best-lag waveform correlation was 0.975, band energies agreed within 1 dB).
Comparing band energies instead of bin magnitudes brought the same lane to median 0, max 0.03.

## Gate 2: original criterion, revised criterion, decisions

The original criterion (median s_w <= 0.02 and no window above 0.25 for every 254 lane) fails: 20 of 36 lanes have at least one window above 0.25
(typically 1 to 50 isolated windows out of thousands, often at a note onset) and two SIDLite lanes miss the median (Crucial_Moment_part_5 0.0213,
3SID_Tracker_Demo_1 0.0536). All 36 lanes have mean s_w <= 0.070 (Q >= 0.93, audio grade >= 235) and no lane has more than 1.52% of its windows above 0.25.

The principal engineer decided on the evidence-based criterion: **every 254 lane has audio grade >= 235, mean s_w <= 0.07 and at most 2% of windows above 0.25.** All 36 corpus
lanes meet it, so gate 2 passes. Grade 254 is documented as "identical register values, re-timed <= 2 ms; audio-validated 235-253 on the corpus".

Other decisions recorded with the calibration:
- The dB-band audio metric stays (deviation from the design's bin-magnitude wording, with the evidence above). T = 2 ms and gamma = 1 are frozen.
- Consumer: `recommended_min_grade` = 128; the list ceiling is 191 (a subtune is listed iff some lane is <= 191). On the benchmark that is 2.0% of subtunes (population-weighted), 1.6% below 128.
- Gate 4 (listening) is non-blocking: grades are threshold independent. A listening session can only move the consumer thresholds (or fit gamma), never require regrading. The user is offered the listening page.

Offline sensitivity study on the first-pass corpus (36 class-B lanes; level matrices recomputed at a 256-frame hop so that a variant window can be matched
against reference windows shifted by up to K hops of 5.3 ms, otherwise the same metric), for reference:

| metric | lanes with a window > 0.25 (of 36 class B <= 2 ms) | worst median | G-class silent lanes: Q range |
|---|---|---|---|
| shipped (K = 0, dead zone 3 dB) | 20 | 0.054 | 0.000 - 0.002 |
| K = 1 (+-5 ms) | 14 | 0.025 | 0.000 - 0.002 |
| K = 2 (+-11 ms) | 14 | 0.017 | 0.000 - 0.002 |
| K = 2, dead zone 6 dB, saturation 18 dB | 9 | 0.002 | 0.000 - 0.002 |
| +-1 whole window (43 ms) tolerance | 9 | 0.015 | 0.008 - 0.29 (silence "explained"; fails gate 3) |

Temporal tolerance helps medians but cannot remove the isolated windows, so those windows are real (small) waveform differences, not timing aliasing: with a drift of 13 to 1,200 cycles
the SID's ADSR rate counters, noise-LFSR phase and oscillator phase differ, and the output differs for tens of milliseconds around an onset. They do not move the grade (Q >= 0.93).

## Design observations

- **Window length**: 2,048 frames is 42.7 ms at 48 kHz, not 46.4 ms.
- **Distribution is bimodal.** Over the 320 jobs no lane grades between 1 and 127 and only 3 between 128 and 191; lanes are 255, 254, 250-253, 192-249 or 0. The threshold choice between 64 and 128 is therefore immaterial; between 192 and 250 it matters (D, I and E lanes).
- **"Listed if G <= 253" is too broad** (decided: list ceiling 191). 7.2% of subtunes (population-weighted) have a lane at or below 253, mostly classes C, D, F and truncated-trace digi tunes with audio grades 250-253 (Q >= 0.99) that sound the same. The share below 250 is 6.4%, below 192 is 2.0% (about 1,750 subtunes), below 128 is 1.6%.
- **Class D/E/I are where the grades live**: D (digi/timer RSIDs) 171-250, I (tempo change) 184-219, E (substantially different music) 120-212; their audio grades overlap, so the trace class is not a substitute for audio.
- **Class H (early CPU jam with substantial playback) was not observed**: the early jams in the census (Dark Tower BASIC, MiniSEQ Demo Songs, Mega Digi) all stop within the initialisation writes and are class G; the late jams (Dupa Jasiu at 96% of the horizon, Edge of Panic at 97%, Computer System at 99%) are late divergence. I restricted H to jams in the first half of the horizon after the first pass put a 96%-late jam in H and violated gate 3 (grade 252 against class F lanes at 235). Reference jams (Bullet in the Head, Populous Tune) are class A.
- **CHARGEN readers are rare**: 3 of 3,924 RSID/BASIC files (first subtune, 30 s) and 0 of 5,000 sampled PSID/multiSID files read the character ROM. The KERNAL+BASIC lane is therefore bit-identical to the reference for essentially every subtune; the three readers are in the corpus (Happy Birthday BASIC, Music Maker, Acid Flashback).
- **Engines agree on the trace** (the CPU side is engine independent) and mostly on the grade: one corpus subtune differs by 10 or more points (This Is Not America, 184 vs 194).
- **gamma**: no evidence supports a change from 1; the audio grades are not spread enough to fit a perceptual curve without the listening session (gate 4).
- **Fallback horizon band is empty**: every HVSC #85 subtune has a Songlengths entry; the 300 s fallback never applies.
