#!/usr/bin/env bun
/**
 * Do the two independent gains compose?
 *
 * Forward-selected features (+20.0%) and a supervised metric (+28.2%) were each
 * measured against the shipped baseline separately, on the same validation slice.
 * Whether they add, overlap, or interfere is a separate question — both work by
 * suppressing dimensions that do not carry authorship signal, so it is entirely
 * possible that the second has nothing left to do once the first has run.
 *
 * VALIDATION ONLY, deliberately. The test set has already been consulted twice in
 * this campaign; a third look chasing the best combination would carry selection
 * optimism that could not be honestly bounded. Whatever wins here gets confirmed on
 * the independent full-corpus holdout instead.
 *
 *   bun run scripts/station-quality/combine-best.ts --features <features.jsonl>
 */

import { existsSync, writeFileSync } from "node:fs";
import process from "node:process";

import { groupOf, type Track } from "./metrics.js";
import { cosineDistance, distanceMatrix, makeRanker, ndcgAtK, pairedBootstrap, splitByGroup } from "./harness.js";
import {
  applyLinearMap,
  applyWeights,
  fitWithinClassWhitening,
  learnWeights,
  rankUniform,
  subsampleByGroup,
  weighted,
} from "./techniques.js";
import { buildModel, loadFeatureRecords } from "./load-features.js";
import { SHIPPED_DIMENSION_NAMES, TONAL_DIMENSION_NAMES, makeSpec } from "./vector-specs.js";
import { buildPerceptualVector } from "../../packages/sidflow-classify/src/deterministic-ratings.js";
import { SIMILARITY_TONAL_DIMENSIONS } from "../../packages/sidflow-classify/src/similarity-vector.js";

const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const FEATURES = arg("--features");
const JSON_OUT = arg("--json") ?? "workspace/station-opt/combine-best.json";
const MAX_TRACKS = Number.parseInt(arg("--max-tracks") ?? "20000", 10);
const K = 10;

if (!FEATURES || !existsSync(FEATURES)) {
  process.stderr.write(`usage: combine-best.ts --features <features.jsonl>\n`);
  process.exit(1);
}

/** The set greedy forward selection chose, in the order it chose them. */
const FORWARD_SELECTED = [
  "adsrPadRatioSid",
  "tempoFused",
  "samplePlaybackRate",
  "filterCutoffMeanSid",
  "sidPolyphonyMean",
  "waveNoiseRatio",
  "filterMotionFused",
  "pwmActivitySid",
  "loudnessFused",
  "sidNoteDurationMean",
  "mfccResidual1",
  "wavePulseRatio",
  "waveSawRatio",
  "adsrPluckRatioSid",
  "voiceRoleEntropySid",
  "bassPresenceFused",
  "sidNoteDurationEntropy",
  "sidTonalPresent",
  "melodicClarityFused",
  "sidPitchClassEntropy",
  "sidNoteRate",
] as const;

const records = loadFeatureRecords(FEATURES);
const model = buildModel(records);
const identity: Track[] = records.map((r) => ({ trackId: r.trackId, sidPath: r.sidPath, vector: [0], e: 3, m: 3, c: 3 }));
const keep = new Set(subsampleByGroup(identity, MAX_TRACKS).map((t) => t.trackId));
const kept = records.filter((r) => keep.has(r.trackId));

function tracksForNames(shippedNames: readonly string[], tonalNames: readonly string[]): Track[] {
  const spec = makeSpec("s", "", shippedNames, tonalNames);
  return kept.map((record) => ({
    trackId: record.trackId,
    sidPath: record.sidPath,
    vector: spec.build(model, record.features),
    e: 3,
    m: 3,
    c: 3,
  }));
}

const shippedSet = new Set<string>(SHIPPED_DIMENSION_NAMES);
const forwardShipped = FORWARD_SELECTED.filter((n) => shippedSet.has(n));
const forwardTonal = FORWARD_SELECTED.filter((n) => !shippedSet.has(n));

const CANDIDATES: Array<{ name: string; tracks: Track[]; supervised: "none" | "wccn" | "weights" }> = [
  { name: "baseline: shipped 24d, raw + weighted cosine", tracks: tracksForNames(SHIPPED_DIMENSION_NAMES, []), supervised: "none" },
  { name: "univariate 35d, rank-uniform", tracks: tracksForNames(SHIPPED_DIMENSION_NAMES, SIMILARITY_TONAL_DIMENSIONS), supervised: "none" },
  { name: "univariate 35d, rank-uniform + WCCN", tracks: tracksForNames(SHIPPED_DIMENSION_NAMES, SIMILARITY_TONAL_DIMENSIONS), supervised: "wccn" },
  { name: "forward 21d, rank-uniform", tracks: tracksForNames(forwardShipped, forwardTonal), supervised: "none" },
  { name: "forward 21d, rank-uniform + WCCN", tracks: tracksForNames(forwardShipped, forwardTonal), supervised: "wccn" },
  { name: "forward 21d, rank-uniform + learned weights", tracks: tracksForNames(forwardShipped, forwardTonal), supervised: "weights" },
  { name: "all 55d, rank-uniform + WCCN", tracks: tracksForNames(SHIPPED_DIMENSION_NAMES, TONAL_DIMENSION_NAMES), supervised: "wccn" },
];

const results: Array<{ name: string; ndcg: number; rareNdcg: number; perSeed: number[] }> = [];

for (const candidate of CANDIDATES) {
  const split = splitByGroup(candidate.tracks);
  const isBaseline = candidate.name.startsWith("baseline");

  // Anything supervised is fitted on TRAIN and applied unchanged to validation.
  let map: number[][] | null = null;
  let weights: number[] | null = null;
  if (candidate.supervised === "wccn") {
    const trainVectors = rankUniform(split.train);
    map = fitWithinClassWhitening(trainVectors, split.train.map((t) => groupOf(t.sidPath) ?? t.sidPath), 0.1);
  } else if (candidate.supervised === "weights") {
    weights = learnWeights(split.train, rankUniform, K, [0.5, 0.25, 0.125]);
  }

  let vectors = isBaseline ? weighted(split.validation) : rankUniform(split.validation);
  if (map) vectors = applyLinearMap(vectors, map);
  if (weights) vectors = applyWeights(vectors, weights);
  const distances = distanceMatrix(vectors, cosineDistance);
  const ranker = makeRanker(split.validation, distances);
  const nd = ndcgAtK(split.validation, ranker, K);

  // Cold start, which matters more than the headline on a corpus where 68% of
  // composers have a single tune.
  const groups = new Map<string, number>();
  for (const t of split.validation) {
    const g = groupOf(t.sidPath);
    if (g) groups.set(g, (groups.get(g) ?? 0) + 1);
  }
  const rareIndices: number[] = [];
  for (let i = 0; i < split.validation.length; i++) {
    const g = groupOf(split.validation[i]!.sidPath);
    if (g && (groups.get(g) ?? 0) <= 3) rareIndices.push(i);
  }
  const rare = rareIndices.length === 0 ? { mean: 0 } : ndcgAtK(split.validation, ranker, K, rareIndices);

  results.push({ name: candidate.name, ndcg: nd.mean, rareNdcg: rare.mean, perSeed: nd.perSeed });
  process.stdout.write(`  ${candidate.name.padEnd(46)} nDCG@${K} ${nd.mean.toFixed(4)}  rare ${rare.mean.toFixed(4)}\n`);
}

const baseline = results[0]!;
process.stdout.write(`\n=== relative to the shipped baseline (validation only) ===\n`);
for (const result of results.slice(1)) {
  const n = Math.min(result.perSeed.length, baseline.perSeed.length);
  const boot = pairedBootstrap(result.perSeed.slice(0, n), baseline.perSeed.slice(0, n));
  const relative = (100 * (result.ndcg - baseline.ndcg)) / (baseline.ndcg || 1);
  process.stdout.write(
    `  ${result.name.padEnd(46)} ${relative >= 0 ? "+" : ""}${relative.toFixed(1)}%` +
      `  95% CI [${boot.ci[0].toFixed(4)}, ${boot.ci[1].toFixed(4)}]  p=${boot.pValue.toFixed(4)}\n`,
  );
}

writeFileSync(
  JSON_OUT,
  `${JSON.stringify(
    { features: FEATURES, forwardSelected: FORWARD_SELECTED, results: results.map(({ perSeed: _o, ...r }) => r) },
    null,
    2,
  )}\n`,
);
process.stdout.write(`\nwritten: ${JSON_OUT}\n`);
