#!/usr/bin/env bun
/**
 * Greedy forward selection over the full candidate dimension pool.
 *
 * The shipped feature set was chosen by ranking each dimension's UNIVARIATE
 * separability and keeping those above a threshold. That is a crude criterion: it
 * cannot see that two dimensions are near-duplicates (so keeping both wastes a
 * slot), nor that a dimension useless alone becomes useful beside another. Since
 * the measured effect of the selection was large — all 31 tonal dimensions made
 * retrieval worse, 11 of them made it better — the selection criterion is worth
 * more than a threshold on a marginal statistic.
 *
 * Forward selection evaluates the actual objective instead: start empty, and
 * repeatedly add whichever remaining dimension most improves nDCG@10, stopping
 * when nothing improves it.
 *
 * ## Guards against fooling ourselves
 *
 * Selection runs on TRAIN only, and on a subsample of train for speed, so the
 * reported validation figure is not the number being maximised. Forward selection
 * on a few thousand tracks will still overfit somewhat — that is exactly why the
 * result is reported on validation and, if it survives, confirmed later on an
 * independent corpus rather than trusted here.
 *
 * The evaluation uses rank-uniform + cosine, the DEPLOYABLE configuration, not the
 * best-scoring one. Selecting features against a metric that cannot be shipped
 * would optimise the wrong thing.
 *
 *   bun run scripts/station-quality/forward-select.ts --features <features.jsonl>
 */

import { existsSync, writeFileSync } from "node:fs";
import process from "node:process";

import { type Track } from "./metrics.js";
import { cosineDistance, distanceMatrix, makeRanker, ndcgAtK, pairedBootstrap, splitByGroup } from "./harness.js";
import { rankUniform, subsampleByGroup, weighted } from "./techniques.js";
import { buildModel, loadFeatureRecords } from "./load-features.js";
import {
  SHIPPED_DIMENSION_NAMES,
  TONAL_DIMENSION_NAMES,
  makeSpec,
} from "./vector-specs.js";
import { buildPerceptualVector } from "../../packages/sidflow-classify/src/deterministic-ratings.js";
import { SIMILARITY_TONAL_DIMENSIONS } from "../../packages/sidflow-classify/src/similarity-vector.js";

const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const FEATURES = arg("--features");
const JSON_OUT = arg("--json") ?? "workspace/station-opt/forward-select.json";
const MAX_TRACKS = Number.parseInt(arg("--max-tracks") ?? "20000", 10);
/** Train subsample used for selection; keeps ~1900 evaluations tractable. */
const SELECT_TRACKS = Number.parseInt(arg("--select-tracks") ?? "2500", 10);
const K = 10;

if (!FEATURES || !existsSync(FEATURES)) {
  process.stderr.write(`usage: forward-select.ts --features <features.jsonl>\n`);
  process.exit(1);
}

const records = loadFeatureRecords(FEATURES);
const model = buildModel(records);

const ALL_NAMES = [...SHIPPED_DIMENSION_NAMES, ...TONAL_DIMENSION_NAMES];
const fullSpec = makeSpec("all", "every candidate dimension", SHIPPED_DIMENSION_NAMES, TONAL_DIMENSION_NAMES);

const identity: Track[] = records.map((r) => ({ trackId: r.trackId, sidPath: r.sidPath, vector: [0], e: 3, m: 3, c: 3 }));
const keep = new Set(subsampleByGroup(identity, MAX_TRACKS).map((t) => t.trackId));
const kept = records.filter((r) => keep.has(r.trackId));

const allTracks: Track[] = kept.map((record) => ({
  trackId: record.trackId,
  sidPath: record.sidPath,
  vector: fullSpec.build(model, record.features),
  e: 3,
  m: 3,
  c: 3,
}));
const split = splitByGroup(allTracks);
const selectionPool = subsampleByGroup(split.train, SELECT_TRACKS);

process.stdout.write(
  `forward selection over ${ALL_NAMES.length} dimensions\n` +
    `  selecting on ${selectionPool.length} train tracks, reporting on ${split.validation.length} validation tracks\n\n`,
);

/** nDCG of a dimension subset under the deployable configuration. */
function score(tracks: Track[], indices: readonly number[]): { mean: number; perSeed: number[] } {
  const projected = tracks.map((track) => ({ ...track, vector: indices.map((i) => track.vector[i]!) }));
  const vectors = rankUniform(projected);
  const distances = distanceMatrix(vectors, cosineDistance);
  return ndcgAtK(projected, makeRanker(projected, distances), K);
}

const chosen: number[] = [];
const remaining = new Set(ALL_NAMES.map((_, i) => i));
const trace: Array<{ step: number; added: string; trainNdcg: number }> = [];
let best = 0;

while (remaining.size > 0) {
  let bestIndex = -1;
  let bestScore = best;
  for (const candidate of remaining) {
    const trial = score(selectionPool, [...chosen, candidate]).mean;
    if (trial > bestScore) {
      bestScore = trial;
      bestIndex = candidate;
    }
  }
  // Stop when no remaining dimension improves the objective at all.
  if (bestIndex < 0) break;
  chosen.push(bestIndex);
  remaining.delete(bestIndex);
  best = bestScore;
  trace.push({ step: chosen.length, added: ALL_NAMES[bestIndex]!, trainNdcg: bestScore });
  process.stdout.write(`  ${String(chosen.length).padStart(2)}. +${ALL_NAMES[bestIndex]!.padEnd(30)} train nDCG ${bestScore.toFixed(4)}\n`);
}

process.stdout.write(`\nselected ${chosen.length} of ${ALL_NAMES.length} dimensions\n\n`);

// ------------------------------------------------------- validation comparison

const shippedIndices = [
  ...SHIPPED_DIMENSION_NAMES.map((n) => ALL_NAMES.indexOf(n)),
  ...SIMILARITY_TONAL_DIMENSIONS.map((n) => ALL_NAMES.indexOf(n)),
];
const shipped24Indices = SHIPPED_DIMENSION_NAMES.map((n) => ALL_NAMES.indexOf(n));

const baselineTracks = kept.map((record) => ({
  trackId: record.trackId,
  sidPath: record.sidPath,
  vector: buildPerceptualVector(model, record.features),
  e: 3,
  m: 3,
  c: 3,
}));
const baselineSplit = splitByGroup(baselineTracks);
const baselineVectors = weighted(baselineSplit.validation);
const baselineNdcg = ndcgAtK(
  baselineSplit.validation,
  makeRanker(baselineSplit.validation, distanceMatrix(baselineVectors, cosineDistance)),
  K,
);

const comparisons = [
  { name: `shipped 24d (raw + weighted cosine)`, result: baselineNdcg },
  { name: `shipped 24d, rank-uniform`, result: score(split.validation, shipped24Indices) },
  { name: `shipped 35d (univariate selection), rank-uniform`, result: score(split.validation, shippedIndices) },
  { name: `forward-selected ${chosen.length}d, rank-uniform`, result: score(split.validation, chosen) },
];

process.stdout.write(`=== validation ===\n`);
for (const entry of comparisons) {
  const relative = (100 * (entry.result.mean - baselineNdcg.mean)) / (baselineNdcg.mean || 1);
  process.stdout.write(
    `  ${entry.name.padEnd(48)} nDCG@${K} ${entry.result.mean.toFixed(4)}  ${relative >= 0 ? "+" : ""}${relative.toFixed(1)}%\n`,
  );
}

process.stdout.write(`\npaired bootstrap against the univariate 35d selection:\n`);
const reference = comparisons[2]!.result;
for (const entry of [comparisons[3]!]) {
  const n = Math.min(entry.result.perSeed.length, reference.perSeed.length);
  const boot = pairedBootstrap(entry.result.perSeed.slice(0, n), reference.perSeed.slice(0, n));
  process.stdout.write(
    `  ${entry.name.padEnd(48)} diff ${boot.diff >= 0 ? "+" : ""}${boot.diff.toFixed(4)}` +
      `  95% CI [${boot.ci[0].toFixed(4)}, ${boot.ci[1].toFixed(4)}]  p=${boot.pValue.toFixed(4)}\n`,
  );
}

writeFileSync(
  JSON_OUT,
  `${JSON.stringify(
    {
      features: FEATURES,
      candidateDimensions: ALL_NAMES.length,
      selectionTracks: selectionPool.length,
      validationTracks: split.validation.length,
      selected: chosen.map((i) => ALL_NAMES[i]!),
      trace,
      validation: comparisons.map((c) => ({ name: c.name, ndcg: c.result.mean })),
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`\nwritten: ${JSON_OUT}\n`);
