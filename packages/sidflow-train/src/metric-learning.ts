/**
 * D2: Metric-learning MLP (24 → 48 → 24) trained on triplets + ranking pairs.
 *
 * Fully pure TypeScript — no TensorFlow or external ML libraries.
 *
 * Architecture:
 *   input  24 → dense 48 (ReLU) → output 24 (linear)
 *
 * Losses:
 *   - Triplet loss:  max(0, d(a, p) - d(a, n) + MARGIN)
 *   - Ranking loss:  max(0, score(neg) - score(pos) + MARGIN)
 *
 * Optimizer: Adam (β1=0.9, β2=0.999, ε=1e-8).
 */

import type { DerivedTrainingPairs, TrainingTriplet, RankingPair } from "./pair-builder.js";

// ---------------------------------------------------------------------------
// Hyperparameters
// ---------------------------------------------------------------------------

export const INPUT_DIM = 24;
export const HIDDEN_DIM = 48;
export const OUTPUT_DIM = 24;
const TRIPLET_MARGIN = 0.2;
const RANKING_MARGIN = 0.1;
const DEFAULT_EPOCHS = 20;
const DEFAULT_BATCH = 64;
const DEFAULT_LR = 1e-3;
const ADAM_BETA1 = 0.9;
const ADAM_BETA2 = 0.999;
const ADAM_EPS = 1e-8;
const TRIPLET_WEIGHT = 1.0;
const RANKING_WEIGHT = 0.5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricModel {
  /** W1 is INPUT_DIM × HIDDEN_DIM stored row-major (INPUT_DIM rows). */
  W1: number[];
  b1: number[];
  /** W2 is HIDDEN_DIM × OUTPUT_DIM stored row-major (HIDDEN_DIM rows). */
  W2: number[];
  b2: number[];
  /** Training metadata */
  trainedAt: string;
  version: number;
}

export interface TrainOptions {
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  /** 32-bit integer seed for reproducibility */
  seed?: number;
}

export interface TrainResult {
  model: MetricModel;
  finalLoss: number;
  epochs: number;
}

// ---------------------------------------------------------------------------
// PRNG (mulberry32 — fast, seedable, 32-bit)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Weight initialization (He initialization for ReLU)
// ---------------------------------------------------------------------------

function heInit(fanIn: number, size: number, rand: () => number): number[] {
  const std = Math.sqrt(2 / fanIn);
  return Array.from({ length: size }, () => {
    // Box-Muller for normal distribution
    const u1 = Math.max(1e-9, rand());
    const u2 = rand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z * std;
  });
}

export function initModel(seed = 42): MetricModel {
  const rand = mulberry32(seed);
  return {
    W1: heInit(INPUT_DIM, INPUT_DIM * HIDDEN_DIM, rand),
    b1: new Array(HIDDEN_DIM).fill(0),
    W2: heInit(HIDDEN_DIM, HIDDEN_DIM * OUTPUT_DIM, rand),
    b2: new Array(OUTPUT_DIM).fill(0),
    trainedAt: new Date().toISOString(),
    version: 0,
  };
}

// ---------------------------------------------------------------------------
// Forward pass
// ---------------------------------------------------------------------------

function relu(x: number): number {
  return x > 0 ? x : 0;
}

/**
 * Forward pass through the MLP.
 * Returns { output, hidden } for backprop.
 */
function forward(
  model: MetricModel,
  input: number[]
): { output: number[]; hidden: number[] } {
  // Layer 1: input → hidden (ReLU)
  const hidden = new Array<number>(HIDDEN_DIM);
  for (let j = 0; j < HIDDEN_DIM; j++) {
    let sum = model.b1[j]!;
    for (let i = 0; i < INPUT_DIM; i++) {
      sum += input[i]! * model.W1[i * HIDDEN_DIM + j]!;
    }
    hidden[j] = relu(sum);
  }

  // Layer 2: hidden → output (linear)
  const output = new Array<number>(OUTPUT_DIM);
  for (let k = 0; k < OUTPUT_DIM; k++) {
    let sum = model.b2[k]!;
    for (let j = 0; j < HIDDEN_DIM; j++) {
      sum += hidden[j]! * model.W2[j * OUTPUT_DIM + k]!;
    }
    output[k] = sum;
  }

  return { output, hidden };
}

// ---------------------------------------------------------------------------
// Distance and similarity helpers
// ---------------------------------------------------------------------------

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

function cosineDist(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 1;
  return 1 - dot(a, b) / (na * nb);
}

// ---------------------------------------------------------------------------
// Gradient accumulator  
// ---------------------------------------------------------------------------

interface Gradients {
  dW1: number[];
  db1: number[];
  dW2: number[];
  db2: number[];
}

function zeroGrads(): Gradients {
  return {
    dW1: new Array(INPUT_DIM * HIDDEN_DIM).fill(0),
    db1: new Array(HIDDEN_DIM).fill(0),
    dW2: new Array(HIDDEN_DIM * OUTPUT_DIM).fill(0),
    db2: new Array(OUTPUT_DIM).fill(0),
  };
}

function addGrads(acc: Gradients, delta: Gradients): void {
  for (let i = 0; i < acc.dW1.length; i++) acc.dW1[i]! += delta.dW1[i]!;
  for (let i = 0; i < acc.db1.length; i++) acc.db1[i]! += delta.db1[i]!;
  for (let i = 0; i < acc.dW2.length; i++) acc.dW2[i]! += delta.dW2[i]!;
  for (let i = 0; i < acc.db2.length; i++) acc.db2[i]! += delta.db2[i]!;
}

/**
 * Backprop gradients for dLoss/dOutput (output layer gradient signal).
 */
function backprop(
  model: MetricModel,
  input: number[],
  hidden: number[],
  dOutput: number[]
): Gradients {
  const g = zeroGrads();

  // dL/dW2 = hidden^T × dOutput
  for (let j = 0; j < HIDDEN_DIM; j++) {
    for (let k = 0; k < OUTPUT_DIM; k++) {
      g.dW2[j * OUTPUT_DIM + k] = hidden[j]! * dOutput[k]!;
    }
    g.db2[j] = 0; // db2 handled below
  }
  for (let k = 0; k < OUTPUT_DIM; k++) {
    g.db2[k] = dOutput[k]!;
  }

  // dL/dHidden = dOutput × W2^T, masked by ReLU
  const dHidden = new Array<number>(HIDDEN_DIM).fill(0);
  for (let j = 0; j < HIDDEN_DIM; j++) {
    for (let k = 0; k < OUTPUT_DIM; k++) {
      dHidden[j] += dOutput[k]! * model.W2[j * OUTPUT_DIM + k]!;
    }
    // ReLU gate (hidden[j] > 0 means pre-activation was > 0)
    dHidden[j] *= hidden[j]! > 0 ? 1 : 0;
  }

  // dL/dW1 = input^T × dHidden
  for (let i = 0; i < INPUT_DIM; i++) {
    for (let j = 0; j < HIDDEN_DIM; j++) {
      g.dW1[i * HIDDEN_DIM + j] = input[i]! * dHidden[j]!;
    }
  }
  for (let j = 0; j < HIDDEN_DIM; j++) {
    g.db1[j] = dHidden[j]!;
  }

  return g;
}

// ---------------------------------------------------------------------------
// Cosine-dist gradient w.r.t. embedding
// ---------------------------------------------------------------------------

/**
 * Gradient of cosine_distance(a, b) w.r.t. a.
 */
function dCosineDist_dA(a: number[], b: number[]): number[] {
  const na = norm(a);
  const nb = norm(b);
  if (na < 1e-9 || nb < 1e-9) return new Array(a.length).fill(0);

  const sim = dot(a, b) / (na * nb);
  const grad = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) {
    // d/da_i [1 - (a·b)/(‖a‖·‖b‖)]
    grad[i] = -(b[i]! / (na * nb) - a[i]! * sim / (na * na));
  }
  return grad;
}

// ---------------------------------------------------------------------------
// Triplet loss gradient pass
// ---------------------------------------------------------------------------

function tripletGrad(
  model: MetricModel,
  anchor: number[],
  positive: number[],
  negative: number[],
  weight: number
): { loss: number; grads: Gradients[] } | null {
  const fa = forward(model, anchor);
  const fp = forward(model, positive);
  const fn = forward(model, negative);

  const dAP = cosineDist(fa.output, fp.output);
  const dAN = cosineDist(fa.output, fn.output);
  const loss = Math.max(0, dAP - dAN + TRIPLET_MARGIN) * weight * TRIPLET_WEIGHT;

  if (loss <= 0) return null; // Non-contributing triplet — skip

  const scale = weight * TRIPLET_WEIGHT;

  // Gradient of d_AP w.r.t. f(anchor), f(positive)
  const dDap_dFa = dCosineDist_dA(fa.output, fp.output);
  const dDap_dFp = dCosineDist_dA(fp.output, fa.output);

  // Gradient of d_AN w.r.t. f(anchor), f(negative)
  const dDan_dFa = dCosineDist_dA(fa.output, fn.output);
  const dDan_dFn = dCosineDist_dA(fn.output, fa.output);

  // dL/d_f = scale * (dD_AP/dF - dD_AN/dF)
  const dLoss_dFa = dDap_dFa.map((v, i) => scale * (v - dDan_dFa[i]!));
  const dLoss_dFp = dDap_dFp.map((v) => scale * v);
  const dLoss_dFn = dDan_dFn.map((v) => -scale * v);

  return {
    loss,
    grads: [
      backprop(model, anchor, fa.hidden, dLoss_dFa),
      backprop(model, positive, fp.hidden, dLoss_dFp),
      backprop(model, negative, fn.hidden, dLoss_dFn),
    ],
  };
}

// ---------------------------------------------------------------------------
// Ranking pair loss gradient (margin ranking: dot-product similarity)
// ---------------------------------------------------------------------------

function rankingGrad(
  model: MetricModel,
  higher: number[],
  lower: number[],
  weight: number
): { loss: number; grads: Gradients[] } | null {
  const fh = forward(model, higher);
  const fl = forward(model, lower);

  // For ranking: we want sim(h, h) > sim(l, l) ... too abstract.
  // More concretely: we want the higher-rated track to be closer to itself
  // (self-embedding norm), but typically: we use intra-embedding cosine to
  // the origin — or simply use the (negated) cosine distance from the higher
  // to the query centroid. Here we use the simpler intra-pair approach:
  // score_higher > score_lower where score = ‖embedding‖₂² (magnitude proxy).
  const scoreH = dot(fh.output, fh.output);
  const scoreL = dot(fl.output, fl.output);
  const loss = Math.max(0, scoreL - scoreH + RANKING_MARGIN) * weight * RANKING_WEIGHT;

  if (loss <= 0) return null;

  const scale = weight * RANKING_WEIGHT;

  // dL/d_scoreH = -scale × 2 × fh.output
  const dLoss_dFh = fh.output.map((v) => -scale * 2 * v);
  // dL/d_scoreL = +scale × 2 × fl.output
  const dLoss_dFl = fl.output.map((v) => scale * 2 * v);

  return {
    loss,
    grads: [
      backprop(model, higher, fh.hidden, dLoss_dFh),
      backprop(model, lower, fl.hidden, dLoss_dFl),
    ],
  };
}

// ---------------------------------------------------------------------------
// Adam optimizer state
// ---------------------------------------------------------------------------

interface AdamState {
  mW1: number[]; vW1: number[];
  mb1: number[]; vb1: number[];
  mW2: number[]; vW2: number[];
  mb2: number[]; vb2: number[];
  t: number;
}

function initAdam(): AdamState {
  return {
    mW1: new Array(INPUT_DIM * HIDDEN_DIM).fill(0),
    vW1: new Array(INPUT_DIM * HIDDEN_DIM).fill(0),
    mb1: new Array(HIDDEN_DIM).fill(0),
    vb1: new Array(HIDDEN_DIM).fill(0),
    mW2: new Array(HIDDEN_DIM * OUTPUT_DIM).fill(0),
    vW2: new Array(HIDDEN_DIM * OUTPUT_DIM).fill(0),
    mb2: new Array(OUTPUT_DIM).fill(0),
    vb2: new Array(OUTPUT_DIM).fill(0),
    t: 0,
  };
}

function adamStep(
  model: MetricModel,
  grads: Gradients,
  state: AdamState,
  lr: number
): void {
  state.t += 1;
  const t = state.t;
  const bc1 = 1 - Math.pow(ADAM_BETA1, t);
  const bc2 = 1 - Math.pow(ADAM_BETA2, t);
  const lrT = lr * Math.sqrt(bc2) / bc1;

  function updateParam(
    params: number[],
    grad: number[],
    m: number[],
    v: number[]
  ): void {
    for (let i = 0; i < params.length; i++) {
      const g = grad[i]!;
      m[i] = ADAM_BETA1 * m[i]! + (1 - ADAM_BETA1) * g;
      v[i] = ADAM_BETA2 * v[i]! + (1 - ADAM_BETA2) * g * g;
      params[i]! -= lrT * m[i]! / (Math.sqrt(v[i]!) + ADAM_EPS);
    }
  }

  updateParam(model.W1, grads.dW1, state.mW1, state.vW1);
  updateParam(model.b1, grads.db1, state.mb1, state.vb1);
  updateParam(model.W2, grads.dW2, state.mW2, state.vW2);
  updateParam(model.b2, grads.db2, state.mb2, state.vb2);
}

// ---------------------------------------------------------------------------
// Shuffle helper
// ---------------------------------------------------------------------------

function shuffleArray<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Track embedding cache (avoids repeated lookups)
// ---------------------------------------------------------------------------

type VectorMap = Map<string, number[]>;

// ---------------------------------------------------------------------------
// Main training entry point
// ---------------------------------------------------------------------------

/**
 * Train the metric-learning MLP.
 *
 * @param pairs          Derived training pairs (D1 output)
 * @param embeddings     Map of trackId → 24D perceptual vector
 * @param options        Training hyperparameters
 */
export function trainMetricModel(
  pairs: DerivedTrainingPairs,
  embeddings: VectorMap,
  options: TrainOptions = {}
): TrainResult {
  const epochs = options.epochs ?? DEFAULT_EPOCHS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const lr = options.learningRate ?? DEFAULT_LR;
  const seed = options.seed ?? 42;

  const rand = mulberry32(seed);
  const model = initModel(seed);
  const adam = initAdam();

  // Filter to pairs where embeddings exist
  const validTriplets = pairs.triplets.filter(
    (t) => embeddings.has(t.anchor) && embeddings.has(t.positive) && embeddings.has(t.negative)
  );
  const validRanking = pairs.ranking.filter(
    (r) => embeddings.has(r.higher) && embeddings.has(r.lower)
  );

  let finalLoss = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const shuffledTriplets = shuffleArray(validTriplets, rand);
    const shuffledRanking = shuffleArray(validRanking, rand);

    let epochLoss = 0;
    let batchCount = 0;

    // Process triplets in mini-batches
    for (let start = 0; start < shuffledTriplets.length; start += batchSize) {
      const batch = shuffledTriplets.slice(start, start + batchSize) as TrainingTriplet[];
      const accGrads = zeroGrads();
      let batchLoss = 0;
      let activeSamples = 0;

      for (const triplet of batch) {
        const anchorVec = embeddings.get(triplet.anchor);
        const posVec = embeddings.get(triplet.positive);
        const negVec = embeddings.get(triplet.negative);
        if (!anchorVec || !posVec || !negVec) continue;

        const result = tripletGrad(model, anchorVec, posVec, negVec, triplet.weight);
        if (!result) continue;

        batchLoss += result.loss;
        activeSamples++;
        for (const g of result.grads) {
          addGrads(accGrads, g);
        }
      }

      if (activeSamples > 0) {
        // Normalize gradients by batch size
        const invN = 1 / activeSamples;
        for (let i = 0; i < accGrads.dW1.length; i++) accGrads.dW1[i]! *= invN;
        for (let i = 0; i < accGrads.db1.length; i++) accGrads.db1[i]! *= invN;
        for (let i = 0; i < accGrads.dW2.length; i++) accGrads.dW2[i]! *= invN;
        for (let i = 0; i < accGrads.db2.length; i++) accGrads.db2[i]! *= invN;

        adamStep(model, accGrads, adam, lr);
        epochLoss += batchLoss / activeSamples;
        batchCount++;
      }
    }

    // Process ranking pairs in mini-batches
    for (let start = 0; start < shuffledRanking.length; start += batchSize) {
      const batch = shuffledRanking.slice(start, start + batchSize) as RankingPair[];
      const accGrads = zeroGrads();
      let batchLoss = 0;
      let activeSamples = 0;

      for (const pair of batch) {
        const higherVec = embeddings.get(pair.higher);
        const lowerVec = embeddings.get(pair.lower);
        if (!higherVec || !lowerVec) continue;

        const result = rankingGrad(model, higherVec, lowerVec, pair.weight);
        if (!result) continue;

        batchLoss += result.loss;
        activeSamples++;
        for (const g of result.grads) {
          addGrads(accGrads, g);
        }
      }

      if (activeSamples > 0) {
        const invN = 1 / activeSamples;
        for (let i = 0; i < accGrads.dW1.length; i++) accGrads.dW1[i]! *= invN;
        for (let i = 0; i < accGrads.db1.length; i++) accGrads.db1[i]! *= invN;
        for (let i = 0; i < accGrads.dW2.length; i++) accGrads.dW2[i]! *= invN;
        for (let i = 0; i < accGrads.db2.length; i++) accGrads.db2[i]! *= invN;

        adamStep(model, accGrads, adam, lr);
        epochLoss += batchLoss / activeSamples;
        batchCount++;
      }
    }

    finalLoss = batchCount > 0 ? epochLoss / batchCount : 0;
  }

  model.trainedAt = new Date().toISOString();
  model.version = 1;

  return { model, finalLoss, epochs };
}

// ---------------------------------------------------------------------------
// Inference: apply model to refine a single 24D embedding
// ---------------------------------------------------------------------------

/**
 * Apply the trained MLP to a 24D perceptual vector to produce a refined embedding.
 */
export function applyModel(model: MetricModel, vector: number[]): number[] {
  if (vector.length !== INPUT_DIM) {
    throw new Error(`Expected ${INPUT_DIM}D vector, got ${vector.length}D`);
  }
  return forward(model, vector).output;
}
