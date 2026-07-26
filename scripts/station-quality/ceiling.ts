#!/usr/bin/env bun
/**
 * How much retrieval quality is available AT ALL from a given feature set?
 *
 *   bun run scripts/station-quality/ceiling.ts --features <features.jsonl>
 *
 * ## Why this is needed
 *
 * A sweep that finds no improvement has two possible explanations, and they call
 * for opposite responses: either the search was too weak, or the features have no
 * more to give. Reporting "no significant improvement" without distinguishing
 * them is close to useless. These measurements are about the FEATURES rather than
 * about any candidate, so they say which case we are in.
 *
 * ## The measurements
 *
 * 1. Pairwise separability, as the probability that two tracks by the same
 *    composer are closer together than a random pair from different composers.
 *    This is the area under the ROC curve of same-group against different-group
 *    distances. At 0.5 the feature space knows nothing about authorship and NO
 *    distance function, re-ranking or amount of tuning can retrieve it; at 1.0 the
 *    two populations are perfectly separated and any sane ranker would succeed.
 *    It is a property of the representation, not of the ranker, which is exactly
 *    what is wanted for a ceiling.
 *
 * 2. The same figure per individual dimension, which shows which musical
 *    properties carry authorship signal and which are dead weight. A dimension
 *    with univariate AUC at 0.50 is not necessarily useless — it might matter in
 *    combination — but a dimension that is also nearly constant is.
 *
 * 3. A learning curve over dimension count: add dimensions in descending order of
 *    univariate AUC and watch nDCG@10. If it has plateaued, more features OF THE
 *    SAME KIND will not help, and the honest recommendation is to look for a
 *    different kind of information rather than more of this one.
 *
 * Everything here is computed on TRAIN and VALIDATION only. The test slice is
 * reserved for the single confirmatory measurement in the sweep.
 */

import { existsSync, writeFileSync } from "node:fs";
import process from "node:process";

import { groupOf, type Track } from "./metrics.js";
import { distanceMatrix, euclidean, makeRanker, ndcgAtK, splitByGroup } from "./harness.js";
import { rankGaussian, subsampleByGroup } from "./techniques.js";
import { buildModel, loadFeatureRecords, type FeatureRecord } from "./load-features.js";
import { buildVectorSpecs, type VectorSpec } from "./vector-specs.js";

const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] : undefined;
};

const FEATURES = arg("--features");
const JSON_OUT = arg("--json") ?? "workspace/station-opt/ceiling.json";
const MAX_TRACKS = Number.parseInt(arg("--max-tracks") ?? "20000", 10);
const PAIR_SAMPLES = Number.parseInt(arg("--pairs") ?? "2000000", 10);
const K = 10;

if (!FEATURES || !existsSync(FEATURES)) {
  process.stderr.write(`usage: ceiling.ts --features <features.jsonl> [--json out] [--pairs n]\n`);
  process.exit(1);
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 0x100000000);
}

/**
 * Probability that a same-group pair is closer than a different-group pair.
 *
 * Estimated by sampling pairs rather than enumerating them: at 11k tracks there
 * are ~60 million pairs, and the quantity is a simple probability whose standard
 * error at two million samples is well under 0.001 — far tighter than any
 * difference worth acting on.
 *
 * Returned alongside the sample counts so a suspiciously narrow interval can be
 * traced back to how many same-group pairs actually existed.
 */
function separability(
  tracks: Track[],
  distance: (a: Track, b: Track) => number,
  samples: number,
): { auc: number; samePairs: number; differentPairs: number; ci: [number, number] } {
  const groups = tracks.map((t) => groupOf(t.sidPath));
  const byGroup = new Map<string, number[]>();
  for (let i = 0; i < tracks.length; i++) {
    const group = groups[i];
    if (!group) continue;
    const list = byGroup.get(group);
    if (list) list.push(i);
    else byGroup.set(group, [i]);
  }
  // Same-file siblings are excluded, matching the retrieval rule: another subsong
  // of the tune already playing is trivially "same composer" and would inflate
  // separability without producing a better station.
  const eligible = [...byGroup.values()].filter((list) => list.length >= 2);

  const random = makeRandom(0x51de51de);
  const sameDistances: number[] = [];
  const differentDistances: number[] = [];

  for (let attempt = 0; attempt < samples && eligible.length > 0; attempt++) {
    const group = eligible[(random() * eligible.length) | 0]!;
    const a = group[(random() * group.length) | 0]!;
    const b = group[(random() * group.length) | 0]!;
    if (a === b || tracks[a]!.sidPath === tracks[b]!.sidPath) continue;
    sameDistances.push(distance(tracks[a]!, tracks[b]!));
  }
  for (let attempt = 0; attempt < samples; attempt++) {
    const a = (random() * tracks.length) | 0;
    const b = (random() * tracks.length) | 0;
    if (a === b) continue;
    if (groups[a] && groups[a] === groups[b]) continue;
    differentDistances.push(distance(tracks[a]!, tracks[b]!));
  }

  if (sameDistances.length === 0 || differentDistances.length === 0) {
    return { auc: 0.5, samePairs: sameDistances.length, differentPairs: differentDistances.length, ci: [0.5, 0.5] };
  }

  // AUC via the rank-sum identity, which is exact and avoids an O(n*m) sweep.
  const labelled = [
    ...sameDistances.map((d) => ({ d, same: true })),
    ...differentDistances.map((d) => ({ d, same: false })),
  ].sort((x, y) => x.d - y.d);
  let rankSum = 0;
  let index = 0;
  while (index < labelled.length) {
    let end = index;
    while (end + 1 < labelled.length && labelled[end + 1]!.d === labelled[index]!.d) end++;
    const averageRank = (index + end) / 2 + 1;
    for (let i = index; i <= end; i++) if (labelled[i]!.same) rankSum += averageRank;
    index = end + 1;
  }
  const n1 = sameDistances.length;
  const n2 = differentDistances.length;
  // Smaller distance for same-group pairs is GOOD, so a low rank sum means high
  // separability; hence 1 - the usual expression.
  const auc = 1 - (rankSum - (n1 * (n1 + 1)) / 2) / (n1 * n2);

  // Hanley-McNeil standard error, adequate here and far cheaper than a bootstrap
  // over millions of pairs.
  const q1 = auc / (2 - auc);
  const q2 = (2 * auc * auc) / (1 + auc);
  const se = Math.sqrt(
    (auc * (1 - auc) + (n1 - 1) * (q1 - auc * auc) + (n2 - 1) * (q2 - auc * auc)) / (n1 * n2),
  );
  return {
    auc,
    samePairs: n1,
    differentPairs: n2,
    ci: [Math.max(0, auc - 1.96 * se), Math.min(1, auc + 1.96 * se)],
  };
}

// ------------------------------------------------------------------- loading

const records = loadFeatureRecords(FEATURES);
const model = buildModel(records);
const identity: Track[] = records.map((r) => ({ trackId: r.trackId, sidPath: r.sidPath, vector: [0], e: 3, m: 3, c: 3 }));
const keep = new Set(subsampleByGroup(identity, MAX_TRACKS).map((t) => t.trackId));
const kept = records.filter((r) => keep.has(r.trackId));

function tracksFor(spec: VectorSpec, source: FeatureRecord[]): Track[] {
  return source
    .map((record) => ({
      trackId: record.trackId,
      sidPath: record.sidPath,
      vector: spec.build(model, record.features),
      e: 3,
      m: 3,
      c: 3,
    }))
    .filter((t) => t.vector.every((v) => Number.isFinite(v)));
}

const SPECS = buildVectorSpecs();
process.stdout.write(`ceiling analysis over ${kept.length} tracks (train + validation only)\n\n`);

/** Rank-Gaussian first, so no dimension dominates purely through its scale. */
function normalisedTracks(tracks: Track[]): Track[] {
  const vectors = rankGaussian(tracks);
  return tracks.map((track, i) => ({ ...track, vector: [...vectors[i]!] }));
}

const euclideanBetween = (a: Track, b: Track): number => {
  let sum = 0;
  for (let i = 0; i < a.vector.length; i++) sum += (a.vector[i]! - b.vector[i]!) ** 2;
  return Math.sqrt(sum);
};

// ------------------------------------------------- 1. separability per spec

interface SpecReport {
  spec: string;
  dimensions: number;
  auc: number;
  ci: [number, number];
  samePairs: number;
  differentPairs: number;
  ndcg: number;
  seeds: number;
}

const specReports: SpecReport[] = [];
process.stdout.write(`=== pairwise separability (P[same-composer pair is closer than a random pair]) ===\n`);
process.stdout.write(`    0.500 means the features know nothing about authorship, so no metric can retrieve it\n\n`);

for (const spec of SPECS) {
  const all = tracksFor(spec, kept);
  const split = splitByGroup(all);
  // Train + validation. Test stays untouched for the sweep's single measurement.
  const analysis = normalisedTracks([...split.train, ...split.validation]);
  const result = separability(analysis, euclideanBetween, PAIR_SAMPLES);

  const distances = distanceMatrix(analysis.map((t) => Float64Array.from(t.vector)), euclidean);
  const nd = ndcgAtK(analysis, makeRanker(analysis, distances), K);

  specReports.push({
    spec: spec.name,
    dimensions: spec.dimensionNames.length,
    auc: result.auc,
    ci: result.ci,
    samePairs: result.samePairs,
    differentPairs: result.differentPairs,
    ndcg: nd.mean,
    seeds: nd.perSeed.length,
  });
  process.stdout.write(
    `  ${spec.name.padEnd(24)} ${String(spec.dimensionNames.length).padStart(3)}d  AUC ${result.auc.toFixed(4)} ` +
      `[${result.ci[0].toFixed(4)}, ${result.ci[1].toFixed(4)}]  nDCG@${K} ${nd.mean.toFixed(4)}  (${nd.perSeed.length} seeds)\n`,
  );
}

// ------------------------------------------- 2. per-dimension separability

const bestSpec = SPECS.reduce((best, spec) => {
  const a = specReports.find((r) => r.spec === spec.name)!.auc;
  const b = specReports.find((r) => r.spec === best.name)!.auc;
  return a > b ? spec : best;
}, SPECS[0]!);

const bestTracksAll = tracksFor(bestSpec, kept);
const bestSplit = splitByGroup(bestTracksAll);
const bestAnalysis = normalisedTracks([...bestSplit.train, ...bestSplit.validation]);

process.stdout.write(`\n=== per-dimension separability (${bestSpec.name}) ===\n`);
const perDimension = bestSpec.dimensionNames.map((name, index) => {
  const single = (a: Track, b: Track) => Math.abs(a.vector[index]! - b.vector[index]!);
  const result = separability(bestAnalysis, single, 200_000);
  const column = bestAnalysis.map((t) => t.vector[index]!);
  const mean = column.reduce((s, v) => s + v, 0) / column.length;
  const sd = Math.sqrt(column.reduce((s, v) => s + (v - mean) ** 2, 0) / column.length);
  return { name, index, auc: result.auc, sd };
});
perDimension.sort((a, b) => b.auc - a.auc);
for (const dimension of perDimension) {
  const bar = "#".repeat(Math.max(0, Math.round((dimension.auc - 0.5) * 200)));
  process.stdout.write(`  ${dimension.name.padEnd(30)} AUC ${dimension.auc.toFixed(4)}  sd ${dimension.sd.toFixed(3)}  ${bar}\n`);
}

// ------------------------------------------------------- 3. learning curve

process.stdout.write(`\n=== learning curve: nDCG@${K} as dimensions are added by descending univariate AUC ===\n`);
const curve: Array<{ dimensions: number; ndcg: number; added: string }> = [];
const order = perDimension.map((d) => d.index);
for (const count of [1, 2, 3, 5, 8, 12, 16, 20, 24, 30, 36, 44, order.length].filter(
  (n, i, list) => n <= order.length && list.indexOf(n) === i,
)) {
  const chosen = order.slice(0, count);
  const projected = bestAnalysis.map((track) => ({
    ...track,
    vector: chosen.map((index) => track.vector[index]!),
  }));
  const distances = distanceMatrix(projected.map((t) => Float64Array.from(t.vector)), euclidean);
  const nd = ndcgAtK(projected, makeRanker(projected, distances), K);
  curve.push({ dimensions: count, ndcg: nd.mean, added: perDimension[count - 1]!.name });
  process.stdout.write(
    `  ${String(count).padStart(3)}d  nDCG ${nd.mean.toFixed(4)}   (last added: ${perDimension[count - 1]!.name})\n`,
  );
}

const peak = curve.reduce((best, point) => (point.ndcg > best.ndcg ? point : best), curve[0]!);
const full = curve[curve.length - 1]!;
process.stdout.write(
  `\n  peak ${peak.ndcg.toFixed(4)} at ${peak.dimensions}d; all ${full.dimensions}d gives ${full.ndcg.toFixed(4)}` +
    ` (${(100 * (full.ndcg - peak.ndcg)) / (peak.ndcg || 1) >= 0 ? "+" : ""}${((100 * (full.ndcg - peak.ndcg)) / (peak.ndcg || 1)).toFixed(1)}% vs peak)\n`,
);

writeFileSync(
  JSON_OUT,
  `${JSON.stringify(
    {
      features: FEATURES,
      tracks: kept.length,
      pairSamples: PAIR_SAMPLES,
      specs: specReports,
      bestSpec: bestSpec.name,
      perDimension,
      learningCurve: curve,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`\nwritten: ${JSON_OUT}\n`);
