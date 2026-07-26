/**
 * The width the perceptual vector happened to have when these weights were
 * chosen. Kept for callers that want to know the historical default; it is
 * deliberately NOT used to decide whether weighting applies.
 */
export const PERCEPTUAL_VECTOR_DIMENSIONS = 24;

/**
 * Beyond this width a vector is a perceptual vector; at or below it, a legacy
 * ratings vector.
 *
 * The distinction matters because a 4-element vector is [e, m, c, p] — discrete
 * 1-5 ratings — and the perceptual weights below describe timbral and rhythmic
 * dimensions. Applying them to ratings would be meaningless. This threshold
 * matches resolveClassificationVector in similarity-export.ts, which uses the
 * same rule to decide which kind of vector it is building.
 */
export const LEGACY_RATINGS_VECTOR_MAX_DIMENSIONS = 4;

/**
 * Per-dimension weights for the perceptual vector.
 *
 * Shorter than the vector may now be: dimensions past the end of this list are
 * weighted 1. That is what allows the classifier to gain dimensions — a new
 * musical property, say key or melodic shape — without this file having to change
 * in lockstep, and without the previous behaviour shifting for the dimensions
 * that were already here.
 */
export const PERCEPTUAL_VECTOR_WEIGHTS = [
  1.1, 1.1, 1.2, 1.0, 1.0, 0.9, 0.9, 0.9,
  1.0, 0.9, 0.8, 1.1, 1.2, 1.2, 1.1, 0.8,
  0.8, 0.9, 0.9, 1.0, 0.9, 0.9, 0.7, 0.7,
] as const;

/**
 * Which weights apply to a vector of a given width.
 *
 * Weighting is a property of a specific VECTOR DEFINITION, not something to be
 * guessed from a length. The 24-dimension weights above were hand-tuned against
 * raw, differently-scaled feature values. The 35-dimension similarity vector is
 * rank-Gaussian normalised before it is stored, so every dimension already has
 * the same distribution and those weights no longer describe anything — measured
 * on an 11,284-track corpus, rank-Gaussian with UNIFORM weights beat raw with the
 * tuned weights by +15.5% on held-out data (nDCG@10 0.2340 -> 0.2701, p=0.0002).
 *
 * An unknown width also gets uniform weights: applying weights derived for one
 * vector definition to a different one is worse than applying none.
 */
const WEIGHTS_BY_DIMENSIONS = new Map<number, readonly number[]>([
  [PERCEPTUAL_VECTOR_DIMENSIONS, PERCEPTUAL_VECTOR_WEIGHTS],
]);

export function weightsForDimensions(dimensions: number): readonly number[] | null {
  if (dimensions <= LEGACY_RATINGS_VECTOR_MAX_DIMENSIONS) {
    return null;
  }
  return WEIGHTS_BY_DIMENSIONS.get(dimensions) ?? null;
}

/**
 * Weighted cosine similarity over the shared prefix of two vectors.
 *
 * Weighting used to be gated on the vector being EXACTLY 24 long. That was the
 * right answer reached for the wrong reason: it happened to disable weights for a
 * wider vector, but silently, so a future width would inherit whatever behaviour
 * fell out rather than a decided one. Widths and their weightings are now declared
 * in one table, so adding a vector definition means stating its weighting.
 */
export function cosineSimilarity(left: number[], right: number[]): number {
  const dimensions = Math.min(left.length, right.length);
  if (dimensions <= 0) {
    return 0;
  }
  const weights = weightsForDimensions(dimensions);

  let dotProduct = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < dimensions; index += 1) {
    const weight = weights?.[index] ?? 1;
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dotProduct += weight * leftValue * rightValue;
    leftNorm += weight * leftValue * leftValue;
    rightNorm += weight * rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
