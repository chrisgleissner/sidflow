import { clampRating, type TagRatings } from "@sidflow/common";
import type { FeatureVector } from "./index.js";

const FEATURE_KEYS = [
  "bpm",
  "rms",
  "energy",
  "spectralCentroid",
  "spectralRolloff",
  "spectralFlatnessDb",
  "spectralEntropy",
  "spectralCrest",
  "spectralHfc",
  "zeroCrossingRate",
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
