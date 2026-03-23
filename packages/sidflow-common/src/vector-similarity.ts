export const PERCEPTUAL_VECTOR_DIMENSIONS = 24;

export const PERCEPTUAL_VECTOR_WEIGHTS = [
  1.1, 1.1, 1.2, 1.0, 1.0, 0.9, 0.9, 0.9,
  1.0, 0.9, 0.8, 1.1, 1.2, 1.2, 1.1, 0.8,
  0.8, 0.9, 0.9, 1.0, 0.9, 0.9, 0.7, 0.7,
] as const;

export function cosineSimilarity(left: number[], right: number[]): number {
  const useWeights = left.length === PERCEPTUAL_VECTOR_DIMENSIONS && right.length === PERCEPTUAL_VECTOR_DIMENSIONS;
  const dimensions = Math.min(left.length, right.length, useWeights ? PERCEPTUAL_VECTOR_WEIGHTS.length : Number.POSITIVE_INFINITY);
  if (dimensions <= 0) {
    return 0;
  }

  let dotProduct = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < dimensions; index += 1) {
    const weight = useWeights ? PERCEPTUAL_VECTOR_WEIGHTS[index]! : 1;
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