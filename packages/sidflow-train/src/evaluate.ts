/**
 * D3: Champion/Challenger evaluation system.
 *
 * Evaluates a candidate (challenger) model against the current (champion) model
 * using 5 metrics. Promotes the challenger if ≥ 3/5 metrics pass.
 *
 * Metrics:
 *   1. Holdout accuracy ≥ 0.60  (positive pairs rank above negative)
 *   2. Coherence ≥ 0.70          (mean intra-station cosine similarity)
 *   3. Diversity ≥ 0.40          (fraction of unique genre-like clusters covered)
 *   4. Drift ≤ 0.15              (mean L2 between champion and challenger embeddings)
 *   5. Feedback correlation ≥ baseline (challenger improves correlation vs champion)
 */

import type { MetricModel } from "./metric-learning.js";
import { applyModel, INPUT_DIM } from "./metric-learning.js";
import type { TrackPair, DerivedTrainingPairs } from "./pair-builder.js";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const HOLDOUT_ACC_THRESHOLD = 0.60;
const COHERENCE_THRESHOLD = 0.70;
const DIVERSITY_THRESHOLD = 0.40;
const DRIFT_THRESHOLD = 0.15;
const MIN_METRICS_PASS = 3;
const DIVERSITY_CLUSTERS = 5; // number of k-means clusters for diversity measure

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricResult {
  name: string;
  value: number;
  threshold: number | null;
  passed: boolean;
  direction: "higher_is_better" | "lower_is_better";
}

export interface EvaluationResult {
  metrics: MetricResult[];
  passed: number;
  required: number;
  promote: boolean;
  summary: string;
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

type VectorMap = Map<string, number[]>;

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function normL2(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

function cosineSim(a: number[], b: number[]): number {
  const na = normL2(a);
  const nb = normL2(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

function l2Dist(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(s);
}

function applyOrIdentity(model: MetricModel | null, vec: number[]): number[] {
  if (!model) return vec;
  return applyModel(model, vec);
}

// ---------------------------------------------------------------------------
// Metric 1: Holdout accuracy
// ---------------------------------------------------------------------------

/**
 * For each holdout pair (anchor, other):
 *   positive pairs should have cosine_sim > negative pairs anchored on the same anchor.
 *
 * Accuracy = fraction of (pos, neg) pair combinations where sim(pos) > sim(neg).
 */
function computeHoldoutAccuracy(
  model: MetricModel | null,
  holdout: DerivedTrainingPairs,
  embeddings: VectorMap
): number {
  // Build a map: anchor → { positiveOthers, negativeOthers }
  const anchorPos = new Map<string, string[]>();
  const anchorNeg = new Map<string, string[]>();

  for (const p of holdout.positive) {
    if (!embeddings.has(p.anchor) || !embeddings.has(p.other)) continue;
    if (!anchorPos.has(p.anchor)) anchorPos.set(p.anchor, []);
    anchorPos.get(p.anchor)!.push(p.other);
  }
  for (const n of holdout.negative) {
    if (!embeddings.has(n.anchor) || !embeddings.has(n.other)) continue;
    if (!anchorNeg.has(n.anchor)) anchorNeg.set(n.anchor, []);
    anchorNeg.get(n.anchor)!.push(n.other);
  }

  let correct = 0;
  let total = 0;

  for (const [anchor, posOthers] of anchorPos) {
    const negOthers = anchorNeg.get(anchor);
    if (!negOthers || negOthers.length === 0) continue;

    const anchorVec = applyOrIdentity(model, embeddings.get(anchor)!);

    for (const posId of posOthers) {
      const posVec = applyOrIdentity(model, embeddings.get(posId)!);
      const posSim = cosineSim(anchorVec, posVec);

      for (const negId of negOthers) {
        const negVec = applyOrIdentity(model, embeddings.get(negId)!);
        const negSim = cosineSim(anchorVec, negVec);
        total++;
        if (posSim > negSim) correct++;
      }
    }
  }

  return total === 0 ? 0 : correct / total;
}

// ---------------------------------------------------------------------------
// Metric 2: Coherence (mean intra-station cosine)
// ---------------------------------------------------------------------------

/**
 * Mean cosine similarity across all positive pairs (approximates intra-station coherence).
 */
function computeCoherence(
  model: MetricModel | null,
  positives: TrackPair[],
  embeddings: VectorMap
): number {
  let total = 0;
  let count = 0;

  for (const p of positives) {
    const a = embeddings.get(p.anchor);
    const b = embeddings.get(p.other);
    if (!a || !b) continue;
    const fa = applyOrIdentity(model, a);
    const fb = applyOrIdentity(model, b);
    total += cosineSim(fa, fb);
    count++;
  }

  return count === 0 ? 0 : total / count;
}

// ---------------------------------------------------------------------------
// Metric 3: Diversity (fraction of clusters covered)
// ---------------------------------------------------------------------------

/**
 * Runs k-means on all positive-pair track embeddings to find DIVERSITY_CLUSTERS
 * clusters, then measures what fraction of clusters are covered by some track.
 * Higher = more diverse embedding space coverage.
 */
function computeDiversity(
  model: MetricModel | null,
  positives: TrackPair[],
  embeddings: VectorMap
): number {
  const trackIds = new Set<string>();
  for (const p of positives) {
    if (embeddings.has(p.anchor)) trackIds.add(p.anchor);
    if (embeddings.has(p.other)) trackIds.add(p.other);
  }

  const vecs = [...trackIds]
    .map((id) => applyOrIdentity(model, embeddings.get(id)!))
    .filter((v) => v.length === INPUT_DIM);

  if (vecs.length < DIVERSITY_CLUSTERS) {
    return vecs.length / DIVERSITY_CLUSTERS;
  }

  // Simple k-means to measure spread
  const k = DIVERSITY_CLUSTERS;
  const centroids = vecs.slice(0, k).map((v) => [...v]);
  const dim = INPUT_DIM;

  for (let iter = 0; iter < 20; iter++) {
    // Assignment step
    const sums: number[][] = Array.from({ length: k }, () => new Array(dim).fill(0));
    const counts = new Array(k).fill(0);

    for (const v of vecs) {
      let bestC = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < k; c++) {
        const s = cosineSim(v, centroids[c]!);
        if (s > bestSim) { bestSim = s; bestC = c; }
      }
      for (let d = 0; d < dim; d++) sums[bestC]![d]! += v[d]!;
      counts[bestC]++;
    }

    // Update centroids
    let changed = false;
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      const newCentroid = sums[c]!.map((s) => s / counts[c]);
      if (l2Dist(newCentroid, centroids[c]!) > 1e-6) changed = true;
      centroids[c] = newCentroid;
    }
    if (!changed) break;
  }

  // Diversity = fraction of clusters with at least one member
  const populated = centroids.filter((_, c) => {
    return vecs.some((v) => {
      let bestC = 0;
      let bestSim = -Infinity;
      for (let cc = 0; cc < k; cc++) {
        const s = cosineSim(v, centroids[cc]!);
        if (s > bestSim) { bestSim = s; bestC = cc; }
      }
      return bestC === c;
    });
  }).length;

  return populated / k;
}

// ---------------------------------------------------------------------------
// Metric 4: Drift (mean L2 between champion and challenger embeddings)
// ---------------------------------------------------------------------------

/**
 * Low drift means the challenger is close to the champion, which is good for stability.
 * Too high drift means the challenger is radically different (potentially unstable).
 */
function computeDrift(
  champion: MetricModel | null,
  challenger: MetricModel,
  embeddings: VectorMap,
  sampleSize = 200
): number {
  const ids = [...embeddings.keys()].slice(0, sampleSize);
  let totalDrift = 0;
  let count = 0;

  for (const id of ids) {
    const vec = embeddings.get(id)!;
    const champEmb = applyOrIdentity(champion, vec);
    const challEmb = applyModel(challenger, vec);
    totalDrift += l2Dist(champEmb, challEmb);
    count++;
  }

  return count === 0 ? 0 : totalDrift / count;
}

// ---------------------------------------------------------------------------
// Metric 5: Feedback correlation improvement
// ---------------------------------------------------------------------------

/**
 * Measures whether the challenger improves the correlation between
 * cosine similarity and observed preference (positive > negative pair scoring).
 *
 * Returns the delta (challenger_acc - champion_acc). Positive delta = improvement.
 */
function computeFeedbackCorrelation(
  champion: MetricModel | null,
  challenger: MetricModel,
  holdout: DerivedTrainingPairs,
  embeddings: VectorMap
): number {
  const champAcc = computeHoldoutAccuracy(champion, holdout, embeddings);
  const challAcc = computeHoldoutAccuracy(challenger, holdout, embeddings);
  return challAcc - champAcc;
}

// ---------------------------------------------------------------------------
// Main evaluation entry point
// ---------------------------------------------------------------------------

/**
 * Evaluate a challenger model against the current champion.
 *
 * @param champion      Current production model (null = no champion yet, raw embeddings used)
 * @param challenger    Newly trained model to evaluate
 * @param holdout       Held-out feedback pairs for evaluation
 * @param embeddings    Track embeddings (24D perceptual vectors)
 */
export function evaluateChallenger(
  champion: MetricModel | null,
  challenger: MetricModel,
  holdout: DerivedTrainingPairs,
  embeddings: VectorMap
): EvaluationResult {
  const holdoutAcc = computeHoldoutAccuracy(challenger, holdout, embeddings);
  const coherence = computeCoherence(challenger, holdout.positive, embeddings);
  const diversity = computeDiversity(challenger, holdout.positive, embeddings);
  const drift = computeDrift(champion, challenger, embeddings);
  const feedbackDelta = computeFeedbackCorrelation(champion, challenger, holdout, embeddings);

  // Feedback correlation: pass if challenger is better than (or equal to) champion
  const feedbackBaseline = 0.0; // delta >= 0 means no regression

  const metrics: MetricResult[] = [
    {
      name: "holdout_accuracy",
      value: holdoutAcc,
      threshold: HOLDOUT_ACC_THRESHOLD,
      passed: holdoutAcc >= HOLDOUT_ACC_THRESHOLD,
      direction: "higher_is_better",
    },
    {
      name: "coherence",
      value: coherence,
      threshold: COHERENCE_THRESHOLD,
      passed: coherence >= COHERENCE_THRESHOLD,
      direction: "higher_is_better",
    },
    {
      name: "diversity",
      value: diversity,
      threshold: DIVERSITY_THRESHOLD,
      passed: diversity >= DIVERSITY_THRESHOLD,
      direction: "higher_is_better",
    },
    {
      name: "drift",
      value: drift,
      threshold: DRIFT_THRESHOLD,
      passed: drift <= DRIFT_THRESHOLD,
      direction: "lower_is_better",
    },
    {
      name: "feedback_correlation",
      value: feedbackDelta,
      threshold: feedbackBaseline,
      passed: feedbackDelta >= feedbackBaseline,
      direction: "higher_is_better",
    },
  ];

  const passed = metrics.filter((m) => m.passed).length;
  const promote = passed >= MIN_METRICS_PASS;

  const summary = metrics
    .map((m) => `${m.name}=${m.value.toFixed(3)}${m.passed ? "✓" : "✗"}`)
    .join(", ");

  return { metrics, passed, required: MIN_METRICS_PASS, promote, summary };
}
