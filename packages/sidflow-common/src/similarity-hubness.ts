/**
 * Hubness correction for neighbour selection.
 *
 * ## Why a correction is needed
 *
 * In high-dimensional spaces a few points become an unreasonable number of other points'
 * nearest neighbour. It is well documented in music similarity, and it is present here:
 * measured on the published full export at k=25, in-degree reaches **217** against a mean of
 * 25, and **456 tracks (0.52%)** have no incoming edge at all and can never be recommended by
 * anything. A listener experiences the first half of that as the same handful of tunes turning
 * up in every station.
 *
 * ## Mutual proximity
 *
 * Mutual proximity (Schnitzer et al.) re-expresses a distance as the probability that two
 * points are close *to each other* given each one's own distance distribution:
 *
 *     MP(x, y) = P(d(x, ·) > d(x, y)) * P(d(y, ·) > d(y, x))
 *
 * modelled with a Gaussian per point. A hub is close to everything, so its distance
 * distribution is shifted low and being close to it stops being remarkable; the correction
 * therefore costs a hub its unearned edges without a threshold or a cap.
 *
 * `scripts/station-quality/techniques.ts` already implements this for the evaluation harness,
 * over a full distance matrix. That cannot run at corpus scale — 87,868 squared is 7.7 billion
 * pairs — so the moments are estimated here from a deterministic random sample of each track's
 * distances instead. The sample is an unbiased estimator of the same mean and standard
 * deviation the exhaustive version computes, which is the only thing the Gaussian model uses.
 * Estimating them from the k-nearest distances instead would be cheaper still and wrong: those
 * are the smallest 25 of 87,867 and describe the tail, not the distribution.
 */

export interface MutualProximityOptions {
  trackCount: number;
  /** Weighted cosine between two track ordinals. */
  similarityBetween: (left: number, right: number) => number;
  /**
   * Distances sampled per track to estimate its mean and standard deviation.
   *
   * 256 keeps the standard error of the mean near a fortieth of the standard deviation, which
   * is far finer than the correction needs, at 22.5 million similarity evaluations over the
   * HVSC corpus.
   */
  sampleSize?: number;
  /** Sampling seed, so a bundle is reproducible from its source export. */
  seed?: number;
}

export interface MutualProximityModel {
  /** Mean sampled distance per track. */
  mean: Float64Array;
  /** Sampled standard deviation of distance per track. */
  standardDeviation: Float64Array;
  /**
   * Mutual-proximity distance between two tracks: `1 - MP(left, right)`.
   *
   * Suitable as a `SelectionDistance`. It changes which edges are chosen and never what the
   * exported similarity byte means.
   */
  distance: (left: number, right: number, similarity?: number) => number;
}

const DEFAULT_SAMPLE_SIZE = 256;
const DEFAULT_SEED = 20_260_730;

/** Abramowitz & Stegun 7.1.26, as used by the station-quality harness. */
function erf(value: number): number {
  const sign = Math.sign(value);
  const absolute = Math.abs(value);
  const t = 1 / (1 + (0.327_591_1 * absolute));
  const y = 1
    - (((((((1.061_405_429 * t) - 1.453_152_027) * t) + 1.421_413_741) * t - 0.284_496_736) * t)
      + 0.254_829_592) * t * Math.exp(-absolute * absolute);
  return sign * y;
}

/** P(X > d) for X ~ Normal(mean, sd). */
function survival(distance: number, mean: number, standardDeviation: number): number {
  return 0.5 * (1 - erf((distance - mean) / (standardDeviation * Math.SQRT2)));
}

/**
 * Fit the per-track distance moments and return the corrected distance.
 *
 * Deterministic: each track's sample is drawn from a PRNG seeded by the track ordinal, so the
 * model does not depend on the order tracks are visited in and reproduces exactly.
 */
export function buildMutualProximityModel(options: MutualProximityOptions): MutualProximityModel {
  const { trackCount, similarityBetween } = options;
  const sampleSize = Math.min(options.sampleSize ?? DEFAULT_SAMPLE_SIZE, Math.max(trackCount - 1, 1));
  const seed = options.seed ?? DEFAULT_SEED;

  const mean = new Float64Array(trackCount);
  const standardDeviation = new Float64Array(trackCount);

  for (let track = 0; track < trackCount; track += 1) {
    let state = (seed ^ Math.imul(track + 1, 0x9e_37_79_b9)) >>> 0;
    const nextOrdinal = (): number => {
      state = (state + 0x6d_2b_79_f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) % trackCount;
    };
    let total = 0;
    let totalSquares = 0;
    let drawn = 0;
    // Sampling with replacement and skipping the track itself. With 87,868 tracks and 256
    // draws a repeat is possible and harmless: the estimator stays unbiased either way.
    let attempts = 0;
    while (drawn < sampleSize && attempts < sampleSize * 4) {
      attempts += 1;
      const other = nextOrdinal();
      if (other === track) {
        continue;
      }
      const distance = 1 - similarityBetween(track, other);
      total += distance;
      totalSquares += distance * distance;
      drawn += 1;
    }
    if (drawn === 0) {
      mean[track] = 0;
      standardDeviation[track] = 1e-9;
      continue;
    }
    const sampleMean = total / drawn;
    const variance = Math.max(0, (totalSquares / drawn) - (sampleMean * sampleMean));
    mean[track] = sampleMean;
    standardDeviation[track] = Math.sqrt(variance) || 1e-9;
  }

  const distance = (left: number, right: number, similarity?: number): number => {
    const raw = 1 - (similarity ?? similarityBetween(left, right));
    const probability = survival(raw, mean[left]!, standardDeviation[left]!)
      * survival(raw, mean[right]!, standardDeviation[right]!);
    return 1 - probability;
  };

  return { mean, standardDeviation, distance };
}

export interface LocalScalingOptions {
  trackCount: number;
  /**
   * Per-track candidate lists in descending similarity, used to read each track's distance to
   * its k-th nearest neighbour.
   */
  candidates: ReadonlyArray<ReadonlyArray<{ trackOrdinal: number; similarity: number }>>;
  similarityBetween: (left: number, right: number) => number;
  /** Which neighbour's distance sets the local scale. */
  k?: number;
}

/**
 * Local scaling (Zelnik-Manor & Perona), the obvious alternative to mutual proximity.
 *
 * Divides each distance by the geometric mean of the two points' distances to their k-th
 * nearest neighbour, so a point sitting in a dense region has its distances inflated and stops
 * dominating. Cheaper than mutual proximity — it needs only the candidate lists, no sampling —
 * and included so the choice between them is made by measurement rather than by assumption.
 */
export function buildLocalScalingDistance(options: LocalScalingOptions): {
  scale: Float64Array;
  distance: (left: number, right: number, similarity?: number) => number;
} {
  const { trackCount, candidates, similarityBetween } = options;
  const k = options.k ?? 7;
  const scale = new Float64Array(trackCount);
  for (let track = 0; track < trackCount; track += 1) {
    const list = candidates[track] ?? [];
    const chosen = list[Math.min(k - 1, list.length - 1)];
    scale[track] = chosen === undefined ? 1 : Math.max(1 - chosen.similarity, 1e-9);
  }
  const distance = (left: number, right: number, similarity?: number): number => {
    const raw = 1 - (similarity ?? similarityBetween(left, right));
    return raw / Math.sqrt(scale[left]! * scale[right]!);
  };
  return { scale, distance };
}
