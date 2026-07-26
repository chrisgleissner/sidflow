/**
 * Evaluation harness for station-quality optimisation.
 *
 * Splitting is by GROUP (composer/production), not by track. If two tunes by the
 * same composer landed either side of the split, a model could learn that
 * composer's fingerprint on train and be rewarded for recognising it on test —
 * the label would have leaked. Grouped splitting is the standard remedy and it
 * makes the test set a genuine cold-start population.
 *
 * The test slice is loaded but deliberately not exposed to the tuning loop; see
 * optimise.ts, which only ever reads `train` and `validation`.
 */

import { Database } from "bun:sqlite";
import { groupOf, type Track } from "./metrics.js";

export interface Split {
  train: Track[];
  validation: Track[];
  test: Track[];
}

export function loadTracks(dbPath: string): Track[] {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.query("select track_id, sid_path, vector_json, e, m, c from tracks").all() as Array<{
    track_id: string;
    sid_path: string;
    vector_json: string | null;
    e: number;
    m: number;
    c: number;
  }>;
  const out: Track[] = [];
  for (const row of rows) {
    if (!row.vector_json) continue;
    let vector: unknown;
    try {
      vector = JSON.parse(row.vector_json);
    } catch {
      continue;
    }
    if (!Array.isArray(vector) || vector.length === 0) continue;
    if (!vector.every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    out.push({ trackId: row.track_id, sidPath: row.sid_path, vector: vector as number[], e: row.e, m: row.m, c: row.c });
  }
  return out;
}

/** FNV-1a, so the split is stable across runs and machines without storing it. */
function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Grouped split, deterministic. Ratios are approximate because whole groups move
 * together — that is the point.
 */
export function splitByGroup(tracks: Track[], trainFrac = 0.5, validationFrac = 0.25): Split {
  const groups = new Map<string, Track[]>();
  for (const track of tracks) {
    const group = groupOf(track.sidPath) ?? `__ungrouped__/${track.sidPath}`;
    groups.set(group, [...(groups.get(group) ?? []), track]);
  }

  const train: Track[] = [];
  const validation: Track[] = [];
  const test: Track[] = [];
  for (const [group, members] of groups) {
    const bucket = (hashString(group) % 10000) / 10000;
    if (bucket < trainFrac) train.push(...members);
    else if (bucket < trainFrac + validationFrac) validation.push(...members);
    else test.push(...members);
  }
  return { train, validation, test };
}

// --------------------------------------------------------------- ranking core

export type Representation = (tracks: Track[]) => Float64Array[];
export type Ranker = (vectors: Float64Array[], tracks: Track[]) => (seedIndex: number, k: number) => number[];

export const euclidean = (a: Float64Array, b: Float64Array): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(sum);
};

export const cosineDistance = (a: Float64Array, b: Float64Array): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 1 : 1 - dot / Math.sqrt(na * nb);
};

/** Full pairwise distance matrix. n is a few thousand, so O(n^2) is fine. */
export function distanceMatrix(vectors: Float64Array[], metric = euclidean): Float64Array[] {
  const n = vectors.length;
  const out: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = metric(vectors[i]!, vectors[j]!);
      out[i]![j] = d;
      out[j]![i] = d;
    }
  }
  return out;
}

// ------------------------------------------------------------------- metrics

/**
 * nDCG@k against the binary group label.
 *
 * Rank-aware, unlike precision@k: a correct neighbour at position 1 is worth
 * more than one at position 10, which is what a listener actually experiences as
 * a station starts. Binary gain, log2 discount, ideal DCG computed from the
 * number of same-group tracks actually available to retrieve, so a seed whose
 * composer has only two other tunes is not penalised for failing to find ten.
 *
 * `seedIndices` restricts which tracks are used as seeds WITHOUT changing the
 * retrievable population or the label arrays. That distinction matters: the
 * cold-start guardrail scores a rare-group subset of seeds, but those seeds are
 * still ranked against — and scored against — the whole slice. Passing a
 * pre-filtered `tracks` array instead would silently misalign the ranker's index
 * space with the label arrays and produce a meaningless number.
 */
export function ndcgAtK(
  tracks: Track[],
  rank: (seedIndex: number, k: number) => number[],
  k: number,
  seedIndices?: readonly number[],
): { mean: number; perSeed: number[] } {
  const groups = tracks.map((t) => groupOf(t.sidPath));
  const files = tracks.map((t) => t.sidPath);
  const available = new Map<string, number>();
  for (const g of groups) if (g) available.set(g, (available.get(g) ?? 0) + 1);
  // Sibling counts once, not per seed: the naive per-seed filter is O(n^2) and
  // dominates every candidate at corpus scale.
  const siblings = new Map<string, number>();
  for (const f of files) siblings.set(f, (siblings.get(f) ?? 0) + 1);

  const perSeed: number[] = [];
  const seeds = seedIndices ?? tracks.map((_, i) => i);
  for (const i of seeds) {
    const seedGroup = groups[i];
    if (!seedGroup) continue;
    // Same-file siblings are excluded from both the ranking and the ideal, so
    // subsong-heavy tunes cannot inflate the score.
    const sameFile = (siblings.get(files[i]!) ?? 1) - 1;
    const relevant = (available.get(seedGroup) ?? 1) - 1 - sameFile;
    if (relevant <= 0) continue;

    const neighbours = rank(i, k);
    let dcg = 0;
    for (let p = 0; p < neighbours.length; p++) {
      const j = neighbours[p]!;
      if (groups[j] === seedGroup) dcg += 1 / Math.log2(p + 2);
    }
    let idcg = 0;
    for (let p = 0; p < Math.min(k, relevant); p++) idcg += 1 / Math.log2(p + 2);
    if (idcg > 0) perSeed.push(dcg / idcg);
  }
  const mean = perSeed.length === 0 ? 0 : perSeed.reduce((s, v) => s + v, 0) / perSeed.length;
  return { mean, perSeed };
}

/**
 * Builds a ranker that excludes the seed and its same-file siblings.
 *
 * Bounded selection rather than a full sort. The obvious implementation — push
 * every candidate into an array of `{j, d}` objects and sort — costs one object
 * allocation per candidate per seed, which at 20k tracks is 4e8 allocations for a
 * single evaluation and does not complete in useful time. Since only the top k
 * (10-25) are ever read, an insertion into a k-sized typed buffer is both O(n)
 * per seed in practice and allocation-free in the hot loop.
 *
 * Ties break toward the lower index, matching the stable sort this replaced, so
 * rankings are byte-identical to the previous implementation.
 */
export function makeRanker(tracks: Track[], distances: Float64Array[]) {
  // Intern paths so the sibling test is an integer compare, not a string compare.
  const fileIds = new Int32Array(tracks.length);
  const seen = new Map<string, number>();
  for (let i = 0; i < tracks.length; i++) {
    const path = tracks[i]!.sidPath;
    let id = seen.get(path);
    if (id === undefined) {
      id = seen.size;
      seen.set(path, id);
    }
    fileIds[i] = id;
  }

  return (seedIndex: number, k: number): number[] => {
    const row = distances[seedIndex]!;
    const seedFile = fileIds[seedIndex]!;
    const bestIdx = new Int32Array(k);
    const bestDist = new Float64Array(k);
    let size = 0;
    let worst = Number.POSITIVE_INFINITY;

    for (let j = 0; j < row.length; j++) {
      if (j === seedIndex || fileIds[j] === seedFile) continue;
      const d = row[j]!;
      if (size === k && d >= worst) continue;
      let p = size < k ? size : k - 1;
      while (p > 0 && bestDist[p - 1]! > d) {
        bestDist[p] = bestDist[p - 1]!;
        bestIdx[p] = bestIdx[p - 1]!;
        p--;
      }
      bestDist[p] = d;
      bestIdx[p] = j;
      if (size < k) size++;
      worst = bestDist[size - 1]!;
    }

    const out = new Array<number>(size);
    for (let i = 0; i < size; i++) out[i] = bestIdx[i]!;
    return out;
  };
}

/**
 * Top-k nearest indices for every row, excluding the diagonal.
 *
 * Shared by the re-ranking techniques, which each need a k-nearest list per
 * track and would otherwise full-sort n candidates per row.
 */
export function topKPerRow(distances: Float64Array[], k: number): Int32Array[] {
  const n = distances.length;
  const out: Int32Array[] = [];
  for (let i = 0; i < n; i++) {
    const row = distances[i]!;
    const idx = new Int32Array(k);
    const dist = new Float64Array(k);
    let size = 0;
    let worst = Number.POSITIVE_INFINITY;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = row[j]!;
      if (size === k && d >= worst) continue;
      let p = size < k ? size : k - 1;
      while (p > 0 && dist[p - 1]! > d) {
        dist[p] = dist[p - 1]!;
        idx[p] = idx[p - 1]!;
        p--;
      }
      dist[p] = d;
      idx[p] = j;
      if (size < k) size++;
      worst = dist[size - 1]!;
    }
    out.push(size === k ? idx : idx.slice(0, size));
  }
  return out;
}

// ---------------------------------------------------------------- statistics

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 0x100000000);
}

/**
 * Paired bootstrap on per-seed scores. Paired because both systems are scored on
 * the same seeds, which removes between-seed variance.
 */
export function pairedBootstrap(
  candidate: number[],
  baseline: number[],
  iterations = 5000,
): { diff: number; ci: [number, number]; pValue: number } {
  const n = Math.min(candidate.length, baseline.length);
  const diffs = Array.from({ length: n }, (_, i) => candidate[i]! - baseline[i]!);
  const observed = diffs.reduce((s, v) => s + v, 0) / n;

  const rand = makeRandom(0x5bf03635);
  const means: number[] = [];
  for (let it = 0; it < iterations; it++) {
    let total = 0;
    for (let i = 0; i < n; i++) total += diffs[(rand() * n) | 0]!;
    means.push(total / n);
  }
  means.sort((a, b) => a - b);

  // Two-sided p from the bootstrap distribution centred at zero.
  const centred = means.map((m) => m - observed);
  const extreme = centred.filter((m) => Math.abs(m) >= Math.abs(observed)).length;
  return {
    diff: observed,
    ci: [means[Math.floor(iterations * 0.025)]!, means[Math.floor(iterations * 0.975)]!],
    pValue: (extreme + 1) / (iterations + 1),
  };
}

/** Holm-Bonferroni: controls family-wise error across every candidate tried. */
export function holmCorrection(pValues: Array<{ name: string; p: number }>): Array<{ name: string; p: number; adjusted: number; significant: boolean }> {
  const sorted = [...pValues].sort((a, b) => a.p - b.p);
  const m = sorted.length;
  let previous = 0;
  return sorted.map((entry, index) => {
    const adjusted = Math.min(1, Math.max(previous, (m - index) * entry.p));
    previous = adjusted;
    return { ...entry, adjusted, significant: adjusted < 0.05 };
  });
}
