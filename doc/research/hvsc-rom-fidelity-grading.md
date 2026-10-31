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
| 254 | Same music, re-timed: identical (chip, register, value) sequence and count; every write within `T` cycles of the reference after the constant start offset; for a digi-playback reference (frequent $D418 writes) every write within 63 cycles (one PAL raster line). Documented as "identical register values, re-timed <= 2 ms; audio-validated 235-253 on the corpus" | Trace |
| 1–253 | `max(1, round(253 · Q))`, with `Q = 1 − mean severity` over the analysed windows (below); drift-aligned for class B and I lanes (below) | Audio, only when the trace is neither 255 nor 254 |
| 0 | No playback: Q below 1/506, e.g. only initialisation writes, an immediate CPU jam, or silence where the reference plays | Trace or audio |

`T` (timing tolerance) was calibrated on the corpus and is frozen at 2 ms (1,970 PAL /
2,045 NTSC cycles), with `gamma = 1`. It must stay well below the onset-asynchrony thresholds listeners can detect
(several ms), and below real hardware jitter once badlines and IRQ latency accumulate. An
identical value sequence re-timed within `T` is grade 254 without audio rendering. A gate
below verifies that such cases also have near-zero audio severity.

**Digi references (revision 2026-10-30).** Gate 2 audio-checked 36 lanes, none of them sample playback, while the full
run gave the trace-only 254 to 357 lanes whose reference plays samples through $D418 with 64–1,970 cycles of jitter.
Sample-timing jitter at 4–8 kHz sample rates can be audible, so for a `referenceDigi` reference the trace proves 254
only up to 63 cycles (the B "<=63cyc" bound); above it, audio decides, drift-aligned.

**Drift-aligned audio (revision 2026-10-30).** A lane whose trace proves the same notes in the same order but does not
decide the grade — class B above the tolerance (or a digi B above 63 cycles), or class I (identical value prefix over the
whole shorter trace, cumulative drift above 10 ms) — is compared after aligning each audio window by the drift the trace
measured. Lock-step comparison read an accumulated offset as different music: `DEMOS/A-F/Funky_Drummer.sid` writes all
380,932 values identically, about 0.07% faster, and graded 127 (SIDLite) and 149 (reSIDfp). For reference window `w`
(reference frames `[w·N, (w+1)·N)`, `N` = 2,048), the variant is read from frame `w·N + o_w`, with
`o_w = round(d_w · 48000 / clockHz)` and `d_w = variantCycle[k] − referenceCycle[k]` for the last matched write `k`
whose reference cycle is at or before the window's start cycle (the first write's offset before it; 0 without writes).
Frames outside what the variant produced read as zero, as in lock-step (a halted variant is silent; an early end
without a CPU halt is an infrastructure fault). The variant is buffered only from the smallest start any later window
still reads, so memory is bounded by the spread of the offsets plus one window, not by the horizon. Because the
variant is rendered over the same horizon, a variant that runs late reads zeros for its last `max(o_w)` frames: a bias
of at most `max(o_w) / horizon` against slower variants. The severity record states `alignment: "trace-drift"` and the
offset range. **The tempo or drift deviation itself is not graded**: identical notes in identical order are the same
music. It is reported in the research export (`finalDriftCycles`, `maxDriftCycles`, `offsetRangeSeconds`); for example
`DEMOS/A-F/Ballet.sid` (0.8 s over 82 s) and `Trivia_Monster` #11 (up to 1 s over 17 s) now grade high. Every other
audio lane keeps the lock-step comparison.

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
- A (channel, band) pair counts only when its louder side is at least 15 dB above the band floor (`BAND_ACTIVE_DB`,
  revision 2026-10-30); a window with no such band is skipped like a quiet window. Near the floor, the band energy of
  noise-like content (a noise or oscillator phase changed by a few cycles of re-timing) fluctuates by several dB between
  two renders of the same music, and its ratio to the small `D_full` of such a band saturated `s_w`: independent white
  noise scored about 0.07 at −20 dBFS, 0.2 at −50 dBFS and 1 at −55 dBFS, so a few quiet windows could decide a grade
  (`GAMES/S-Z/Temple_of_Apshai.sid` #8, reSIDfp: 161 from 31 of 234 windows; now 215, SIDLite 252). At 15 dB a band
  whose reference is the louder side has `e_full = 1`, so a fluctuation of a few dB stays a small fraction. Of the three
  candidates evaluated on the qualification set (below) — a 10 dB margin, this 15 dB margin, and `Q` weighted by window
  loudness, alone and combined with the margin — the 15 dB margin is the simplest that meets the acceptance criteria and
  has the highest null-set floor.
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
- C — identical values plus a few trailing extra or missing writes (the variant made more than the 32 initialisation writes;
  a variant with only init writes is G, or D/E/F when the reference has fewer than 8 writes more)
- D — value divergence, near-equal write count (digi/timer RSIDs)
- E — early divergence with substantially different music
- F — late divergence (more than 50% of the horizon plays identically)
- G — no playback: only initialisation writes
- H — CPU jam or illegal instruction in the variant (not the reference). The trace carries no halt time, so the rule
  tests the first value divergence instead: H when it falls within the first half of the horizon (or there is none);
  a variant whose values match beyond half of the horizon is F
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

## Pre-run qualification of the 2026-10-30 revision

Methodology identity `f256dd987eb81af427731400b505c4470e6c423aa0f583198f5f99171a3b4d83`. No full run: targeted subsets of
the HVSC #85 run (`bf3b3eff…`) were re-graded, with audio forced on every lane (`validateAudio`) so that trace-decided lanes
also get an audio grade. Evidence is in `workspace/rom-grade-revalidate/` of the main checkout (`qual/` 2,961 subtunes, 57 min on
18 workers; `official/` 656 subtunes through `run-full.sh` with `ROM_GRADE_KEYS`, 23 min). The 1,824 lanes in both agree exactly.

- **Null set N** (trace-proven same music, 2,775 lanes): a stratified sample of 762 trace-254 lanes (B ≤ 2 ms, both engines;
  game SFX, multi-speed and digi strata), the 357 digi B lanes above 63 cycles, the 386 pure re-timing lanes (I or B > 2 ms
  with `valueSequenceIdentical`, drift-aligned), and the 1,270 C lanes whose differing writes all come after the last
  analysed window. Audio grade: **0 below 128, 99.86% above 191** (minimum 166). The four at or below 191: `Trivia_Monster`
  #11 (166/167, irregular re-timing between +0.05 and −0.87 s, a rhythm change), `Rimrunner` #16 reSIDfp (172: four analysed
  windows, a reSIDfp noise burst 10–15 dB lower after a 57-cycle shift; SIDLite 251), `Skate_or_Die` #23 SIDLite (175, 11
  windows). The 111 class I lanes whose value prefix covers the shorter trace without equal write counts (outside N, also
  drift-aligned) went from 2 / 20 / 89 lanes in <128 / 128–191 / >191 to 2 / 1 / 108 (`Ballet` 134/135 → 240/241).
- **Positive set P** (2,998 lanes: every lane below 128 and every G/E/H lane): the only lane crossing 128 upward is
  `Funky_Drummer` SIDLite (127 → 249, drift-aligned I). Both listening pairs rated broken (`Party_Songs`,
  `MiniSEQ_Demo_Songs`) stay 0, also by audio. G lanes: audio grade 0–6, except `God_Save_the_King_BASIC` SIDLite (253 with
  0 analysed windows: SIDLite renders its reference below −60 dBFS too; the trace grade is 0). The 64 E/H lanes graded 128 or
  more were so graded before (trace class E/H is a label, audio decides; e.g. `Matt/Allo_Allo` 244).
- **Re-timing** (497 I/B > 2 ms lanes): before 3 / 67 / 393 / 34 lanes in <128 / 128–191 / 192–249 / 250–253, after
  2 / 4 / 375 / 116. The two below 128 are `UFO_Strike` #1 (81/85): its variant runs at about 73% of the tempo (the offset
  grows by 0.38 s per second), so its windows still differ after alignment. Alignment removes an accumulated offset; it
  does not hide a large tempo change.
- **Control** (200 other audio-graded subtunes, 800 lanes, production mode): all 403 trace-graded lanes identical; of 397
  audio lanes 317 identical and 80 moved by the 15 dB band margin (−2 to +23, 66 of them by ±1); one crosses the list
  ceiling (`Stainless_Steel/No_Good` reSIDfp 170 → 193). Without the margin (the old metric recomputed on the same windows),
  all 1,476 previously audio-graded lock-step lanes of the qualification set reproduce their earlier grade.
- **Calibration gates** re-run under this identity: see the PLANS.md entry of 2026-10-30.
- **Extrapolated list** (re-graded subsets substituted into the `bf3b3eff…` run; an extrapolation, not a run): 672 files /
  1,516 subtunes listed at ceiling 191 (published: 696 / 1,556), 1,468 subtunes with a lane below 128 (1,469). 2,025
  audio-graded subtunes were not re-graded; 11 of them are listed with a lane graded 170–191, which the band margin could
  move out of the list.
- **Open for judgement**: `SIDwave/Mazza_Blauze` #1 and `FieserWolF/All_the_Way_to_Reusel` #1 grade 3/0 on SIDLite and
  178/174 on reSIDfp with identical write traces on both engines: the variant drops out in 10–22% of the music, and reSIDfp
  renders the remaining quiet passages above −60 dBFS (SIDLite below), so they count as identical windows and dilute `Q`.
  Loudness-weighted `Q` would grade Mazza_Blauze reSIDfp 63 but All_the_Way_to_Reusel still 158, and lowers the null-set
  minimum to 152; it was not adopted.

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
checkpoint header and every output, and a checkpoint written under another identity is refused. The checkpoint header also binds
the HVSC corpus identity and the SHA-256 of `Songlengths.md5` (which sets every horizon): resume refuses other digests, and
`finalize.ts` refuses a `scope.json` or checkpoint header with another digest, a record outside the scope, a duplicate, a record
whose horizon differs from its scope job's, an unmeasured lane, and an incomplete checkpoint. It writes `grading-results.jsonl`
(schema `sidflow-rom-grading-results-1`) and a gzipped full-detail export when complete.

**KERNAL+BASIC shortcut.** A KERNAL+BASIC lane is 255 without rendering when the reference never read CHARGEN, and only when the
reference ran to its end: no error, or a diagnosed CPU halt (the audit's `digital-screen.ts` rule). A truncated trace buffer does
not matter, because the CHARGEN counter keeps counting; a reference engine or resource error voids the counter, and the lane is
traced and graded like any other.

### HVSC #85 result under the revised methodology (2026-10-31)

Run commit `ae90b9c`, methodology identity `f256dd987eb81af427731400b505c4470e6c423aa0f583198f5f99171a3b4d83` (the qualified
one): 87,868 of 87,868 subtunes, 0 errors, 30,581 s wall time on 18 workers (591,595 CPU-seconds). After the run, all 61,157
graded SID files were re-hashed: every SHA-256 equals the one the run recorded. The list derived from it at ceiling 191 has
672 files and 1,516 subtunes (19,228 bytes); 1,468 subtunes in 627 files have a lane below 128, exactly as extrapolated above.
Against the superseded run `bf3b3eff…`, one subtune left the below-128 set (`Funky_Drummer` #1), 39 left the 128–191 band for
above 191, and none moved down. Per-lane distributions, strata and the list are in
[hvsc-rom-grading-results.md](hvsc-rom-grading-results.md).

The two input guards added after the run (the SHA-256 of the bytes actually rendered must equal the scheduled one; a resumed
record must have the job's horizon) cannot change a grade of an unchanged corpus. For this run both are shown to hold
directly: the re-hash above, and `finalize.ts`, which already refused any record whose horizon differs from its scope job.
They change the methodology identity of later runs only.
