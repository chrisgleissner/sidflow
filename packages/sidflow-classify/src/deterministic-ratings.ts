import { clampRating, type TagRatings } from "@sidflow/common";
import type { FeatureVector } from "./index.js";

const FEATURE_KEYS = [
  "bpm",
  "rms",
  "energy",
  "spectralCentroid",
  "spectralCentroidStd",
  "spectralRolloff",
  "spectralFlatnessDb",
  "spectralEntropy",
  "spectralCrest",
  "spectralHfc",
  "zeroCrossingRate",
  "spectralContrastMean",
  "mfccMean1",
  "mfccMean2",
  "mfccMean3",
  "mfccMean4",
  "mfccMean5",
  "onsetDensity",
  "rhythmicRegularity",
  "spectralFluxMean",
  "dynamicRange",
  "pitchSalience",
  "inharmonicity",
  "lowFrequencyEnergyRatio",
] as const;

export type DeterministicFeatureKey = (typeof FEATURE_KEYS)[number];

export interface FeatureNormStats {
  mu: number;
  sigma: number;
  count: number;
  nonZeroCount: number;
}

export interface DeterministicRatingModel {
  featureSetVersion: string;
  renderEngine: string;
  features: Partial<Record<DeterministicFeatureKey, FeatureNormStats>>;
}

type OnlineStats = {
  count: number;
  mean: number;
  m2: number;
  nonZeroCount: number;
};

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function addOnline(stats: OnlineStats, x: number): void {
  stats.count += 1;
  const delta = x - stats.mean;
  stats.mean += delta / stats.count;
  const delta2 = x - stats.mean;
  stats.m2 += delta * delta2;
  if (Math.abs(x) > 1e-12) stats.nonZeroCount += 1;
}

function finalizeSigma(stats: OnlineStats): number {
  if (stats.count <= 0) return 0;
  const variance = stats.m2 / stats.count;
  return Math.sqrt(Math.max(0, variance));
}

export class DeterministicRatingModelBuilder {
  private readonly byKey = new Map<DeterministicFeatureKey, OnlineStats>();
  private featureSetVersion: string = "unknown";

  add(features: FeatureVector): void {
    if (typeof features.featureSetVersion === "string" && features.featureSetVersion) {
      this.featureSetVersion = features.featureSetVersion;
    }
    for (const k of FEATURE_KEYS) {
      const v = features[k];
      if (!isFiniteNumber(v)) continue;
      const stats = this.byKey.get(k) ?? { count: 0, mean: 0, m2: 0, nonZeroCount: 0 };
      addOnline(stats, v);
      this.byKey.set(k, stats);
    }
  }

  finalize(renderEngine: string): DeterministicRatingModel {
    const out: DeterministicRatingModel = {
      featureSetVersion: this.featureSetVersion,
      renderEngine,
      features: {},
    };

    for (const k of FEATURE_KEYS) {
      const s = this.byKey.get(k);
      if (!s) continue;

      // Exclude constant-zero features across the dataset.
      if (s.nonZeroCount <= 0) continue;

      const sigma = finalizeSigma(s);
      // Degenerate variance -> treat as missing (cannot normalize).
      if (!Number.isFinite(sigma) || sigma <= 0) continue;

      out.features[k] = {
        mu: s.mean,
        sigma,
        count: s.count,
        nonZeroCount: s.nonZeroCount,
      };
    }

    return out;
  }
}

export function buildDeterministicRatingModel(
  records: Array<{ features: FeatureVector; renderEngine: string }>
): DeterministicRatingModel {
  const builder = new DeterministicRatingModelBuilder();
  let renderEngine = "unknown";
  for (const { features, renderEngine: engine } of records) {
    if (typeof engine === "string" && engine) renderEngine = engine;
    builder.add(features);
  }
  return builder.finalize(renderEngine);
}

export function normalizeFeature(
  model: DeterministicRatingModel,
  key: DeterministicFeatureKey,
  value: unknown
): number | undefined {
  if (!isFiniteNumber(value)) return undefined;
  const stats = model.features[key];
  if (!stats) return undefined;
  const z = (value - stats.mu) / stats.sigma;
  return clamp(z, -3, 3);
}

type Weighted = { w: number; x?: number };

function weightedAverageTerms(terms: Weighted[]): { value: number; present: boolean } {
  let wSum = 0;
  let sum = 0;

  for (const t of terms) {
    if (!isFiniteNumber(t.x)) continue;
    if (!Number.isFinite(t.w) || t.w <= 0) continue;
    wSum += t.w;
    sum += t.w * t.x;
  }

  if (wSum <= 0) {
    return { value: 0, present: false };
  }

  return { value: sum / wSum, present: true };
}

function sigmoidFromNormalizedTerms(terms: Weighted[]): { value: number; present: boolean } {
  const avg = weightedAverageTerms(terms);
  if (!avg.present) {
    return { value: 0.5, present: false };
  }
  return { value: sigmoid(avg.value), present: true };
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

function normalize01(model: DeterministicRatingModel, key: DeterministicFeatureKey, value: unknown, fallback = 0.5): number {
  const normalized = normalizeFeature(model, key, value);
  if (normalized === undefined) {
    return fallback;
  }
  return clamp01((normalized + 3) / 6);
}

function normalizeSigned(model: DeterministicRatingModel, key: DeterministicFeatureKey, value: unknown): number {
  const normalized = normalizeFeature(model, key, value);
  if (normalized === undefined) {
    return 0;
  }
  return clamp(normalized / 3, -1, 1);
}

function direct01(value: unknown, fallback = 0.5): number {
  return isFiniteNumber(value) ? clamp01(value) : fallback;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0.5;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface DeterministicTags {
  tempo_fast: { value: number; present: boolean };
  bright: { value: number; present: boolean };
  noisy: { value: number; present: boolean };
  percussive: { value: number; present: boolean };
  dynamic_loud: { value: number; present: boolean };
  tonal_clarity: { value: number; present: boolean };
  demo_like: { value: number; present: boolean };
}

export function computeDeterministicTags(
  model: DeterministicRatingModel,
  features: FeatureVector
): DeterministicTags {
  const bpmNorm = normalizeFeature(model, "bpm", features.bpm);
  const conf = isFiniteNumber(features.confidence) ? clamp(features.confidence, 0, 1) : 1;

  const tempo_fast = bpmNorm === undefined
    ? { value: 0.5, present: false }
    : { value: sigmoid(bpmNorm * conf), present: true };

  const bright = sigmoidFromNormalizedTerms([
    { w: 0.45, x: normalizeFeature(model, "spectralCentroid", features.spectralCentroid) },
    { w: 0.35, x: normalizeFeature(model, "spectralRolloff", features.spectralRolloff) },
    { w: 0.20, x: normalizeFeature(model, "spectralHfc", features.spectralHfc) },
  ]);

  const noisy = sigmoidFromNormalizedTerms([
    { w: 0.45, x: normalizeFeature(model, "spectralFlatnessDb", features.spectralFlatnessDb) },
    { w: 0.25, x: normalizeFeature(model, "zeroCrossingRate", features.zeroCrossingRate) },
    { w: 0.30, x: normalizeFeature(model, "spectralEntropy", features.spectralEntropy) },
  ]);

  const percussive = sigmoidFromNormalizedTerms([
    { w: 0.50, x: normalizeFeature(model, "spectralCrest", features.spectralCrest) },
    { w: 0.30, x: normalizeFeature(model, "zeroCrossingRate", features.zeroCrossingRate) },
    { w: 0.20, x: normalizeFeature(model, "spectralHfc", features.spectralHfc) },
  ]);

  const dynamic_loud = sigmoidFromNormalizedTerms([
    { w: 0.70, x: normalizeFeature(model, "rms", features.rms) },
    { w: 0.30, x: normalizeFeature(model, "energy", features.energy) },
  ]);

  const tonal_clarity = noisy.present
    ? { value: 1 - noisy.value, present: true }
    : { value: 0.5, present: false };

  const demo_like = (() => {
    const avg = weightedAverageTerms([
      { w: 0.40, x: tempo_fast.value },
      { w: 0.35, x: percussive.value },
      { w: 0.25, x: bright.value },
    ]);
    return { value: clamp01(avg.present ? avg.value : 0.5), present: avg.present };
  })();

  return {
    tempo_fast,
    bright,
    noisy,
    percussive,
    dynamic_loud,
    tonal_clarity,
    demo_like,
  };
}

function ratingFromRaw(raw: number): number {
  const r = Math.round(1 + 4 * clamp01(raw));
  return clampRating(r);
}

export function predictDeterministicRatings(
  model: DeterministicRatingModel,
  features: FeatureVector
): { ratings: TagRatings; tags: DeterministicTags } {
  const tags = computeDeterministicTags(model, features);

  const cAvg = weightedAverageTerms([
    { w: 0.35, x: tags.percussive.present ? tags.percussive.value : undefined },
    { w: 0.25, x: tags.tempo_fast.present ? tags.tempo_fast.value : undefined },
    { w: 0.25, x: tags.bright.present ? tags.bright.value : undefined },
    { w: 0.15, x: tags.noisy.present ? tags.noisy.value : undefined },
  ]);

  const eAvg = weightedAverageTerms([
    { w: 0.40, x: tags.dynamic_loud.present ? tags.dynamic_loud.value : undefined },
    { w: 0.35, x: tags.tempo_fast.present ? tags.tempo_fast.value : undefined },
    { w: 0.25, x: tags.percussive.present ? tags.percussive.value : undefined },
  ]);

  const mAvg = weightedAverageTerms([
    { w: 0.45, x: tags.tonal_clarity.present ? tags.tonal_clarity.value : undefined },
    { w: 0.25, x: tags.percussive.present ? 1 - tags.percussive.value : undefined },
    { w: 0.15, x: tags.bright.present ? 1 - tags.bright.value : undefined },
    { w: 0.15, x: tags.dynamic_loud.present ? 1 - tags.dynamic_loud.value : undefined },
  ]);

  const cRaw = clamp01(cAvg.present ? cAvg.value : 0.5);
  const eRaw = clamp01(eAvg.present ? eAvg.value : 0.5);
  const mRaw = clamp01(mAvg.present ? mAvg.value : 0.5);

  return {
    tags,
    ratings: {
      c: ratingFromRaw(cRaw),
      e: ratingFromRaw(eRaw),
      m: ratingFromRaw(mRaw),
    },
  };
}

export function buildPerceptualVector(
  model: DeterministicRatingModel,
  features: FeatureVector,
): number[] {
  const brightness = average([
    normalize01(model, "spectralCentroid", features.spectralCentroid),
    normalize01(model, "spectralRolloff", features.spectralRolloff),
    normalize01(model, "spectralHfc", features.spectralHfc),
  ]);
  const noisiness = average([
    normalize01(model, "spectralFlatnessDb", features.spectralFlatnessDb),
    normalize01(model, "spectralEntropy", features.spectralEntropy),
    normalize01(model, "zeroCrossingRate", features.zeroCrossingRate),
  ]);
  const percussiveness = average([
    normalize01(model, "spectralCrest", features.spectralCrest),
    normalize01(model, "zeroCrossingRate", features.zeroCrossingRate),
    normalize01(model, "spectralHfc", features.spectralHfc),
  ]);
  const loudness = average([
    normalize01(model, "rms", features.rms),
    normalize01(model, "energy", features.energy),
  ]);
  const bassPresence = direct01(features.lowFrequencyEnergyRatio);
  const spectralComplexity = average([
    normalize01(model, "spectralContrastMean", features.spectralContrastMean),
    normalize01(model, "spectralEntropy", features.spectralEntropy),
  ]);
  const harmonicClarity = average([
    direct01(features.pitchSalience),
    1 - direct01(features.inharmonicity),
  ]);
  const dissonance = average([
    direct01(features.inharmonicity),
    noisiness,
  ]);

  const tempo = normalize01(model, "bpm", features.bpm);
  const onsetDensity = normalize01(model, "onsetDensity", features.onsetDensity);
  const rhythmicRegularity = direct01(features.rhythmicRegularity);
  const spectralFluxMean = normalize01(model, "spectralFluxMean", features.spectralFluxMean);
  const dynamicRange = direct01(features.dynamicRange);
  const timbralModulation = normalize01(model, "spectralCentroidStd", features.spectralCentroidStd);

  const mfcc1 = normalizeSigned(model, "mfccMean1", features.mfccMean1);
  const mfcc2 = normalizeSigned(model, "mfccMean2", features.mfccMean2);
  const mfcc3 = normalizeSigned(model, "mfccMean3", features.mfccMean3);
  const mfcc4 = normalizeSigned(model, "mfccMean4", features.mfccMean4);
  const mfcc5 = normalizeSigned(model, "mfccMean5", features.mfccMean5);

  const energyComposite = clamp01((0.35 * loudness) + (0.25 * tempo) + (0.2 * onsetDensity) + (0.2 * percussiveness));
  const moodProxy = clamp01((0.35 * harmonicClarity) + (0.25 * (1 - dissonance)) + (0.2 * (1 - noisiness)) + (0.2 * (1 - percussiveness)));
  const complexityProxy = clamp01((0.25 * spectralComplexity) + (0.25 * onsetDensity) + (0.25 * timbralModulation) + (0.25 * (1 - rhythmicRegularity)));
  const danceability = clamp01((0.4 * rhythmicRegularity) + (0.3 * tempo) + (0.3 * percussiveness));
  const atmosphere = clamp01((0.3 * dynamicRange) + (0.3 * spectralFluxMean) + (0.2 * (1 - rhythmicRegularity)) + (0.2 * timbralModulation));

  return [
    brightness,
    noisiness,
    percussiveness,
    loudness,
    bassPresence,
    spectralComplexity,
    harmonicClarity,
    dissonance,
    tempo,
    onsetDensity,
    rhythmicRegularity,
    spectralFluxMean,
    dynamicRange,
    timbralModulation,
    mfcc1,
    mfcc2,
    mfcc3,
    mfcc4,
    mfcc5,
    energyComposite,
    moodProxy,
    complexityProxy,
    danceability,
    atmosphere,
  ];
}
