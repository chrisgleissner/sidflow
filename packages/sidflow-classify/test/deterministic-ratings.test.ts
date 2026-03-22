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
    vectorA.slice(0, 22).forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
    vectorA.slice(22).forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    });
  });

  it("keeps WAV-derived overlap semantics when SID-native features are missing", () => {
    const model: DeterministicRatingModel = buildDeterministicRatingModel([
      {
        renderEngine: "wasm",
        features: {
          featureSetVersion: "1.3.0",
          bpm: 90,
          rms: 0.12,
          energy: 0.03,
          spectralCentroidStd: 120,
          onsetDensity: 1.2,
          rhythmicRegularity: 0.7,
          spectralFluxMean: 0.15,
          dynamicRange: 0.4,
          pitchSalience: 0.85,
          inharmonicity: 0.2,
          lowFrequencyEnergyRatio: 0.3,
          mfccMean1: -40,
          mfccMean2: -12,
        },
      },
      {
        renderEngine: "wasm",
        features: {
          featureSetVersion: "1.3.0",
          bpm: 150,
          rms: 0.22,
          energy: 0.08,
          spectralCentroidStd: 260,
          onsetDensity: 3.8,
          rhythmicRegularity: 0.35,
          spectralFluxMean: 0.42,
          dynamicRange: 0.7,
          pitchSalience: 0.45,
          inharmonicity: 0.65,
          lowFrequencyEnergyRatio: 0.12,
          mfccMean1: -15,
          mfccMean2: 4,
        },
      },
    ]);

    const vector = buildPerceptualVector(model, {
      bpm: 110,
      rms: 0.14,
      energy: 0.04,
      spectralCentroidStd: 140,
      onsetDensity: 1.5,
      rhythmicRegularity: 0.72,
      spectralFluxMean: 0.18,
      dynamicRange: 0.38,
      pitchSalience: 0.81,
      inharmonicity: 0.19,
      lowFrequencyEnergyRatio: 0.28,
      mfccMean1: -30,
      mfccMean2: -8,
      featureVariant: "essentia",
    });

    expect(vector[0]).toBeGreaterThan(0);
    expect(vector[1]).toBeGreaterThan(0);
    expect(vector[11]).toBeGreaterThan(0);
    expect(vector[13]).toBeGreaterThan(0);
    expect(vector[14]).toBeGreaterThan(0);
    expect(vector[22]).toBeGreaterThanOrEqual(-1);
    expect(vector[23]).toBeGreaterThanOrEqual(-1);
  });

  it("uses SID-native causal features without overwriting WAV-derived overlap semantics", () => {
    const model: DeterministicRatingModel = buildDeterministicRatingModel([
      {
        renderEngine: "wasm",
        features: {
          featureSetVersion: "1.3.0",
          bpm: 90,
          rms: 0.12,
          energy: 0.03,
          spectralCentroidStd: 120,
          onsetDensity: 1.2,
          rhythmicRegularity: 0.7,
          spectralFluxMean: 0.15,
          dynamicRange: 0.4,
          pitchSalience: 0.85,
          inharmonicity: 0.2,
          lowFrequencyEnergyRatio: 0.3,
          mfccMean1: -40,
          mfccMean2: -12,
        },
      },
      {
        renderEngine: "wasm",
        features: {
          featureSetVersion: "1.3.0",
          bpm: 150,
          rms: 0.22,
          energy: 0.08,
          spectralCentroidStd: 260,
          onsetDensity: 3.8,
          rhythmicRegularity: 0.35,
          spectralFluxMean: 0.42,
          dynamicRange: 0.7,
          pitchSalience: 0.45,
          inharmonicity: 0.65,
          lowFrequencyEnergyRatio: 0.12,
          mfccMean1: -15,
          mfccMean2: 4,
        },
      },
    ]);

    const withoutSid = buildPerceptualVector(model, {
      bpm: 110,
      rms: 0.14,
      energy: 0.04,
      spectralCentroidStd: 140,
      onsetDensity: 1.5,
      rhythmicRegularity: 0.72,
      spectralFluxMean: 0.18,
      dynamicRange: 0.38,
      pitchSalience: 0.81,
      inharmonicity: 0.19,
      lowFrequencyEnergyRatio: 0.28,
      mfccMean1: -30,
      mfccMean2: -8,
    });

    const withSid = buildPerceptualVector(model, {
      bpm: 110,
      rms: 0.14,
      energy: 0.04,
      spectralCentroidStd: 140,
      onsetDensity: 1.5,
      rhythmicRegularity: 0.72,
      spectralFluxMean: 0.18,
      dynamicRange: 0.38,
      pitchSalience: 0.81,
      inharmonicity: 0.19,
      lowFrequencyEnergyRatio: 0.28,
      mfccMean1: -30,
      mfccMean2: -8,
      sidFeatureVariant: "sid-native",
      sidGateOnsetDensity: 1.8,
      sidRhythmicRegularity: 0.62,
      sidSyncopation: 0.3,
      sidArpeggioActivity: 0.4,
      sidWaveTriangleRatio: 0.2,
      sidWaveSawRatio: 0.3,
      sidWavePulseRatio: 0.4,
      sidWaveNoiseRatio: 0.1,
      sidWaveMixedRatio: 0.2,
      sidPwmActivity: 0.5,
      sidRegisterMotion: 0.6,
      sidFilterCutoffMean: 0.55,
      sidFilterMotion: 0.65,
      sidSamplePlaybackActivity: 0.2,
      sidMelodicClarity: 0.9,
      sidRoleBassRatio: 0.7,
      sidRoleAccompanimentRatio: 0.2,
      sidVoiceRoleEntropy: 0.45,
      sidAdsrPluckRatio: 0.8,
      sidAdsrPadRatio: 0.1,
    });

    expect(withSid[0]).not.toBe(withoutSid[0]);
    expect(withSid[11]).not.toBe(withoutSid[11]);
    expect(withSid[13]).not.toBe(withoutSid[13]);
    expect(withSid[20]).toBe(withoutSid[20]);
    expect(withSid[21]).toBe(withoutSid[21]);
    expect(withSid[22]).not.toBe(withoutSid[22]);
  });
});
