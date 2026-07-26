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
  /**
   * Corpus breakpoints that cut each raw score into five equally populated
   * levels. Optional so a model persisted before calibration existed still
   * loads; absent means fall back to the uncalibrated linear mapping.
   */
  ratingQuantiles?: RatingQuantiles;
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

/**
 * The uncalibrated mapping: raw in [0,1] spread linearly over five levels.
 *
 * Retained only as the fallback for a corpus too small to estimate quantiles
 * from. On any real corpus it collapses, and the reason is structural rather
 * than a matter of tuning. Each raw score is a weighted average of sigmoids of
 * clamped z-scores, so reaching level 1 or 5 requires several of those sigmoids
 * to sit at a joint ~2.4-sigma extreme simultaneously. Averaging independent
 * terms concentrates the result on its mean, so almost everything lands on 3.
 *
 * Measured on 710 tracks of HVSC: 3 of 5 levels ever used, with 81.5% / 93.8% /
 * 90.7% of tracks in a single bucket for e / m / c, and mood carrying 0.397 of
 * the 2.322 bits a five-level scale can hold. A mood filter where 94% of the
 * collection answers "3" cannot build a distinctive station.
 */
function uncalibratedRatingFromRaw(raw: number): number {
  const r = Math.round(1 + 4 * clamp01(raw));
  return clampRating(r);
}

/**
 * Breakpoints splitting a corpus's raw scores into five equally populated levels.
 *
 * Four values per dimension, at the 20th, 40th, 60th and 80th percentiles.
 */
export interface RatingQuantiles {
  c: number[];
  e: number[];
  m: number[];
}

/**
 * Fewer records than this and the percentiles are noise: five levels need enough
 * observations that each breakpoint is estimated from more than a handful of
 * tracks. Below the threshold the uncalibrated mapping is used instead, which is
 * poor but at least not arbitrary.
 */
export const MIN_RECORDS_FOR_RATING_QUANTILES = 50;

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0.5;
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/**
 * Map a raw score to a level by where it falls among the corpus breakpoints.
 *
 * Monotone in `raw`, so the ordering the features produce is preserved exactly —
 * calibration changes only how that ordering is cut into five bands, never which
 * track is more energetic than which. The levels become corpus-relative
 * percentiles: "5" means "in the most energetic fifth of this collection". For a
 * radio station that is the useful reading, because it guarantees every category
 * has material in it by construction.
 */
export function calibratedRatingFromRaw(raw: number, breakpoints: readonly number[]): number {
  let level = 1;
  for (const breakpoint of breakpoints) {
    if (raw > breakpoint) level++;
  }
  return clampRating(level);
}

/**
 * Derive breakpoints from the raw scores of a whole corpus.
 *
 * Ties are not resolvable: if a value is repeated across a breakpoint, every
 * copy lands in the same level and a neighbouring level is left short. That is
 * a property of the data, not of the mapping.
 */
export function buildRatingQuantiles(rawScores: Array<{ c: number; e: number; m: number }>): RatingQuantiles | null {
  if (rawScores.length < MIN_RECORDS_FOR_RATING_QUANTILES) return null;
  const fractions = [0.2, 0.4, 0.6, 0.8];
  const breakpointsFor = (pick: (score: { c: number; e: number; m: number }) => number): number[] => {
    const sorted = rawScores.map(pick).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const breakpoints = fractions.map((fraction) => percentile(sorted, fraction));
    // A dimension with no spread at all cannot be split into fifths, and forcing
    // it through the comparison would drop every track to level 1 -- strictly
    // worse than the neutral 3 the uncalibrated mapping gives. Returning no
    // breakpoints makes that dimension fall back instead.
    if (breakpoints[0] === breakpoints[breakpoints.length - 1]) return [];
    return breakpoints;
  };
  return {
    c: breakpointsFor((s) => s.c),
    e: breakpointsFor((s) => s.e),
    m: breakpointsFor((s) => s.m),
  };
}

/** The continuous scores behind the discrete levels, before any calibration. */
export function computeRawRatingScores(
  model: DeterministicRatingModel,
  features: FeatureVector
): { c: number; e: number; m: number } {
  const { raw } = predictDeterministicRatings(model, features);
  return raw;
}

/**
 * Musical terms available only once pitch is extracted from the register trace.
 *
 * doc/feature-tag-rating-mapping.md section F named the features needed to improve
 * these ratings -- "chroma + key + mode (major/minor)", "predominant melody
 * confidence", "onset rate" -- and deferred the improvement until they existed.
 * They now exist, so the deferral is over.
 */
interface TonalTerms {
  /** Notes per unit time: the density `c` claims to measure but did not. */
  noteDensity: number | undefined;
  /** Simultaneous voices, the other half of textural density. */
  polyphony: number | undefined;
  /** Spread of note lengths: a proxy for rhythmic vocabulary. */
  rhythmicVocabulary: number | undefined;
  /**
   * Major-vs-minor, scaled by how confidently a key was found at all.
   *
   * 0.5 is neutral, above is major, below is minor. Weighting by key confidence
   * matters: an atonal or percussion-only track has no valence to report, and
   * asserting one from a meaningless key estimate would be worse than abstaining.
   */
  valence: number | undefined;
}

function computeTonalTerms(features: FeatureVector): TonalTerms {
  const available = features.sidTonalVariant === "tonal";
  if (!available) {
    return { noteDensity: undefined, polyphony: undefined, rhythmicVocabulary: undefined, valence: undefined };
  }
  const minorness = direct01(features.sidKeyMinorness, 0.5);
  const keyStrength = direct01(features.sidKeyStrength, 0.5);
  // keyStrength maps a correlation onto [0,1] with 0.5 meaning "no tonal centre",
  // so confidence is how far above that it sits.
  const confidence = clamp01((keyStrength - 0.5) * 2);
  return {
    noteDensity: direct01(features.sidNoteRate),
    polyphony: direct01(features.sidPolyphonyMean),
    rhythmicVocabulary: direct01(features.sidNoteDurationEntropy),
    valence: clamp01(0.5 + (0.5 - minorness) * confidence),
  };
}

export function predictDeterministicRatings(
  model: DeterministicRatingModel,
  features: FeatureVector
): { ratings: TagRatings; tags: DeterministicTags; raw: { c: number; e: number; m: number } } {
  const tags = computeDeterministicTags(model, features);
  const tonal = computeTonalTerms(features);

  // Complexity is documented as a "textural/rhythmic density proxy", but measured
  // against the corpus it had a Spearman rho of -0.016 against note rate and -0.019
  // against onset density -- no relationship at all with how many notes a tune
  // actually contains. It was measuring spectral brightness instead (rho 0.64
  // against both centroid and zero-crossing rate). Actual density terms restore the
  // claim; the spectral terms keep their share of the weight because timbral
  // busyness is a real part of perceived complexity.
  const cAvg = weightedAverageTerms([
    { w: 0.22, x: tags.percussive.present ? tags.percussive.value : undefined },
    { w: 0.16, x: tags.tempo_fast.present ? tags.tempo_fast.value : undefined },
    { w: 0.16, x: tags.bright.present ? tags.bright.value : undefined },
    { w: 0.10, x: tags.noisy.present ? tags.noisy.value : undefined },
    { w: 0.20, x: tonal.noteDensity },
    { w: 0.10, x: tonal.polyphony },
    { w: 0.06, x: tonal.rhythmicVocabulary },
  ]);

  const eAvg = weightedAverageTerms([
    { w: 0.40, x: tags.dynamic_loud.present ? tags.dynamic_loud.value : undefined },
    { w: 0.35, x: tags.tempo_fast.present ? tags.tempo_fast.value : undefined },
    { w: 0.25, x: tags.percussive.present ? tags.percussive.value : undefined },
  ]);

  // Mood carried an explicit RESTRICTED CLAIM: with only spectral features it could
  // offer a "smooth/clear vs tense/harsh" axis and deliberately not valence, because
  // major/minor was not observable. It is observable now, so a valence term is added
  // -- weighted by key confidence, so an atonal or percussion-only track abstains
  // rather than being assigned a mood from a meaningless key estimate. The smoothness
  // terms are retained rather than replaced: both contribute to what a listener means
  // by mood, and dropping them would discard a working signal to chase a new one.
  const mAvg = weightedAverageTerms([
    { w: 0.34, x: tags.tonal_clarity.present ? tags.tonal_clarity.value : undefined },
    { w: 0.19, x: tags.percussive.present ? 1 - tags.percussive.value : undefined },
    { w: 0.11, x: tags.bright.present ? 1 - tags.bright.value : undefined },
    { w: 0.11, x: tags.dynamic_loud.present ? 1 - tags.dynamic_loud.value : undefined },
    { w: 0.25, x: tonal.valence },
  ]);

  const cRaw = clamp01(cAvg.present ? cAvg.value : 0.5);
  const eRaw = clamp01(eAvg.present ? eAvg.value : 0.5);
  const mRaw = clamp01(mAvg.present ? mAvg.value : 0.5);

  const quantiles = model.ratingQuantiles;
  const rate = (raw: number, breakpoints: number[] | undefined): number =>
    breakpoints && breakpoints.length > 0
      ? calibratedRatingFromRaw(raw, breakpoints)
      : uncalibratedRatingFromRaw(raw);

  return {
    tags,
    raw: { c: cRaw, e: eRaw, m: mRaw },
    ratings: {
      c: rate(cRaw, quantiles?.c),
      e: rate(eRaw, quantiles?.e),
      m: rate(mRaw, quantiles?.m),
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
