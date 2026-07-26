#!/usr/bin/env bun
/**
 * Station-quality optimisation over BOTH the feature set and the distance metric.
 *
 * Reads a classification run's raw features, rebuilds candidate similarity vectors
 * offline, and searches representations, re-rankings and feature sets under the
 * pre-registered protocol in metrics.ts.
 *
 *   bun run scripts/station-quality/optimise-all.ts --features <features.jsonl>
 *
 * ## Search shape, and why it is not a grid
 *
 * Six representations x five re-rankings x four feature sets is 120 candidates.
 * Holm-correcting across 120 would demand roughly a 24x smaller p-value than
 * correcting across five, which would hide any effect this corpus is capable of
 * showing. So the search is SEQUENTIAL AND GREEDY: pick the best representation,
 * then the best feature set given it, then the best re-ranking given both. That
 * evaluates about sixteen candidates instead of 120, and the Holm family covers
 * every one of them.
 *
 * Greedy search can miss an interaction that only appears in a combination it
 * never visits. That is a real limitation and is stated in the write-up rather
 * than hidden; it is the price of retaining the power to detect anything at all.
 *
 * ## What is held fixed
 *
 * The split, the primary metric, the guardrails, the stopping rule and the
 * success criterion all come from the pre-registered protocol and are not
 * negotiated here. TEST is read exactly once, at the very end, for the baseline
 * and the final winner only.
 */

import { existsSync, writeFileSync } from "node:fs";
import process from "node:process";

import { groupOf, ratingSpread, stationQuality, type Track } from "./metrics.js";
import {
  cosineDistance,
  distanceMatrix,
  euclidean,
  holmCorrection,
  makeRanker,
  ndcgAtK,
  pairedBootstrap,
  splitByGroup,
} from "./harness.js";
import {
  applyLinearMap,
  applyWeights,
  fitWithinClassWhitening,
  kReciprocal,
  learnWeights,
  mutualProximity,
  queryExpansion,
  rankGaussian,
  raw,
  subsampleByGroup,
  treeComposition,
  weighted,
  whiten,
  zscore,
} from "./techniques.js";
import { buildModel, loadFeatureRecords, type FeatureRecord } from "./load-features.js";
import { buildVectorSpecs, type VectorSpec } from "./vector-specs.js";
import { predictDeterministicRatings } from "../../packages/sidflow-classify/src/deterministic-ratings.js";

const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] : undefined;
};

const FEATURES = arg("--features");
const JSON_OUT = arg("--json") ?? "workspace/station-opt/optimisation.json";
const MAX_TRACKS = Number.parseInt(arg("--max-tracks") ?? "20000", 10);
const K = 10;

if (!FEATURES || !existsSync(FEATURES)) {
  process.stderr.write(`usage: optimise-all.ts --features <features.jsonl> [--json out] [--max-tracks n]\n`);
  process.exit(1);
}

// ------------------------------------------------------------------- loading

process.stdout.write(`loading ${FEATURES}\n`);
const records = loadFeatureRecords(FEATURES);
const model = buildModel(records);
process.stdout.write(`  ${records.length} feature records, normalisation model over ${Object.keys(model.features).length} features\n`);

/**
 * Subsample ONCE, on identity, then build every spec's vectors for exactly that
 * set of tracks. Subsampling per spec would give each candidate a different
 * corpus and make the paired bootstrap meaningless.
 */
const identityTracks: Track[] = records.map((record) => ({
  trackId: record.trackId,
  sidPath: record.sidPath,
  vector: [0],
  e: 3,
  m: 3,
  c: 3,
}));
const keep = new Set(subsampleByGroup(identityTracks, MAX_TRACKS).map((t) => t.trackId));
const kept = records.filter((record) => keep.has(record.trackId));
if (kept.length < records.length) {
  process.stdout.write(`  subsampled ${records.length} -> ${kept.length} tracks (whole groups)\n`);
}

function tracksFor(spec: VectorSpec, source: FeatureRecord[]): Track[] {
  const out: Track[] = [];
  for (const record of source) {
    const vector = spec.build(model, record.features);
    if (!vector.every((v) => Number.isFinite(v))) continue;
    const { ratings } = predictDeterministicRatings(model, record.features);
    out.push({
      trackId: record.trackId,
      sidPath: record.sidPath,
      vector,
      e: ratings.e,
      m: ratings.m,
      c: ratings.c,
    });
  }
  return out;
}

const SPECS = buildVectorSpecs();
const tracksBySpec = new Map<string, Track[]>();
for (const spec of SPECS) tracksBySpec.set(spec.name, tracksFor(spec, kept));

const shippedTracks = tracksBySpec.get(SPECS[0]!.name)!;
const splitOf = (tracks: Track[]) => splitByGroup(tracks);
const shippedSplit = splitOf(shippedTracks);
process.stdout.write(
  `corpus ${shippedTracks.length} tracks -> train ${shippedSplit.train.length} / validation ${shippedSplit.validation.length} / test ${shippedSplit.test.length}\n` +
    `(split by composer group, so no composer appears in two slices)\n` +
    `composition: ${JSON.stringify(treeComposition(shippedTracks))}\n\n`,
);

// -------------------------------------------------------------- combinations

type Representation = { name: string; build: (t: Track[]) => Float64Array[]; metric: typeof euclidean };
type Reranker = { name: string; apply: (d: Float64Array[], v: Float64Array[]) => Float64Array[] };

const REPRESENTATIONS: Representation[] = [
  { name: "raw + weighted cosine", build: weighted, metric: cosineDistance },
  { name: "raw + euclidean", build: raw, metric: euclidean },
  { name: "z-score + euclidean", build: zscore, metric: euclidean },
  { name: "rank-gaussian + euclidean", build: rankGaussian, metric: euclidean },
  { name: "whitened + euclidean", build: whiten, metric: euclidean },
  { name: "rank-gaussian + cosine", build: rankGaussian, metric: cosineDistance },
];

const RERANKERS: Reranker[] = [
  { name: "none", apply: (d) => d },
  { name: "mutual proximity", apply: (d) => mutualProximity(d) },
  { name: "k-reciprocal", apply: (d) => kReciprocal(d) },
  { name: "query expansion", apply: (d, v) => distanceMatrix(queryExpansion(v, d), euclidean) },
  { name: "MP + k-reciprocal", apply: (d) => kReciprocal(mutualProximity(d)) },
];

interface Combination {
  spec: VectorSpec;
  representation: Representation;
  reranker: Reranker;
  weights?: number[];
  /** A supervised linear map, fitted on TRAIN only. */
  supervised?: { name: string; map: number[][] };
}

function describe(combination: Combination): string {
  const parts = [combination.spec.name, combination.representation.name];
  if (combination.supervised) parts.push(combination.supervised.name);
  if (combination.weights) parts.push("learned weights");
  if (combination.reranker.name !== "none") parts.push(combination.reranker.name);
  return parts.join(" | ");
}

/**
 * Fit within-class whitening on the TRAIN slice of a spec.
 *
 * Fitted once and reused, so the transform applied to validation and to test is
 * literally the same matrix and carries no information from either.
 *
 * One wrinkle worth naming: the base representation (rank-Gaussian, z-score) is
 * fitted per slice, so train's representation space and validation's are not
 * numerically identical. Both map each dimension to standard-normal marginals, so
 * a map fitted in one is meaningful in the other, but it is an approximation
 * rather than an identity.
 */
function fitSupervisedMap(spec: VectorSpec, representation: Representation, shrinkage: number): number[][] {
  const split = splitOf(tracksBySpec.get(spec.name)!);
  const vectors = representation.build(split.train);
  const groups = split.train.map((t) => groupOf(t.sidPath) ?? t.sidPath);
  return fitWithinClassWhitening(vectors, groups, shrinkage);
}

interface Evaluation {
  ndcg: number;
  perSeed: number[];
  diversity: number;
  maxGroupShare: number;
  rareNdcg: number;
  rareSeeds: number;
  seeds: number;
}

function evaluate(tracks: Track[], combination: Combination): Evaluation {
  let vectors = combination.representation.build(tracks);
  if (combination.supervised) vectors = applyLinearMap(vectors, combination.supervised.map);
  if (combination.weights) vectors = applyWeights(vectors, combination.weights);
  const base = distanceMatrix(vectors, combination.representation.metric);
  const distances = combination.reranker.apply(base, vectors);
  const ranker = makeRanker(tracks, distances);
  const nd = ndcgAtK(tracks, ranker, K);

  const STATION_SEEDS = 200;
  const stride = Math.max(1, Math.floor(tracks.length / STATION_SEEDS));
  const stations: Array<{ seed: Track; tracks: Track[] }> = [];
  for (let i = 0; i < tracks.length && stations.length < STATION_SEEDS; i += stride) {
    stations.push({ seed: tracks[i]!, tracks: ranker(i, 20).map((j) => tracks[j]!) });
  }

  const groups = new Map<string, number>();
  for (const track of tracks) {
    const group = groupOf(track.sidPath);
    if (group) groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  const total = [...groups.values()].reduce((sum, value) => sum + value, 0);
  const chance = total > 1 ? [...groups.values()].reduce((sum, c) => sum + c * (c - 1), 0) / (total * (total - 1)) : 0;
  const station = stationQuality(stations, chance);

  const rareSeedIndices: number[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const group = groupOf(tracks[i]!.sidPath);
    if (group && (groups.get(group) ?? 0) <= 3) rareSeedIndices.push(i);
  }
  const rare = rareSeedIndices.length === 0 ? { mean: 0, perSeed: [] } : ndcgAtK(tracks, ranker, K, rareSeedIndices);

  return {
    ndcg: nd.mean,
    perSeed: nd.perSeed,
    diversity: station.diversity,
    maxGroupShare: station.maxGroupShare,
    rareNdcg: rare.mean,
    rareSeeds: rare.perSeed.length,
    seeds: nd.perSeed.length,
  };
}

// ------------------------------------------------------------------- the run

interface Attempt {
  phase: string;
  name: string;
  rationale: string;
  combination: Combination;
  evaluation: Evaluation;
}

const attempts: Attempt[] = [];

function attempt(phase: string, rationale: string, combination: Combination): Attempt {
  const split = splitOf(tracksBySpec.get(combination.spec.name)!);
  const evaluation = evaluate(split.validation, combination);
  const record: Attempt = { phase, name: describe(combination), rationale, combination, evaluation };
  attempts.push(record);
  process.stdout.write(
    `  ${record.name.padEnd(62)} nDCG@${K} ${evaluation.ndcg.toFixed(4)}  div ${evaluation.diversity.toFixed(3)}  rare ${evaluation.rareNdcg.toFixed(4)} (${evaluation.rareSeeds})\n`,
  );
  return record;
}

const BASELINE: Combination = {
  spec: SPECS[0]!,
  representation: REPRESENTATIONS[0]!,
  reranker: RERANKERS[0]!,
};

process.stdout.write(`=== phase A: representation, on the shipped vector ===\n`);
const baselineAttempt = attempt("A", "what ships today", BASELINE);
for (const representation of REPRESENTATIONS.slice(1)) {
  attempt("A", "is the shipped weighting and metric the right one?", {
    spec: SPECS[0]!,
    representation,
    reranker: RERANKERS[0]!,
  });
}
const phaseA = attempts.filter((a) => a.phase === "A").sort((x, y) => y.evaluation.ndcg - x.evaluation.ndcg)[0]!;
process.stdout.write(`  -> best representation: ${phaseA.combination.representation.name}\n\n`);

process.stdout.write(`=== phase B: feature set, with the phase-A representation ===\n`);
for (const spec of SPECS.slice(1)) {
  attempt("B", spec.rationale, {
    spec,
    representation: phaseA.combination.representation,
    reranker: RERANKERS[0]!,
  });
}
const phaseBCandidates = attempts.filter((a) => a.phase === "A" || a.phase === "B");
const phaseB = [...phaseBCandidates].sort((x, y) => y.evaluation.ndcg - x.evaluation.ndcg)[0]!;
process.stdout.write(`  -> best feature set: ${phaseB.combination.spec.name}\n\n`);

process.stdout.write(`=== phase C: re-ranking, with the phase-B feature set ===\n`);
for (const reranker of RERANKERS.slice(1)) {
  attempt("C", "hubness and neighbourhood-consistency corrections", {
    spec: phaseB.combination.spec,
    representation: phaseB.combination.representation,
    reranker,
  });
}

process.stdout.write(`\n=== phase D: learned diagonal weights (fitted on TRAIN only) ===\n`);
const winnerSplit = splitOf(tracksBySpec.get(phaseB.combination.spec.name)!);
const learned = learnWeights(winnerSplit.train, phaseB.combination.representation.build, K);
process.stdout.write(
  `  fitted ${learned.length} weights on ${winnerSplit.train.length} train tracks, range ${Math.min(...learned).toFixed(2)}..${Math.max(...learned).toFixed(2)}\n`,
);
const bestReranker = attempts
  .filter((a) => a.phase === "C")
  .sort((x, y) => y.evaluation.ndcg - x.evaluation.ndcg)[0];
attempt("D", "let the labels choose feature importance", {
  spec: phaseB.combination.spec,
  representation: phaseB.combination.representation,
  reranker: RERANKERS[0]!,
  weights: learned,
});
if (bestReranker && bestReranker.evaluation.ndcg > phaseB.evaluation.ndcg) {
  attempt("D", "learned weights plus the best re-ranking", {
    spec: phaseB.combination.spec,
    representation: phaseB.combination.representation,
    reranker: bestReranker.combination.reranker,
    weights: learned,
  });
}

process.stdout.write(`\n=== phase E: supervised metric, fitted on TRAIN only ===\n`);
/**
 * Within-class covariance normalisation.
 *
 * Every representation above is unsupervised, and learned diagonal weights are
 * supervised but can only rescale existing axes. This is the full-covariance
 * version: it measures how a composer's own tunes vary and shrinks exactly those
 * directions, on the principle that a direction along which one composer already
 * varies wildly is a poor witness that two tunes share a composer.
 *
 * Two shrinkage levels, because the right amount is not knowable in advance: most
 * HVSC groups contribute only a handful of tunes, so the within-class covariance
 * is estimated from few observations per direction and an under-regularised
 * inverse would amplify whichever directions are underdetermined.
 */
for (const shrinkage of [0.2, 0.5]) {
  const map = fitSupervisedMap(phaseB.combination.spec, phaseB.combination.representation, shrinkage);
  attempt("E", `shrink within-composer variation (shrinkage ${shrinkage})`, {
    spec: phaseB.combination.spec,
    representation: phaseB.combination.representation,
    reranker: RERANKERS[0]!,
    supervised: { name: `within-class whitening (${shrinkage})`, map },
  });
}
const phaseE = attempts.filter((a) => a.phase === "E").sort((x, y) => y.evaluation.ndcg - x.evaluation.ndcg)[0]!;
if (phaseE.evaluation.ndcg > phaseB.evaluation.ndcg && bestReranker) {
  attempt("E", "supervised metric plus the best re-ranking", {
    spec: phaseB.combination.spec,
    representation: phaseB.combination.representation,
    reranker: bestReranker.combination.reranker,
    supervised: phaseE.combination.supervised,
  });
}

// -------------------------------------------------------------- significance

process.stdout.write(`\n=== significance vs baseline (Holm across all ${attempts.length - 1} candidates) ===\n`);
const comparisons = attempts
  .filter((a) => a !== baselineAttempt)
  .map((a) => {
    const n = Math.min(a.evaluation.perSeed.length, baselineAttempt.evaluation.perSeed.length);
    const boot = pairedBootstrap(a.evaluation.perSeed.slice(0, n), baselineAttempt.evaluation.perSeed.slice(0, n));
    return { attempt: a, ...boot };
  });
const holm = holmCorrection(comparisons.map((c) => ({ name: c.attempt.name, p: c.pValue })));

for (const entry of holm) {
  const comparison = comparisons.find((c) => c.attempt.name === entry.name)!;
  const relative = (100 * comparison.diff) / (baselineAttempt.evaluation.ndcg || 1);
  process.stdout.write(
    `  ${entry.name.padEnd(62)} ${relative >= 0 ? "+" : ""}${relative.toFixed(1)}%  p=${entry.p.toFixed(4)} adj=${entry.adjusted.toFixed(4)}${entry.significant ? "  SIGNIFICANT" : ""}\n`,
  );
}

/** Guardrails: neither diversity nor cold-start may regress by more than 5% relative. */
const eligible = comparisons.filter((comparison) => {
  const entry = holm.find((h) => h.name === comparison.attempt.name)!;
  if (!entry.significant || comparison.diff <= 0) return false;
  const diversityOk = comparison.attempt.evaluation.diversity >= baselineAttempt.evaluation.diversity * 0.95;
  const rareOk = comparison.attempt.evaluation.rareNdcg >= baselineAttempt.evaluation.rareNdcg * 0.95;
  return diversityOk && rareOk;
});
eligible.sort((a, b) => b.attempt.evaluation.ndcg - a.attempt.evaluation.ndcg);
const winner = eligible[0]?.attempt ?? null;

process.stdout.write(`\n=== selection (validation only) ===\n`);
process.stdout.write(
  winner
    ? `  winner: ${winner.name}\n`
    : `  no candidate beat the baseline significantly with guardrails intact\n`,
);

// -------------------------------------------------------- TEST, touched once

process.stdout.write(`\n=== test (touched once) ===\n`);
const baselineTestSplit = splitOf(tracksBySpec.get(BASELINE.spec.name)!);
const testBaseline = evaluate(baselineTestSplit.test, BASELINE);
process.stdout.write(
  `  baseline nDCG@${K} ${testBaseline.ndcg.toFixed(4)}  div ${testBaseline.diversity.toFixed(3)}  rare ${testBaseline.rareNdcg.toFixed(4)}  (${testBaseline.seeds} seeds)\n`,
);

let verdict = "no improvement found";
let testWinner: Evaluation | null = null;
let testStats: { diff: number; ci: [number, number]; pValue: number } | null = null;
if (winner) {
  const winnerTestSplit = splitOf(tracksBySpec.get(winner.combination.spec.name)!);
  testWinner = evaluate(winnerTestSplit.test, winner.combination);
  const n = Math.min(testWinner.perSeed.length, testBaseline.perSeed.length);
  testStats = pairedBootstrap(testWinner.perSeed.slice(0, n), testBaseline.perSeed.slice(0, n));
  const relative = (100 * (testWinner.ndcg - testBaseline.ndcg)) / (testBaseline.ndcg || 1);
  process.stdout.write(
    `  winner   nDCG@${K} ${testWinner.ndcg.toFixed(4)}  div ${testWinner.diversity.toFixed(3)}  rare ${testWinner.rareNdcg.toFixed(4)}\n`,
  );
  process.stdout.write(
    `  relative gain ${relative >= 0 ? "+" : ""}${relative.toFixed(1)}%  95% CI [${testStats.ci[0].toFixed(4)}, ${testStats.ci[1].toFixed(4)}]  p=${testStats.pValue.toFixed(4)}\n`,
  );
  const guardOk =
    testWinner.diversity >= testBaseline.diversity * 0.95 && testWinner.rareNdcg >= testBaseline.rareNdcg * 0.95;
  const met = relative >= 20 && testStats.pValue < 0.05 && guardOk;
  verdict = met
    ? "SUCCESS CRITERION MET (>=20% relative, p<0.05, guardrails intact)"
    : `criterion not met (needed >=20% relative with p<0.05 and guardrails intact)`;
  process.stdout.write(`  ${verdict}\n`);
}

// ------------------------------------------------------------- diagnostics

/**
 * Per-dimension diagnostics for the winning spec.
 *
 * Answers "which dimensions are dead weight?" with measurements rather than
 * intuition: a dimension that is constant, or almost always zero, cannot
 * contribute to any distance, and the learned weight says what the labels think
 * of the ones that do vary.
 */
const diagnosticSpec = winner?.combination.spec ?? phaseB.combination.spec;
const diagnosticTracks = tracksBySpec.get(diagnosticSpec.name)!;
const dimensionDiagnostics = diagnosticSpec.dimensionNames.map((name, index) => {
  const column = diagnosticTracks.map((t) => t.vector[index] ?? 0);
  const mean = column.reduce((sum, v) => sum + v, 0) / column.length;
  const sd = Math.sqrt(column.reduce((sum, v) => sum + (v - mean) ** 2, 0) / column.length);
  const zeros = column.filter((v) => v === 0).length / column.length;
  return { name, mean, sd, zeroFraction: zeros, learnedWeight: learned[index] ?? null };
});

process.stdout.write(`\n=== dimension diagnostics (${diagnosticSpec.name}) ===\n`);
const dead = dimensionDiagnostics.filter((d) => d.sd < 1e-6);
const nearlyDead = dimensionDiagnostics.filter((d) => d.sd >= 1e-6 && d.zeroFraction > 0.9);
process.stdout.write(`  constant dimensions: ${dead.length === 0 ? "none" : dead.map((d) => d.name).join(", ")}\n`);
process.stdout.write(
  `  >90% zero:           ${nearlyDead.length === 0 ? "none" : nearlyDead.map((d) => d.name).join(", ")}\n`,
);

const spread = ratingSpread(shippedTracks);
process.stdout.write(`\n=== rating spread (category stations) ===\n`);
for (const dim of ["e", "m", "c"] as const) {
  const s = spread[dim]!;
  process.stdout.write(
    `  ${dim}: ${s.levels} of 5 levels, largest share ${(100 * s.largestShare).toFixed(1)}%, entropy ${s.entropyBits.toFixed(3)} of 2.322 bits\n`,
  );
}

writeFileSync(
  JSON_OUT,
  `${JSON.stringify(
    {
      features: FEATURES,
      corpus: {
        records: records.length,
        used: shippedTracks.length,
        train: shippedSplit.train.length,
        validation: shippedSplit.validation.length,
        test: shippedSplit.test.length,
        composition: treeComposition(shippedTracks),
      },
      specs: SPECS.map((s) => ({ name: s.name, dimensions: s.dimensionNames.length })),
      attempts: attempts.map((a) => ({
        phase: a.phase,
        name: a.name,
        rationale: a.rationale,
        ndcg: a.evaluation.ndcg,
        diversity: a.evaluation.diversity,
        rareNdcg: a.evaluation.rareNdcg,
        seeds: a.evaluation.seeds,
      })),
      holm,
      learnedWeights: Object.fromEntries(
        (winner?.combination.spec ?? phaseB.combination.spec).dimensionNames.map((n, i) => [n, learned[i] ?? null]),
      ),
      dimensionDiagnostics,
      winner: winner?.name ?? null,
      test: {
        baseline: { ndcg: testBaseline.ndcg, diversity: testBaseline.diversity, rare: testBaseline.rareNdcg, seeds: testBaseline.seeds },
        winner: testWinner
          ? { ndcg: testWinner.ndcg, diversity: testWinner.diversity, rare: testWinner.rareNdcg, seeds: testWinner.seeds }
          : null,
        statistics: testStats,
        verdict,
      },
      ratingSpread: spread,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`\nwritten: ${JSON_OUT}\n`);
