import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDeterministicRatingModel, buildPerceptualVector, predictDeterministicRatings } from "../packages/sidflow-classify/src/deterministic-ratings.js";

const OUTPUT_DIR = path.join(process.cwd(), "tmp", "phase-ab-validation");
const VECTOR_WEIGHTS = [
  1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
  1.2, 1.2, 1.2, 1.2, 1.2, 1.2,
  0.8, 0.8, 0.8, 0.8, 0.8,
  1.5, 1.5, 1.5, 1.5, 1.5,
] as const;

type SampleTrack = {
  sid_path: string;
  renderEngine: string;
  features: Record<string, number | string>;
};

const sampleTracks: SampleTrack[] = [
  {
    sid_path: "MUSICIANS/A/Artist/ambient-1.sid",
    renderEngine: "wasm",
    features: {
      featureSetVersion: "1.2.0",
      bpm: 88,
      rms: 0.11,
      energy: 0.025,
      spectralCentroid: 720,
      spectralCentroidStd: 110,
      spectralRolloff: 2100,
      spectralFlatnessDb: 0.18,
      spectralEntropy: 5.2,
      spectralCrest: 16,
      spectralHfc: 1100,
      zeroCrossingRate: 0.035,
      spectralContrastMean: 0.82,
      mfccMean1: -42,
      mfccMean2: -11,
      mfccMean3: 4,
      mfccMean4: 1,
      mfccMean5: -2,
      onsetDensity: 1.1,
      rhythmicRegularity: 0.78,
      spectralFluxMean: 0.14,
      dynamicRange: 0.41,
      pitchSalience: 0.84,
      inharmonicity: 0.18,
      lowFrequencyEnergyRatio: 0.31,
    },
  },
  {
    sid_path: "MUSICIANS/A/Artist/ambient-2.sid",
    renderEngine: "wasm",
    features: {
      featureSetVersion: "1.2.0",
      bpm: 92,
      rms: 0.12,
      energy: 0.028,
      spectralCentroid: 760,
      spectralCentroidStd: 120,
      spectralRolloff: 2200,
      spectralFlatnessDb: 0.2,
      spectralEntropy: 5.4,
      spectralCrest: 18,
      spectralHfc: 1250,
      zeroCrossingRate: 0.04,
      spectralContrastMean: 0.88,
      mfccMean1: -39,
      mfccMean2: -10,
      mfccMean3: 5,
      mfccMean4: 2,
      mfccMean5: -1,
      onsetDensity: 1.3,
      rhythmicRegularity: 0.74,
      spectralFluxMean: 0.16,
      dynamicRange: 0.38,
      pitchSalience: 0.8,
      inharmonicity: 0.22,
      lowFrequencyEnergyRatio: 0.29,
    },
  },
  {
    sid_path: "GAMES/B/Composer/game-drive.sid",
    renderEngine: "wasm",
    features: {
      featureSetVersion: "1.2.0",
      bpm: 142,
      rms: 0.23,
      energy: 0.082,
      spectralCentroid: 2100,
      spectralCentroidStd: 260,
      spectralRolloff: 5400,
      spectralFlatnessDb: 0.46,
      spectralEntropy: 8.0,
      spectralCrest: 44,
      spectralHfc: 6400,
      zeroCrossingRate: 0.13,
      spectralContrastMean: 1.7,
      mfccMean1: -16,
      mfccMean2: 5,
      mfccMean3: 8,
      mfccMean4: -2,
      mfccMean5: 3,
      onsetDensity: 3.9,
      rhythmicRegularity: 0.36,
      spectralFluxMean: 0.4,
      dynamicRange: 0.71,
      pitchSalience: 0.48,
      inharmonicity: 0.62,
      lowFrequencyEnergyRatio: 0.12,
    },
  },
  {
    sid_path: "GAMES/B/Composer/game-drive-2.sid",
    renderEngine: "wasm",
    features: {
      featureSetVersion: "1.2.0",
      bpm: 146,
      rms: 0.24,
      energy: 0.086,
      spectralCentroid: 2150,
      spectralCentroidStd: 275,
      spectralRolloff: 5600,
      spectralFlatnessDb: 0.49,
      spectralEntropy: 8.3,
      spectralCrest: 46,
      spectralHfc: 6900,
      zeroCrossingRate: 0.135,
      spectralContrastMean: 1.78,
      mfccMean1: -14,
      mfccMean2: 6,
      mfccMean3: 9,
      mfccMean4: -1,
      mfccMean5: 4,
      onsetDensity: 4.2,
      rhythmicRegularity: 0.32,
      spectralFluxMean: 0.43,
      dynamicRange: 0.74,
      pitchSalience: 0.44,
      inharmonicity: 0.66,
      lowFrequencyEnergyRatio: 0.11,
    },
  },
  {
    sid_path: "DEMOS/C/Group/demo-hybrid.sid",
    renderEngine: "wasm",
    features: {
      featureSetVersion: "1.2.0",
      bpm: 118,
      rms: 0.17,
      energy: 0.05,
      spectralCentroid: 1450,
      spectralCentroidStd: 190,
      spectralRolloff: 3600,
      spectralFlatnessDb: 0.31,
      spectralEntropy: 6.8,
      spectralCrest: 30,
      spectralHfc: 3600,
      zeroCrossingRate: 0.085,
      spectralContrastMean: 1.15,
      mfccMean1: -28,
      mfccMean2: -2,
      mfccMean3: 6,
      mfccMean4: 1,
      mfccMean5: 0,
      onsetDensity: 2.3,
      rhythmicRegularity: 0.58,
      spectralFluxMean: 0.24,
      dynamicRange: 0.55,
      pitchSalience: 0.67,
      inharmonicity: 0.39,
      lowFrequencyEnergyRatio: 0.22,
    },
  },
];

function weightedCosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const weight = VECTOR_WEIGHTS[index] ?? 1;
    dot += weight * left[index]! * right[index]!;
    leftNorm += weight * left[index]! * left[index]!;
    rightNorm += weight * right[index]! * right[index]!;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function featureStats(records: Array<Record<string, number>>, key: string) {
  const values = records.map((record) => record[key]!).filter((value) => Number.isFinite(value));
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: mean(values),
  };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const model = buildDeterministicRatingModel(sampleTracks.map((track) => ({ renderEngine: track.renderEngine, features: track.features })));
  const classified = sampleTracks.map((track) => {
    const { ratings } = predictDeterministicRatings(model, track.features);
    const vector = buildPerceptualVector(model, track.features);
    return {
      sid_path: track.sid_path,
      ratings,
      features: track.features,
      vector,
    };
  });

  const featureDistribution = {
    onsetDensity: featureStats(classified.map((track) => track.features as Record<string, number>), 'onsetDensity'),
    rhythmicRegularity: featureStats(classified.map((track) => track.features as Record<string, number>), 'rhythmicRegularity'),
    spectralFluxMean: featureStats(classified.map((track) => track.features as Record<string, number>), 'spectralFluxMean'),
    dynamicRange: featureStats(classified.map((track) => track.features as Record<string, number>), 'dynamicRange'),
    pitchSalience: featureStats(classified.map((track) => track.features as Record<string, number>), 'pitchSalience'),
    inharmonicity: featureStats(classified.map((track) => track.features as Record<string, number>), 'inharmonicity'),
    lowFrequencyEnergyRatio: featureStats(classified.map((track) => track.features as Record<string, number>), 'lowFrequencyEnergyRatio'),
  };

  const ambientSeed = classified[0]!;
  const pairwise = classified.slice(1).map((track) => ({ sid_path: track.sid_path, similarityToAmbientSeed: weightedCosine(ambientSeed.vector, track.vector) }));
  pairwise.sort((left, right) => right.similarityToAmbientSeed - left.similarityToAmbientSeed);

  const station = [classified[0]!, classified[1]!, classified[4]!];
  const pairwiseStation: number[] = [];
  for (let left = 0; left < station.length; left += 1) {
    for (let right = left + 1; right < station.length; right += 1) {
      pairwiseStation.push(weightedCosine(station[left]!.vector, station[right]!.vector));
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    vectorDimensions: classified[0]!.vector.length,
    sampleClassificationOutput: classified[0],
    featureDistribution,
    similarityMetrics: {
      ambientSeedRankedNeighbors: pairwise,
      bestSimilarity: pairwise[0]!.similarityToAmbientSeed,
      worstSimilarity: pairwise[pairwise.length - 1]!.similarityToAmbientSeed,
    },
    stationCoherence: {
      stationMembers: station.map((track) => track.sid_path),
      meanPairwiseWeightedCosine: mean(pairwiseStation),
      minPairwiseWeightedCosine: Math.min(...pairwiseStation),
      maxPairwiseWeightedCosine: Math.max(...pairwiseStation),
    },
  };

  await writeFile(path.join(OUTPUT_DIR, 'sample-24d-classification.json'), JSON.stringify(classified[0], null, 2) + '\n', 'utf8');
  await writeFile(path.join(OUTPUT_DIR, 'validation-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

await main();
