import { describe, expect, it } from "bun:test";
import {
  trainMetricModel,
  applyModel,
  initModel,
  INPUT_DIM,
  HIDDEN_DIM,
  OUTPUT_DIM,
} from "../src/metric-learning.js";
import type { DerivedTrainingPairs } from "../src/pair-builder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build N 24D vectors with a basis direction for easy separation. */
function makeVec(dim: number, basisIdx: number, scale = 1.0): number[] {
  const v = new Array<number>(dim).fill(0);
  v[basisIdx % dim] = scale;
  return v;
}

function makeEmbeddings(trackIds: string[], basisIdx: number): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const id of trackIds) {
    m.set(id, makeVec(INPUT_DIM, basisIdx));
  }
  return m;
}

function makeTriplets(count: number): DerivedTrainingPairs["triplets"] {
  return Array.from({ length: count }, (_, i) => ({
    anchor: `anchor-${i}`,
    positive: `positive-${i}`,
    negative: `negative-${i}`,
    weight: 1.0,
  }));
}

function makeRankingPairs(count: number): DerivedTrainingPairs["ranking"] {
  return Array.from({ length: count }, (_, i) => ({
    higher: `higher-${i}`,
    lower: `lower-${i}`,
    weight: 1.0,
  }));
}

// ---------------------------------------------------------------------------
// initModel
// ---------------------------------------------------------------------------

describe("initModel", () => {
  it("returns model with correct weight matrix dimensions", () => {
    const model = initModel(42);
    expect(model.W1.length).toBe(INPUT_DIM * HIDDEN_DIM);
    expect(model.b1.length).toBe(HIDDEN_DIM);
    expect(model.W2.length).toBe(HIDDEN_DIM * OUTPUT_DIM);
    expect(model.b2.length).toBe(OUTPUT_DIM);
  });

  it("produces different weights for different seeds", () => {
    const m1 = initModel(42);
    const m2 = initModel(99);
    const allSame = m1.W1.every((v, i) => v === m2.W1[i]);
    expect(allSame).toBe(false);
  });

  it("produces identical weights for same seed (determinism)", () => {
    const m1 = initModel(7);
    const m2 = initModel(7);
    const allSame = m1.W1.every((v, i) => v === m2.W1[i]);
    expect(allSame).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyModel
// ---------------------------------------------------------------------------

describe("applyModel", () => {
  it("returns a vector of OUTPUT_DIM length", () => {
    const model = initModel(42);
    const input = makeVec(INPUT_DIM, 0);
    const output = applyModel(model, input);
    expect(output.length).toBe(OUTPUT_DIM);
  });

  it("throws when input dimension is wrong", () => {
    const model = initModel(42);
    expect(() => applyModel(model, [1, 2, 3])).toThrow();
  });

  it("different inputs produce different outputs", () => {
    const model = initModel(42);
    const out1 = applyModel(model, makeVec(INPUT_DIM, 0));
    const out2 = applyModel(model, makeVec(INPUT_DIM, 12));
    const allSame = out1.every((v, i) => v === out2[i]);
    expect(allSame).toBe(false);
  });

  it("same input always produces same output (pure function)", () => {
    const model = initModel(42);
    const input = makeVec(INPUT_DIM, 5);
    const out1 = applyModel(model, input);
    const out2 = applyModel(model, input);
    out1.forEach((v, i) => expect(v).toBeCloseTo(out2[i]!, 10));
  });
});

// ---------------------------------------------------------------------------
// trainMetricModel — structural / convergence tests
// ---------------------------------------------------------------------------

describe("trainMetricModel", () => {
  it("returns a valid MetricModel with correct shape", () => {
    const triplets = makeTriplets(10);
    const ranking = makeRankingPairs(5);
    const allIds = [
      ...triplets.flatMap((t) => [t.anchor, t.positive, t.negative]),
      ...ranking.flatMap((r) => [r.higher, r.lower]),
    ];
    const embeddings = new Map<string, number[]>();
    for (const id of allIds) {
      embeddings.set(id, makeVec(INPUT_DIM, id.charCodeAt(0) % INPUT_DIM));
    }
    const pairs: DerivedTrainingPairs = { positive: [], negative: [], triplets, ranking };

    const result = trainMetricModel(pairs, embeddings, { epochs: 2, seed: 42 });

    expect(result.model.W1.length).toBe(INPUT_DIM * HIDDEN_DIM);
    expect(result.model.b1.length).toBe(HIDDEN_DIM);
    expect(result.model.W2.length).toBe(HIDDEN_DIM * OUTPUT_DIM);
    expect(result.model.b2.length).toBe(OUTPUT_DIM);
    expect(typeof result.finalLoss).toBe("number");
    expect(result.epochs).toBe(2);
  });

  it("loss is non-negative", () => {
    const triplets = makeTriplets(20);
    const allIds = triplets.flatMap((t) => [t.anchor, t.positive, t.negative]);
    const embeddings = new Map<string, number[]>();
    for (const id of allIds) {
      embeddings.set(id, makeVec(INPUT_DIM, id.charCodeAt(0) % INPUT_DIM));
    }
    const pairs: DerivedTrainingPairs = { positive: [], negative: [], triplets, ranking: [] };

    const result = trainMetricModel(pairs, embeddings, { epochs: 3, seed: 1 });
    expect(result.finalLoss).toBeGreaterThanOrEqual(0);
  });

  it("zero triplets / ranking produces 0 loss", () => {
    const pairs: DerivedTrainingPairs = { positive: [], negative: [], triplets: [], ranking: [] };
    const result = trainMetricModel(pairs, new Map(), { epochs: 5 });
    expect(result.finalLoss).toBe(0);
  });

  it("deterministic: same seed, same initial weights → identical loss", () => {
    const triplets = makeTriplets(30);
    const allIds = triplets.flatMap((t) => [t.anchor, t.positive, t.negative]);

    // Build embeddings where each positives is closer to anchor than negatives
    const embeddings = new Map<string, number[]>();
    for (const t of triplets) {
      embeddings.set(t.anchor, makeVec(INPUT_DIM, 0, 1.0));
      embeddings.set(t.positive, makeVec(INPUT_DIM, 0, 0.9));
      embeddings.set(t.negative, makeVec(INPUT_DIM, 12, 1.0));
    }
    const pairs: DerivedTrainingPairs = { positive: [], negative: [], triplets, ranking: [] };

    const r1 = trainMetricModel(pairs, embeddings, { epochs: 3, seed: 7 });
    const r2 = trainMetricModel(pairs, embeddings, { epochs: 3, seed: 7 });
    expect(r1.finalLoss).toBeCloseTo(r2.finalLoss, 8);
  });

  it("model converges: positive pairs should score higher than negative after training", () => {
    // Build clearly separable (anchor, positive, negative) triplets
    const MARGIN = 0.2;
    const triplets = Array.from({ length: 50 }, (_, i) => ({
      anchor: `anchor-${i}`,
      positive: `positive-${i}`,
      negative: `negative-${i}`,
      weight: 1.0,
    }));
    const embeddings = new Map<string, number[]>();
    for (const t of triplets) {
      // anchor and positive share dim=0; negative is in dim=12
      embeddings.set(t.anchor, makeVec(INPUT_DIM, 0, 1.0));
      embeddings.set(t.positive, makeVec(INPUT_DIM, 0, 0.95));
      embeddings.set(t.negative, makeVec(INPUT_DIM, 12, 1.0));
    }
    const pairs: DerivedTrainingPairs = { positive: [], negative: [], triplets, ranking: [] };

    // Train for more epochs to allow convergence
    const result = trainMetricModel(pairs, embeddings, {
      epochs: 10,
      learningRate: 1e-3,
      seed: 42,
    });

    // After training, positive should be closer to anchor than negative for most triplets
    let successes = 0;
    for (const t of triplets.slice(0, 10)) {
      const fa = applyModel(result.model, embeddings.get(t.anchor)!);
      const fp = applyModel(result.model, embeddings.get(t.positive)!);
      const fn = applyModel(result.model, embeddings.get(t.negative)!);

      function dot(a: number[], b: number[]): number {
        let s = 0;
        for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
        return s;
      }
      function norm(a: number[]): number {
        return Math.sqrt(dot(a, a));
      }
      function cosSim(a: number[], b: number[]): number {
        const na = norm(a), nb = norm(b);
        if (na === 0 || nb === 0) return 0;
        return dot(a, b) / (na * nb);
      }

      if (cosSim(fa, fp) > cosSim(fa, fn)) successes++;
    }
    // At least half of the test triplets should be correctly ordered
    expect(successes).toBeGreaterThanOrEqual(5);
  });
});
