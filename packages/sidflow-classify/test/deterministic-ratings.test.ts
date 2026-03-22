import { describe, expect, it } from "bun:test";
import { buildDeterministicRatingModel, buildPerceptualVector, type DeterministicRatingModel } from "../src/deterministic-ratings.js";

describe("buildPerceptualVector", () => {
  it("builds a deterministic 24D vector with normalized ranges", () => {
    const model: DeterministicRatingModel = buildDeterministicRatingModel([
      {
        renderEngine: "wasm",
        features: {
          featureSetVersion: "1.2.0",
          bpm: 90,
          rms: 0.12,
          energy: 0.03,
          spectralCentroid: 800,
          spectralCentroidStd: 120,
          spectralRolloff: 2200,
          spectralFlatnessDb: 0.2,
          spectralEntropy: 5.5,
          spectralCrest: 18,
          spectralHfc: 1200,
          zeroCrossingRate: 0.04,
          spectralContrastMean: 0.8,
          mfccMean1: -40,
          mfccMean2: -12,
          mfccMean3: 5,
          mfccMean4: 2,
          mfccMean5: -1,
          onsetDensity: 1.2,
          rhythmicRegularity: 0.7,
          spectralFluxMean: 0.15,
          dynamicRange: 0.4,
          pitchSalience: 0.85,
          inharmonicity: 0.2,
          lowFrequencyEnergyRatio: 0.3,
        },
      },
      {
        renderEngine: "wasm",
        features: {
          featureSetVersion: "1.2.0",
          bpm: 150,
          rms: 0.22,
          energy: 0.08,
          spectralCentroid: 2200,
          spectralCentroidStd: 260,
          spectralRolloff: 5200,
          spectralFlatnessDb: 0.5,
          spectralEntropy: 8.2,
          spectralCrest: 42,
          spectralHfc: 6200,
          zeroCrossingRate: 0.13,
          spectralContrastMean: 1.8,
          mfccMean1: -15,
          mfccMean2: 4,
          mfccMean3: 8,
          mfccMean4: -2,
          mfccMean5: 3,
          onsetDensity: 3.8,
          rhythmicRegularity: 0.35,
          spectralFluxMean: 0.42,
          dynamicRange: 0.7,
          pitchSalience: 0.45,
          inharmonicity: 0.65,
          lowFrequencyEnergyRatio: 0.12,
        },
      },
    ]);

    const featureSet = {
      bpm: 110,
      rms: 0.14,
      energy: 0.04,
      spectralCentroid: 1000,
      spectralCentroidStd: 140,
      spectralRolloff: 2500,
      spectralFlatnessDb: 0.22,
      spectralEntropy: 5.8,
      spectralCrest: 20,
      spectralHfc: 1800,
      zeroCrossingRate: 0.05,
      spectralContrastMean: 0.9,
      mfccMean1: -30,
      mfccMean2: -8,
      mfccMean3: 4,
      mfccMean4: 1,
      mfccMean5: -0.5,
      onsetDensity: 1.5,
      rhythmicRegularity: 0.72,
      spectralFluxMean: 0.18,
      dynamicRange: 0.38,
      pitchSalience: 0.81,
      inharmonicity: 0.19,
      lowFrequencyEnergyRatio: 0.28,
    };

    const vectorA = buildPerceptualVector(model, featureSet);
    const vectorB = buildPerceptualVector(model, featureSet);

    expect(vectorA).toHaveLength(24);
    expect(vectorA).toEqual(vectorB);
    vectorA.slice(0, 14).forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
    vectorA.slice(14, 19).forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    });
    vectorA.slice(19).forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
  });
});
