/**
 * Does a classified record actually contain what it claims to?
 *
 * This exists because of a defect that produced a corpus nobody could tell was wrong.
 * `introSkipSec` skips the first 15 seconds of a tune before analysis, which is right for
 * a full-length tune and lands past the end of a jingle. HVSC is full of short subsongs,
 * so on the full 87,868-track corpus **16,398 records (18.66%)** came out with all 22
 * playroutine and driver dimensions at exactly zero -- the "no trace available" default --
 * even though the register trace held thousands of events. One example wrote for 1.14
 * seconds while the window asked for 15-30 seconds.
 *
 * Nothing failed. Every record was well-formed, every count matched, the export built, and
 * 34 of 58 similarity dimensions were a shared constant across a fifth of the corpus. It
 * was found only by auditing feature distributions by hand.
 *
 * These checks are the mechanical version of that audit, run as records are produced. They
 * look for the one thing a schema cannot express: a record that is internally
 * contradictory, claiming evidence it does not contain.
 */

import type { FeatureVector } from "./index.js";

export interface FeatureIntegrityViolation {
  kind: "trace_events_but_no_playroutine" | "tonal_claimed_but_empty" | "non_finite_value";
  detail: string;
}

/**
 * Dimensions that cannot all be zero at once when a trace exists.
 *
 * `sidSilentFrameRatio` is excluded deliberately: the empty default sets it to 1, so
 * including it would make every empty record look as though it held one real value. That
 * is exactly the mistake that hid this defect during an earlier attempt to measure it.
 */
const PLAYROUTINE_EVIDENCE_KEYS = [
  "sidWritesPerFrame",
  "sidMultiSpeedRatio",
  "sidWriteShareFrequency",
  "sidWriteSharePulseWidth",
  "sidWriteShareControl",
  "sidWriteShareEnvelope",
  "sidWriteShareFilter",
  "sidWriteShareVolume",
  "sidWriteSpreadEntropy",
  "sidWriteRateRegularity",
  "sidVoiceCount1Ratio",
  "sidVoiceCount2Ratio",
  "sidVoiceCount3Ratio",
  "sidVoiceCountVariation",
  "sidWriteFramePositionMean",
  "sidWriteFramePositionSpread",
  "sidWriteRedundantRatio",
  "sidWriteRegisterCoverage",
  "sidWriteOrderEntropy",
  "sidWriteVoice1Share",
  "sidWriteVoice2Share",
  "sidWriteVoice3Share",
] as const;

const TONAL_EVIDENCE_KEYS = [
  "sidPolyphonyMean",
  "sidNoteDurationMean",
  "sidNoteRate",
  "sidPitchClassEntropy",
  "sidMelodicMeanAbsInterval",
  "sidMelodicRange",
  "sidNoteDurationEntropy",
  "sidTonicWeight",
  "sidMelodicLeapRatio",
  "sidKeyStrength",
] as const;

function allZero(features: FeatureVector, keys: readonly string[]): boolean {
  return keys.every((key) => {
    const value = features[key];
    return typeof value === "number" && value === 0;
  });
}

/** Every violation, not the first, so a run reports what is wrong rather than one symptom. */
export function inspectFeatureIntegrity(features: FeatureVector): FeatureIntegrityViolation[] {
  const violations: FeatureIntegrityViolation[] = [];

  const traceEvents = features.sidTraceEventCount;
  const hasTraceEvents = typeof traceEvents === "number" && traceEvents > 0;

  // The defect this module was written for. A trace with events must produce at least one
  // non-zero playroutine dimension; if it does not, the analysis window missed the music.
  if (hasTraceEvents && allZero(features, PLAYROUTINE_EVIDENCE_KEYS)) {
    violations.push({
      kind: "trace_events_but_no_playroutine",
      detail: `${traceEvents} trace events but all ${PLAYROUTINE_EVIDENCE_KEYS.length} playroutine dimensions are zero`,
    });
  }

  // A record claiming analysable pitch content must carry some.
  if (features.sidTonalVariant === "tonal" && allZero(features, TONAL_EVIDENCE_KEYS)) {
    violations.push({
      kind: "tonal_claimed_but_empty",
      detail: 'sidTonalVariant is "tonal" but every tonal dimension is zero',
    });
  }

  // NaN and Infinity survive JSON as null, which reads downstream as a MISSING feature
  // rather than as a broken one.
  for (const [key, value] of Object.entries(features)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      violations.push({ kind: "non_finite_value", detail: `${key} is ${String(value)}` });
    }
  }

  return violations;
}

/** True when a record is fit to keep. Used by the resume index so a rerun repairs it. */
export function isFeatureRecordSound(features: FeatureVector): boolean {
  return inspectFeatureIntegrity(features).length === 0;
}

export interface FeatureIntegrityTally {
  checked: number;
  violating: number;
  byKind: Record<string, number>;
  examples: Record<string, string[]>;
}

export function createFeatureIntegrityTally(): FeatureIntegrityTally {
  return { checked: 0, violating: 0, byKind: {}, examples: {} };
}

export function recordFeatureIntegrity(
  tally: FeatureIntegrityTally,
  label: string,
  features: FeatureVector,
): FeatureIntegrityViolation[] {
  tally.checked += 1;
  const violations = inspectFeatureIntegrity(features);
  if (violations.length === 0) {
    return violations;
  }
  tally.violating += 1;
  for (const violation of violations) {
    tally.byKind[violation.kind] = (tally.byKind[violation.kind] ?? 0) + 1;
    const examples = tally.examples[violation.kind] ?? [];
    if (examples.length < 5) {
      examples.push(`${label}: ${violation.detail}`);
      tally.examples[violation.kind] = examples;
    }
  }
  return violations;
}

/**
 * Above this share of violating records a run is producing a systematically wrong corpus
 * rather than hitting awkward individual tunes, and should stop.
 *
 * Set at 1%: the defect that motivated this was 18.66%, and a handful of genuinely
 * pathological tunes in 87,868 is well under 1%. A run that trips this has a bug, not bad
 * luck, and continuing would spend hours producing data that has to be thrown away.
 */
export const FEATURE_INTEGRITY_FAILURE_RATE = 0.01;
/** Below this many checked records the rate is too noisy to act on. */
export const FEATURE_INTEGRITY_MIN_SAMPLE = 500;

export function featureIntegrityBreach(tally: FeatureIntegrityTally): string | null {
  if (tally.checked < FEATURE_INTEGRITY_MIN_SAMPLE) {
    return null;
  }
  const rate = tally.violating / tally.checked;
  if (rate <= FEATURE_INTEGRITY_FAILURE_RATE) {
    return null;
  }
  const breakdown = Object.entries(tally.byKind)
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
  return `${tally.violating} of ${tally.checked} records (${(rate * 100).toFixed(2)}%) are internally`
    + ` inconsistent, above the ${(FEATURE_INTEGRITY_FAILURE_RATE * 100).toFixed(0)}% limit [${breakdown}]`;
}

export function formatFeatureIntegrity(tally: FeatureIntegrityTally): string {
  if (tally.checked === 0) {
    return "integrity=unchecked";
  }
  if (tally.violating === 0) {
    return `integrity=ok(${tally.checked})`;
  }
  const breakdown = Object.entries(tally.byKind)
    .map(([kind, count]) => `${kind}=${count}`)
    .join(",");
  return `integrity=${tally.violating}/${tally.checked}`
    + `(${((tally.violating / tally.checked) * 100).toFixed(2)}%)[${breakdown}]`;
}
