/**
 * Tests for the diversifying selection rule and the navigable construction.
 *
 * The rule is stated in two places — `doc/neighbour-graph-design.md` and
 * `similarity-neighbour-selection.ts` — and both are prose. These tests are where the rule is
 * stated executably, over geometries small enough that the right answer can be worked out by
 * hand rather than asserted from a previous run's output.
 */

import { describe, expect, test } from "bun:test";
// Imported from the modules directly rather than through `../src/index.js`: the barrel re-exports
// every module in the package, and pulling all of them in to test two pure functions costs seconds
// of start-up and gigabytes of resident memory.
import { buildNavigableNeighbourGraph } from "../src/similarity-graph-build.js";
import {
  pruneCandidates,
  selectDiversifiedNeighbours,
  type NeighbourCandidate,
} from "../src/similarity-neighbour-selection.js";

/**
 * Points on a line, so distances are differences and every expectation can be checked by hand.
 * Similarity is `1 - distance`, matching the selection rule's `d = 1 - s`.
 */
function lineGeometry(positions: number[]): {
  trackCount: number;
  similarityBetween: (left: number, right: number) => number;
  candidates: NeighbourCandidate[][];
} {
  const trackCount = positions.length;
  const similarityBetween = (left: number, right: number): number =>
    1 - Math.abs(positions[left]! - positions[right]!);
  const candidates = positions.map((_, seed) => {
    const list: NeighbourCandidate[] = [];
    for (let other = 0; other < trackCount; other += 1) {
      if (other !== seed) {
        list.push({ trackOrdinal: other, similarity: similarityBetween(seed, other) });
      }
    }
    list.sort((a, b) => b.similarity - a.similarity || a.trackOrdinal - b.trackOrdinal);
    return list;
  });
  return { trackCount, similarityBetween, candidates };
}

const distanceFor = (
  similarityBetween: (left: number, right: number) => number,
) => (left: number, right: number, similarity?: number): number =>
  1 - (similarity ?? similarityBetween(left, right));

describe("the diversifying pruning rule", () => {
  test("drops a candidate reachable via one already kept", () => {
    // Seed at 0. Candidates at 0.10, 0.11 and 0.50.
    //   d(seed, 0.10) = 0.10, d(seed, 0.11) = 0.11, d(seed, 0.50) = 0.50
    //   d(0.10, 0.11) = 0.01, which is NOT > 0.11, so 0.11 is dropped: 0.10 reaches it.
    //   d(0.10, 0.50) = 0.40, which IS > 0.50? No — 0.40 <= 0.50, so 0.50 is also dropped.
    // At alpha = 1 the rule therefore keeps only the nearest of a collinear run, which is the
    // relative-neighbourhood-graph rule behaving exactly as advertised.
    const { similarityBetween, candidates } = lineGeometry([0, 0.1, 0.11, 0.5]);
    const kept = pruneCandidates(0, candidates[0]!, 3, 1, distanceFor(similarityBetween));
    expect(kept.map((candidate) => candidate.trackOrdinal)).toEqual([1]);
  });

  test("keeps a candidate in a different direction", () => {
    // Seed at 0.5 with neighbours either side. Neither reaches the other: the two are 0.8
    // apart while each is 0.4 from the seed, so both survive.
    const { similarityBetween, candidates } = lineGeometry([0.1, 0.5, 0.9]);
    const kept = pruneCandidates(1, candidates[1]!, 3, 1, distanceFor(similarityBetween));
    expect(kept.map((candidate) => candidate.trackOrdinal).sort()).toEqual([0, 2]);
  });

  test("a larger alpha retains more short edges", () => {
    // alpha multiplies d(w, v), so raising it makes the keep condition easier to satisfy.
    const { similarityBetween, candidates } = lineGeometry([0, 0.1, 0.11, 0.5]);
    const distance = distanceFor(similarityBetween);
    const strict = pruneCandidates(0, candidates[0]!, 3, 1, distance);
    const loose = pruneCandidates(0, candidates[0]!, 3, 20, distance);
    expect(loose.length).toBeGreaterThan(strict.length);
  });

  test("never returns more than the slot count, or the seed itself", () => {
    const { similarityBetween, candidates } = lineGeometry([0, 0.2, 0.45, 0.7, 0.95]);
    const kept = pruneCandidates(0, candidates[0]!, 2, 20, distanceFor(similarityBetween));
    expect(kept.length).toBe(2);
    expect(kept.some((candidate) => candidate.trackOrdinal === 0)).toBe(false);
  });
});

describe("selectDiversifiedNeighbours", () => {
  test("fills every slot the candidate lists can fill", () => {
    // The rule alone keeps one edge per track on a collinear corpus; backfill must take the
    // rows to three, because a sentinel where a real edge was available is capacity the
    // consumer paid for and did not get.
    const { trackCount, similarityBetween, candidates } = lineGeometry(
      Array.from({ length: 12 }, (_, index) => index / 11),
    );
    const { rows, stats } = selectDiversifiedNeighbours({
      trackCount,
      candidates,
      neighboursPerTrack: 3,
      alpha: 1,
      similarityBetween,
    });
    for (const row of rows) {
      expect(row.length).toBe(3);
    }
    expect(stats.emptySlots).toBe(0);
    expect(stats.backfilledSlots).toBeGreaterThan(0);
  });

  test("ships sentinels rather than invented edges when the corpus is too small", () => {
    const { trackCount, similarityBetween, candidates } = lineGeometry([0, 0.5]);
    const { rows, stats } = selectDiversifiedNeighbours({
      trackCount,
      candidates,
      neighboursPerTrack: 3,
      alpha: 1,
      similarityBetween,
    });
    expect(rows[0]!.length).toBe(1);
    expect(stats.emptySlots).toBe(4);
  });

  test("orders every row by descending similarity", () => {
    const { trackCount, similarityBetween, candidates } = lineGeometry(
      Array.from({ length: 20 }, (_, index) => Math.sin(index) / 2 + 0.5),
    );
    const { rows } = selectDiversifiedNeighbours({
      trackCount,
      candidates,
      neighboursPerTrack: 3,
      alpha: 1.2,
      similarityBetween,
    });
    for (const row of rows) {
      for (let slot = 1; slot < row.length; slot += 1) {
        expect(row[slot - 1]!.similarity).toBeGreaterThanOrEqual(row[slot]!.similarity);
      }
    }
  });

  test("contains no duplicate and no self edge", () => {
    const { trackCount, similarityBetween, candidates } = lineGeometry(
      Array.from({ length: 30 }, (_, index) => (index * 7 % 30) / 29),
    );
    const { rows } = selectDiversifiedNeighbours({
      trackCount,
      candidates,
      neighboursPerTrack: 3,
      alpha: 1.2,
      similarityBetween,
    });
    rows.forEach((row, seed) => {
      const targets = row.map((candidate) => candidate.trackOrdinal);
      expect(new Set(targets).size).toBe(targets.length);
      expect(targets).not.toContain(seed);
    });
  });

  test("reverse insertion raises in-degree", () => {
    // A corpus with one isolated cluster and one long tail, so pass 1 leaves tracks nothing
    // points at. Reverse insertion must reduce the count of those; it is the pass whose whole
    // purpose is bounding in-degree and keeping edges pointing back.
    const positions = [
      ...Array.from({ length: 20 }, (_, index) => index / 400),
      ...Array.from({ length: 20 }, (_, index) => 0.5 + index / 40),
    ];
    const { trackCount, similarityBetween, candidates } = lineGeometry(positions);
    const withReverse = selectDiversifiedNeighbours({
      trackCount,
      candidates,
      neighboursPerTrack: 3,
      alpha: 1,
      similarityBetween,
      reverseInsertion: true,
    });
    const withoutReverse = selectDiversifiedNeighbours({
      trackCount,
      candidates,
      neighboursPerTrack: 3,
      alpha: 1,
      similarityBetween,
      reverseInsertion: false,
    });
    const zeroInDegree = (rows: NeighbourCandidate[][]): number => {
      const inDegree = new Int32Array(trackCount);
      for (const row of rows) {
        for (const edge of row) {
          inDegree[edge.trackOrdinal]! += 1;
        }
      }
      return inDegree.reduce((count, degree) => (degree === 0 ? count + 1 : count), 0);
    };
    expect(withReverse.stats.reverseEdgesOffered).toBeGreaterThan(0);
    expect(zeroInDegree(withReverse.rows)).toBeLessThanOrEqual(zeroInDegree(withoutReverse.rows));
  });

  test("is deterministic", () => {
    const { trackCount, similarityBetween, candidates } = lineGeometry(
      Array.from({ length: 40 }, (_, index) => (index * 13 % 40) / 39),
    );
    const first = selectDiversifiedNeighbours({
      trackCount, candidates, neighboursPerTrack: 3, alpha: 1.2, similarityBetween,
    });
    const second = selectDiversifiedNeighbours({
      trackCount, candidates, neighboursPerTrack: 3, alpha: 1.2, similarityBetween,
    });
    expect(JSON.stringify(first.rows)).toBe(JSON.stringify(second.rows));
  });
});

describe("the navigable construction", () => {
  /**
   * A corpus in a ring, which is the smallest geometry that distinguishes a navigable graph
   * from a top-k one: the nearest neighbours of any point are its two ring neighbours, so a
   * top-k graph is the ring itself and has diameter n/2, while a graph with any long edge is
   * dramatically better connected.
   */
  function ringGeometry(count: number): {
    trackCount: number;
    similarityBetween: (left: number, right: number) => number;
    candidates: NeighbourCandidate[][];
  } {
    const angle = (index: number): number => (2 * Math.PI * index) / count;
    const similarityBetween = (left: number, right: number): number =>
      Math.cos(angle(left) - angle(right));
    const candidates = Array.from({ length: count }, (_, seed) => {
      const list: NeighbourCandidate[] = [];
      for (let other = 0; other < count; other += 1) {
        if (other !== seed) {
          list.push({ trackOrdinal: other, similarity: similarityBetween(seed, other) });
        }
      }
      list.sort((a, b) => b.similarity - a.similarity || a.trackOrdinal - b.trackOrdinal);
      return list.slice(0, 8);
    });
    return { trackCount: count, similarityBetween, candidates };
  }

  test("produces full rows with no duplicate or self edge", () => {
    const { trackCount, similarityBetween, candidates } = ringGeometry(60);
    const { rows } = buildNavigableNeighbourGraph({
      trackCount,
      neighboursPerTrack: 3,
      similarityBetween,
      candidates,
      alpha: 1.2,
      searchListSize: 16,
    });
    rows.forEach((row, seed) => {
      expect(row.length).toBe(3);
      const targets = row.map((candidate) => candidate.trackOrdinal);
      expect(new Set(targets).size).toBe(3);
      expect(targets).not.toContain(seed);
    });
  });

  test("leaves nothing unreachable once the repair has run", () => {
    const { trackCount, similarityBetween, candidates } = ringGeometry(80);
    const { rows, stats } = buildNavigableNeighbourGraph({
      trackCount,
      neighboursPerTrack: 3,
      similarityBetween,
      candidates,
      alpha: 1.2,
      searchListSize: 16,
    });
    const inDegree = new Int32Array(trackCount);
    for (const row of rows) {
      for (const edge of row) {
        inDegree[edge.trackOrdinal]! += 1;
      }
    }
    expect(stats.unreachableAfterRepair).toBe(0);
    expect([...inDegree].filter((degree) => degree === 0)).toEqual([]);
  });

  test("the repair never strips a track's last incoming edge", () => {
    const { trackCount, similarityBetween, candidates } = ringGeometry(50);
    const { rows } = buildNavigableNeighbourGraph({
      trackCount,
      neighboursPerTrack: 3,
      similarityBetween,
      candidates,
      alpha: 1,
      searchListSize: 12,
    });
    const inDegree = new Int32Array(trackCount);
    for (const row of rows) {
      for (const edge of row) {
        inDegree[edge.trackOrdinal]! += 1;
      }
    }
    expect(Math.min(...inDegree)).toBeGreaterThanOrEqual(1);
  });

  test("is deterministic", () => {
    const { trackCount, similarityBetween, candidates } = ringGeometry(48);
    const build = (): string => JSON.stringify(buildNavigableNeighbourGraph({
      trackCount,
      neighboursPerTrack: 3,
      similarityBetween,
      candidates,
      alpha: 1.2,
      searchListSize: 16,
    }).rows);
    expect(build()).toBe(build());
  });

  test("reaches edges the top-k candidate pool does not contain", () => {
    // The point of the construction. Each track's pool here is its 8 nearest ring neighbours;
    // a graph confined to that pool has no edge spanning more than 4 ring positions. The
    // construction must produce at least one that does, because its candidate pool comes from
    // a search over the whole graph rather than from the pool.
    const count = 120;
    const { trackCount, similarityBetween, candidates } = ringGeometry(count);
    const { rows } = buildNavigableNeighbourGraph({
      trackCount,
      neighboursPerTrack: 3,
      similarityBetween,
      candidates,
      alpha: 1.2,
      searchListSize: 24,
    });
    const ringDistance = (left: number, right: number): number => {
      const raw = Math.abs(left - right);
      return Math.min(raw, count - raw);
    };
    let longest = 0;
    rows.forEach((row, seed) => {
      for (const edge of row) {
        longest = Math.max(longest, ringDistance(seed, edge.trackOrdinal));
      }
    });
    expect(longest).toBeGreaterThan(4);
  });
});
