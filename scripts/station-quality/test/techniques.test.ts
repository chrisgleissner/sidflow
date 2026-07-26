/**
 * Equivalence tests for the representation and re-ranking techniques.
 *
 * kReciprocal and queryExpansion were rewritten from the direct form into sparse
 * and bounded-selection forms so they finish on a 20k-track corpus. Both are
 * pinned here against naive implementations transcribed straight from the
 * definition, because a re-ranker that is fast and subtly wrong would show up as
 * a plausible-looking nDCG number rather than as a crash.
 *
 * subsampleByGroup is tested for the property its previous version violated: a
 * sample must represent the corpus, not a prefix of its sorted group names.
 */

import { describe, expect, test } from "bun:test";

import { distanceMatrix, euclidean, splitByGroup } from "../harness.js";
import { groupOf, type Track } from "../metrics.js";
import {
  applyWeights,
  kReciprocal,
  queryExpansion,
  rankGaussian,
  subsampleByGroup,
  treeComposition,
  whiten,
  zscore,
} from "../techniques.js";

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 0x100000000);
}

function makeCorpus(count: number, dims = 6, seed = 0x1234): Track[] {
  const rand = makeRandom(seed);
  const trees = ["MUSICIANS", "GAMES", "DEMOS"];
  const out: Track[] = [];
  for (let i = 0; i < count; i++) {
    const tree = trees[i % trees.length]!;
    out.push({
      trackId: `t${i}`,
      sidPath: `C64Music/${tree}/X/Composer_${i % 11}/tune_${Math.floor(i / 3)}.sid`,
      vector: Array.from({ length: dims }, () => rand()),
      e: 1 + (i % 5),
      m: 1 + (i % 3),
      c: 1 + (i % 4),
    });
  }
  return out;
}

const vectorsOf = (tracks: Track[]) => tracks.map((t) => Float64Array.from(t.vector));

// --------------------------------------------------------- naive references

/** k-reciprocal, transcribed directly from the definition. O(n^2) set probes. */
function naiveKReciprocal(distances: Float64Array[], k = 20, lambda = 0.3): Float64Array[] {
  const n = distances.length;
  const knn: number[][] = [];
  for (let i = 0; i < n; i++) {
    knn.push(
      Array.from({ length: n }, (_, j) => j)
        .filter((j) => j !== i)
        .sort((a, b) => distances[i]![a]! - distances[i]![b]! || a - b)
        .slice(0, k),
    );
  }
  const sets = knn.map((list) => new Set(list));
  const rsets = knn.map((list, i) => new Set(list.filter((j) => sets[j]!.has(i))));

  const out: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = rsets[i]!;
      const b = rsets[j]!;
      let inter = 0;
      for (const v of a) if (b.has(v)) inter++;
      const union = a.size + b.size - inter;
      const jaccard = union === 0 ? 1 : 1 - inter / union;
      const blended = lambda * distances[i]![j]! + (1 - lambda) * jaccard;
      out[i]![j] = blended;
      out[j]![i] = blended;
    }
  }
  return out;
}

function naiveQueryExpansion(
  vectors: Float64Array[],
  distances: Float64Array[],
  k = 3,
  alpha = 1.5,
): Float64Array[] {
  const n = vectors.length;
  const d = vectors[0]!.length;
  return vectors.map((v, i) => {
    const order = Array.from({ length: n }, (_, j) => j)
      .filter((j) => j !== i)
      .sort((a, b) => distances[i]![a]! - distances[i]![b]! || a - b)
      .slice(0, k);
    const out = new Float64Array(d);
    for (let x = 0; x < d; x++) out[x] = v[x]!;
    let weightSum = 1;
    for (const j of order) {
      const w = Math.pow(1 / (1 + distances[i]![j]!), alpha);
      for (let x = 0; x < d; x++) out[x]! += w * vectors[j]![x]!;
      weightSum += w;
    }
    for (let x = 0; x < d; x++) out[x]! /= weightSum;
    return out;
  });
}

// ------------------------------------------------------------------- tests

describe("kReciprocal", () => {
  test("the sparse form equals the direct definition", () => {
    const tracks = makeCorpus(140, 5, 0x77);
    const distances = distanceMatrix(vectorsOf(tracks), euclidean);
    for (const k of [5, 20]) {
      const fast = kReciprocal(distances, k, 0.3);
      const slow = naiveKReciprocal(distances, k, 0.3);
      for (let i = 0; i < distances.length; i++) {
        for (let j = 0; j < distances.length; j++) {
          expect(fast[i]![j]!).toBeCloseTo(slow[i]![j]!, 12);
        }
      }
    }
  });

  test("stays symmetric with a zero diagonal", () => {
    const tracks = makeCorpus(60, 4, 0x1a);
    const out = kReciprocal(distanceMatrix(vectorsOf(tracks), euclidean), 10, 0.3);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]![i]!).toBe(0);
      for (let j = 0; j < out.length; j++) expect(out[i]![j]!).toBeCloseTo(out[j]![i]!, 12);
    }
  });

  test("pairs with disjoint reciprocal sets get the maximal Jaccard term", () => {
    // Two tight, far-apart clusters: nothing in cluster A is reciprocal with
    // anything in cluster B, so every cross pair must take jaccard = 1 exactly.
    const tracks: Track[] = [];
    for (let i = 0; i < 12; i++) {
      const far = i >= 6 ? 1000 : 0;
      tracks.push({
        trackId: `t${i}`,
        sidPath: `MUSICIANS/A/A/f${i}.sid`,
        vector: [far + i * 0.01, far],
        e: 3,
        m: 3,
        c: 3,
      });
    }
    const distances = distanceMatrix(vectorsOf(tracks), euclidean);
    const lambda = 0.3;
    const out = kReciprocal(distances, 3, lambda);
    for (let i = 0; i < 6; i++) {
      for (let j = 6; j < 12; j++) {
        expect(out[i]![j]!).toBeCloseTo(lambda * distances[i]![j]! + (1 - lambda), 12);
      }
    }
  });
});

describe("queryExpansion", () => {
  test("matches the direct definition", () => {
    const tracks = makeCorpus(90, 5, 0x2b);
    const vectors = vectorsOf(tracks);
    const distances = distanceMatrix(vectors, euclidean);
    const fast = queryExpansion(vectors, distances, 3, 1.5);
    const slow = naiveQueryExpansion(vectors, distances, 3, 1.5);
    for (let i = 0; i < vectors.length; i++) {
      for (let x = 0; x < vectors[0]!.length; x++) {
        expect(fast[i]![x]!).toBeCloseTo(slow[i]![x]!, 12);
      }
    }
  });
});

describe("rankGaussian", () => {
  test("each dimension becomes a symmetric zero-mean ranking", () => {
    const tracks = makeCorpus(200, 4, 0x3c);
    const out = rankGaussian(tracks);
    for (let i = 0; i < 4; i++) {
      const column = out.map((v) => v[i]!);
      const mean = column.reduce((s, v) => s + v, 0) / column.length;
      expect(mean).toBeCloseTo(0, 6);
      // Monotone in the original feature: the rank transform must preserve order.
      const byOriginal = tracks
        .map((t, j) => ({ v: t.vector[i]!, j }))
        .sort((a, b) => a.v - b.v)
        .map((x) => out[x.j]![i]!);
      for (let j = 1; j < byOriginal.length; j++) {
        expect(byOriginal[j]!).toBeGreaterThanOrEqual(byOriginal[j - 1]!);
      }
    }
  });

  test("is deterministic when a dimension is entirely tied", () => {
    const tracks = makeCorpus(40, 3, 0x4d).map((t) => ({ ...t, vector: [1, t.vector[1]!, t.vector[2]!] }));
    const a = rankGaussian(tracks);
    const b = rankGaussian(tracks);
    for (let i = 0; i < tracks.length; i++) expect(a[i]![0]!).toBe(b[i]![0]!);
  });
});

describe("zscore and whiten", () => {
  test("z-scored dimensions have unit variance", () => {
    const tracks = makeCorpus(300, 5, 0x5e);
    const z = zscore(tracks);
    for (let i = 0; i < 5; i++) {
      const column = z.map((v) => v[i]!);
      const mean = column.reduce((s, v) => s + v, 0) / column.length;
      const variance = column.reduce((s, v) => s + (v - mean) ** 2, 0) / column.length;
      expect(mean).toBeCloseTo(0, 8);
      expect(variance).toBeCloseTo(1, 6);
    }
  });

  test("whitening decorrelates the dimensions", () => {
    // Deliberately correlated input: dimension 1 is a noisy copy of dimension 0.
    const rand = makeRandom(0x6f);
    const tracks: Track[] = Array.from({ length: 400 }, (_, i) => {
      const base = rand();
      return {
        trackId: `t${i}`,
        sidPath: `MUSICIANS/A/C${i % 7}/f${i}.sid`,
        vector: [base, base * 0.9 + rand() * 0.1, rand()],
        e: 3,
        m: 3,
        c: 3,
      };
    });
    const w = whiten(tracks);
    const dims = w[0]!.length;
    for (let a = 0; a < dims; a++) {
      for (let b = a + 1; b < dims; b++) {
        let cov = 0;
        for (const v of w) cov += (v[a]! * v[b]!) / w.length;
        expect(Math.abs(cov)).toBeLessThan(0.05);
      }
    }
  });
});

describe("applyWeights", () => {
  test("scales each dimension by the square root of its weight", () => {
    const v = [Float64Array.from([2, 3, 4])];
    const out = applyWeights(v, [4, 9, 0]);
    expect(out[0]![0]!).toBeCloseTo(4, 12);
    expect(out[0]![1]!).toBeCloseTo(9, 12);
    expect(out[0]![2]!).toBeCloseTo(0, 12);
  });

  test("a negative weight is clamped to zero rather than producing NaN", () => {
    const out = applyWeights([Float64Array.from([5])], [-1]);
    expect(out[0]![0]!).toBe(0);
  });
});

// ---------------------------------------------------------------- sampling

describe("subsampleByGroup", () => {
  /**
   * A corpus shaped like HVSC: the tree that holds most of the material sorts
   * LAST by name. This is the configuration the old alphabetical implementation
   * got wrong.
   */
  function hvscShapedCorpus(): Track[] {
    const out: Track[] = [];
    const push = (tree: string, group: number, tracks: number) => {
      for (let i = 0; i < tracks; i++) {
        out.push({
          trackId: `${tree}-${group}-${i}`,
          sidPath: `C64Music/${tree}/A/Group_${group}/tune_${i}.sid`,
          vector: [group, i],
          e: 3,
          m: 3,
          c: 3,
        });
      }
    };
    for (let g = 0; g < 100; g++) push("DEMOS", g, 8);
    for (let g = 0; g < 150; g++) push("GAMES", g, 10);
    for (let g = 0; g < 600; g++) push("MUSICIANS", g, 12);
    return out;
  }

  test("draws from every tree instead of taking an alphabetical prefix", () => {
    const corpus = hvscShapedCorpus();
    const sample = subsampleByGroup(corpus, 2000);
    const composition = treeComposition(sample);
    expect(composition.MUSICIANS ?? 0).toBeGreaterThan(0);
    expect(composition.GAMES ?? 0).toBeGreaterThan(0);
    expect(composition.DEMOS ?? 0).toBeGreaterThan(0);

    // And roughly in proportion: MUSICIANS is 78% of the corpus, so it must
    // dominate the sample too. The old prefix behaviour yielded exactly 0.
    const full = treeComposition(corpus);
    const sampleShare = (composition.MUSICIANS ?? 0) / sample.length;
    const fullShare = (full.MUSICIANS ?? 0) / corpus.length;
    expect(Math.abs(sampleShare - fullShare)).toBeLessThan(0.05);
  });

  test("keeps every selected group whole", () => {
    const corpus = hvscShapedCorpus();
    const sample = subsampleByGroup(corpus, 2000);
    const sizesInSample = new Map<string, number>();
    for (const t of sample) {
      const g = groupOf(t.sidPath)!;
      sizesInSample.set(g, (sizesInSample.get(g) ?? 0) + 1);
    }
    const sizesInCorpus = new Map<string, number>();
    for (const t of corpus) {
      const g = groupOf(t.sidPath)!;
      sizesInCorpus.set(g, (sizesInCorpus.get(g) ?? 0) + 1);
    }
    for (const [g, n] of sizesInSample) {
      const inCorpus = sizesInCorpus.get(g);
      expect(inCorpus).toBeDefined();
      expect(n).toBe(inCorpus as number);
    }
  });

  test("the sample still splits three ways, because its hash is independent of the split's", () => {
    // The failure this guards against: if subsampling reused the split's hash,
    // a prefix of that order would land entirely in one slice.
    const sample = subsampleByGroup(hvscShapedCorpus(), 2000);
    const { train, validation, test: held } = splitByGroup(sample);
    expect(train.length).toBeGreaterThan(0);
    expect(validation.length).toBeGreaterThan(0);
    expect(held.length).toBeGreaterThan(0);
    // Roughly 50/25/25, allowing slack for whole groups moving together.
    expect(train.length / sample.length).toBeGreaterThan(0.3);
    expect(validation.length / sample.length).toBeGreaterThan(0.1);
    expect(held.length / sample.length).toBeGreaterThan(0.1);
  });

  test("returns the corpus unchanged when it already fits", () => {
    const corpus = makeCorpus(50);
    expect(subsampleByGroup(corpus, 1000)).toBe(corpus);
  });

  test("is deterministic", () => {
    const corpus = hvscShapedCorpus();
    const a = subsampleByGroup(corpus, 1500).map((t) => t.trackId);
    const b = subsampleByGroup(corpus, 1500).map((t) => t.trackId);
    expect(b).toEqual(a);
  });
});
