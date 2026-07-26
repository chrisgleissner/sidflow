/**
 * Tests for weighted cosine similarity, focused on its behaviour as the
 * perceptual vector gains dimensions.
 *
 * The regression being guarded is silent: weighting used to require the vector to
 * be exactly 24 long, so the first added dimension would have turned the shipped
 * ranking into plain unweighted cosine with nothing failing. Station quality would
 * have moved for a reason invisible in the diff.
 */

import { describe, expect, test } from "bun:test";

import {
  LEGACY_RATINGS_VECTOR_MAX_DIMENSIONS,
  PERCEPTUAL_VECTOR_WEIGHTS,
  cosineSimilarity,
  weightsForDimensions,
} from "../src/index.js";

/** Weighted cosine written straight from the definition, for cross-checking. */
function reference(left: number[], right: number[], weights: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const w = weights[i] ?? 1;
    dot += w * left[i]! * right[i]!;
    leftNorm += w * left[i]! * left[i]!;
    rightNorm += w * right[i]! * right[i]!;
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function makeVector(length: number, seed: number): number[] {
  let state = (seed * 2654435761) >>> 0;
  return Array.from({ length }, () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 0x100000000;
  });
}

describe("cosineSimilarity", () => {
  test("identical vectors are perfectly similar and orthogonal ones are not", () => {
    const v = makeVector(24, 1);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 12);

    const a = [1, 0, 0, 0, 0, 0];
    const b = [0, 1, 0, 0, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 12);
  });

  test("weights the historical 24-dimension vector exactly as before", () => {
    const a = makeVector(24, 7);
    const b = makeVector(24, 8);
    expect(cosineSimilarity(a, b)).toBeCloseTo(reference(a, b, [...PERCEPTUAL_VECTOR_WEIGHTS]), 12);
  });

  test("weights a width with no declared weighting uniformly", () => {
    // Applying weights derived for one vector definition to a different one is
    // worse than applying none: the 35-dimension vector is rank-Gaussian
    // normalised before storage, so weights tuned for raw values describe nothing.
    for (const width of [25, 35, 40, 54]) {
      expect(weightsForDimensions(width)).toBeNull();
      const a = makeVector(width, 11);
      const b = makeVector(width, 12);
      expect(cosineSimilarity(a, b)).toBeCloseTo(reference(a, b, []), 12);

      // And that must genuinely differ from the 24-dimension weighting, or the
      // assertion above would be vacuous.
      expect(Math.abs(cosineSimilarity(a, b) - reference(a, b, [...PERCEPTUAL_VECTOR_WEIGHTS]))).toBeGreaterThan(1e-9);
    }
  });

  test("declares weighting per width in one table", () => {
    expect(weightsForDimensions(24)).toEqual(PERCEPTUAL_VECTOR_WEIGHTS);
    expect(weightsForDimensions(4)).toBeNull();
    expect(weightsForDimensions(0)).toBeNull();
  });

  test("leaves the legacy ratings vector unweighted", () => {
    // [e, m, c, p] are discrete 1-5 ratings; the perceptual weights describe
    // timbral dimensions and would be meaningless applied to them.
    const a = [1, 2, 3, 4];
    const b = [4, 3, 2, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(reference(a, b, []), 12);
    expect(LEGACY_RATINGS_VECTOR_MAX_DIMENSIONS).toBe(4);
  });

  test("compares only the shared prefix when widths differ", () => {
    const a = makeVector(30, 31);
    const b = a.slice(0, 24);
    // The shared prefix is 24 wide, so the 24-dimension weighting applies.
    expect(cosineSimilarity(a, b)).toBeCloseTo(reference(a.slice(0, 24), b, [...PERCEPTUAL_VECTOR_WEIGHTS]), 12);
  });

  test("returns 0 rather than NaN for empty or zero vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0, 0, 0, 0, 0], [1, 2, 3, 4, 5, 6])).toBe(0);
    expect(cosineSimilarity([1, 2, 3, 4, 5, 6], [0, 0, 0, 0, 0, 0])).toBe(0);
  });

  test("is symmetric", () => {
    const a = makeVector(54, 41);
    const b = makeVector(54, 42);
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 12);
  });
});
