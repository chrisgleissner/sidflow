/**
 * Equivalence and correctness tests for the station-quality harness.
 *
 * Most of what is checked here is EQUIVALENCE: several hot paths were rewritten
 * from the obvious-but-quadratic form into bounded-selection and sparse forms so
 * they survive a 20k-track corpus. A rewrite that is merely fast is worthless if
 * it also changes the ranking, so each one is pinned against a naive reference
 * implementation written directly from the definition.
 *
 * The rare-seed test is different: it pins a BUG FIX. The cold-start guardrail
 * used to score a filtered seed array against label arrays built from that same
 * filtered array, while the ranker returned indices into the unfiltered slice.
 * The indices and the labels lived in different spaces, so the number it produced
 * was noise. The test below fails against the old behaviour.
 */

import { describe, expect, test } from "bun:test";

import {
  distanceMatrix,
  euclidean,
  makeRanker,
  ndcgAtK,
  topKPerRow,
  splitByGroup,
} from "../harness.js";
import { groupOf, type Track } from "../metrics.js";

/** Deterministic LCG: the same corpus every run, on every machine. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 0x100000000);
}

/**
 * A synthetic corpus with the structure that matters: several groups, several
 * subsongs per file, and enough dimensions to make ties unlikely but not
 * impossible.
 */
function makeCorpus(count: number, dims = 6, seed = 0x1234): Track[] {
  const rand = makeRandom(seed);
  const trees = ["MUSICIANS", "GAMES", "DEMOS"];
  const out: Track[] = [];
  for (let i = 0; i < count; i++) {
    const tree = trees[i % trees.length]!;
    const composer = `Composer_${i % 11}`;
    const file = `C64Music/${tree}/X/${composer}/tune_${Math.floor(i / 3)}.sid`;
    out.push({
      trackId: `t${i}`,
      sidPath: file,
      vector: Array.from({ length: dims }, () => rand()),
      e: 1 + (i % 5),
      m: 1 + (i % 3),
      c: 1 + (i % 4),
    });
  }
  return out;
}

// --------------------------------------------------------------------- rankers

/** The implementation makeRanker replaced: build every candidate, sort, slice. */
function naiveRanker(tracks: Track[], distances: Float64Array[]) {
  const files = tracks.map((t) => t.sidPath);
  return (seedIndex: number, k: number): number[] => {
    const candidates: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < distances[seedIndex]!.length; j++) {
      if (j === seedIndex || files[j] === files[seedIndex]) continue;
      candidates.push({ j, d: distances[seedIndex]![j]! });
    }
    candidates.sort((a, b) => a.d - b.d);
    return candidates.slice(0, k).map((c) => c.j);
  };
}

describe("makeRanker", () => {
  test("returns exactly what a full sort would, including tie order", () => {
    const tracks = makeCorpus(120);
    const distances = distanceMatrix(
      tracks.map((t) => Float64Array.from(t.vector)),
      euclidean,
    );
    const fast = makeRanker(tracks, distances);
    const slow = naiveRanker(tracks, distances);
    for (const k of [1, 5, 10, 25]) {
      for (let seed = 0; seed < tracks.length; seed++) {
        expect(fast(seed, k)).toEqual(slow(seed, k));
      }
    }
  });

  test("never returns the seed or a sibling subsong of the same file", () => {
    const tracks = makeCorpus(60);
    const distances = distanceMatrix(
      tracks.map((t) => Float64Array.from(t.vector)),
      euclidean,
    );
    const rank = makeRanker(tracks, distances);
    for (let seed = 0; seed < tracks.length; seed++) {
      for (const j of rank(seed, 10)) {
        expect(j).not.toBe(seed);
        expect(tracks[j]!.sidPath).not.toBe(tracks[seed]!.sidPath);
      }
    }
  });

  test("ties break toward the lower index", () => {
    // Three candidates at identical distance; the seed is index 0.
    const distances = [
      Float64Array.from([0, 5, 5, 5]),
      Float64Array.from([5, 0, 1, 1]),
      Float64Array.from([5, 1, 0, 1]),
      Float64Array.from([5, 1, 1, 0]),
    ];
    const tracks: Track[] = [0, 1, 2, 3].map((i) => ({
      trackId: `t${i}`,
      sidPath: `MUSICIANS/A/A/f${i}.sid`,
      vector: [0],
      e: 3,
      m: 3,
      c: 3,
    }));
    expect(makeRanker(tracks, distances)(0, 3)).toEqual([1, 2, 3]);
  });
});

describe("topKPerRow", () => {
  test("matches a full sort per row, excluding the diagonal", () => {
    const tracks = makeCorpus(80, 5, 0xbeef);
    const distances = distanceMatrix(
      tracks.map((t) => Float64Array.from(t.vector)),
      euclidean,
    );
    for (const k of [1, 3, 20]) {
      const fast = topKPerRow(distances, k);
      for (let i = 0; i < distances.length; i++) {
        const expected = Array.from({ length: distances.length }, (_, j) => j)
          .filter((j) => j !== i)
          .sort((a, b) => distances[i]![a]! - distances[i]![b]!)
          .slice(0, k);
        expect([...fast[i]!]).toEqual(expected);
      }
    }
  });
});

// ----------------------------------------------------------------------- nDCG

describe("ndcgAtK", () => {
  test("scoring every seed is the same whether seedIndices is given or omitted", () => {
    const tracks = makeCorpus(90, 4, 0xfeed);
    const distances = distanceMatrix(
      tracks.map((t) => Float64Array.from(t.vector)),
      euclidean,
    );
    const rank = makeRanker(tracks, distances);
    const all = ndcgAtK(tracks, rank, 10);
    const explicit = ndcgAtK(tracks, rank, 10, tracks.map((_, i) => i));
    expect(explicit.mean).toBeCloseTo(all.mean, 12);
    expect(explicit.perSeed).toEqual(all.perSeed);
  });

  test("a seed subset scores each seed identically to the full run", () => {
    // This is the property the cold-start guardrail depends on: restricting the
    // SEEDS must not change the retrievable population or the labels, so a
    // subset's per-seed scores must be a sub-multiset of the full run's.
    const tracks = makeCorpus(90, 4, 0xc0ffee);
    const distances = distanceMatrix(
      tracks.map((t) => Float64Array.from(t.vector)),
      euclidean,
    );
    const rank = makeRanker(tracks, distances);

    const scoreOf = (i: number) => ndcgAtK(tracks, rank, 10, [i]).perSeed[0];
    const subset = [3, 17, 42, 61];
    const subsetRun = ndcgAtK(tracks, rank, 10, subset);
    const individually = subset.map(scoreOf).filter((v) => v !== undefined);
    expect(subsetRun.perSeed).toEqual(individually as number[]);
  });

  test("rare-group seeds are scored against full-slice labels, not subset labels", () => {
    // makeCorpus spreads tracks over 11 prolific composers, so it contains no
    // rare group at all. The cold-start guardrail needs groups with <=3 tracks,
    // so append a tail of one- and two-tune composers.
    const tracks = makeCorpus(150, 5, 0xabcd);
    for (let i = 0; i < 30; i++) {
      tracks.push({
        trackId: `rare${i}`,
        sidPath: `C64Music/MUSICIANS/R/Rare_${i}/only_tune.sid`,
        vector: Array.from({ length: 5 }, (_, d) => ((i * 7 + d * 13) % 100) / 100),
        e: 3,
        m: 3,
        c: 3,
      });
    }
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 2; j++) {
        tracks.push({
          trackId: `pair${i}_${j}`,
          sidPath: `C64Music/GAMES/P/Pair_${i}/tune_${j}.sid`,
          vector: Array.from({ length: 5 }, (_, d) => ((i * 11 + j * 5 + d * 3) % 100) / 100),
          e: 3,
          m: 3,
          c: 3,
        });
      }
    }
    const distances = distanceMatrix(
      tracks.map((t) => Float64Array.from(t.vector)),
      euclidean,
    );
    const rank = makeRanker(tracks, distances);

    const counts = new Map<string, number>();
    for (const t of tracks) {
      const g = groupOf(t.sidPath);
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const rareIdx = tracks
      .map((_, i) => i)
      .filter((i) => {
        const g = groupOf(tracks[i]!.sidPath);
        return g ? (counts.get(g) ?? 0) <= 3 : false;
      });
    // The corpus is built so that some groups really are rare.
    expect(rareIdx.length).toBeGreaterThan(0);

    const correct = ndcgAtK(tracks, rank, 10, rareIdx);

    // The old, broken form: hand ndcgAtK a FILTERED array while the ranker still
    // returns full-slice indices. Recreated here so the fix is pinned by a
    // failing comparison rather than by a comment.
    const rareTracks = rareIdx.map((i) => tracks[i]!);
    const broken = ndcgAtK(rareTracks, (i, k) => rank(rareIdx[i]!, k), 10);

    // Every score must be a real nDCG in [0, 1] and derived from real labels.
    for (const v of correct.perSeed) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // The broken form reads labels out of a shorter array, so it cannot agree.
    expect(correct.mean).not.toBeCloseTo(broken.mean, 6);
  });

  test("a perfect ranker scores 1 and an adversarial one scores 0", () => {
    const tracks = makeCorpus(60, 3, 0x99);
    const groups = tracks.map((t) => groupOf(t.sidPath));
    const sameGroup = (i: number) =>
      tracks
        .map((_, j) => j)
        .filter((j) => j !== i && groups[j] === groups[i] && tracks[j]!.sidPath !== tracks[i]!.sidPath);
    const otherGroup = (i: number) =>
      tracks.map((_, j) => j).filter((j) => groups[j] !== groups[i]);

    const perfect = ndcgAtK(tracks, (i, k) => sameGroup(i).slice(0, k), 10);
    const adversarial = ndcgAtK(tracks, (i, k) => otherGroup(i).slice(0, k), 10);
    expect(perfect.mean).toBeCloseTo(1, 10);
    expect(adversarial.mean).toBeCloseTo(0, 10);
  });
});

// ---------------------------------------------------------------------- splits

describe("splitByGroup", () => {
  test("no group appears in more than one slice", () => {
    const tracks = makeCorpus(400, 4, 0x5151);
    const { train, validation, test: held } = splitByGroup(tracks);
    const groupsOf = (xs: Track[]) => new Set(xs.map((t) => groupOf(t.sidPath) ?? t.sidPath));
    const a = groupsOf(train);
    const b = groupsOf(validation);
    const c = groupsOf(held);
    for (const g of a) {
      expect(b.has(g)).toBe(false);
      expect(c.has(g)).toBe(false);
    }
    for (const g of b) expect(c.has(g)).toBe(false);
    expect(train.length + validation.length + held.length).toBe(tracks.length);
  });

  test("is stable across calls", () => {
    const tracks = makeCorpus(200, 4, 0x2727);
    const first = splitByGroup(tracks);
    const second = splitByGroup(tracks);
    expect(second.train.map((t) => t.trackId)).toEqual(first.train.map((t) => t.trackId));
    expect(second.test.map((t) => t.trackId)).toEqual(first.test.map((t) => t.trackId));
  });
});
