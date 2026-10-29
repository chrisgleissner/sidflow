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
| 254 | Same music, re-timed: identical (chip, register, value) sequence and count; every write within `T` cycles of the reference after the constant start offset | Trace |
| 1–253 | `max(1, round(253 · Q))`, with `Q = 1 − mean severity` over the analysed windows (below) | Audio, only when the trace is neither 255 nor 254 |
| 0 | No playback: Q below 1/506, e.g. only initialisation writes, an immediate CPU jam, or silence where the reference plays | Trace or audio |

`T` (timing tolerance) is calibrated on the corpus. The starting value is 2 ms (1,970 PAL /
2,045 NTSC cycles). It must stay well below the onset-asynchrony thresholds listeners can detect
(several ms), and below real hardware jitter once badlines and IRQ latency accumulate. An
identical value sequence re-timed within `T` is grade 254 without audio rendering. A gate
below verifies that such cases also have near-zero audio severity.

**Per-window severity** `s_w ∈ [0, 1]`:
- Use 46.4 ms windows (2,048 frames at 44.1/48 kHz), stereo channels folded per the listener's
  existing preprocessing (DC removal, Hann window).
- Spectral distance: magnitude spectra in about third-octave bands, normalised by the reference
  window's energy.
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
2. Timing class soundness: every grade-254 case has median `s_w` ≤ 0.02, and no window above 0.25.
3. No-playback soundness: every class G case grades 0–5, and every class E/H case grades below
   the class F cases of similar length.
4. Monotonicity: the principal engineer, and optionally the user, listens to a published listening
   page of reference/variant pairs across grade bands. No pair is ranked inverted by more than
   one band.
5. Distribution: the grade histogram over the stratified 320-job benchmark is reported. The share
   of subtunes below the consumer threshold is plausible against earlier research (about 3% of
   subtunes with execution changes) and is explained if it differs.
6. Cost: measured CPU per stratum projects the full-HVSC run on the i5-14600K within the 24 h
   limit, with the 25% margin.

## Consumer format impact

`sidromdep` changes from 4-bit masks to one grade byte per lane. Only subtunes with any lane
`G ≤ 253` are listed, so an unlisted subtune means `G ≥ 254` in every lane. C64 Commander applies
a single threshold, which defaults to the calibrated "plays acceptably" band and is skipped below
it. The expected size is about 40 KiB.
