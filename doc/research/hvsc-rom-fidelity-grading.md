# ROM fidelity grading (design, 2026-10-29)

Status: design accepted by the principal engineer; the calibration corpus must pass the gates
below before any full-HVSC run. This supersedes binary listener-v1 verdicts for consumer use.

## Why the binary verdict was replaced

The stopped accelerated census (`workspace/rom-audit-sample/`, 5,736 rows) flagged the no-ROM
configuration as incompatible for about 39% of measured rows (about 22% stratified across
HVSC). A write-trace probe (`workspace/rom-grade-probe/`) showed the following:

- **Same music, judged different.** Most flagged PSID and multiSID subtunes write an
  **identical sequence of SID register values**. Their only difference is play-routine timing
  shifted by 13–66 cycles, because the engine's absent-KERNAL IRQ shim enters the handler by a
  different path. Some RSIDs shift by 0.4–1.2 ms with identical values. All of these are the
  same music.
- **The severity measure is inverted.** BASIC tunes produce **one** SID write without ROMs, yet
  score only 1–12% "differing listener windows". The listener's window fraction is therefore
  not a usable severity measure: a silent failure scores lower than a 13-cycle shift.
- **Exact-value comparison is too strict.** Some digi and timer-driven RSIDs have near-identical
  write counts but diverge in values within the first second. Exact value-sequence equality
  cannot judge them, so they need alignment and audio.

Lesson recorded in PLANS.md: validate the result distribution on a representative sample against
expectations before any full run.

## Definition

The grade is one byte `G` per (file MD5, subtune, engine ∈ {SIDLite, reSIDfp}, ROM configuration ∈
{none, KERNAL+BASIC}). It measures playback fidelity against the same engine with all three authentic
ROMs, over the measured horizon (`Songlengths` duration + 5 s, minimum 10 s; 300 s fallback).

| G | Meaning | Evidence |
|---|---|---|
| 255 | Bit-exact: identical (chip, register, value, cycle) write trace | Trace |
| 254 | Same music, re-timed: identical (chip, register, value) sequence and count; every write within `T` cycles of the reference after the constant start offset. Documented as "identical register values, re-timed <= 2 ms; audio-validated 235-253 on the corpus" | Trace |
| 1–253 | `max(1, round(253 · Q))`, with `Q = 1 − mean severity` over the analysed windows (below) | Audio, only when the trace is neither 255 nor 254 |
| 0 | No playback: Q below 1/506, e.g. only initialisation writes, an immediate CPU jam, or silence where the reference plays | Trace or audio |

`T` (timing tolerance) was calibrated on the corpus and is frozen at 2 ms (1,970 PAL /
2,045 NTSC cycles), with `gamma = 1`. It must stay well below the onset-asynchrony thresholds listeners can detect
(several ms), and below real hardware jitter once badlines and IRQ latency accumulate. An
identical value sequence re-timed within `T` is grade 254 without audio rendering. A gate
below verifies that such cases also have near-zero audio severity.

**Per-window severity** `s_w ∈ [0, 1]`:
- Use 46.4 ms windows (2,048 frames at 44.1/48 kHz), stereo channels folded per the listener's
  existing preprocessing (DC removal, Hann window).
- Spectral distance (as implemented, calibration 2026-10-29): per channel and about-third-octave band, the band energy level
  above a -60 dBFS white-noise floor is compared in dB with a 3 dB dead zone saturating at 15 dB; the distance of silence is the
  same ramp applied to the reference level. The first implementation compared bin magnitudes inside each band (the listener-v1
  form), which scored a pure 13-cycle re-timing at median 0.059 because upper-band bin magnitudes are dominated by resampler
  aliasing that changes with the sample phase; band energies are insensitive to that. Windows are 2,048 frames (42.7 ms at 48 kHz;
  46.4 ms is the same frames at 44.1 kHz).
- Only windows where either player is above −60 dBFS are analysed. If neither is, the window is
  skipped and does not count.
- `s_w = min(1, D_w / D_full)`, where `D_full` is the distance between the reference and silence
  for that window. As a result, a missing or totally different window scores 1, and a slightly
  re-phased window scores near 0.
- The exact `D` formula is fixed by the implementation PR and frozen by the calibration gates.

**Monotonicity requirement:** higher G must never mean audibly worse playback within the
calibration corpus. A perceptual curve `Q' = Q^γ` may be fitted once, on the corpus, before the
full run. It is then frozen and recorded in the methodology identity.

## Calibration corpus (small, exhaustive)

The corpus is selected deterministically from the 320-job stratified benchmark, the stopped
census checkpoint and the probes, plus targeted inventory searches. Aim for about 60–100 subtunes,
and at least 3 exemplars per occupied cell. Every cell below must be covered, or explicitly shown
to be empty in HVSC:

**Trace categories:**
- A — bit-exact
- B — re-timed only (identical values), split by drift: ≤63 cycles, ≤1 ms, ≤2 ms, >2 ms
- C — identical values plus a few trailing extra or missing writes
- D — value divergence, near-equal write count (digi/timer RSIDs)
- E — early divergence with substantially different music
- F — late divergence (more than 50% of the horizon plays identically)
- G — no playback: only initialisation writes
- H — CPU jam or illegal instruction partway through
- I — tempo change (large cumulative drift with an identical value prefix)

**Context dimensions:**
- File type: PSID / RSID / BASIC / multiSID (2SID, 3SID)
- Engine: SIDLite / reSIDfp, including cases where the engines disagree
- ROM configuration: none, KERNAL+BASIC (CHARGEN readers)
- Horizon: <30 s, 30–120 s, 120–300 s, >300 s, and the no-Songlengths fallback
- SID model: 6581 / 8580
- Clock: PAL / NTSC
- Content: digi or sample playback ($D418 bursts)

## Gates (all must pass before a full run)

1. Determinism: grading the corpus twice gives byte-identical grades.
2. Timing class soundness: every grade-254 lane has audio grade >= 235, mean `s_w` <= 0.07 and at most 2% of its windows
   above 0.25. (The first formulation, median `s_w` <= 0.02 and no window above 0.25, failed on 20 of 36 corpus lanes: isolated
   onset windows differ by real, small waveform differences caused by ADSR/noise phase, not by timing aliasing, and a temporal
   tolerance of up to 11 ms removed only some of them. The revised criterion is evidence-based: all 36 lanes have mean `s_w` <= 0.070,
   audio grade >= 235 and at most 1.52% of windows above 0.25. See hvsc-rom-grading-calibration-analysis.md.)
3. No-playback soundness: every class G case grades 0–5, and every class E/H case grades below
   the class F cases of similar length.
4. Monotonicity: the user is offered a listening page of reference/variant pairs across grade bands (24 pairs prepared in
   `workspace/rom-grade-calibration/listening/`). No pair may be ranked inverted by more than one band. Non-blocking for the full
   run: the grades are threshold independent, so a listening result can only move the consumer thresholds (and, if a perceptual
   curve is ever fitted, `gamma`), never require regrading the traces.
   **Result (2026-10-30, user, blind):** PASS, no inversions. All 21 pairs graded 171–254 were rated
   "Same", including the lowest-graded audible pair (`Prophet64_Sequencer_Demo_2SID`, 171, class D; listed but
   above the skip threshold). Both audible grade-0 pairs (`Party_Songs`, `MiniSEQ_Demo_Songs`, class G) were
   rated "Broken". The third grade-0 pair (`Swan_BASIC`) was heard as silent on both sides: its reference
   excerpt is a sparse BASIC tune (mean -38 dBFS, peaks -8.9 dBFS, isolated notes), while the no-ROM side is
   digital silence (-91 dBFS), so the grade is right and the excerpt was a poor listening choice. Grades 1–170
   were not represented among the listened pairs.
5. Distribution: the grade histogram over the stratified 320-job benchmark is reported. The share
   of subtunes below the consumer threshold is plausible against earlier research (about 3% of
   subtunes with execution changes) and is explained if it differs.
6. Cost: measured CPU per stratum projects the full-HVSC run on the i5-14600K within the 24 h
   limit, with the 25% margin.

## Consumer format impact

`sidromdep` changes from 4-bit masks to one grade byte per lane. Decided with the calibration: the consumer threshold
`recommended_min_grade` is **128** (a lane graded below it is skipped by the player), and the list ceiling is **191**: only
subtunes with any lane `G <= 191` are listed, so an unlisted subtune means `G >= 192` in every lane. On the 320-job benchmark,
population-weighted, 2.0% of subtunes have a lane below 192 and 1.6% below 128 (about 1,750 and 1,400 of 87,868 subtunes); the
grades are bimodal (0, or 128 and above), so any threshold between 1 and 127 selects the same subtunes. Grades 192-253 are
audible-equivalent playback that is not provably identical (Q >= 0.76) and are not listed.

## Full run

`scripts/rom-grade/run-full.sh` grades all 87,868 subtunes (both engines x none/KERNAL+BASIC) under a methodology identity (SHA-256 over the
grader sources and the modules they import, both renderer binaries, the ROM images and the frozen options); the identity is in the
checkpoint header and every output, and a checkpoint written under another identity is refused. It writes `grading-results.jsonl`
(schema `sidflow-rom-grading-results-1`) and a gzipped full-detail export when complete.
