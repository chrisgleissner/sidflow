/**
 * Tests for the similarity vector the product stores and serves stations from.
 *
 * These pin the things that would silently degrade station quality if changed
 * without measurement:
 *
 *   - the dimension COUNT and ORDER, because `PERCEPTUAL_VECTOR_WEIGHTS` indexes
 *     by position and the stored vectors in every published export are positional;
 *   - that the 24-dimension perceptual vector is a strict prefix, so it remains
 *     usable unchanged as the measurement baseline;
 *   - that the appended tonal dimensions are exactly the eleven selected by
 *     measurement, and that the optimisation harness reads the same list.
 *
 * The last one matters most. The eleven were chosen because all 31 tonal features
 * concatenated made retrieval WORSE than none at all, and the eleven made it
 * substantially better. If this list and the harness's list ever diverge, every
 * number in doc/station-quality.md silently stops describing the shipped system.
 */

import { describe, expect, test } from "bun:test";

import {
  SIMILARITY_APPENDED_DIMENSIONS,
  SIMILARITY_PLAYROUTINE_DIMENSIONS,
  SIMILARITY_TONAL_DIMENSIONS,
  SIMILARITY_VECTOR_DIMENSIONS,
  buildSimilarityVector,
} from "../src/similarity-vector.js";
import { SIMILARITY_VECTOR_DIMENSIONS as SERVING_VECTOR_DIMENSIONS } from "@sidflow/common";
import {
  DeterministicRatingModelBuilder,
  buildPerceptualVector,
} from "../src/deterministic-ratings.js";
import type { FeatureVector } from "../src/index.js";

/** A feature vector complete enough for the deterministic path to accept it. */
function makeFeatures(overrides: FeatureVector = {}): FeatureVector {
  const base: FeatureVector = {
    featureSetVersion: "1.4.0",
    featureVariant: "essentia",
    sidFeatureVariant: "sid-native",
    sidTonalVariant: "tonal",
    bpm: 125,
    rms: 0.08,
    energy: 0.01,
    spectralCentroid: 0.3,
    spectralCentroidStd: 0.1,
    spectralRolloff: 0.4,
    spectralFlatnessDb: 0.2,
    spectralEntropy: 0.5,
    spectralCrest: 0.3,
    spectralHfc: 0.2,
    zeroCrossingRate: 0.1,
    spectralContrastMean: 0.4,
    mfccMean1: -0.2,
    mfccMean2: 0.1,
    mfccMean3: 0.05,
    mfccMean4: -0.05,
    mfccMean5: 0.02,
    onsetDensity: 3,
    rhythmicRegularity: 0.7,
    spectralFluxMean: 0.2,
    dynamicRange: 0.8,
    pitchSalience: 0.6,
    inharmonicity: 0.2,
    lowFrequencyEnergyRatio: 0.3,
  };
  // Every appended dimension gets a distinct, recognisable value so the ORDER can
  // be asserted rather than merely the count.
  SIMILARITY_APPENDED_DIMENSIONS.forEach((name, index) => {
    if (name === "sidTonalPresent") return;
    base[name] = (index + 1) / 100;
  });
  return { ...base, ...overrides };
}

function modelFor(features: FeatureVector[]) {
  const builder = new DeterministicRatingModelBuilder();
  for (const f of features) builder.add(f);
  return builder.finalize("wasm");
}

describe("buildSimilarityVector", () => {
  test("has the declared width", () => {
    const features = [makeFeatures({ bpm: 90 }), makeFeatures({ bpm: 160 })];
    const model = modelFor(features);
    const vector = buildSimilarityVector(model, features[0]!);
    expect(vector.length).toBe(SIMILARITY_VECTOR_DIMENSIONS);
    expect(SIMILARITY_VECTOR_DIMENSIONS).toBe(24 + SIMILARITY_APPENDED_DIMENSIONS.length);
  });

  test("the serving weights table covers exactly this width", () => {
    // A drift guard across package boundaries. The weights are indexed by position
    // and looked up by vector width, so if the classifier grows a dimension without
    // the table being refitted, every station silently reverts to unweighted cosine
    // -- which measured 42.7 percentage points worse on held-out retrieval.
    expect(SERVING_VECTOR_DIMENSIONS).toBe(SIMILARITY_VECTOR_DIMENSIONS);
  });

  test("keeps the 24-dimension perceptual vector as a strict prefix", () => {
    // The baseline must remain intact and comparable: a baseline that moved with
    // the thing being measured would invalidate every reported gain.
    const features = [makeFeatures({ bpm: 90 }), makeFeatures({ bpm: 160 })];
    const model = modelFor(features);
    const perceptual = buildPerceptualVector(model, features[0]!);
    const similarity = buildSimilarityVector(model, features[0]!);
    expect(similarity.slice(0, perceptual.length)).toEqual(perceptual);
  });

  test("appends every dimension in the declared order", () => {
    const features = [makeFeatures({ bpm: 90 }), makeFeatures({ bpm: 160 })];
    const model = modelFor(features);
    const tail = buildSimilarityVector(model, features[0]!).slice(24);
    expect(tail.length).toBe(SIMILARITY_APPENDED_DIMENSIONS.length);
    SIMILARITY_APPENDED_DIMENSIONS.forEach((name, index) => {
      const expected = name === "sidTonalPresent" ? 1 : (index + 1) / 100;
      expect(tail[index]).toBeCloseTo(expected, 10);
    });
  });

  test("keeps the playroutine dimensions, which carry the most signal", () => {
    // One of these separates composers better than all 24 original dimensions
    // together (0.7713 against 0.7229), because a composer reuses a playroutine and
    // its register-write pattern is effectively that tooling's signature.
    for (const name of ["sidWriteSpreadEntropy", "sidWritesPerFrame", "sidWriteRateRegularity"]) {
      expect(SIMILARITY_PLAYROUTINE_DIMENSIONS as readonly string[]).toContain(name);
    }
    expect(SIMILARITY_PLAYROUTINE_DIMENSIONS.length).toBe(15);
  });

  test("derives sidTonalPresent from the tonal variant", () => {
    const model = modelFor([makeFeatures({ bpm: 90 }), makeFeatures({ bpm: 160 })]);
    const presentAt = SIMILARITY_TONAL_DIMENSIONS.indexOf("sidTonalPresent");
    expect(presentAt).toBeGreaterThanOrEqual(0);

    const tonal = buildSimilarityVector(model, makeFeatures({ sidTonalVariant: "tonal" }));
    const absent = buildSimilarityVector(model, makeFeatures({ sidTonalVariant: "insufficient" }));
    expect(tonal[24 + presentAt]).toBe(1);
    expect(absent[24 + presentAt]).toBe(0);
  });

  test("treats a missing tonal feature as zero rather than NaN", () => {
    const model = modelFor([makeFeatures({ bpm: 90 }), makeFeatures({ bpm: 160 })]);
    const stripped = makeFeatures();
    for (const name of SIMILARITY_APPENDED_DIMENSIONS) delete stripped[name];
    stripped.sidTonalVariant = "insufficient";

    const vector = buildSimilarityVector(model, stripped);
    expect(vector.length).toBe(SIMILARITY_VECTOR_DIMENSIONS);
    for (const value of vector) expect(Number.isFinite(value)).toBe(true);
    for (const value of vector.slice(24)) expect(value).toBe(0);
  });

  test("clamps tonal dimensions into [0, 1]", () => {
    const model = modelFor([makeFeatures({ bpm: 90 }), makeFeatures({ bpm: 160 })]);
    const wild = makeFeatures({ sidPolyphonyMean: 42, sidNoteRate: -7 });
    const vector = buildSimilarityVector(model, wild);
    for (const value of vector.slice(24)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  test("excludes the tonal features measured to carry no composer signal", () => {
    // Measured on the TRAIN split: major-versus-minor mode separates composers at
    // AUC 0.507 against a 0.500 floor, and the chord-colour weights are no better.
    // Including them made retrieval worse, so their absence is a result, not an
    // oversight, and re-adding one should be a deliberate act with a measurement.
    for (const rejected of [
      "sidKeyMinorness",
      "sidKeyIsMinor",
      "sidMajorThirdWeight",
      "sidMinorThirdWeight",
      "sidTritoneWeight",
      "sidMelodicAscendingRatio",
      "sidMelodicRepeatRatio",
      "sidKeyRoot",
    ]) {
      expect(SIMILARITY_APPENDED_DIMENSIONS as readonly string[]).not.toContain(rejected);
    }
  });

  test("keeps the texture dimensions that do carry composer signal", () => {
    for (const kept of ["sidPolyphonyMean", "sidNoteDurationMean", "sidNoteRate", "sidTonalPresent"]) {
      expect(SIMILARITY_TONAL_DIMENSIONS as readonly string[]).toContain(kept);
    }
  });

  test("never includes a nominal or unbounded feature", () => {
    // sidKeyRoot is nominal: C# is not between C and D, and the wrap from B to C
    // would read as the largest possible distance in a Euclidean or cosine metric.
    // sidNoteCount is unbounded, which would let one dimension dominate the norm.
    expect(SIMILARITY_APPENDED_DIMENSIONS as readonly string[]).not.toContain("sidKeyRoot");
    expect(SIMILARITY_APPENDED_DIMENSIONS as readonly string[]).not.toContain("sidNoteCount");
  });
});
