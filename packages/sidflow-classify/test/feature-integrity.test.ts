/**
 * Tests for the assertion that catches a corpus which is wrong but well-formed.
 *
 * The defect these exist for: `introSkipSec` skips 15 seconds before analysis, HVSC is
 * full of subsongs shorter than that, and on the full 87,868-track corpus 16,398 records
 * (18.66%) ended up with all 22 playroutine dimensions at exactly zero because the window
 * opened after the music had stopped. Nothing threw, every count matched, and 34 of 58
 * similarity dimensions became a shared constant across a fifth of the corpus.
 *
 * The property being pinned is not "features are present" but "the record does not
 * contradict itself" — a trace with thousands of events cannot yield an all-zero
 * playroutine vector, and a record claiming pitch content must carry some.
 */

import { describe, expect, test } from "bun:test";

import {
  FEATURE_INTEGRITY_MIN_SAMPLE,
  createFeatureIntegrityTally,
  featureIntegrityBreach,
  formatFeatureIntegrity,
  inspectFeatureIntegrity,
  isFeatureRecordSound,
  recordFeatureIntegrity,
} from "../src/feature-integrity.js";
import { resolveEffectiveTraceSkipSeconds } from "../src/sid-register-trace.js";
import type { FeatureVector } from "../src/index.js";

const PLAYROUTINE_KEYS = [
  "sidWritesPerFrame", "sidMultiSpeedRatio", "sidWriteShareFrequency", "sidWriteSharePulseWidth",
  "sidWriteShareControl", "sidWriteShareEnvelope", "sidWriteShareFilter", "sidWriteShareVolume",
  "sidWriteSpreadEntropy", "sidWriteRateRegularity", "sidVoiceCount1Ratio", "sidVoiceCount2Ratio",
  "sidVoiceCount3Ratio", "sidVoiceCountVariation", "sidWriteFramePositionMean",
  "sidWriteFramePositionSpread", "sidWriteRedundantRatio", "sidWriteRegisterCoverage",
  "sidWriteOrderEntropy", "sidWriteVoice1Share", "sidWriteVoice2Share", "sidWriteVoice3Share",
];

const TONAL_KEYS = [
  "sidPolyphonyMean", "sidNoteDurationMean", "sidNoteRate", "sidPitchClassEntropy",
  "sidMelodicMeanAbsInterval", "sidMelodicRange", "sidNoteDurationEntropy", "sidTonicWeight",
  "sidMelodicLeapRatio", "sidKeyStrength",
];

function features(overrides: FeatureVector = {}): FeatureVector {
  const base: FeatureVector = { sidTraceEventCount: 5424, sidTonalVariant: "insufficient" };
  for (const key of PLAYROUTINE_KEYS) base[key] = 0.25;
  for (const key of TONAL_KEYS) base[key] = 0;
  return { ...base, ...overrides };
}

function allZeroPlayroutine(overrides: FeatureVector = {}): FeatureVector {
  const record = features(overrides);
  for (const key of PLAYROUTINE_KEYS) record[key] = 0;
  return record;
}

describe("feature integrity", () => {
  test("flags a trace with events that produced no playroutine data", () => {
    // The exact shape of the shipped defect: 5,424 real register writes, every playroutine
    // dimension zero. This is the record the export happily accepted 16,398 times.
    const violations = inspectFeatureIntegrity(allZeroPlayroutine());
    expect(violations.map((v) => v.kind)).toContain("trace_events_but_no_playroutine");
    expect(violations[0]!.detail).toContain("5424");
  });

  test("accepts an all-zero playroutine vector when the trace is genuinely empty", () => {
    // A tune with no traced writes SHOULD have zeros. Flagging it would make the check
    // fire constantly and be ignored, which is worse than not having it.
    expect(isFeatureRecordSound(allZeroPlayroutine({ sidTraceEventCount: 0 }))).toBe(true);
  });

  test("accepts a sparse but real playroutine vector", () => {
    // Measured case: an 86-event trace yields 19 of 22 dimensions non-zero, and the three
    // zeros are true zeros (no filter writes). Real data must not be mistaken for default.
    const sparse = allZeroPlayroutine({ sidTraceEventCount: 86 });
    sparse.sidWritesPerFrame = 0.004;
    expect(isFeatureRecordSound(sparse)).toBe(true);
  });

  test("flags a record claiming pitch content that carries none", () => {
    const violations = inspectFeatureIntegrity(features({ sidTonalVariant: "tonal" }));
    expect(violations.map((v) => v.kind)).toContain("tonal_claimed_but_empty");
  });

  test("flags NaN, which JSON turns into a missing feature rather than a broken one", () => {
    const violations = inspectFeatureIntegrity(features({ spectralCentroid: Number.NaN }));
    expect(violations.map((v) => v.kind)).toContain("non_finite_value");
  });

  test("accepts a sound record", () => {
    expect(inspectFeatureIntegrity(features())).toEqual([]);
  });

  test("does not abort on a small sample, however bad it looks", () => {
    // Early in a run the rate is dominated by whichever tunes happen to sort first.
    const tally = createFeatureIntegrityTally();
    for (let index = 0; index < 20; index += 1) {
      recordFeatureIntegrity(tally, `T${index}.sid#1`, allZeroPlayroutine());
    }
    expect(tally.violating).toBe(20);
    expect(featureIntegrityBreach(tally)).toBeNull();
  });

  test("aborts once a systematic defect is established", () => {
    const tally = createFeatureIntegrityTally();
    for (let index = 0; index < FEATURE_INTEGRITY_MIN_SAMPLE + 100; index += 1) {
      // 5% violating: well above the 1% limit, far below the 18.66% actually shipped.
      recordFeatureIntegrity(tally, `T${index}.sid#1`, index % 20 === 0 ? allZeroPlayroutine() : features());
    }
    const breach = featureIntegrityBreach(tally);
    expect(breach).not.toBeNull();
    expect(breach).toContain("trace_events_but_no_playroutine");
  });

  test("tolerates a corpus with a few genuinely pathological tunes", () => {
    // 87,868 tracks will contain oddities. The limit has to leave room for them, or the
    // check turns into a reason to disable the check.
    const tally = createFeatureIntegrityTally();
    for (let index = 0; index < 10_000; index += 1) {
      recordFeatureIntegrity(tally, `T${index}.sid#1`, index % 500 === 0 ? allZeroPlayroutine() : features());
    }
    expect(featureIntegrityBreach(tally)).toBeNull();
    expect(formatFeatureIntegrity(tally)).toContain("trace_events_but_no_playroutine");
  });
});

describe("adaptive trace skip", () => {
  const traces = (lastSecond: number, cyclesPerSecond = 985_248) => [
    { cyclePhi1: 1000 },
    { cyclePhi1: lastSecond * cyclesPerSecond },
  ];

  test("leaves a full-length tune untouched", () => {
    // The large majority of the corpus. Any change here would alter shipped features.
    expect(resolveEffectiveTraceSkipSeconds(traces(30), { clock: "PAL", skipSeconds: 15, analysisSeconds: 15 }))
      .toBe(15);
  });

  test("slides the window back for a tune shorter than the skip", () => {
    // Measured case: writes stop at 11.3s while the window asked for 15-30s and found
    // nothing. The window must move to where the music is.
    const skip = resolveEffectiveTraceSkipSeconds(
      traces(11.3),
      { clock: "PAL", skipSeconds: 15, analysisSeconds: 15 },
    );
    expect(skip).toBe(0);
  });

  test("handles a one-second jingle", () => {
    // Games_Winter_Edition.sid song 38 writes for 1.14 seconds.
    expect(resolveEffectiveTraceSkipSeconds(traces(1.14), { clock: "PAL", skipSeconds: 15, analysisSeconds: 15 }))
      .toBe(0);
  });

  test("keeps a partial skip when the tune is longer than the window but shorter than skip+window", () => {
    // 20s of activity, 15s window: skip 5 so the window covers 5-20 rather than 15-30.
    const skip = resolveEffectiveTraceSkipSeconds(
      traces(20),
      { clock: "PAL", skipSeconds: 15, analysisSeconds: 15 },
    );
    expect(skip).toBe(15);
  });

  test("returns the requested skip when there is no trace to reason about", () => {
    expect(resolveEffectiveTraceSkipSeconds([], { clock: "PAL", skipSeconds: 15, analysisSeconds: 15 }))
      .toBe(15);
  });

  test("never returns a negative skip", () => {
    expect(resolveEffectiveTraceSkipSeconds(traces(0.1), { clock: "NTSC", skipSeconds: 15, analysisSeconds: 15 }))
      .toBeGreaterThanOrEqual(0);
  });
});
