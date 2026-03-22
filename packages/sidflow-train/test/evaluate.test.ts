import { describe, expect, it } from "bun:test";
import { evaluateChallenger } from "../src/evaluate.js";
import { initModel } from "../src/metric-learning.js";
import type { DerivedTrainingPairs } from "../src/pair-builder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIM = 24;

function makeVec(basisIdx: number, scale = 1.0): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[basisIdx % DIM] = scale;
  return v;
}

/** Build a simple evaluation scenario where the challenger knows positive pairs perfectly. */
function buildScenario(): {
  embeddings: Map<string, number[]>;
  holdout: DerivedTrainingPairs;
} {
  const embeddings = new Map<string, number[]>();

  // 10 "liked-together" pairs (same basis direction = highly similar)
  for (let i = 0; i < 10; i++) {
    embeddings.set(`pos-a-${i}`, makeVec(0, 1.0));
    embeddings.set(`pos-b-${i}`, makeVec(0, 0.95));
  }
  // 10 "disliked" tracks (different basis direction = dissimilar)
  for (let i = 0; i < 10; i++) {
    embeddings.set(`neg-${i}`, makeVec(12, 1.0));
  }

  const positive = Array.from({ length: 10 }, (_, i) => ({
    anchor: `pos-a-${i}`,
    other: `pos-b-${i}`,
    pairType: "positive" as const,
    weight: 0.7,
  }));
  const negative = Array.from({ length: 10 }, (_, i) => ({
    anchor: `pos-a-${i}`,
    other: `neg-${i}`,
    pairType: "negative" as const,
    weight: 0.8,
  }));
  const triplets = Array.from({ length: 10 }, (_, i) => ({
    anchor: `pos-a-${i}`,
    positive: `pos-b-${i}`,
    negative: `neg-${i}`,
    weight: 0.7,
  }));

  const holdout: DerivedTrainingPairs = {
    positive,
    negative,
    triplets,
    ranking: [],
  };

  return { embeddings, holdout };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evaluateChallenger", () => {
  it("returns a structured EvaluationResult", () => {
    const { embeddings, holdout } = buildScenario();
    const challenger = initModel(42);
    const result = evaluateChallenger(null, challenger, holdout, embeddings);

    expect(result).toBeDefined();
    expect(Array.isArray(result.metrics)).toBe(true);
    expect(result.metrics.length).toBe(5);
    expect(typeof result.passed).toBe("number");
    expect(typeof result.required).toBe("number");
    expect(typeof result.promote).toBe("boolean");
    expect(typeof result.summary).toBe("string");
  });

  it("all 5 named metrics are present", () => {
    const { embeddings, holdout } = buildScenario();
    const challenger = initModel(42);
    const result = evaluateChallenger(null, challenger, holdout, embeddings);

    const names = result.metrics.map((m) => m.name);
    expect(names).toContain("holdout_accuracy");
    expect(names).toContain("coherence");
    expect(names).toContain("diversity");
    expect(names).toContain("drift");
    expect(names).toContain("feedback_correlation");
  });

  it("metric values are finite numbers", () => {
    const { embeddings, holdout } = buildScenario();
    const challenger = initModel(42);
    const result = evaluateChallenger(null, challenger, holdout, embeddings);

    for (const m of result.metrics) {
      expect(Number.isFinite(m.value)).toBe(true);
    }
  });

  it("promote is true when ≥3 metrics pass", () => {
    const { embeddings, holdout } = buildScenario();
    const challenger = initModel(42);
    const result = evaluateChallenger(null, challenger, holdout, embeddings);

    // Verify the promote flag is consistent with the pass count
    if (result.passed >= result.required) {
      expect(result.promote).toBe(true);
    } else {
      expect(result.promote).toBe(false);
    }
  });

  it("no champion (null) = identity baseline: drift should be checked against untransformed embedding", () => {
    const { embeddings, holdout } = buildScenario();
    const challenger = initModel(1);
    const result = evaluateChallenger(null, challenger, holdout, embeddings);
    // Drift metric should exist and have a finite value
    const driftMetric = result.metrics.find((m) => m.name === "drift");
    expect(driftMetric).toBeDefined();
    expect(Number.isFinite(driftMetric!.value)).toBe(true);
  });

  it("summary string contains all metric names", () => {
    const { embeddings, holdout } = buildScenario();
    const challenger = initModel(42);
    const result = evaluateChallenger(null, challenger, holdout, embeddings);
    expect(result.summary).toContain("holdout_accuracy");
    expect(result.summary).toContain("coherence");
    expect(result.summary).toContain("diversity");
    expect(result.summary).toContain("drift");
    expect(result.summary).toContain("feedback_correlation");
  });

  it("handles empty holdout pairs gracefully", () => {
    const embeddings = new Map<string, number[]>();
    const holdout: DerivedTrainingPairs = {
      positive: [],
      negative: [],
      triplets: [],
      ranking: [],
    };
    const challenger = initModel(42);
    const result = evaluateChallenger(null, challenger, holdout, embeddings);
    // Should not throw; metrics may be 0
    expect(result).toBeDefined();
    expect(result.metrics.length).toBe(5);
  });

  it("holdout_accuracy is in [0, 1]", () => {
    const { embeddings, holdout } = buildScenario();
    const challenger = initModel(42);
    const result = evaluateChallenger(null, challenger, holdout, embeddings);
    const acc = result.metrics.find((m) => m.name === "holdout_accuracy")!;
    expect(acc.value).toBeGreaterThanOrEqual(0);
    expect(acc.value).toBeLessThanOrEqual(1);
  });

  it("drift is non-negative", () => {
    const { embeddings, holdout } = buildScenario();
    const champion = initModel(1);
    const challenger = initModel(2);
    const result = evaluateChallenger(champion, challenger, holdout, embeddings);
    const drift = result.metrics.find((m) => m.name === "drift")!;
    expect(drift.value).toBeGreaterThanOrEqual(0);
  });
});
