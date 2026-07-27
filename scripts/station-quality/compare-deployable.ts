#!/usr/bin/env bun
/**
 * Head-to-head on the configurations that could actually be DEPLOYED.
 *
 * The sweep answers "what ranks best". This answers a narrower and more practical
 * question: of the options that can be shipped without re-deriving the station
 * model, which is best, and what does each cost?
 *
 * The distinction matters because the best-ranking representation is not
 * deployable as-is. Rank-Gaussian centres every dimension on zero, so cosine
 * similarity spans [-1, 1]; the station pipeline applies an ABSOLUTE
 * minimum-similarity threshold (0.73 at the default adventure level) and the tiny
 * profile quantises each edge similarity into one byte, both of which assume
 * non-negative vectors and a "similar means ~0.9" scale.
 *
 * So each configuration is reported with two numbers that have to be weighed
 * together: retrieval quality, and how many candidates per seed still clear the
 * shipped threshold. A representation that ranks better but starves the station of
 * candidates is not an improvement, and one that admits almost the whole corpus
 * has quietly disabled the adventure control.
 *
 *   bun run scripts/station-quality/compare-deployable.ts --features <features.jsonl>
 */

import { existsSync, writeFileSync } from "node:fs";
import process from "node:process";

import { type Track } from "./metrics.js";
import { distanceMatrix, euclidean, cosineDistance, makeRanker, ndcgAtK, pairedBootstrap, splitByGroup } from "./harness.js";
import { rankGaussian, rankUniform, subsampleByGroup, weighted } from "./techniques.js";
import { buildModel, loadFeatureRecords } from "./load-features.js";
import { buildPerceptualVector } from "../../packages/sidflow-classify/src/deterministic-ratings.js";
import { buildSimilarityVector } from "../../packages/sidflow-classify/src/similarity-vector.js";
import { cosineSimilarity } from "../../packages/sidflow-common/src/vector-similarity.js";

const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const FEATURES = arg("--features");
const JSON_OUT = arg("--json") ?? "workspace/station-opt/deployable.json";
const MAX_TRACKS = Number.parseInt(arg("--max-tracks") ?? "20000", 10);
/** The threshold the station applies at the default adventure level. */
const STATION_MIN_SIMILARITY = 0.73;
const K = 10;

if (!FEATURES || !existsSync(FEATURES)) {
  process.stderr.write(`usage: compare-deployable.ts --features <features.jsonl>\n`);
  process.exit(1);
}

const records = loadFeatureRecords(FEATURES);
const model = buildModel(records);

const base: Track[] = records.map((record) => ({
  trackId: record.trackId,
  sidPath: record.sidPath,
  vector: [0],
  e: 3,
  m: 3,
  c: 3,
}));
const keep = new Set(subsampleByGroup(base, MAX_TRACKS).map((t) => t.trackId));
const kept = records.filter((r) => keep.has(r.trackId));

const build = (fn: (features: (typeof kept)[number]["features"]) => number[]): Track[] =>
  kept.map((record) => ({
    trackId: record.trackId,
    sidPath: record.sidPath,
    vector: fn(record.features),
    e: 3,
    m: 3,
    c: 3,
  }));

const shipped24 = build((f) => buildPerceptualVector(model, f));
const shipped35 = build((f) => buildSimilarityVector(model, f));

interface Config {
  name: string;
  tracks: Track[];
  transform: (tracks: Track[]) => Float64Array[];
  metric: typeof euclidean;
  /** Whether the shipped cosineSimilarity can be applied to the stored vector. */
  deployable: boolean;
  note: string;
}

const CONFIGS: Config[] = [
  {
    name: "24d raw + weighted cosine (ships today)",
    tracks: shipped24,
    transform: (t) => weighted(t),
    metric: cosineDistance,
    deployable: true,
    note: "baseline",
  },
  {
    name: "35d raw + uniform cosine",
    tracks: shipped35,
    transform: (t) => t.map((x) => Float64Array.from(x.vector)),
    metric: cosineDistance,
    deployable: true,
    note: "tonal features, no normalisation",
  },
  {
    name: "35d rank-uniform + cosine",
    tracks: shipped35,
    transform: rankUniform,
    metric: cosineDistance,
    deployable: true,
    note: "values stay in [0,1], so the shipped threshold keeps its scale",
  },
  {
    name: "35d rank-gaussian + cosine",
    tracks: shipped35,
    transform: rankGaussian,
    metric: cosineDistance,
    deployable: false,
    note: "best ranking, but centres on zero and breaks absolute thresholds",
  },
];

/**
 * How many candidates per seed clear the shipped station threshold.
 *
 * Sampled over a stride of seeds against the whole slice. Reported as a fraction
 * of the corpus, because both failure modes matter: too few starves the station,
 * and near-100% means the adventure control no longer selects anything.
 */
function thresholdReach(vectors: number[][]): { median: number; p05: number; min: number } {
  const counts: number[] = [];
  const stride = Math.max(1, Math.floor(vectors.length / 150));
  for (let i = 0; i < vectors.length; i += stride) {
    let count = 0;
    for (let j = 0; j < vectors.length; j++) {
      if (i === j) continue;
      if (cosineSimilarity(vectors[i]!, vectors[j]!) >= STATION_MIN_SIMILARITY) count++;
    }
    counts.push(count / (vectors.length - 1));
  }
  counts.sort((a, b) => a - b);
  return {
    median: counts[Math.floor(counts.length / 2)]!,
    p05: counts[Math.floor(counts.length * 0.05)]!,
    min: counts[0]!,
  };
}

const results: Array<{
  name: string;
  deployable: boolean;
  note: string;
  validationNdcg: number;
  testNdcg: number;
  relativeToBaseline: number;
  reachMedian: number;
  reachP05: number;
  reachMin: number;
  perSeed: number[];
}> = [];

for (const config of CONFIGS) {
  const split = splitByGroup(config.tracks);
  const evaluate = (slice: Track[]) => {
    const vectors = config.transform(slice);
    const distances = distanceMatrix(vectors, config.metric);
    return ndcgAtK(slice, makeRanker(slice, distances), K);
  };
  const validation = evaluate(split.validation);
  const test = evaluate(split.test);

  // Threshold reach is measured on the stored representation, which is what the
  // product will actually hold.
  const stored = config.transform(split.test).map((v) => [...v]);
  const reach = thresholdReach(stored);

  results.push({
    name: config.name,
    deployable: config.deployable,
    note: config.note,
    validationNdcg: validation.mean,
    testNdcg: test.mean,
    relativeToBaseline: 0,
    reachMedian: reach.median,
    reachP05: reach.p05,
    reachMin: reach.min,
    perSeed: test.perSeed,
  });
}

const baseline = results[0]!;
for (const result of results) {
  result.relativeToBaseline = (100 * (result.testNdcg - baseline.testNdcg)) / (baseline.testNdcg || 1);
}

process.stdout.write(`corpus ${kept.length} tracks; station threshold ${STATION_MIN_SIMILARITY} (adventure default)\n\n`);
process.stdout.write(
  `${"configuration".padEnd(42)}${"val".padStart(8)}${"test".padStart(8)}${"rel".padStart(8)}` +
    `${"reach med".padStart(11)}${"p05".padStart(8)}${"min".padStart(8)}  deployable\n`,
);
for (const result of results) {
  process.stdout.write(
    `${result.name.padEnd(42)}${result.validationNdcg.toFixed(4).padStart(8)}${result.testNdcg.toFixed(4).padStart(8)}` +
      `${`${result.relativeToBaseline >= 0 ? "+" : ""}${result.relativeToBaseline.toFixed(1)}%`.padStart(8)}` +
      `${`${(100 * result.reachMedian).toFixed(1)}%`.padStart(11)}${`${(100 * result.reachP05).toFixed(1)}%`.padStart(8)}` +
      `${`${(100 * result.reachMin).toFixed(1)}%`.padStart(8)}  ${result.deployable ? "yes" : "NO"}\n`,
  );
}

process.stdout.write(`\npaired bootstrap on TEST against the shipped baseline:\n`);
for (const result of results.slice(1)) {
  const n = Math.min(result.perSeed.length, baseline.perSeed.length);
  const boot = pairedBootstrap(result.perSeed.slice(0, n), baseline.perSeed.slice(0, n));
  process.stdout.write(
    `  ${result.name.padEnd(42)} diff ${boot.diff >= 0 ? "+" : ""}${boot.diff.toFixed(4)}` +
      `  95% CI [${boot.ci[0].toFixed(4)}, ${boot.ci[1].toFixed(4)}]  p=${boot.pValue.toFixed(4)}\n`,
  );
}

writeFileSync(
  JSON_OUT,
  `${JSON.stringify(
    {
      features: FEATURES,
      tracks: kept.length,
      stationMinSimilarity: STATION_MIN_SIMILARITY,
      results: results.map(({ perSeed: _omit, ...rest }) => rest),
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`\nwritten: ${JSON_OUT}\n`);
