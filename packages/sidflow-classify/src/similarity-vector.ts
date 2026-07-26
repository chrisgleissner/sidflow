/**
 * The similarity vector the product stores and serves stations from.
 *
 * This is the 24-dimension perceptual vector plus the tonal dimensions that were
 * measured to carry composer signal. It is kept separate from
 * `buildPerceptualVector` so that the 24-dimension vector remains available
 * unchanged as the baseline the optimisation measures against — a baseline that
 * silently moved with the thing being tested would make every comparison
 * meaningless.
 *
 * ## Why these eleven tonal dimensions and not the other twenty
 *
 * All 31 bounded tonal features were extracted and each was scored by how well it
 * alone separates same-composer pairs from random pairs, measured on the TRAIN
 * split only. Eleven cleared 0.57; twenty did not.
 *
 * That selection is not cosmetic. Concatenating all 31 under an unweighted metric
 * made retrieval WORSE than using no tonal features at all (nDCG@10 0.279 vs
 * 0.285), because twenty near-chance dimensions dilute the informative ones.
 * Using only the eleven turned the same information into a gain (0.307), and the
 * best configuration built on them reached +28% over the shipped baseline on
 * validation.
 *
 * The musically interesting part is which ones lost. Major-versus-minor mode
 * carries essentially no information about authorship (AUC 0.507, chance is
 * 0.500), and neither do the specific chord colours — major third 0.515, minor
 * third 0.521, tritone 0.514. What identifies a composer is TEXTURE: how many
 * voices sound at once (0.643), how long notes are held (0.634), how quickly they
 * arrive (0.623), and whether the tune has pitched content at all (0.607).
 * Composers are recognisable by their arrangement habits far more than by their
 * harmonic palette.
 */

import { buildPerceptualVector, type DeterministicRatingModel } from "./deterministic-ratings.js";
import type { FeatureVector } from "./index.js";

/**
 * Tonal dimensions appended to the perceptual vector, in order.
 *
 * Ordered by measured univariate separability, strongest first. The order is part
 * of the stored format: `PERCEPTUAL_VECTOR_WEIGHTS` indexes by position, and any
 * consumer that names a dimension does so by index.
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

export const SIMILARITY_VECTOR_DIMENSIONS = 24 + SIMILARITY_TONAL_DIMENSIONS.length;

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/**
 * `sidTonalPresent` is derived rather than stored: it is 1 when the track has
 * analysable pitch content and 0 otherwise.
 *
 * It exists because 28% of HVSC has no pitched oscillator activity in the analysis
 * window — digi tunes driving the volume register, BASIC listings, and tunes whose
 * window is silent. For those every other tonal dimension is zero, and without
 * this flag the distance function cannot tell "no notes" from "notes, but few of
 * them". Those are entirely different tracks, and letting a quarter of the corpus
 * collapse onto one point is exactly the spurious cluster that ruins a station.
 */
function tonalDimensionValue(features: FeatureVector, name: string): number {
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
  const tonal = SIMILARITY_TONAL_DIMENSIONS.map((name) => tonalDimensionValue(features, name));
  return [...perceptual, ...tonal];
}
