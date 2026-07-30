/**
 * The flow order and the forward edge selection, tested without an export chain.
 *
 * These are the two functions that decide whether a station can keep going. The
 * artefact-level consequences are covered by `similarity-export-tiny-flow.test.ts`; this
 * file pins the properties those consequences rest on, at a size where a failure points
 * straight at the cause.
 */

import { describe, expect, test } from "bun:test";

import { computeFlowOrder, selectForwardNeighbors, type FlowOrderCandidate } from "../src/similarity-flow-order.js";

/**
 * A ring of tracks whose similarity falls off with distance around the ring, so the
 * greedy order has an obvious right answer to be checked against.
 */
function buildRing(trackCount: number, candidatesPerTrack: number, fileOrdinals?: number[]): {
  candidates: FlowOrderCandidate[][];
  similarityBetween: (left: number, right: number) => number;
  fileOrdinals: number[];
} {
  const distance = (left: number, right: number): number => {
    const raw = Math.abs(left - right);
    return Math.min(raw, trackCount - raw);
  };
  const similarityBetween = (left: number, right: number): number => 1 / (1 + distance(left, right));
  const candidates = Array.from({ length: trackCount }, (_unused, seed) =>
    Array.from({ length: trackCount }, (_ignored, target) => target)
      .filter((target) => target !== seed)
      .map((target) => ({ trackOrdinal: target, similarity: similarityBetween(seed, target) }))
      .sort((left, right) => right.similarity - left.similarity || left.trackOrdinal - right.trackOrdinal)
      .slice(0, candidatesPerTrack));
  return {
    candidates,
    similarityBetween,
    fileOrdinals: fileOrdinals ?? Array.from({ length: trackCount }, (_unused, index) => index),
  };
}

/**
 * Tight clusters with nothing linking them.
 *
 * A ring never strands a greedy walk — the next track along is always still listed — so it
 * cannot exercise the full-scan fallback. Clusters can: once a cluster's listed members are
 * used up, the only way on is a scan, and the track it lands on is by construction not in
 * the list. That is the shape a real corpus has, and it is where the guarantee has to hold.
 */
function buildClusters(clusterCount: number, perCluster: number, candidatesPerTrack: number): {
  trackCount: number;
  candidates: FlowOrderCandidate[][];
  similarityBetween: (left: number, right: number) => number;
  fileOrdinals: number[];
} {
  const trackCount = clusterCount * perCluster;
  const clusterOf = (ordinal: number): number => Math.floor(ordinal / perCluster);
  const similarityBetween = (left: number, right: number): number => {
    if (left === right) {
      return 1;
    }
    return clusterOf(left) === clusterOf(right)
      ? 0.9 - (0.001 * Math.abs(left - right))
      : 0.1 - (0.0001 * Math.abs(clusterOf(left) - clusterOf(right)));
  };
  const candidates = Array.from({ length: trackCount }, (_unused, seed) =>
    Array.from({ length: trackCount }, (_ignored, target) => target)
      .filter((target) => target !== seed)
      .map((target) => ({ trackOrdinal: target, similarity: similarityBetween(seed, target) }))
      .sort((left, right) => right.similarity - left.similarity || left.trackOrdinal - right.trackOrdinal)
      .slice(0, candidatesPerTrack));
  return {
    trackCount,
    candidates,
    similarityBetween,
    fileOrdinals: Array.from({ length: trackCount }, (_unused, index) => index),
  };
}

describe("flow order", () => {
  test("visits every track exactly once", () => {
    const trackCount = 200;
    const ring = buildRing(trackCount, 8);
    const flow = computeFlowOrder({ trackCount, ...ring });

    expect(flow.order.length).toBe(trackCount);
    expect(new Set(flow.order).size).toBe(trackCount);
    for (let index = 0; index < trackCount; index += 1) {
      expect(flow.rankByTrackOrdinal[flow.order[index]!]).toBe(index);
    }
  });

  test("falls back to a full scan only when a candidate list is used up, and stays exact", () => {
    // Six candidates each across ten clusters of twenty: the walk exhausts a track's list
    // repeatedly and must still find the nearest unvisited track rather than stopping.
    const narrow = buildClusters(10, 20, 6);
    // With the whole corpus listed, the shortcut is always available.
    const wide = buildClusters(10, 20, (10 * 20) - 1);
    const narrowFlow = computeFlowOrder(narrow);
    const wideFlow = computeFlowOrder(wide);

    expect(narrowFlow.fullScanSteps).toBeGreaterThan(0);
    expect(wideFlow.fullScanSteps).toBe(0);
    // The shortcut is exact, so the shorter lists produce the identical order.
    expect([...narrowFlow.order]).toEqual([...wideFlow.order]);
  });

  test("is deterministic", () => {
    const trackCount = 120;
    const first = computeFlowOrder({ trackCount, ...buildRing(trackCount, 6) });
    const second = computeFlowOrder({ trackCount, ...buildRing(trackCount, 6) });
    expect([...first.order]).toEqual([...second.order]);
  });

  test("does not walk one file's subsongs back to back while another file is available", () => {
    // Four files of three subsongs each. Subsongs of one file are each other's nearest
    // neighbours by a wide margin, which is what makes the unconstrained greedy walk stack
    // them — the same defect the 14.42% rank-1 sibling rate shows on the real corpus.
    const trackCount = 12;
    const fileOf = (ordinal: number): number => Math.floor(ordinal / 3);
    const similarityBetween = (left: number, right: number): number =>
      (fileOf(left) === fileOf(right) ? 0.99 : 0.9 - (0.01 * Math.abs(left - right)));
    const candidates = Array.from({ length: trackCount }, (_unused, seed) =>
      Array.from({ length: trackCount }, (_ignored, target) => target)
        .filter((target) => target !== seed)
        .map((target) => ({ trackOrdinal: target, similarity: similarityBetween(seed, target) }))
        .sort((left, right) => right.similarity - left.similarity || left.trackOrdinal - right.trackOrdinal));

    const flow = computeFlowOrder({
      trackCount,
      candidates,
      similarityBetween,
      fileOrdinals: Array.from({ length: trackCount }, (_unused, index) => fileOf(index)),
    });

    // Only the very last step may be forced onto a sibling, and on this corpus not even
    // that: every file still has an unvisited member until the end.
    let adjacentSiblings = 0;
    for (let index = 1; index < trackCount; index += 1) {
      if (fileOf(flow.order[index]!) === fileOf(flow.order[index - 1]!)) {
        adjacentSiblings += 1;
      }
    }
    expect(adjacentSiblings).toBe(0);
    expect(flow.siblingSteps).toBe(0);
  });
});

describe("forward neighbour selection", () => {
  test("puts the flow successor in slot 0 and never points backwards", () => {
    const trackCount = 200;
    const ring = buildRing(trackCount, 8);
    const flow = computeFlowOrder({ trackCount, ...ring });
    const selected = selectForwardNeighbors({
      trackCount,
      flow,
      candidates: ring.candidates,
      similarityBetween: ring.similarityBetween,
      neighborsPerTrack: 3,
    });

    const last = flow.order[trackCount - 1]!;
    for (let trackOrdinal = 0; trackOrdinal < trackCount; trackOrdinal += 1) {
      const rank = flow.rankByTrackOrdinal[trackOrdinal]!;
      const row = selected[trackOrdinal]!;
      expect(row.length).toBeLessThanOrEqual(3);
      for (const edge of row) {
        expect(flow.rankByTrackOrdinal[edge.trackOrdinal]!).toBeGreaterThan(rank);
      }
      if (trackOrdinal === last) {
        expect(row.length).toBe(0);
      } else {
        expect(row[0]?.trackOrdinal).toBe(flow.order[rank + 1]!);
      }
    }
  });

  test("the selected edges carry a path over the whole corpus", () => {
    const trackCount = 200;
    const ring = buildRing(trackCount, 8);
    const flow = computeFlowOrder({ trackCount, ...ring });
    const selected = selectForwardNeighbors({
      trackCount,
      flow,
      candidates: ring.candidates,
      similarityBetween: ring.similarityBetween,
      neighborsPerTrack: 3,
    });

    // Follow slot 0 from the start of the order: it must reach every track.
    let current = flow.order[0]!;
    const visited = new Set<number>([current]);
    while (selected[current]!.length > 0) {
      current = selected[current]![0]!.trackOrdinal;
      expect(visited.has(current)).toBe(false);
      visited.add(current);
    }
    expect(visited.size).toBe(trackCount);
  });

  test("slot 1 is the forward candidate that jumps furthest along the stream", () => {
    // The shortcut is what makes the stream navigable to a consumer that explores a bounded
    // neighbourhood instead of walking it. Without it the exported graph is a long thin
    // path and an 8-hop expansion sees only 8 steps of it.
    const clusters = buildClusters(10, 20, 6);
    const { trackCount, candidates, similarityBetween } = clusters;
    const flow = computeFlowOrder(clusters);
    const selected = selectForwardNeighbors({
      trackCount,
      flow,
      candidates,
      similarityBetween,
      neighborsPerTrack: 3,
    });

    let checked = 0;
    for (let trackOrdinal = 0; trackOrdinal < trackCount; trackOrdinal += 1) {
      const rank = flow.rankByTrackOrdinal[trackOrdinal]!;
      const successor = rank + 1 < trackCount ? flow.order[rank + 1]! : -1;
      let furthest = 0;
      for (const candidate of candidates[trackOrdinal]!) {
        if (candidate.trackOrdinal === successor) {
          continue;
        }
        furthest = Math.max(furthest, flow.rankByTrackOrdinal[candidate.trackOrdinal]! - rank);
      }
      if (furthest <= 0) {
        continue;
      }
      checked += 1;
      const shortcut = selected[trackOrdinal]![1]!;
      expect(flow.rankByTrackOrdinal[shortcut.trackOrdinal]! - rank).toBe(furthest);
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("a successor missing from the candidate list still gets an edge with a real similarity", () => {
    // Every cluster hand-off leaves the flow order on a track whose successor is in a
    // different cluster and therefore not in its candidate list. The selection has to
    // compute that similarity rather than drop the edge — dropping it is exactly what would
    // break the corpus-spanning guarantee at the sparse end of a real corpus.
    const clusters = buildClusters(10, 20, 6);
    const { trackCount, candidates, similarityBetween } = clusters;
    const flow = computeFlowOrder(clusters);
    const selected = selectForwardNeighbors({
      trackCount,
      flow,
      candidates,
      similarityBetween,
      neighborsPerTrack: 3,
    });

    let computedSuccessors = 0;
    for (let trackOrdinal = 0; trackOrdinal < trackCount; trackOrdinal += 1) {
      const rank = flow.rankByTrackOrdinal[trackOrdinal]!;
      if (rank + 1 >= trackCount) {
        continue;
      }
      const successor = flow.order[rank + 1]!;
      expect(selected[trackOrdinal]![0]?.trackOrdinal).toBe(successor);
      expect(selected[trackOrdinal]![0]!.similarity).toBeCloseTo(
        similarityBetween(trackOrdinal, successor),
        12,
      );
      if (!candidates[trackOrdinal]!.some((candidate) => candidate.trackOrdinal === successor)) {
        computedSuccessors += 1;
      }
    }
    expect(computedSuccessors).toBeGreaterThan(0);
  });
});
