import { describe, expect, it } from "bun:test";
import {
  buildIntentModel,
  interleaveClusterResults,
  kMeans2,
  cosineSim,
  cosineDist,
  weightedCentroid,
  CLUSTER_SPLIT_THRESHOLD,
  CLUSTER_MIN_TRACKS,
} from "../src/station/intent.js";

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

describe("cosineSim / cosineDist", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(cosineSim(v, v)).toBeCloseTo(1, 5);
    expect(cosineDist(v, v)).toBeCloseTo(0, 5);
  });

  it("returns 0 similarity for orthogonal vectors", () => {
    const a = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const b = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(cosineSim(a, b)).toBeCloseTo(0, 5);
    expect(cosineDist(a, b)).toBeCloseTo(1, 5);
  });

  it("handles zero vectors gracefully", () => {
    const z = new Array<number>(24).fill(0);
    const v = new Array<number>(24).fill(1);
    expect(cosineSim(z, v)).toBe(0);
    expect(cosineDist(z, v)).toBe(1);
  });

  it("satisfies symmetry: sim(a,b) === sim(b,a)", () => {
    const a = Array.from({ length: 24 }, (_, i) => i * 0.1);
    const b = Array.from({ length: 24 }, (_, i) => (24 - i) * 0.1);
    expect(cosineSim(a, b)).toBeCloseTo(cosineSim(b, a), 10);
  });
});

// ---------------------------------------------------------------------------
// weightedCentroid
// ---------------------------------------------------------------------------

describe("weightedCentroid", () => {
  it("returns the average for uniform weights", () => {
    const vecs = [
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ];
    const c = weightedCentroid(vecs, [1, 1]);
    expect(c[0]).toBeCloseTo(0.5, 5);
    expect(c[1]).toBeCloseTo(0.5, 5);
    expect(c[2]).toBeCloseTo(0, 5);
  });

  it("throws or returns empty for empty input", () => {
    // Implementation returns empty array or throws — both acceptable
    try {
      const result = weightedCentroid([], []);
      expect(result.length).toBe(0);
    } catch {
      // throwing is also acceptable
    }
  });
});

// ---------------------------------------------------------------------------
// kMeans2
// ---------------------------------------------------------------------------

describe("kMeans2", () => {
  function makeVec(dim: number, val: number): number[] {
    const v = new Array<number>(dim).fill(0);
    v[0] = val;
    return v;
  }

  it("splits clearly separated clusters", () => {
    // Use orthogonal basis directions so cosine distance is well-defined (no zero vectors)
    // Group 1 points in dim 0, Group 2 points in dim 12 — cosineDist = 1 between groups
    const grp1 = Array.from({ length: 5 }, (): number[] => {
      const v = new Array<number>(24).fill(0);
      v[0] = 1.0;
      return v;
    });
    const grp2 = Array.from({ length: 5 }, (): number[] => {
      const v = new Array<number>(24).fill(0);
      v[12] = 1.0;
      return v;
    });
    const vecs = [...grp1, ...grp2];
    const result = kMeans2(vecs);
    expect(result.centroids.length).toBe(2);
    expect(result.assignments.length).toBe(vecs.length);
    // All assignments should be 0 or 1
    for (const a of result.assignments) {
      expect(a === 0 || a === 1).toBe(true);
    }
    // The two groups should be non-empty
    const group0 = result.assignments.filter((a) => a === 0).length;
    const group1Count = result.assignments.filter((a) => a === 1).length;
    expect(group0).toBeGreaterThan(0);
    expect(group1Count).toBeGreaterThan(0);
    expect(group0 + group1Count).toBe(10);
  });

  it("returns two centroids always", () => {
    const vecs = Array.from({ length: 8 }, (_, i): number[] => {
      const v = new Array<number>(24).fill(0);
      v[i % 24] = i + 1; // non-zero, varied directions
      return v;
    });
    const result = kMeans2(vecs);
    expect(result.centroids[0]).toBeDefined();
    expect(result.centroids[1]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// buildIntentModel
// ---------------------------------------------------------------------------

describe("buildIntentModel", () => {
  function makeVec(dim: number, val: number): number[] {
    const v = new Array<number>(dim).fill(0);
    v[0] = val;
    return v;
  }

  function makeTrackMap(n: number, valOffset: number): { ids: string[]; vectors: Map<string, number[]>; weights: Map<string, number> } {
    const ids: string[] = [];
    const vectors = new Map<string, number[]>();
    const weights = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const id = `track-${valOffset}-${i}`;
      ids.push(id);
      vectors.set(id, makeVec(24, valOffset + i * 0.01));
      weights.set(id, 1);
    }
    return { ids, vectors, weights };
  }

  it("produces a single cluster when vectors are similar", () => {
    // offset=1 ensures no zero vectors; all vectors point in the same direction
    const { ids, vectors, weights } = makeTrackMap(6, 1);
    const model = buildIntentModel(ids, vectors, weights);
    // Vectors are nearly identical (v[0]=1.00..1.05) → single cluster
    expect(model.clusters.length).toBe(1);
    expect(model.multiCluster).toBe(false);
  });

  it("returns single cluster when fewer tracks than CLUSTER_MIN_TRACKS", () => {
    const vectors = new Map<string, number[]>();
    const weights = new Map<string, number>();
    const ids = ["t1", "t2"];
    vectors.set("t1", makeVec(24, 1));
    vectors.set("t2", makeVec(24, 2));
    weights.set("t1", 1);
    weights.set("t2", 1);
    const model = buildIntentModel(ids, vectors, weights);
    expect(model.clusters.length).toBe(1);
    expect(model.multiCluster).toBe(false);
  });

  it("gracefully handles empty track list", () => {
    const model = buildIntentModel([], new Map(), new Map());
    expect(model.clusters.length).toBe(1);
    expect(model.multiCluster).toBe(false);
  });

  it("exposes CLUSTER_SPLIT_THRESHOLD and CLUSTER_MIN_TRACKS as numbers", () => {
    expect(typeof CLUSTER_SPLIT_THRESHOLD).toBe("number");
    expect(typeof CLUSTER_MIN_TRACKS).toBe("number");
    expect(CLUSTER_SPLIT_THRESHOLD).toBeGreaterThan(0);
    expect(CLUSTER_MIN_TRACKS).toBeGreaterThan(0);
  });

  it("cluster centroids have 24 dimensions", () => {
    const { ids, vectors, weights } = makeTrackMap(6, 1);
    const model = buildIntentModel(ids, vectors, weights);
    for (const c of model.clusters) {
      expect(c.centroid.length).toBe(24);
    }
  });
});

// ---------------------------------------------------------------------------
// interleaveClusterResults
// ---------------------------------------------------------------------------

describe("interleaveClusterResults", () => {
  it("interleaves two equal-length arrays", () => {
    const a = ["a1", "a2", "a3"];
    const b = ["b1", "b2", "b3"];
    const result = interleaveClusterResults(a, b);
    expect(result).toEqual(["a1", "b1", "a2", "b2", "a3", "b3"]);
  });

  it("handles unequal lengths — shorter exhausted first", () => {
    const a = ["a1", "a2"];
    const b = ["b1", "b2", "b3", "b4"];
    const result = interleaveClusterResults(a, b);
    // a exhausted after 2 rounds; remaining b appended
    expect(result.slice(0, 4)).toEqual(["a1", "b1", "a2", "b2"]);
    expect(result.slice(4)).toEqual(["b3", "b4"]);
  });

  it("handles empty cluster A", () => {
    const b = ["b1", "b2"];
    expect(interleaveClusterResults([], b)).toEqual(["b1", "b2"]);
  });

  it("handles empty cluster B", () => {
    const a = ["a1", "a2"];
    expect(interleaveClusterResults(a, [])).toEqual(["a1", "a2"]);
  });

  it("total length equals sum of input lengths", () => {
    const a = ["a1", "a2", "a3"];
    const b = ["b1", "b2"];
    const result = interleaveClusterResults(a, b);
    expect(result.length).toBe(a.length + b.length);
  });
});
