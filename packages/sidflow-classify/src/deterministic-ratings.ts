import { FEATURE_SCHEMA_VERSION, clampRating, type TagRatings } from "@sidflow/common";
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

export const DETERMINISTIC_FEATURE_KEYS = FEATURE_KEYS;

export type DeterministicFeatureKey = (typeof FEATURE_KEYS)[number];

export interface FeatureVectorHealthReport {
  healthy: boolean;
  vector: Record<DeterministicFeatureKey, number | null>;
  unhealthyElements: string[];
  featureVariant: string | null;
  sidFeatureVariant: string | null;
  featureSetVersion: string | null;
}

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

export function hasRealisticCompleteFeatureVector(features: FeatureVector): boolean {
  return inspectFeatureVectorHealth(features).healthy;
}

export function inspectFeatureVectorHealth(features: FeatureVector): FeatureVectorHealthReport {
  const unhealthyElements: string[] = [];
  const vector = Object.fromEntries(
    FEATURE_KEYS.map((key) => {
      const value = features[key];
      return [key, isFiniteNumber(value) ? Number(value.toFixed(6)) : null];
    })
  ) as Record<DeterministicFeatureKey, number | null>;

  if (features.featureVariant === "heuristic") {
    unhealthyElements.push("featureVariant=heuristic");
  }

  if (features.sidFeatureVariant === "unavailable") {
    unhealthyElements.push("sidFeatureVariant=unavailable");
  }

  if (typeof features.featureSetVersion === "string" && features.featureSetVersion !== FEATURE_SCHEMA_VERSION) {
    unhealthyElements.push(`featureSetVersion=${features.featureSetVersion} (expected ${FEATURE_SCHEMA_VERSION})`);
  }

  for (const key of FEATURE_KEYS) {
    const value = features[key];
    if (value === undefined || value === null) {
      unhealthyElements.push(`${key}=missing`);
      continue;
    }
    if (!isFiniteNumber(value)) {
      unhealthyElements.push(`${key}=non-finite(${String(value)})`);
    }
  }

  return {
    healthy: unhealthyElements.length === 0,
    vector,
    unhealthyElements,
    featureVariant: typeof features.featureVariant === "string" ? features.featureVariant : null,
    sidFeatureVariant: typeof features.sidFeatureVariant === "string" ? features.sidFeatureVariant : null,
    featureSetVersion: typeof features.featureSetVersion === "string" ? features.featureSetVersion : null,
  };
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

function directSigned(value: unknown): number {
  return isFiniteNumber(value) ? clamp(value, -1, 1) : 0;
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
  const sidAvailable = typeof features.sidFeatureVariant === "string" && features.sidFeatureVariant === "sid-native";

  const tempoWav = normalize01(model, "bpm", features.bpm);
  const onsetDensityWav = normalize01(model, "onsetDensity", features.onsetDensity);
  const rhythmicRegularityWav = direct01(features.rhythmicRegularity);
  const centroidStdWav = normalize01(model, "spectralCentroidStd", features.spectralCentroidStd);
  const spectralFluxWav = normalize01(model, "spectralFluxMean", features.spectralFluxMean);
  const pitchSalienceWav = direct01(features.pitchSalience);
  const lowFrequencyEnergyWav = direct01(features.lowFrequencyEnergyRatio);
  const rmsNorm = normalize01(model, "rms", features.rms);
  const energyNorm = normalize01(model, "energy", features.energy);
  const dynamicRangeWav = direct01(features.dynamicRange);
  const inharmonicityWav = direct01(features.inharmonicity);
  const mfccNorm1 = normalizeSigned(model, "mfccMean1", features.mfccMean1);
  const mfccNorm2 = normalizeSigned(model, "mfccMean2", features.mfccMean2);

  const tempoSid = sidAvailable ? clamp01(direct01(features.sidGateOnsetDensity) / 4) : tempoWav;
  const onsetDensitySid = sidAvailable ? clamp01(direct01(features.sidGateOnsetDensity) / 4) : onsetDensityWav;
  const rhythmicRegularitySid = sidAvailable ? direct01(features.sidRhythmicRegularity) : rhythmicRegularityWav;
  const syncopationSid = sidAvailable ? direct01(features.sidSyncopation) : 0;
  const arpeggioRateSid = sidAvailable ? direct01(features.sidArpeggioActivity) : 0;
  const waveTriangleRatio = sidAvailable ? direct01(features.sidWaveTriangleRatio) : 0;
  const waveSawRatio = sidAvailable ? direct01(features.sidWaveSawRatio) : 0;
  const wavePulseRatio = sidAvailable ? direct01(features.sidWavePulseRatio) : 0;
  const waveNoiseRatio = sidAvailable ? direct01(features.sidWaveNoiseRatio) : 0;
  const pwmActivitySid = sidAvailable ? direct01(features.sidPwmActivity) : 0;
  const filterCutoffMeanSid = sidAvailable ? direct01(features.sidFilterCutoffMean) : 0;
  const filterSweepSid = sidAvailable ? direct01(features.sidFilterMotion) : centroidStdWav;
  const registerMotionSid = sidAvailable ? direct01(features.sidRegisterMotion) : spectralFluxWav;
  const samplePlaybackRate = sidAvailable ? direct01(features.sidSamplePlaybackActivity) : 0;
  const melodyConfidenceSid = sidAvailable ? direct01(features.sidMelodicClarity) : pitchSalienceWav;
  const bassShareSid = sidAvailable ? direct01(features.sidRoleBassRatio) : lowFrequencyEnergyWav;
  const accompanimentShareSid = sidAvailable ? direct01(features.sidRoleAccompanimentRatio) : 0;
  const voiceRoleEntropySid = sidAvailable ? direct01(features.sidVoiceRoleEntropy) : 0;
  const adsrPluckRatioSid = sidAvailable ? direct01(features.sidAdsrPluckRatio) : 0;
  const adsrPadRatioSid = sidAvailable ? direct01(features.sidAdsrPadRatio) : 0;

  const digiPresent = samplePlaybackRate > 0.15;
  const tempoFused = clamp01((digiPresent ? 0.5 : 0.7) * tempoSid + (digiPresent ? 0.5 : 0.3) * tempoWav);
  const onsetDensityFused = clamp01((0.7 * onsetDensitySid) + (0.3 * onsetDensityWav));
  const rhythmicRegularityFused = clamp01((0.7 * rhythmicRegularitySid) + (0.3 * rhythmicRegularityWav));
  const filterMotionFused = clamp01((0.75 * filterSweepSid) + (0.25 * centroidStdWav));
  const melodicClarityFused = clamp01((0.6 * melodyConfidenceSid) + (0.4 * pitchSalienceWav));
  const bassPresenceFused = clamp01((0.6 * bassShareSid) + (0.4 * lowFrequencyEnergyWav));
  const loudnessFused = clamp01((0.6 * rmsNorm) + (0.4 * energyNorm));

  const sidTimbreBasis = [
    waveTriangleRatio,
    waveSawRatio,
    wavePulseRatio,
    waveNoiseRatio,
    sidAvailable ? direct01(features.sidWaveMixedRatio) : 0,
    pwmActivitySid,
    filterCutoffMeanSid,
    filterSweepSid,
    samplePlaybackRate,
  ];
  const mfccResidual1 = computeMfccResidual(mfccNorm1, sidTimbreBasis, [0.18, 0.26, 0.31, 0.14, 0.19, 0.22, 0.08, 0.11, 0.16], sidAvailable);
  const mfccResidual2 = computeMfccResidual(mfccNorm2, sidTimbreBasis, [-0.08, 0.11, 0.14, 0.17, 0.1, 0.15, 0.04, 0.08, 0.1], sidAvailable);

  return [
    tempoFused,
    onsetDensityFused,
    rhythmicRegularityFused,
    syncopationSid,
    arpeggioRateSid,
    waveTriangleRatio,
    waveSawRatio,
    wavePulseRatio,
    waveNoiseRatio,
    pwmActivitySid,
    filterCutoffMeanSid,
    filterMotionFused,
    samplePlaybackRate,
    melodicClarityFused,
    bassPresenceFused,
    accompanimentShareSid,
    voiceRoleEntropySid,
    adsrPluckRatioSid,
    adsrPadRatioSid,
    loudnessFused,
    dynamicRangeWav,
    inharmonicityWav,
    mfccResidual1,
    mfccResidual2,
  ];
}

function computeMfccResidual(
  mfccNorm: number,
  sidTimbreBasis: number[],
  regressionWeights: number[],
  sidAvailable: boolean,
): number {
  if (!sidAvailable) {
    return mfccNorm;
  }

  let predicted = 0;
  for (let index = 0; index < Math.min(sidTimbreBasis.length, regressionWeights.length); index += 1) {
    predicted += sidTimbreBasis[index]! * regressionWeights[index]!;
  }
  return clamp(mfccNorm - predicted, -1, 1);
}
