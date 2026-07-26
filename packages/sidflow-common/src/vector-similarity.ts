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
 * Weighted cosine similarity over the shared prefix of two vectors.
 *
 * Weighting used to be gated on the vector being EXACTLY 24 long, which made the
 * function silently change behaviour the moment the classifier gained a
 * dimension: at 25 dimensions every weight dropped to 1 and the similarity became
 * plain cosine, with nothing failing to indicate it. Since the weights are what
 * the shipped ranking is tuned around, that would have been an invisible
 * regression in station quality on the very change meant to improve it.
 *
 * Now any vector wider than a legacy ratings vector is weighted, with weight 1
 * for dimensions the table does not cover.
 */
export function cosineSimilarity(left: number[], right: number[]): number {
  const dimensions = Math.min(left.length, right.length);
  if (dimensions <= 0) {
    return 0;
  }
  const useWeights = dimensions > LEGACY_RATINGS_VECTOR_MAX_DIMENSIONS;

  let dotProduct = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < dimensions; index += 1) {
    const weight = useWeights ? PERCEPTUAL_VECTOR_WEIGHTS[index] ?? 1 : 1;
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
