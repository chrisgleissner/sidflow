# Classification Bug Analysis: waveform "none" Leaks and Feature Anomalies

**Date:** 2026-03-26
**Samples examined:** Kaikki_on_Vaikeaa.sid, Layla.sid, Little_Booze.sid (MUSICIANS/A/Argon)

## Anomalies Found

### 1. Wave ratios sum to less than 1.0 (or all zero)

| Song | pulse | saw | triangle | noise | mixed | **sum** |
|------|-------|-----|----------|-------|-------|---------|
| Kaikki_on_Vaikeaa | 0.333 | 0 | 0 | 0 | 0 | **0.333** |
| Layla | 0 | 0 | 0 | 0 | 0 | **0.000** |
| Little_Booze | 0.667 | 0.333 | 0 | 0 | 0 | **1.000** |

**Root cause — confirmed bug in `sid-native-features.ts:436-459`:**

`computeWaveformRatios()` only counts frames whose `waveform` field matches one of `{triangle, saw, pulse, noise, mixed}`. When a voice frame has `waveform: "none"` (SID control register bits 4-7 are all zero), it is silently excluded from all ratio buckets but **still counted in the denominator** (`voiceFrames.length`).

This means:
- The denominator includes "none" frames, but no numerator bucket does
- Ratios sum to `(total - noneFrames) / total`, which is < 1.0 whenever "none" frames exist
- For Layla: **100% of active voice frames have waveform "none"**, so all ratios are 0

The filter at line 184 (`activeVoiceFrames = voiceFrames.filter(frame => frame.gate || frame.frequencyWord > 0)`) lets through frames that have a non-zero frequency word but no waveform bits set — a common SID pattern where the frequency register is loaded before the waveform/gate control register is written.

**Fix options:**

**Option A — Exclude "none" from the denominator:**
```typescript
function computeWaveformRatios(voiceFrames: VoiceFrameSummary[]) {
  // ... count as before ...
  const relevant = voiceFrames.filter(f => f.waveform !== "none");
  const total = Math.max(1, relevant.length);
  // ... divide by total ...
}
```
This makes ratios always sum to 1.0 (when any non-none frames exist), which is the expected semantic: "of all frames with an audible waveform, what fraction used pulse?"

**Option B — Add a "none" bucket to the output:**
Add `sidWaveNoneRatio` to the feature vector so the sum is always 1.0 and downstream classifiers can observe silence-despite-activity.

Option A is simpler and probably correct — "none" frames produce no audio, so they shouldn't dilute waveform distribution.

---

### 2. `sidGateOnsetDensity` is 0 despite 259 trace events (Layla)

**Location:** `sid-native-features.ts:360-380`

`collectGateOnsets()` counts false-to-true gate transitions. For Layla, all 259 events exist in the trace, but the gate bit (bit 0 of control register) may never transition from off to on within the analysis window — it could already be on from the start, or the events may be frequency/pulse writes that don't touch the control register.

This is **not a bug per se** — it's a data-dependent edge case. However, it's suspicious combined with `sidActiveVoiceFrameRatio: 1`. The implication is: voices have non-zero frequency words (hence "active") but gates never open during the window.

**Interaction with bug #1:** If gates never open, the voice frames are included as active (due to `frequencyWord > 0`) but with `waveform: "none"` and `gate: false`. This is the likely scenario for Layla — frequency registers are set up, but the waveform control register is never written (or written without waveform bits), making all active frames produce "none".

---

### 3. `sidFilterMotion` is 0 while `sidFilterCutoffMean` is 0.625 and `sidFilterResonanceMean` is 1.0 (Layla)

**Location:** `sid-native-features.ts:474-512`

`computeFilterStats()` measures motion as the average of absolute frame-to-frame deltas in filter cutoff. If the filter cutoff is set once and never changes, all deltas are 0 and motion is 0.

**Not a bug.** A static filter (high cutoff, high resonance, never modulated) produces `cutoffMean > 0` but `cutoffMotion == 0`. This is correct — the filter is present but not moving.

---

### 4. `sidMelodicClarity` is exactly 0.55 for both Kaikki_on_Vaikeaa and Layla

**Location:** `sid-native-features.ts:654-666`

Formula: `0.45 * roleLeadRatio + 0.25 * (1 - waveNoiseRatio) + 0.15 * (1 - arpeggioActivity) + 0.15 * rhythmicRegularity`

For both songs: `waveNoiseRatio = 0`, `arpeggioActivity = 0`, `rhythmicRegularity = 0`.
This gives: `0.45 * roleLeadRatio + 0.25 + 0.15 + 0 = 0.45 * roleLeadRatio + 0.40`

- Kaikki: roleLeadRatio = 0.333 -> `0.45 * 0.333 + 0.40 = 0.55`
- Layla: roleLeadRatio = 0.333 -> same result

**Not a bug per se**, but a consequence of bug #1. Because waveform ratios are all zero (due to "none" leak), `waveNoiseRatio` is artificially 0, which inflates melodic clarity by 0.25. The melodic clarity for Layla (a song with apparently no audible output in the analysis window) should likely be 0 or near-zero, not 0.55.

**This is a downstream consequence of bug #1.** Fixing waveform ratios won't directly fix this, but eliminating the false "active" frames would cause `activeVoiceFrames` to be empty, which would produce correct zero/default values for all dependent features.

---

### 5. Voice role ratios are meaningless when all waveforms are "none"

For Layla, voice roles are computed as bass=0.333, lead=0.333, accompaniment=0.333 (maximum entropy). This is because all three voices have equal activity (frequency words set) but no audible waveforms. The role classifier assigns roles based on median frequency, but the frequency values are meaningless without actual audio output.

**Root cause:** Same as #1 — the `activeVoiceFrames` filter doesn't account for `waveform: "none"`.

---

## Summary of Confirmed Bugs

| # | Bug | Severity | File | Lines |
|---|-----|----------|------|-------|
| 1 | `computeWaveformRatios` denominator includes "none" frames, causing ratios to sum < 1.0 | **High** | sid-native-features.ts | 436-459 |
| 2 | `activeVoiceFrames` filter admits frames with `frequencyWord > 0` but `waveform: "none"` and `gate: false`, inflating all downstream features | **High** | sid-native-features.ts | 184 |

Bug #2 is the root cause that enables bug #1 and cascades into incorrect values for: waveform ratios, voice role ratios, voice role entropy, melodic clarity, ADSR ratios, and active voice frame ratio.

## Recommended Fix

Tighten the `activeVoiceFrames` filter at line 184 to require at least one of: gate is open, OR a non-"none" waveform is set:

```typescript
// Current (too permissive):
const activeVoiceFrames = voiceFrames.filter((frame) => frame.gate || frame.frequencyWord > 0);

// Proposed (require audible output evidence):
const activeVoiceFrames = voiceFrames.filter(
  (frame) => (frame.gate || frame.frequencyWord > 0) && frame.waveform !== "none",
);
```

Additionally, fix `computeWaveformRatios` to use only non-"none" frames in its denominator (Option A above), as a defense-in-depth measure even after the filter fix.

Both fixes together ensure that:
1. Frames with no waveform bits don't pollute the active frame set
2. Even if "none" frames slip through, waveform ratios still sum to 1.0
3. Downstream features (roles, melodic clarity, entropy) operate on genuinely audible frames only
