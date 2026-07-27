#!/usr/bin/env bun
/**
 * Do the learned weights transfer to tracks they were never fitted on?
 *
 * The campaign in doc/station-quality.md fitted a diagonal weight vector by coordinate
 * ascent on an 11,284-track development corpus, and every headline number was measured
 * on a held-out split of THAT corpus. Held out within a corpus is not the same as held
 * out from it: the rank normalisation, the rating quantiles and the weights were all
 * fitted against one collection's feature distribution, so the reported gain could in
 * principle be partly a fit to that distribution.
 *
 * This measures the shipped configuration on a DIFFERENT slice of HVSC with every track
 * that appears in the development corpus removed, so nothing here was seen during
 * fitting in any capacity.
 *
 *   bun run scripts/station-quality/verify-transfer.ts \
 *     --features <corpus.jsonl> --exclude <dev-corpus.jsonl>
 */

import { existsSync, writeFileSync } from "node:fs";
import process from "node:process";

import { groupOf, ratingSpread, type Track } from "./metrics.js";
import { cosineDistance, distanceMatrix, makeRanker, ndcgAtK, pairedBootstrap, splitByGroup } from "./harness.js";
import { applyWeights, rankUniform, weighted } from "./techniques.js";
import { buildModel, loadFeatureRecords } from "./load-features.js";
import { SHIPPED_DIMENSION_NAMES, makeSpec } from "./vector-specs.js";
import { SIMILARITY_APPENDED_DIMENSIONS } from "../../packages/sidflow-classify/src/similarity-vector.js";
import {
  buildRatingQuantiles,
  calibratedRatingFromRaw,
  computeRawRatingScores,
} from "../../packages/sidflow-classify/src/deterministic-ratings.js";
import { weightsForDimensions } from "../../packages/sidflow-common/src/vector-similarity.js";

const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const FEATURES = arg("--features");
const EXCLUDE = arg("--exclude");
const JSON_OUT = arg("--json") ?? "workspace/engine-compare/transfer.json";
const K = 10;

if (!FEATURES || !existsSync(FEATURES)) {
  process.stderr.write("usage: verify-transfer.ts --features <corpus.jsonl> [--exclude <dev.jsonl>]\n");
  process.exit(1);
}

/**
 * Track ids are compared with any leading music-root prefix stripped.
 *
 * The two corpora were classified with `sidPath` pointing at different levels, so one records
 * "C64Music/DEMOS/x.sid" and the other "DEMOS/x.sid". Compared literally the overlap is zero,
 * which does not error -- it silently reports a clean holdout while measuring on the fitting
 * corpus. Observed exactly that: 11,284 dev keys against 87,868 corpus keys, overlap 0.
 */
function canonicalTrackId(trackId: string): string {
  return trackId.replace(/^C64Music\//, "");
}

const all = loadFeatureRecords(FEATURES);
const excluded = EXCLUDE && existsSync(EXCLUDE)
  ? new Set(loadFeatureRecords(EXCLUDE).map((record) => canonicalTrackId(record.trackId)))
  : new Set<string>();
const records = all.filter((record) => !excluded.has(canonicalTrackId(record.trackId)));

process.stdout.write(
  `corpus ${all.length}, excluded ${all.length - records.length} seen during fitting, measuring on ${records.length}\n\n`,
);

const model = buildModel(records);

/** The 1-5 levels the product serves, so category-station spread is measurable here. */
const raws = records.map((record) => computeRawRatingScores(model, record.features));
const quantiles = buildRatingQuantiles(raws);
const ratings = raws.map((raw) => ({
  e: quantiles ? calibratedRatingFromRaw(raw.e, quantiles.e) : 3,
  m: quantiles ? calibratedRatingFromRaw(raw.m, quantiles.m) : 3,
  c: quantiles ? calibratedRatingFromRaw(raw.c, quantiles.c) : 3,
}));

function tracksFor(dimensionNames: readonly string[], appended: readonly string[]): Track[] {
  const spec = makeSpec("s", "", dimensionNames, appended);
  return records.map((record, index) => ({
    trackId: record.trackId,
    sidPath: record.sidPath,
    vector: spec.build(model, record.features),
    e: ratings[index]!.e,
    m: ratings[index]!.m,
    c: ratings[index]!.c,
  }));
}

/** The legacy published representation: the three 1-5 ratings and a spare. */
function legacyTracks(): Track[] {
  return records.map((record, index) => ({
    trackId: record.trackId,
    sidPath: record.sidPath,
    vector: [ratings[index]!.e / 5, ratings[index]!.m / 5, ratings[index]!.c / 5, 0.6],
    e: ratings[index]!.e,
    m: ratings[index]!.m,
    c: ratings[index]!.c,
  }));
}

type Result = { name: string; ndcg: number; cold: number; perSeed: number[] };

function evaluate(name: string, tracks: Track[], mode: "legacy" | "weighted-raw" | "shipped"): Result {
  const split = splitByGroup(tracks);
  let vectors: Array<Float64Array | number[]>;
  if (mode === "shipped") {
    const weights = weightsForDimensions(tracks[0]!.vector.length);
    const normalised = rankUniform(split.test);
    vectors = weights ? applyWeights(normalised, [...weights]) : normalised;
  } else if (mode === "weighted-raw") {
    vectors = weighted(split.test);
  } else {
    vectors = split.test.map((track) => Float64Array.from(track.vector));
  }
  const ranker = makeRanker(split.test, distanceMatrix(vectors as Float64Array[], cosineDistance));
  const overall = ndcgAtK(split.test, ranker, K);

  const counts = new Map<string, number>();
  for (const track of split.test) {
    const group = groupOf(track.sidPath);
    if (group) counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const rare: number[] = [];
  for (let index = 0; index < split.test.length; index += 1) {
    const group = groupOf(split.test[index]!.sidPath);
    if (group && (counts.get(group) ?? 0) <= 3) rare.push(index);
  }
  const cold = rare.length === 0 ? 0 : ndcgAtK(split.test, ranker, K, rare).mean;
  process.stdout.write(`  ${name.padEnd(44)} nDCG@${K} ${overall.mean.toFixed(4)}   cold start ${cold.toFixed(4)}\n`);
  return { name, ndcg: overall.mean, cold, perSeed: overall.perSeed };
}

process.stdout.write("=== retrieval on tracks never used for fitting ===\n");
const legacy = evaluate("published today: 4-dim ratings vector", legacyTracks(), "legacy");
const baseline = evaluate("previous best: 24-dim raw + weighted", tracksFor(SHIPPED_DIMENSION_NAMES, []), "weighted-raw");
const shipped = evaluate("shipped: 58-dim rank-uniform + learned", tracksFor(SHIPPED_DIMENSION_NAMES, SIMILARITY_APPENDED_DIMENSIONS), "shipped");

process.stdout.write("\n=== relative, paired bootstrap over shared seeds ===\n");
for (const reference of [legacy, baseline]) {
  const n = Math.min(shipped.perSeed.length, reference.perSeed.length);
  const boot = pairedBootstrap(shipped.perSeed.slice(0, n), reference.perSeed.slice(0, n));
  const factor = shipped.ndcg / (reference.ndcg || 1e-9);
  process.stdout.write(
    `  vs ${reference.name.padEnd(42)} ${factor.toFixed(1)}x`
    + `  (+${(100 * (shipped.ndcg - reference.ndcg) / (reference.ndcg || 1e-9)).toFixed(1)}%)`
    + `  95% CI [${boot.ci[0].toFixed(4)}, ${boot.ci[1].toFixed(4)}]  p=${boot.pValue.toFixed(4)}\n`,
  );
}

process.stdout.write("\n=== category-station inputs ===\n");
const spread = ratingSpread(tracksFor(SHIPPED_DIMENSION_NAMES, SIMILARITY_APPENDED_DIMENSIONS));
process.stdout.write(`  ${JSON.stringify(spread)}\n`);

writeFileSync(
  JSON_OUT,
  `${JSON.stringify(
    {
      corpus: FEATURES,
      totalRecords: all.length,
      excludedSeenDuringFitting: all.length - records.length,
      measuredOn: records.length,
      results: [legacy, baseline, shipped].map(({ perSeed: _drop, ...rest }) => rest),
      ratingSpread: spread,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`\nwritten: ${JSON_OUT}\n`);
