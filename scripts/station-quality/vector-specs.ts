/**
 * Named similarity-vector definitions, so a FEATURE SET can be a candidate.
 *
 * The optimisation loop as inherited could only vary how distances were computed
 * over a fixed 24-dimension vector. That is the smaller half of the problem: if
 * the vector cannot see a musical property, no metric over it can recover that
 * property. Making the vector itself a candidate is what allows the question
 * "would knowing the key help?" to be answered with a measurement instead of an
 * opinion.
 *
 * Each spec is an ordered list of named dimensions. Names matter: they make an
 * ablation interpretable and let the learned-weight output be read as a statement
 * about which musical properties carry the signal.
 */

import {
  buildPerceptualVector,
  type DeterministicRatingModel,
} from "../../packages/sidflow-classify/src/deterministic-ratings.js";
import type { FeatureVector } from "../../packages/sidflow-classify/src/index.js";

/**
 * Names for the 24 dimensions buildPerceptualVector emits, in its own order.
 *
 * Kept as a parallel list rather than derived, because the function returns a
 * bare number[]. The names are checked against the array length at load time so
 * this cannot silently drift out of step with the implementation.
 */
export const SHIPPED_DIMENSION_NAMES = [
  "tempoFused",
  "onsetDensityFused",
  "rhythmicRegularityFused",
  "syncopationSid",
  "arpeggioRateSid",
  "waveTriangleRatio",
  "waveSawRatio",
  "wavePulseRatio",
  "waveNoiseRatio",
  "pwmActivitySid",
  "filterCutoffMeanSid",
  "filterMotionFused",
  "samplePlaybackRate",
  "melodicClarityFused",
  "bassPresenceFused",
  "accompanimentShareSid",
  "voiceRoleEntropySid",
  "adsrPluckRatioSid",
  "adsrPadRatioSid",
  "loudnessFused",
  "dynamicRangeWav",
  "inharmonicityWav",
  "mfccResidual1",
  "mfccResidual2",
] as const;

/**
 * Tonal features admitted to a vector.
 *
 * Deliberately excludes four of the 36 computed tonal features:
 *   sidKeyRoot      nominal. C# is not between C and D; a Euclidean metric would
 *                   read the wrap-around from B to C as the largest possible
 *                   distance. Tonality enters transposition-invariantly instead,
 *                   through the tonic-rotated scale weights.
 *   sidKeyIsMinor   a hard threshold on sidKeyMinorness, which is already here
 *                   and carries strictly more information.
 *   sidChromaticism exactly 1 - sidDiatonicRatio, so it adds a perfectly
 *                   collinear dimension and nothing else.
 *   sidNoteCount    unbounded, and sidNoteRate is its bounded form.
 */
export const TONAL_DIMENSION_NAMES = [
  "sidKeyStrength",
  "sidKeyMinorness",
  "sidKeyStability",
  "sidPitchClassEntropy",
  "sidDiatonicRatio",
  "sidTonicWeight",
  "sidDominantWeight",
  "sidMinorThirdWeight",
  "sidMajorThirdWeight",
  "sidFlatSeventhWeight",
  "sidTritoneWeight",
  "sidMelodicRepeatRatio",
  "sidMelodicStepRatio",
  "sidMelodicThirdRatio",
  "sidMelodicLeapRatio",
  "sidMelodicMeanAbsInterval",
  "sidMelodicRange",
  "sidMelodicAscendingRatio",
  "sidMelodicIntervalEntropy",
  "sidHarmonyUnisonOctaveRatio",
  "sidHarmonySemitoneRatio",
  "sidHarmonyToneRatio",
  "sidHarmonyMinorThirdRatio",
  "sidHarmonyMajorThirdRatio",
  "sidHarmonyFourthRatio",
  "sidHarmonyTritoneRatio",
  "sidNoteDurationMean",
  "sidNoteDurationEntropy",
  "sidNoteRate",
  "sidPolyphonyMean",
] as const;

/**
 * The tonal subset that describes musical CONTENT rather than texture.
 *
 * Separated out so the sweep can distinguish two different claims: that pitch
 * information helps at all, and that all thirty dimensions of it help. Key, mode,
 * scale shape and melodic shape are the properties a listener would name when
 * asked why two tunes sound alike.
 */
export const TONAL_CORE_NAMES = [
  "sidKeyStrength",
  "sidKeyMinorness",
  "sidKeyStability",
  "sidPitchClassEntropy",
  "sidDiatonicRatio",
  "sidMinorThirdWeight",
  "sidMajorThirdWeight",
  "sidMelodicStepRatio",
  "sidMelodicLeapRatio",
  "sidMelodicMeanAbsInterval",
  "sidMelodicRange",
  "sidHarmonyMinorThirdRatio",
  "sidHarmonyMajorThirdRatio",
  "sidNoteRate",
  "sidPolyphonyMean",
] as const;

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

function tonalValue(features: FeatureVector, name: string): number {
  const value = features[name];
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : 0;
}

export interface VectorSpec {
  name: string;
  rationale: string;
  dimensionNames: string[];
  build: (model: DeterministicRatingModel, features: FeatureVector) => number[];
}

function shippedDimensions(model: DeterministicRatingModel, features: FeatureVector): number[] {
  const vector = buildPerceptualVector(model, features);
  if (vector.length !== SHIPPED_DIMENSION_NAMES.length) {
    throw new Error(
      `buildPerceptualVector returned ${vector.length} dimensions but SHIPPED_DIMENSION_NAMES has ` +
        `${SHIPPED_DIMENSION_NAMES.length}; update the name list so ablations stay interpretable.`,
    );
  }
  return vector;
}

/** A spec combining a subset of the shipped dimensions with a set of tonal ones. */
export function makeSpec(
  name: string,
  rationale: string,
  shippedNames: readonly string[],
  tonalNames: readonly string[],
): VectorSpec {
  const shippedIndices = shippedNames.map((wanted) => {
    const index = SHIPPED_DIMENSION_NAMES.indexOf(wanted as (typeof SHIPPED_DIMENSION_NAMES)[number]);
    if (index < 0) throw new Error(`unknown shipped dimension: ${wanted}`);
    return index;
  });
  return {
    name,
    rationale,
    dimensionNames: [...shippedNames, ...tonalNames],
    build: (model, features) => {
      const shipped = shippedIndices.length > 0 ? shippedDimensions(model, features) : [];
      const out: number[] = [];
      for (const index of shippedIndices) out.push(shipped[index]!);
      for (const tonal of tonalNames) out.push(tonalValue(features, tonal));
      return out;
    },
  };
}

export const SHIPPED_SPEC: VectorSpec = makeSpec(
  "shipped 24-dim",
  "what ships today; the baseline every other spec is measured against",
  SHIPPED_DIMENSION_NAMES,
  [],
);

export function buildVectorSpecs(): VectorSpec[] {
  return [
    SHIPPED_SPEC,
    makeSpec(
      "shipped + tonal core",
      "does key, mode and melodic shape add anything the spectral/register vector lacks?",
      SHIPPED_DIMENSION_NAMES,
      TONAL_CORE_NAMES,
    ),
    makeSpec(
      "shipped + tonal all",
      "or does the full tonal set help beyond the curated core?",
      SHIPPED_DIMENSION_NAMES,
      TONAL_DIMENSION_NAMES,
    ),
    makeSpec(
      "tonal only",
      "ablation: how much does pitch carry on its own? bounds how much of any gain is really tonal",
      [],
      TONAL_DIMENSION_NAMES,
    ),
  ];
}
