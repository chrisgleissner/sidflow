/**
 * The similarity vector the product stores and serves stations from.
 *
 * Three groups of information, kept separate because they came from different places
 * and carry very different amounts of signal:
 *
 *   1. The 24 perceptual dimensions (spectral features plus register-state
 *      summaries) that the product shipped historically.
 *   2. 11 pitch/texture dimensions read from note-level analysis of the register
 *      trace.
 *   3. 15 playroutine dimensions describing how the driver code behaves.
 *
 * Measured on a held-out, composer-grouped test slice of an 11,284-track corpus,
 * against the previous configuration (24 dimensions, raw values, hand-tuned weighted
 * cosine):
 *
 *   shipped 24d, raw + weighted cosine          nDCG@10 0.2340   cold start 0.1108
 *   + 11 tonal, rank-normalised                        0.2686  +14.8%      0.1912
 *   playroutine dimensions ALONE (15d)                 0.4517  +93.0%      0.1592
 *   all 50 dimensions                                  0.4112  +75.7%      0.2019
 *   all 50 with learned weights                        0.5109 +118.4%      0.2324
 *
 * More than double the retrieval quality, and more than double the cold-start
 * quality, at p=0.0002 with a 95% CI of [0.2623, 0.2917] on the difference.
 *
 * ## Why the playroutine dimensions are worth so much
 *
 * A single one of them separates composers better than the entire 24-dimension
 * vector did: `sidWriteSpreadEntropy` scores 0.7713 on same-composer-versus-random
 * pair separability against 0.7229 for all 24 together, and the top eight all exceed
 * 0.71 where the best pre-existing feature reached 0.689.
 *
 * The reason is mechanical rather than musical. Composers do not write a new player
 * for every tune; they reuse a playroutine, and a playroutine leaves a signature in
 * how it drives the chip — writes per frame, which registers it favours, how
 * regularly it runs. Identifying a composer partly reduces to identifying their
 * tooling, which is a far sharper signal than anything about the sound itself.
 *
 * It also fits the pattern the rest of this work established: adding more SPECTRAL
 * dimensions bought almost nothing (the learning curve moved 0.1791 to 0.1803
 * between 20 and 24 dimensions), while each genuinely NEW KIND of information —
 * pitch, then driver behaviour — bought a great deal.
 */

import { buildPerceptualVector, type DeterministicRatingModel } from "./deterministic-ratings.js";
import type { FeatureVector } from "./index.js";

/**
 * Pitch and texture dimensions, ordered by measured univariate separability.
 *
 * Eleven of 31 candidates, selected on the TRAIN split only. Concatenating all 31
 * made retrieval WORSE than using none, because twenty near-chance dimensions dilute
 * the informative ones.
 *
 * What lost is the interesting part: major-versus-minor mode carries essentially no
 * information about authorship (0.507 against a 0.500 floor), nor do the chord
 * colours. What identifies a composer is texture — polyphony 0.643, note duration
 * 0.634, note rate 0.623. Arrangement habits, not harmonic palette. (Mode is still
 * used for the MOOD rating, where it does matter; feature value is task-specific.)
 */
export const SIMILARITY_TONAL_DIMENSIONS = [
  "sidPolyphonyMean",
  "sidNoteDurationMean",
  "sidNoteRate",
  "sidTonalPresent",
  "sidPitchClassEntropy",
  "sidMelodicMeanAbsInterval",
  "sidMelodicRange",
  "sidNoteDurationEntropy",
  "sidTonicWeight",
  "sidMelodicLeapRatio",
  "sidKeyStrength",
] as const;

/**
 * Playroutine dimensions, ordered by measured univariate separability.
 *
 * All 15 candidates cleared the selection threshold — the only feature group where
 * that happened — and the weakest of them (0.572) still beats the median dimension
 * of every other group.
 */
export const SIMILARITY_PLAYROUTINE_DIMENSIONS = [
  "sidWriteSpreadEntropy",
  "sidWritesPerFrame",
  "sidWriteShareControl",
  "sidWriteRateRegularity",
  "sidWriteShareFilter",
  "sidWriteSharePulseWidth",
  "sidWriteShareEnvelope",
  "sidWriteShareVolume",
  "sidWriteShareFrequency",
  "sidSilentFrameRatio",
  "sidVoiceCount3Ratio",
  "sidVoiceCountVariation",
  "sidVoiceCount1Ratio",
  "sidVoiceCount2Ratio",
  "sidMultiSpeedRatio",
] as const;

/**
 * Finer descriptors of the driver's shape, added after the first playroutine group
 * proved how much signal lives here.
 *
 * Worth a further +5.5% on held-out retrieval over the 50-dimension vector
 * (0.5109 to 0.5392 with learned weights, p=0.0002) and +5.6% on cold start. Where
 * the group above describes how MUCH the routine writes and to which register
 * families, these describe its shape: when in the frame it runs and how tightly it
 * holds that position, whether it rewrites unchanged values, how much of the register
 * file it touches, the order it walks registers in, and how it divides attention
 * between the three voices.
 *
 * All of these are properties of the code rather than of the music, which is exactly
 * why they identify an author.
 */
export const SIMILARITY_DRIVER_SHAPE_DIMENSIONS = [
  "sidWriteFramePositionMean",
  "sidWriteFramePositionSpread",
  "sidWriteRedundantRatio",
  "sidWriteRegisterCoverage",
  "sidWriteOrderEntropy",
  "sidWriteVoice1Share",
  "sidWriteVoice2Share",
  "sidWriteVoice3Share",
] as const;

/** Every dimension appended to the perceptual vector, in stored order. */
export const SIMILARITY_APPENDED_DIMENSIONS = [
  ...SIMILARITY_TONAL_DIMENSIONS,
  ...SIMILARITY_PLAYROUTINE_DIMENSIONS,
  ...SIMILARITY_DRIVER_SHAPE_DIMENSIONS,
] as const;

export const SIMILARITY_VECTOR_DIMENSIONS = 24 + SIMILARITY_APPENDED_DIMENSIONS.length;

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/**
 * `sidTonalPresent` is derived rather than stored: 1 when the track has analysable
 * pitch content, 0 otherwise.
 *
 * 28% of HVSC has no pitched oscillator activity in the analysis window — digi tunes
 * driving the volume register, BASIC listings, and tunes whose window is silent. For
 * those every other tonal dimension is zero, and without this flag the distance
 * function cannot tell "no notes" from "notes, but few of them". Those are entirely
 * different tracks, and letting a quarter of the corpus collapse onto one point is
 * exactly the spurious cluster that ruins a station.
 */
function appendedDimensionValue(features: FeatureVector, name: string): number {
  if (name === "sidTonalPresent") {
    return features.sidTonalVariant === "tonal" ? 1 : 0;
  }
  const value = features[name];
  return typeof value === "number" ? clamp01(value) : 0;
}

export function buildSimilarityVector(
  model: DeterministicRatingModel,
  features: FeatureVector,
): number[] {
  const perceptual = buildPerceptualVector(model, features);
  const appended = SIMILARITY_APPENDED_DIMENSIONS.map((name) => appendedDimensionValue(features, name));
  return [...perceptual, ...appended];
}
