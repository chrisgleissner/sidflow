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
  applyLinearMap,
  applyWeights,
  fitWithinClassWhitening,
  jacobiEigen,
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

  test("a constant dimension contributes nothing instead of a ramp", () => {
    // The failure this guards: consecutive ranks for tied values spread one
    // repeated number across the whole quantile range in track order, so a
    // constant column becomes a monotone gradient and the corpus's arbitrary file
    // ordering leaks into the distance function as fabricated signal.
    const tracks = makeCorpus(64, 3, 0x8f).map((t) => ({ ...t, vector: [7, t.vector[1]!, t.vector[2]!] }));
    const out = rankGaussian(tracks);
    const first = out[0]![0]!;
    for (const vector of out) expect(vector[0]!).toBe(first);
    // And it must be the centre of the distribution, not an arbitrary offset.
    expect(first).toBeCloseTo(0, 6);
  });

  test("tied values share one quantile, untied values keep their order", () => {
    // Half the corpus at zero -- the shape SID features actually have.
    const tracks = makeCorpus(40, 1, 0x9a).map((t, i) => ({ ...t, vector: [i < 20 ? 0 : i] }));
    const out = rankGaussian(tracks);
    const tied = out.slice(0, 20).map((v) => v[0]!);
    for (const value of tied) expect(value).toBe(tied[0]!);
    // The untied tail stays strictly increasing and sits above the tie group.
    for (let i = 21; i < 40; i++) expect(out[i]![0]!).toBeGreaterThan(out[i - 1]![0]!);
    expect(out[20]![0]!).toBeGreaterThan(tied[0]!);
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

  test("whitening is invariant to appending constant dimensions", () => {
    // The failure this guards: whitening divides each component by the square
    // root of its variance, so a direction with no variance is divided by
    // (numerically) nothing. With an absolute eigenvalue cutoff, appending 15
    // constant dimensions retained 31 components instead of 24 and inflated the
    // mean pairwise distance from 6.9 to 3539 -- pure amplified rounding error,
    // which silently changed which neighbours the candidate proposed.
    const rand = makeRandom(0xd1);
    const base: Track[] = Array.from({ length: 160 }, (_, i) => ({
      trackId: `t${i}`,
      sidPath: `MUSICIANS/A/C${i % 9}/f${Math.floor(i / 2)}.sid`,
      vector: Array.from({ length: 12 }, () => rand()),
      e: 3,
      m: 3,
      c: 3,
    }));
    const padded = base.map((t) => ({ ...t, vector: [...t.vector, 0, 0, 0, 0, 0, 0, 0, 0] }));

    const a = whiten(base);
    const b = whiten(padded);
    expect(b[0]!.length).toBe(a[0]!.length);

    const da = distanceMatrix(a, euclidean);
    const db = distanceMatrix(b, euclidean);
    for (let i = 0; i < base.length; i++) {
      for (let j = i + 1; j < base.length; j++) {
        expect(db[i]![j]!).toBeCloseTo(da[i]![j]!, 9);
      }
    }
  });

  test("whitening drops a redundant dimension instead of amplifying it", () => {
    const rand = makeRandom(0xd2);
    const base: Track[] = Array.from({ length: 160 }, (_, i) => {
      const v = Array.from({ length: 12 }, () => rand());
      return {
        trackId: `t${i}`,
        sidPath: `MUSICIANS/A/C${i % 9}/f${Math.floor(i / 2)}.sid`,
        vector: v,
        e: 3,
        m: 3,
        c: 3,
      };
    });
    // An exact duplicate carries no new information, so the rank must not grow.
    const duplicated = base.map((t) => ({ ...t, vector: [...t.vector, t.vector[0]!] }));
    expect(whiten(duplicated)[0]!.length).toBe(whiten(base)[0]!.length);
  });

  test("every retained whitened component has unit variance", () => {
    const rand = makeRandom(0xd3);
    const tracks: Track[] = Array.from({ length: 300 }, (_, i) => {
      const a = rand();
      const b = rand();
      return {
        trackId: `t${i}`,
        sidPath: `MUSICIANS/A/C${i % 9}/f${Math.floor(i / 2)}.sid`,
        // Deliberately correlated and differently scaled.
        vector: [a, a * 0.8 + b * 0.2, b * 100, rand() * 0.001],
        e: 3,
        m: 3,
        c: 3,
      };
    });
    const w = whiten(tracks);
    for (let k = 0; k < w[0]!.length; k++) {
      const column = w.map((v) => v[k]!);
      const mean = column.reduce((s, v) => s + v, 0) / column.length;
      const variance = column.reduce((s, v) => s + (v - mean) ** 2, 0) / column.length;
      expect(variance).toBeCloseTo(1, 2);
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

// --------------------------------------------------------- supervised metric

describe("jacobiEigen", () => {
  test("returns the diagonal of a diagonal matrix", () => {
    const { values } = jacobiEigen([
      [3, 0, 0],
      [0, 1, 0],
      [0, 0, 7],
    ]);
    expect([...values].sort((a, b) => a - b)).toEqual([1, 3, 7]);
  });

  test("reconstructs the input as V diag(lambda) V^T", () => {
    const rand = makeRandom(0xe1);
    const d = 8;
    // A symmetric positive definite matrix: M = B B^T + I.
    const b: number[][] = Array.from({ length: d }, () => Array.from({ length: d }, () => rand() - 0.5));
    const input: number[][] = Array.from({ length: d }, (_, i) =>
      Array.from({ length: d }, (_, j) => {
        let sum = i === j ? 1 : 0;
        for (let k = 0; k < d; k++) sum += b[i]![k]! * b[j]![k]!;
        return sum;
      }),
    );

    const { values, vectors } = jacobiEigen(input);
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        let sum = 0;
        for (let k = 0; k < d; k++) sum += vectors[i]![k]! * values[k]! * vectors[j]![k]!;
        expect(sum).toBeCloseTo(input[i]![j]!, 8);
      }
    }
  });

  test("produces an orthonormal eigenvector basis", () => {
    const rand = makeRandom(0xe2);
    const d = 6;
    const input: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    for (let i = 0; i < d; i++) {
      for (let j = i; j < d; j++) {
        const value = rand() - 0.5;
        input[i]![j] = value;
        input[j]![i] = value;
      }
    }
    const { vectors } = jacobiEigen(input);
    for (let p = 0; p < d; p++) {
      for (let q = 0; q < d; q++) {
        let dot = 0;
        for (let k = 0; k < d; k++) dot += vectors[k]![p]! * vectors[k]![q]!;
        expect(dot).toBeCloseTo(p === q ? 1 : 0, 8);
      }
    }
  });
});

describe("fitWithinClassWhitening", () => {
  test("shrinks the direction along which a group varies internally", () => {
    // Groups are separated equally on both axes, but each group's own tunes are
    // spread widely on axis 0 and tightly on axis 1. Axis 0 is therefore a poor
    // witness of shared authorship, and WCCN must down-weight it.
    const rand = makeRandom(0xe3);
    const vectors: Float64Array[] = [];
    const groups: string[] = [];
    for (let g = 0; g < 40; g++) {
      for (let member = 0; member < 6; member++) {
        vectors.push(Float64Array.from([g + (rand() - 0.5) * 10, g + (rand() - 0.5) * 0.1]));
        groups.push(`g${g}`);
      }
    }

    const withinSpread = (source: Float64Array[], axis: number): number => {
      let total = 0;
      for (let g = 0; g < 40; g++) {
        const members = source.slice(g * 6, g * 6 + 6).map((v) => v[axis]!);
        const mean = members.reduce((s, v) => s + v, 0) / members.length;
        total += members.reduce((s, v) => s + (v - mean) ** 2, 0) / members.length;
      }
      return total / 40;
    };
    const anisotropy = (source: Float64Array[]): number => {
      const a = withinSpread(source, 0);
      const b = withinSpread(source, 1);
      return Math.max(a, b) / Math.min(a, b);
    };

    // Before: axis 0 varies ~10,000x more within a group than axis 1.
    expect(anisotropy(vectors)).toBeGreaterThan(1000);

    // Essentially unregularised, the transform is exact: within-group variation
    // becomes isotropic, which is the whole point of the technique.
    expect(anisotropy(applyLinearMap(vectors, fitWithinClassWhitening(vectors, groups, 1e-9)))).toBeLessThan(4);

    // With real shrinkage it deliberately stops short of exact. A single scalar
    // ridge cannot be small relative to both a variance of 8 and one of 0.0008,
    // so the tiny axis stays partly regularised. That is the bias accepted in
    // exchange for not inverting a direction estimated from a handful of tunes,
    // and it must still be a large improvement on the raw anisotropy.
    const shrunk = anisotropy(applyLinearMap(vectors, fitWithinClassWhitening(vectors, groups, 0.05)));
    expect(shrunk).toBeLessThan(anisotropy(vectors) / 10);
  });

  test("the fitted map is an inverse square root of the within-class covariance", () => {
    // The pure linear-algebra contract, checked without shrinkage confusing it:
    // M W M must be the identity, where M is the returned map.
    const rand = makeRandom(0xe7);
    const d = 5;
    const vectors: Float64Array[] = [];
    const groups: string[] = [];
    for (let g = 0; g < 30; g++) {
      for (let member = 0; member < 8; member++) {
        vectors.push(Float64Array.from(Array.from({ length: d }, (_, k) => g * 3 + (rand() - 0.5) * (k + 1))));
        groups.push(`g${g}`);
      }
    }
    const shrinkage = 1e-9;
    const map = fitWithinClassWhitening(vectors, groups, shrinkage);

    // Recompute the (shrunk) within-class covariance the same way the fit does.
    const within: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    for (let g = 0; g < 30; g++) {
      const members = vectors.slice(g * 8, g * 8 + 8);
      const mean = Array.from({ length: d }, (_, k) => members.reduce((s, v) => s + v[k]!, 0) / members.length);
      for (const v of members) {
        for (let p = 0; p < d; p++) {
          for (let q = 0; q < d; q++) within[p]![q]! += ((v[p]! - mean[p]!) * (v[q]! - mean[q]!)) / members.length / 30;
        }
      }
    }
    let trace = 0;
    for (let i = 0; i < d; i++) trace += within[i]![i]!;
    const target = trace / d;
    for (let p = 0; p < d; p++) {
      for (let q = 0; q < d; q++) {
        within[p]![q] = (1 - shrinkage) * within[p]![q]! + (p === q ? shrinkage * target : 0);
      }
    }

    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        let sum = 0;
        for (let a = 0; a < d; a++) {
          for (let b = 0; b < d; b++) sum += map[i]![a]! * within[a]![b]! * map[b]![j]!;
        }
        expect(sum).toBeCloseTo(i === j ? 1 : 0, 6);
      }
    }
  });

  test("returns identity when no group has two members to learn from", () => {
    const vectors = [Float64Array.from([1, 2]), Float64Array.from([3, 4])];
    const map = fitWithinClassWhitening(vectors, ["a", "b"]);
    expect(map).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  test("stays finite on a degenerate, perfectly collinear group structure", () => {
    const vectors: Float64Array[] = [];
    const groups: string[] = [];
    for (let g = 0; g < 20; g++) {
      for (let member = 0; member < 4; member++) {
        // Second axis is an exact copy of the first: within-class covariance is singular.
        const value = g + member;
        vectors.push(Float64Array.from([value, value]));
        groups.push(`g${g}`);
      }
    }
    const map = fitWithinClassWhitening(vectors, groups);
    for (const row of map) for (const value of row) expect(Number.isFinite(value)).toBe(true);
    const transformed = applyLinearMap(vectors, map);
    for (const vector of transformed) for (const value of vector) expect(Number.isFinite(value)).toBe(true);
  });
});
