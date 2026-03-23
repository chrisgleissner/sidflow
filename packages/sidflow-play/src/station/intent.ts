/**
 * Multi-centroid intent model for station generation.
 *
 * Detects when a user's rated tracks span distinct perceptual clusters and
 * produces separate centroids so station generation can serve both preference
 * regions coherently instead of averaging them into a meaningless midpoint.
 *
 * Algorithm:
 *  1. Compute pairwise cosine distances between all positively-rated tracks.
 *  2. If the maximum pairwise cosine distance exceeds CLUSTER_SPLIT_THRESHOLD
 *     (indicating perceptually diverse tastes), run k-means with k=2.
 *  3. Return 2 centroids with per-cluster track lists for interleaved station
 *     generation.  Otherwise return a single centroid as before.
 */

/** Cosine distance above which we consider the preference space "bimodal". */
export const CLUSTER_SPLIT_THRESHOLD = 0.5;

/** Minimum rated tracks required to attempt clustering. */
export const CLUSTER_MIN_TRACKS = 4;

/** Maximum k-means iterations. */
const KMEANS_MAX_ITER = 50;

// ---------------------------------------------------------------------------
// Pure math helpers
// ---------------------------------------------------------------------------

function dotProduct(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

function norm(a: number[]): number {
  return Math.sqrt(dotProduct(a, a));
}

/** Cosine similarity in [0, 1]. Returns 0 for zero-norm vectors. */
export function cosineSim(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return Math.max(-1, Math.min(1, dotProduct(a, b) / (na * nb)));
}

/** Cosine distance in [0, 2]. */
export function cosineDist(a: number[], b: number[]): number {
  return 1 - cosineSim(a, b);
}

/** Weighted average of vectors. Returns zero vector for empty list. */
export function weightedCentroid(vectors: number[][], weights: number[]): number[] {
  if (vectors.length === 0) return [];
  const dims = vectors[0]!.length;
  const out = new Array<number>(dims).fill(0);
  let totalW = 0;
  for (let i = 0; i < vectors.length; i++) {
    const w = weights[i] ?? 1;
    totalW += w;
    const v = vectors[i]!;
    for (let d = 0; d < dims; d++) {
      out[d]! += (v[d] ?? 0) * w;
    }
  }
  if (totalW > 0) {
    for (let d = 0; d < dims; d++) out[d]! /= totalW;
  }
  return out;
}

// ---------------------------------------------------------------------------
// K-means with k=2
// ---------------------------------------------------------------------------

interface KMeansResult {
  centroids: [number[], number[]];
  assignments: number[]; // 0 or 1 per input vector
  iterations: number;
}

/**
 * Run k-means with k=2 on the given vectors.
 *
 * Initialisation uses the two vectors with the largest mutual cosine distance
 * (deterministic, no random seed required) for reproducibility.
 */
export function kMeans2(vectors: number[][]): KMeansResult {
  if (vectors.length < 2) {
    const c = vectors[0] ?? [];
    return {
      centroids: [c, c],
      assignments: vectors.map(() => 0),
      iterations: 0,
    };
  }

  // Find the pair with the largest cosine distance for deterministic init
  let bestDist = -1;
  let seedA = 0;
  let seedB = 1;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const d = cosineDist(vectors[i]!, vectors[j]!);
      if (d > bestDist) {
        bestDist = d;
        seedA = i;
        seedB = j;
      }
    }
  }

  let centroidA = [...vectors[seedA]!];
  let centroidB = [...vectors[seedB]!];
  let assignments = new Array<number>(vectors.length).fill(0);
  let iterations = 0;

  for (let iter = 0; iter < KMEANS_MAX_ITER; iter++) {
    iterations++;
    // Assignment step
    const next = new Array<number>(vectors.length);
    let changed = false;
    for (let i = 0; i < vectors.length; i++) {
      const distA = cosineDist(vectors[i]!, centroidA);
      const distB = cosineDist(vectors[i]!, centroidB);
      const label = distA <= distB ? 0 : 1;
      next[i] = label;
      if (label !== assignments[i]) changed = true;
    }
    assignments = next as number[];

    // Update step
    const clusterAVecs = vectors.filter((_, i) => assignments[i] === 0);
    const clusterBVecs = vectors.filter((_, i) => assignments[i] === 1);

    if (clusterAVecs.length > 0) {
      centroidA = weightedCentroid(clusterAVecs, clusterAVecs.map(() => 1));
    }
    if (clusterBVecs.length > 0) {
      centroidB = weightedCentroid(clusterBVecs, clusterBVecs.map(() => 1));
    }

    if (!changed) break;
  }

  return { centroids: [centroidA, centroidB], assignments, iterations };
}

// ---------------------------------------------------------------------------
// Intent model types and builder
// ---------------------------------------------------------------------------

export interface IntentCluster {
  /** Centroid vector for this cluster. */
  centroid: number[];
  /** Track IDs belonging to this cluster. */
  trackIds: string[];
  /** Per-track weights (same order as trackIds). */
  weights: number[];
}

export interface IntentModel {
  /** One or two clusters. */
  clusters: IntentCluster[];
  /** True when the user's preferences spanned multiple perceptual regions. */
  multiCluster: boolean;
  /** Maximum pairwise cosine distance among rated tracks. */
  maxPairwiseDist: number;
}

/**
 * Build an intent model from the user's rated tracks.
 *
 * @param trackIds   Ordered list of positive track IDs to cluster.
 * @param vectors    Map from track_id to perceptual vector.
 * @param weights    Map from track_id to importance weight (derived from rating).
 */
export function buildIntentModel(
  trackIds: string[],
  vectors: Map<string, number[]>,
  weights: Map<string, number>,
): IntentModel {
  // Only include tracks that have vectors
  const eligible = trackIds.filter((id) => vectors.has(id));

  // Compute max pairwise cosine distance
  let maxDist = 0;
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const vi = vectors.get(eligible[i]!)!;
      const vj = vectors.get(eligible[j]!)!;
      const d = cosineDist(vi, vj);
      if (d > maxDist) maxDist = d;
    }
  }

  // Single centroid path: too few tracks or clusters are not well separated
  if (eligible.length < CLUSTER_MIN_TRACKS || maxDist <= CLUSTER_SPLIT_THRESHOLD) {
    const vecs = eligible.map((id) => vectors.get(id)!);
    const ws = eligible.map((id) => weights.get(id) ?? 1);
    const centroid = vecs.length > 0 ? weightedCentroid(vecs, ws) : [];
    return {
      clusters: [{ centroid, trackIds: eligible, weights: ws }],
      multiCluster: false,
      maxPairwiseDist: maxDist,
    };
  }

  // Multi-centroid path: k-means k=2
  const vecs = eligible.map((id) => vectors.get(id)!);
  const { centroids, assignments } = kMeans2(vecs);

  const clusterA: IntentCluster = { centroid: centroids[0], trackIds: [], weights: [] };
  const clusterB: IntentCluster = { centroid: centroids[1], trackIds: [], weights: [] };

  for (let i = 0; i < eligible.length; i++) {
    const target = assignments[i] === 0 ? clusterA : clusterB;
    target.trackIds.push(eligible[i]!);
    target.weights.push(weights.get(eligible[i]!) ?? 1);
  }

  // Recompute weighted centroids from final cluster membership
  if (clusterA.trackIds.length > 0) {
    clusterA.centroid = weightedCentroid(
      clusterA.trackIds.map((id) => vectors.get(id)!),
      clusterA.weights,
    );
  }
  if (clusterB.trackIds.length > 0) {
    clusterB.centroid = weightedCentroid(
      clusterB.trackIds.map((id) => vectors.get(id)!),
      clusterB.weights,
    );
  }

  // If one cluster is empty, collapse to single centroid
  if (clusterA.trackIds.length === 0 || clusterB.trackIds.length === 0) {
    const nonEmpty = clusterA.trackIds.length > 0 ? clusterA : clusterB;
    return {
      clusters: [nonEmpty],
      multiCluster: false,
      maxPairwiseDist: maxDist,
    };
  }

  return {
    clusters: [clusterA, clusterB],
    multiCluster: true,
    maxPairwiseDist: maxDist,
  };
}

/**
 * Interleave recommendations from two clusters in alternating order.
 *
 * Tracks from cluster 0 and cluster 1 are woven together so the station
 * alternates between the two preference regions.  Within each cluster the
 * original score ordering is preserved.
 */
export function interleaveClusterResults<T>(clusterA: T[], clusterB: T[]): T[] {
  const out: T[] = [];
  const lenA = clusterA.length;
  const lenB = clusterB.length;
  let ia = 0;
  let ib = 0;
  while (ia < lenA || ib < lenB) {
    if (ia < lenA) out.push(clusterA[ia++]!);
    if (ib < lenB) out.push(clusterB[ib++]!);
  }
  return out;
}
