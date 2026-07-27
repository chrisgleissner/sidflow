/**
 * Representations, re-rankings and sampling for the station-quality loop.
 *
 * Extracted from optimise.ts so it can be unit-tested. optimise.ts runs its whole
 * experiment as a side effect of being imported, which makes anything defined
 * inside it untestable; several functions here were rewritten into sparse or
 * bounded-selection forms to survive a 20k-track corpus, and a rewrite that
 * changes the ranking while claiming only to be faster is exactly the kind of
 * silent error this project cannot afford.
 *
 * Nothing here knows about the protocol, the split, or the metrics. It maps
 * tracks to vectors, or distances to distances.
 */

import { groupOf, type Track } from "./metrics.js";
import { distanceMatrix, euclidean, makeRanker, ndcgAtK, topKPerRow } from "./harness.js";

// ------------------------------------------------------------------- sampling

/**
 * Salted FNV-1a followed by a MurmurHash3 avalanche finaliser.
 *
 * The salt is not cosmetic. If subsampling ordered groups by the SAME hash the
 * split uses, then taking a prefix of that order would select exactly the groups
 * whose hash falls low — and splitByGroup sends low hashes to `train`. The
 * subsample would arrive with an empty validation and test set. Two independent
 * hashes keep selection and assignment orthogonal.
 *
 * The finaliser is not cosmetic either. Bare FNV-1a has weak avalanche, and HVSC
 * group names share long common suffixes ("MUSICIANS/H/Hubbard_Rob" and
 * "GAMES/H/Hunter" differ mostly in their prefix). Sorting by the raw FNV value
 * therefore clusters groups by tree: measured on an HVSC-shaped corpus, the
 * DEMOS count in the sample stayed pinned at exactly 96 tracks while the sample
 * grew from 500 to 3000, because several hundred consecutive positions in the
 * hashed order contained no DEMOS group at all. That is a biased sample wearing
 * a hash's clothing. fmix32 diffuses every input bit across all 32 output bits,
 * which is what ordering — as opposed to modulo bucketing — actually requires.
 *
 * splitByGroup's own hash is deliberately left alone: it only ever takes
 * `hash % 10000`, and that IS uniform per tree (measured 50/25/25 within each of
 * DEMOS, GAMES and MUSICIANS), so it has no such defect to fix.
 */
export function saltedHash(value: string): number {
  let h = 0x811c9dc5;
  const salted = `subsample|${value}`;
  for (let i = 0; i < salted.length; i++) {
    h ^= salted.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // MurmurHash3 fmix32.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Draw whole groups until `limit` tracks are collected.
 *
 * Ordered by a hash of the group name, not alphabetically. Alphabetical order is
 * not a sample, it is a prefix: group names begin with DEMOS/, GAMES/ or
 * MUSICIANS/, so sorting by name and taking the first 20k of ~87k tracks yields
 * all of DEMOS, part of GAMES, and not one track from MUSICIANS — the tree that
 * carries most of the corpus and the strongest composer labels. Hashing draws
 * groups uniformly across all three trees while still keeping each group whole,
 * and stays deterministic across runs and machines.
 *
 * Groups are kept whole because the label structure IS several tunes per
 * composer; sampling individual tracks would strand most composers with one tune
 * and destroy the signal being measured.
 */
export function subsampleByGroup(tracks: Track[], limit: number): Track[] {
  if (tracks.length <= limit) return tracks;
  const groups = new Map<string, Track[]>();
  for (const t of tracks) {
    const g = groupOf(t.sidPath) ?? `__ungrouped__/${t.sidPath}`;
    groups.set(g, [...(groups.get(g) ?? []), t]);
  }
  const ordered = [...groups.entries()].sort(
    (a, b) => saltedHash(a[0]) - saltedHash(b[0]) || a[0].localeCompare(b[0]),
  );
  const out: Track[] = [];
  for (const [, members] of ordered) {
    // Stop at the first group that does not fit, rather than skipping it and
    // continuing. Skipping looks harmless — it packs the sample closer to the
    // limit — but it only ever admits groups SMALL enough to fit the remaining
    // space, so near the boundary it systematically prefers small groups and the
    // sample's group-size distribution drifts away from the corpus's. Taking a
    // prefix of a randomly ordered list keeps every group's inclusion
    // probability equal, which makes the sampled TRACK distribution match the
    // corpus in expectation. The cost is ending up to one group short of the
    // limit, which is immaterial.
    if (out.length + members.length > limit) break;
    out.push(...members);
  }
  return out;
}

/** Which HVSC trees the sample actually drew from, so the sample is auditable. */
export function treeComposition(tracks: Track[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of tracks) {
    const tree = groupOf(t.sidPath)?.split("/")[0] ?? "ungrouped";
    counts[tree] = (counts[tree] ?? 0) + 1;
  }
  return counts;
}

// ------------------------------------------------------------ representations

/** The per-dimension weights the shipped similarity path uses today. */
export const SHIPPED_WEIGHTS = [
  1.1, 1.1, 1.2, 1.0, 1.0, 0.9, 0.9, 0.9, 1.0, 0.9, 0.8, 1.1,
  1.2, 1.2, 1.1, 0.8, 0.8, 0.9, 0.9, 1.0, 0.9, 0.9, 0.7, 0.7,
];

export const raw = (tracks: Track[]): Float64Array[] => tracks.map((t) => Float64Array.from(t.vector));

export function weighted(tracks: Track[], weights = SHIPPED_WEIGHTS): Float64Array[] {
  return tracks.map((t) => Float64Array.from(t.vector.map((v, i) => v * Math.sqrt(weights[i] ?? 1))));
}

export function columnStats(tracks: Track[]): { mu: Float64Array; sd: Float64Array } {
  const d = tracks[0]!.vector.length;
  const n = tracks.length;
  const mu = new Float64Array(d);
  const sd = new Float64Array(d);
  for (const t of tracks) for (let i = 0; i < d; i++) mu[i]! += t.vector[i]! / n;
  for (const t of tracks) for (let i = 0; i < d; i++) sd[i]! += (t.vector[i]! - mu[i]!) ** 2 / n;
  for (let i = 0; i < d; i++) sd[i] = Math.sqrt(sd[i]!) || 1;
  return { mu, sd };
}

export function zscore(tracks: Track[]): Float64Array[] {
  const { mu, sd } = columnStats(tracks);
  return tracks.map((t) => Float64Array.from(t.vector.map((v, i) => (v - mu[i]!) / sd[i]!)));
}

/** Acklam's inverse-normal approximation; accurate to ~1e-9, ample here. */
export function probit(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const dd = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((dd[0]! * q + dd[1]!) * q + dd[2]!) * q + dd[3]!) * q + 1);
  }
  if (p > 1 - pl) return -probit(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/**
 * Rank-Gaussian: map each dimension to its within-corpus rank, then to a normal
 * quantile. Removes skew and makes dimensions genuinely comparable, which plain
 * z-scoring does not do for heavy-tailed features.
 *
 * Tied values receive the AVERAGE of the ranks they span (midranks), which is the
 * standard rank transform and is not a detail. SID features are full of ties:
 * sample-playback activity, tritone weight and several waveform ratios are exactly
 * zero for most of the corpus. Handing those ties consecutive ranks — as any
 * index-tie-broken sort does — spreads a single repeated value across the whole
 * quantile range in TRACK ORDER, turning the corpus's arbitrary file ordering into
 * a gradient the distance function can see. A perfectly constant dimension would
 * become a perfect ramp, i.e. pure fabricated signal. Midranks collapse each tie
 * group to one value, so a constant dimension contributes exactly nothing.
 */
export function rankGaussian(tracks: Track[]): Float64Array[] {
  const n = tracks.length;
  const d = tracks[0]!.vector.length;
  const out = tracks.map(() => new Float64Array(d));
  const order = new Int32Array(n);
  const column = new Float64Array(n);
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < n; j++) {
      order[j] = j;
      column[j] = tracks[j]!.vector[i]!;
    }
    // Sorting indices in a typed array avoids allocating n objects per dimension.
    order.sort((x, y) => column[x]! - column[y]! || x - y);
    let start = 0;
    while (start < n) {
      let end = start;
      while (end + 1 < n && column[order[end + 1]!]! === column[order[start]!]!) end++;
      // Mean quantile position across the tie group, then one probit for all of it.
      let sum = 0;
      for (let rank = start; rank <= end; rank++) sum += (rank + 0.5) / n;
      const value = probit(sum / (end - start + 1));
      for (let rank = start; rank <= end; rank++) out[order[rank]!]![i] = value;
      start = end + 1;
    }
  }
  return out;
}

/**
 * Rank-UNIFORM: the same rank transform, mapped to [0, 1] instead of to a normal
 * quantile.
 *
 * Exists for a blunt engineering reason. Rank-Gaussian centres every dimension on
 * zero, so cosine similarity over the result spans [-1, 1] with unrelated tracks
 * near 0. The rest of the product is calibrated for cosine over NON-NEGATIVE
 * vectors, where "similar" means roughly 0.9 and up: the adventure-radius model
 * applies an absolute minimum-similarity threshold, and the tiny profile quantises
 * each edge similarity into one byte. Centring the vectors silently invalidates
 * every one of those absolute numbers — measured effect, a station asked for 20
 * tracks returned 14, because most candidates no longer cleared the threshold.
 *
 * Keeping the values in [0, 1] preserves the similarity scale the downstream
 * thresholds were tuned against, so the representation can change without
 * re-deriving the entire station model. Whether it costs retrieval quality is a
 * question for measurement, not for taste.
 *
 * Ties take the mean of their quantile positions, for the same reason as
 * rankGaussian: consecutive ranks for tied values would leak corpus order.
 */
export function rankUniform(tracks: Track[]): Float64Array[] {
  const n = tracks.length;
  const d = tracks[0]!.vector.length;
  const out = tracks.map(() => new Float64Array(d));
  const order = new Int32Array(n);
  const column = new Float64Array(n);
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < n; j++) {
      order[j] = j;
      column[j] = tracks[j]!.vector[i]!;
    }
    order.sort((x, y) => column[x]! - column[y]! || x - y);
    let start = 0;
    while (start < n) {
      let end = start;
      while (end + 1 < n && column[order[end + 1]!]! === column[order[start]!]!) end++;
      let sum = 0;
      for (let rank = start; rank <= end; rank++) sum += (rank + 0.5) / n;
      const value = sum / (end - start + 1);
      for (let rank = start; rank <= end; rank++) out[order[rank]!]![i] = value;
      start = end + 1;
    }
  }
  return out;
}

/**
 * PCA whitening. Decorrelates the dimensions and equalises their variance, so no
 * group of correlated features silently dominates the distance.
 *
 * Rank is truncated RELATIVE to the largest eigenvalue, which is the whole
 * difficulty with whitening. Dividing each component by the square root of its
 * variance is the point of the transform, but it means a direction with almost no
 * variance gets multiplied by an almost unbounded factor — and after deflation,
 * the directions past the true rank contain nothing but floating-point residue.
 * Amplifying those turns rounding error into the dominant term of every distance.
 *
 * Measured with the previous absolute cutoff (keep while lambda >= 1e-9, then
 * divide by sqrt(lambda + 1e-6)): appending fifteen CONSTANT dimensions to a
 * 24-dimension corpus made it retain 31 components and inflated the mean pairwise
 * distance from 6.9 to 3539. The extra dimensions carried no information at all,
 * so every bit of that was noise, and it silently changed which neighbours the
 * candidate proposed. This matters for the real vector too, whose waveform ratios
 * and voice-role ratios each sum to roughly one and are therefore close to
 * collinear by construction.
 */
export function whiten(tracks: Track[]): Float64Array[] {
  const z = zscore(tracks);
  const n = z.length;
  const d = z[0]!.length;
  const cov: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  for (const v of z) {
    for (let i = 0; i < d; i++) for (let j = i; j < d; j++) cov[i]![j]! += (v[i]! * v[j]!) / n;
  }
  for (let i = 0; i < d; i++) for (let j = 0; j < i; j++) cov[i]![j] = cov[j]![i]!;

  // Power iteration with deflation; d is a few dozen, so this is cheap and adequate.
  const comps: Float64Array[] = [];
  const vals: number[] = [];
  let work = cov.map((r) => [...r]);
  // For z-scored input the total variance is known exactly: it is the trace, i.e.
  // the number of dimensions that vary at all. That gives an absolute yardstick
  // for "this component explains nothing", which a threshold relative to the
  // LEADING eigenvalue does not -- deflation error accumulates, so the residual
  // directions past the true rank are far larger than machine epsilon and slip
  // past any purely relative cutoff.
  const trace = cov.reduce((sum, row, i) => sum + row[i]!, 0);
  let explained = 0;
  for (let k = 0; k < d; k++) {
    let v = new Float64Array(d).fill(1 / Math.sqrt(d));
    let lambda = 0;
    for (let it = 0; it < 200; it++) {
      const w = new Float64Array(d);
      for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) w[i]! += work[i]![j]! * v[j]!;
      const norm = Math.hypot(...w);
      if (norm < 1e-12) break;
      for (let i = 0; i < d; i++) w[i]! /= norm;
      v = w;
      lambda = norm;
    }
    // Drop directions that explain a negligible share of the known total
    // variance, and stop once essentially all of it is accounted for.
    if (lambda <= 0 || lambda < trace * 1e-7) break;
    if (explained >= trace * (1 - 1e-6)) break;
    explained += lambda;
    comps.push(v);
    vals.push(lambda);
    work = work.map((row, i) => row.map((c, j) => c - lambda * v[i]! * v[j]!));
  }

  return z.map((vec) => {
    const out = new Float64Array(comps.length);
    for (let k = 0; k < comps.length; k++) {
      let dot = 0;
      for (let i = 0; i < d; i++) dot += vec[i]! * comps[k]![i]!;
      // No additive floor: the retained eigenvalues are bounded away from zero by
      // the truncation above, so this is the exact whitening scale.
      out[k] = dot / Math.sqrt(vals[k]!);
    }
    return out;
  });
}

/** Scale a representation by per-dimension weights (in squared-distance units). */
export function applyWeights(vectors: Float64Array[], weights: number[]): Float64Array[] {
  return vectors.map((vec) => Float64Array.from(vec.map((x, i) => x * Math.sqrt(Math.max(0, weights[i] ?? 1)))));
}

// --------------------------------------------------------------- re-rankings

/**
 * Mutual proximity: the standard fix for HUBNESS, where a few tracks become
 * everyone's nearest neighbour purely as an artefact of high-dimensional space.
 * Hubness is well documented in music similarity and quietly wrecks stations —
 * the same handful of tunes surface everywhere. MP re-expresses each distance as
 * the probability that the two points are mutually close, given the distance
 * distributions of both.
 */
export function mutualProximity(distances: Float64Array[]): Float64Array[] {
  const n = distances.length;
  const mu = new Float64Array(n);
  const sd = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = distances[i]!;
    let sum = 0;
    for (let j = 0; j < n; j++) if (i !== j) sum += row[j]!;
    const count = n - 1;
    mu[i] = sum / count;
    let variance = 0;
    for (let j = 0; j < n; j++) if (i !== j) variance += (row[j]! - mu[i]!) ** 2;
    sd[i] = Math.sqrt(variance / count) || 1e-9;
  }
  // Gaussian CDF via erf approximation (Abramowitz & Stegun 7.1.26).
  const erf = (x: number): number => {
    const s = Math.sign(x);
    const a = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * a);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return s * y;
  };
  const sf = (d: number, m: number, s: number) => 0.5 * (1 - erf((d - m) / (s * Math.SQRT2)));

  const out: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = sf(distances[i]![j]!, mu[i]!, sd[i]!) * sf(distances[i]![j]!, mu[j]!, sd[j]!);
      const d = 1 - p;
      out[i]![j] = d;
      out[j]![i] = d;
    }
  }
  return out;
}

/**
 * k-reciprocal re-ranking (Zhong et al., CVPR 2017), simplified.
 *
 * Two tracks are more likely genuinely similar if each appears in the other's
 * neighbourhood. Blends the original distance with a Jaccard distance over
 * reciprocal neighbour sets.
 */
export function kReciprocal(distances: Float64Array[], k = 20, lambda = 0.3): Float64Array[] {
  const n = distances.length;
  const knn = topKPerRow(distances, k);
  const sets = knn.map((list) => new Set(list));
  // Reciprocal set of i: the neighbours that also count i among their own.
  const reciprocal = knn.map((list, i) => Int32Array.from([...list].filter((j) => sets[j]!.has(i))));

  const out: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));

  // Almost every pair of reciprocal sets is disjoint, and a disjoint pair has
  // Jaccard distance exactly 1 regardless of the sets' contents. So fill every
  // pair with the disjoint answer first, then correct only the pairs that
  // genuinely share a member. Comparing all n^2/2 pairs directly costs ~1e9 set
  // probes at corpus scale; the shared-member pairs number a few million.
  for (let i = 0; i < n; i++) {
    const row = out[i]!;
    const dRow = distances[i]!;
    for (let j = i + 1; j < n; j++) row[j] = lambda * dRow[j]! + (1 - lambda);
  }

  // Inverted index: which reciprocal sets contain each member.
  const holders: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (const member of reciprocal[i]!) holders[member]!.push(i);

  const interCount = new Int32Array(n);
  const touched = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const mine = reciprocal[i]!;
    if (mine.length === 0) continue;
    let touchedCount = 0;
    for (const member of mine) {
      for (const j of holders[member]!) {
        if (j <= i) continue;
        if (interCount[j] === 0) touched[touchedCount++] = j;
        interCount[j]!++;
      }
    }
    for (let t = 0; t < touchedCount; t++) {
      const j = touched[t]!;
      const inter = interCount[j]!;
      interCount[j] = 0;
      const union = mine.length + reciprocal[j]!.length - inter;
      const jaccard = union === 0 ? 1 : 1 - inter / union;
      out[i]![j] = lambda * distances[i]![j]! + (1 - lambda) * jaccard;
    }
  }

  // Mirror once, at the end, rather than writing both triangles throughout.
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out[j]![i] = out[i]![j]!;
  return out;
}

/** alpha-query expansion: pull the query toward its confident neighbours. */
export function queryExpansion(
  vectors: Float64Array[],
  distances: Float64Array[],
  k = 3,
  alpha = 1.5,
): Float64Array[] {
  const d = vectors[0]!.length;
  const nearest = topKPerRow(distances, k);
  return vectors.map((v, i) => {
    const out = new Float64Array(d);
    for (let x = 0; x < d; x++) out[x] = v[x]!;
    let weightSum = 1;
    for (const j of nearest[i]!) {
      const w = Math.pow(1 / (1 + distances[i]![j]!), alpha);
      for (let x = 0; x < d; x++) out[x]! += w * vectors[j]![x]!;
      weightSum += w;
    }
    for (let x = 0; x < d; x++) out[x]! /= weightSum;
    return out;
  });
}

// ------------------------------------------------------------ learned weights

/**
 * Coordinate ascent on per-dimension weights, maximising train nDCG@k.
 *
 * Deliberately a diagonal metric rather than a full projection: with a few
 * thousand tracks a full matrix would overfit badly, and a diagonal weighting is
 * both regularised by construction and interpretable — you can read off which
 * features matter.
 */
export function learnWeights(
  tracks: Track[],
  base: (t: Track[]) => Float64Array[],
  k: number,
  steps: number[] = [0.5, 0.25],
): number[] {
  const vectors = base(tracks);
  const d = vectors[0]!.length;
  let weights = new Array<number>(d).fill(1);

  const score = (w: number[]): number => {
    const scaled = applyWeights(vectors, w);
    const dist = distanceMatrix(scaled, euclidean);
    return ndcgAtK(tracks, makeRanker(tracks, dist), k).mean;
  };

  let best = score(weights);
  for (const step of steps) {
    for (let i = 0; i < d; i++) {
      for (const delta of [1 + step, 1 - step]) {
        const trial = [...weights];
        trial[i] = Math.max(0, trial[i]! * delta);
        const s = score(trial);
        if (s > best + 1e-6) {
          best = s;
          weights = trial;
        }
      }
    }
  }
  return weights;
}

// ------------------------------------------------------- supervised metric

/**
 * Symmetric eigendecomposition by cyclic Jacobi rotations.
 *
 * Chosen over anything cleverer because d is a few dozen, Jacobi is
 * unconditionally stable for symmetric input, and it returns a genuinely
 * orthogonal eigenvector basis — which matters here, since the result is used to
 * form an inverse square root and any loss of orthogonality would show up as an
 * asymmetric distance.
 */
export function jacobiEigen(
  input: readonly number[][],
  sweeps = 100,
): { values: number[]; vectors: number[][] } {
  const d = input.length;
  const a = input.map((row) => [...row]);
  const v: number[][] = Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) => (i === j ? 1 : 0)),
  );

  for (let sweep = 0; sweep < sweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < d; p++) for (let q = p + 1; q < d; q++) off += a[p]![q]! ** 2;
    if (off < 1e-22) break;

    for (let p = 0; p < d; p++) {
      for (let q = p + 1; q < d; q++) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-18) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < d; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < d; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < d; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }

  return { values: Array.from({ length: d }, (_, i) => a[i]![i]!), vectors: v };
}

/**
 * Within-class covariance normalisation, fitted on labelled TRAIN data.
 *
 * Every other representation here is unsupervised: it can equalise scales, remove
 * skew or decorrelate, but it has no idea which directions distinguish one
 * composer from another. Learned diagonal weights are the first supervised step,
 * and they can only rescale the existing axes. WCCN is the full-covariance
 * version: it estimates how tracks vary WITHIN a group and shrinks exactly those
 * directions, so what survives is the between-group structure. A direction along
 * which one composer's own tunes already differ wildly is, by construction, a
 * poor witness that two tunes share a composer.
 *
 * Fitted on train only, then applied unchanged to validation and test, so no
 * label information from the evaluated slice can leak into the transform.
 *
 * Shrinkage toward a scaled identity is not optional. With d dimensions the
 * within-class covariance needs many more than d observations per direction to be
 * estimated stably, and most HVSC groups contribute only a handful of tunes; an
 * unregularised inverse would amplify whichever directions happen to be
 * underdetermined, which is the same failure whitening had.
 */
export function fitWithinClassWhitening(
  trainVectors: Float64Array[],
  groups: readonly string[],
  shrinkage = 0.2,
): number[][] {
  const d = trainVectors[0]!.length;
  const byGroup = new Map<string, number[]>();
  for (let i = 0; i < trainVectors.length; i++) {
    const key = groups[i]!;
    const list = byGroup.get(key);
    if (list) list.push(i);
    else byGroup.set(key, [i]);
  }

  const within: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  let contributing = 0;
  for (const indices of byGroup.values()) {
    // A group of one has no within-group variation to observe.
    if (indices.length < 2) continue;
    const mean = new Float64Array(d);
    for (const i of indices) for (let k = 0; k < d; k++) mean[k]! += trainVectors[i]![k]! / indices.length;
    for (const i of indices) {
      const vector = trainVectors[i]!;
      for (let p = 0; p < d; p++) {
        const dp = vector[p]! - mean[p]!;
        for (let q = p; q < d; q++) within[p]![q]! += (dp * (vector[q]! - mean[q]!)) / indices.length;
      }
    }
    contributing++;
  }
  if (contributing === 0) {
    return Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? 1 : 0)));
  }
  for (let p = 0; p < d; p++) {
    for (let q = p; q < d; q++) {
      const value = within[p]![q]! / contributing;
      within[p]![q] = value;
      within[q]![p] = value;
    }
  }

  // Shrink toward a scaled identity of the same total variance.
  let trace = 0;
  for (let i = 0; i < d; i++) trace += within[i]![i]!;
  const target = trace / d || 1;
  for (let p = 0; p < d; p++) {
    for (let q = 0; q < d; q++) {
      within[p]![q] = (1 - shrinkage) * within[p]![q]! + (p === q ? shrinkage * target : 0);
    }
  }

  const { values, vectors } = jacobiEigen(within);
  // Floor eigenvalues relative to the largest, for the same reason whitening
  // truncates: dividing by a near-zero variance amplifies noise without bound.
  const largest = Math.max(...values.map((v) => Math.abs(v)));
  const floor = Math.max(largest * 1e-6, 1e-12);
  const scale = values.map((v) => 1 / Math.sqrt(Math.max(v, floor)));

  // W^(-1/2) = V diag(scale) V^T
  const out: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      let sum = 0;
      for (let k = 0; k < d; k++) sum += vectors[i]![k]! * scale[k]! * vectors[j]![k]!;
      out[i]![j] = sum;
    }
  }
  return out;
}

/** Apply a d x d linear map to every vector. */
export function applyLinearMap(vectors: Float64Array[], matrix: readonly number[][]): Float64Array[] {
  const d = matrix.length;
  return vectors.map((vector) => {
    const out = new Float64Array(d);
    for (let i = 0; i < d; i++) {
      let sum = 0;
      for (let j = 0; j < d; j++) sum += matrix[i]![j]! * vector[j]!;
      out[i] = sum;
    }
    return out;
  });
}
