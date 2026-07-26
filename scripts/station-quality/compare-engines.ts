#!/usr/bin/env bun
/**
 * Does the SID emulation change the classification enough to change the stations?
 *
 * Executes the design pre-registered in doc/sid-engine-comparison.md. Nothing here
 * chooses what to measure -- that was fixed before either arm finished rendering.
 *
 *   bun run scripts/station-quality/compare-engines.ts \
 *     --residfp workspace/engine-compare/residfp-partial.jsonl \
 *     --sidlite workspace/engine-compare/sidlite-classified/features_*.jsonl
 *
 * The pairing is what makes this cheap to interpret: identical tracks, identical
 * split, identical code, one variable. Any difference is the engine.
 */

import { existsSync, writeFileSync } from "node:fs";
import process from "node:process";

import { groupOf, type Track } from "./metrics.js";
import { cosineDistance, distanceMatrix, holmCorrection, makeRanker, ndcgAtK, pairedBootstrap, splitByGroup } from "./harness.js";
import { applyWeights, rankUniform } from "./techniques.js";
import { buildModel, loadFeatureRecords, type FeatureRecord } from "./load-features.js";
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
const RESIDFP = arg("--residfp") ?? "workspace/engine-compare/residfp-partial.jsonl";
const SIDLITE = arg("--sidlite");
const JSON_OUT = arg("--json") ?? "workspace/engine-compare/comparison.json";
const K = 10;

if (!SIDLITE || !existsSync(SIDLITE) || !existsSync(RESIDFP)) {
  process.stderr.write("usage: compare-engines.ts --residfp <features.jsonl> --sidlite <features.jsonl>\n");
  process.exit(1);
}

process.stdout.write("loading both arms\n");
const residfpAll = loadFeatureRecords(RESIDFP);
const sidliteAll = loadFeatureRecords(SIDLITE);

// Intersect, and impose ONE ordering on both arms. splitByGroup is deterministic in
// its input order, so a shared order is what guarantees the two arms are split
// identically -- without it a track could be train in one arm and test in the other,
// and the comparison would be measuring the split rather than the engine.
const sidliteById = new Map(sidliteAll.map((record) => [record.trackId, record]));
const paired: Array<{ residfp: FeatureRecord; sidlite: FeatureRecord }> = [];
for (const record of residfpAll) {
  const other = sidliteById.get(record.trackId);
  if (other) paired.push({ residfp: record, sidlite: other });
}
paired.sort((left, right) => left.residfp.trackId.localeCompare(right.residfp.trackId));

process.stdout.write(
  `  reSIDfp ${residfpAll.length}, SIDLite ${sidliteAll.length}, paired ${paired.length}\n\n`,
);
if (paired.length < 500) {
  process.stderr.write("too few paired tracks to measure anything; aborting\n");
  process.exit(1);
}

const residfpRecords = paired.map((entry) => entry.residfp);
const sidliteRecords = paired.map((entry) => entry.sidlite);

// Each arm gets its OWN rating model. It is corpus-fitted, so sharing one would carry
// one engine's feature distribution into the other engine's ratings and quietly make
// the arms agree more than they do.
const residfpModel = buildModel(residfpRecords);
const sidliteModel = buildModel(sidliteRecords);

const WAV_ONLY = makeSpec("wav", "", SHIPPED_DIMENSION_NAMES, []);
const FULL = makeSpec("full", "", SHIPPED_DIMENSION_NAMES, SIMILARITY_APPENDED_DIMENSIONS);

function tracksFor(records: FeatureRecord[], model: ReturnType<typeof buildModel>, spec: typeof FULL): Track[] {
  return records.map((record) => ({
    trackId: record.trackId,
    sidPath: record.sidPath,
    vector: spec.build(model, record.features),
    e: 3,
    m: 3,
    c: 3,
  }));
}

/** The shipped serving path: rank-uniform across the corpus, then learned weights. */
function evaluate(tracks: Track[]): { ndcg: number; perSeed: number[]; cold: number; coldPerSeed: number[] } {
  const split = splitByGroup(tracks);
  const width = tracks[0]!.vector.length;
  const weights = weightsForDimensions(width);
  let vectors = rankUniform(split.test);
  if (weights) vectors = applyWeights(vectors, [...weights]);
  const ranker = makeRanker(split.test, distanceMatrix(vectors, cosineDistance));
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
  const cold = rare.length === 0 ? { mean: 0, perSeed: [] as number[] } : ndcgAtK(split.test, ranker, K, rare);
  return { ndcg: overall.mean, perSeed: overall.perSeed, cold: cold.mean, coldPerSeed: cold.perSeed };
}

process.stdout.write("=== co-primary endpoints ===\n");
const arms = {
  wavResidfp: evaluate(tracksFor(residfpRecords, residfpModel, WAV_ONLY)),
  wavSidlite: evaluate(tracksFor(sidliteRecords, sidliteModel, WAV_ONLY)),
  fullResidfp: evaluate(tracksFor(residfpRecords, residfpModel, FULL)),
  fullSidlite: evaluate(tracksFor(sidliteRecords, sidliteModel, FULL)),
};

type Row = { label: string; residfp: number; sidlite: number; relative: number; ci: [number, number]; p: number };
function contrast(label: string, a: { ndcg: number; perSeed: number[] }, b: { ndcg: number; perSeed: number[] }): Row {
  const n = Math.min(a.perSeed.length, b.perSeed.length);
  const boot = pairedBootstrap(a.perSeed.slice(0, n), b.perSeed.slice(0, n));
  return {
    label,
    residfp: a.ndcg,
    sidlite: b.ndcg,
    relative: (100 * (a.ndcg - b.ndcg)) / (b.ndcg || 1),
    ci: boot.ci,
    p: boot.pValue,
  };
}

const coPrimary = [
  contrast("nDCG@10, 24 WAV-derived dims", arms.wavResidfp, arms.wavSidlite),
  contrast("nDCG@10, full 58-dim vector", arms.fullResidfp, arms.fullSidlite),
];
const holmRows = holmCorrection(coPrimary.map((row) => ({ name: row.label, p: row.p })));
const holmByLabel = new Map(holmRows.map((row) => [row.name, row.adjusted]));
const holm = coPrimary.map((row) => holmByLabel.get(row.label) ?? 1);

for (const [index, row] of coPrimary.entries()) {
  process.stdout.write(
    `  ${row.label.padEnd(32)} reSIDfp ${row.residfp.toFixed(4)}  SIDLite ${row.sidlite.toFixed(4)}`
    + `  ${row.relative >= 0 ? "+" : ""}${row.relative.toFixed(2)}%`
    + `  95% CI [${row.ci[0].toFixed(4)}, ${row.ci[1].toFixed(4)}]  p=${row.p.toFixed(4)}`
    + `  Holm p=${holm[index]!.toFixed(4)}\n`,
  );
}

process.stdout.write("\n=== guardrails (cold start) ===\n");
const coldWav = contrast("cold start, 24 dims", { ndcg: arms.wavResidfp.cold, perSeed: arms.wavResidfp.coldPerSeed }, { ndcg: arms.wavSidlite.cold, perSeed: arms.wavSidlite.coldPerSeed });
const coldFull = contrast("cold start, 58 dims", { ndcg: arms.fullResidfp.cold, perSeed: arms.fullResidfp.coldPerSeed }, { ndcg: arms.fullSidlite.cold, perSeed: arms.fullSidlite.coldPerSeed });
for (const row of [coldWav, coldFull]) {
  process.stdout.write(
    `  ${row.label.padEnd(32)} reSIDfp ${row.residfp.toFixed(4)}  SIDLite ${row.sidlite.toFixed(4)}`
    + `  ${row.relative >= 0 ? "+" : ""}${row.relative.toFixed(2)}%\n`,
  );
}

// ---- mechanistic: how far apart are the two renderings, dimension by dimension ----

function spearman(a: number[], b: number[]): number {
  const rank = (values: number[]): number[] => {
    const order = values.map((value, index) => ({ value, index })).sort((l, r) => l.value - r.value);
    const ranks = new Array<number>(values.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j += 1;
      const midrank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) ranks[order[k]!.index] = midrank;
      i = j + 1;
    }
    return ranks;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = ra.length;
  const mean = (n + 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = ra[i]! - mean;
    const y = rb[i]! - mean;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da === 0 || db === 0 ? 1 : num / Math.sqrt(da * db);
}

process.stdout.write("\n=== per-dimension agreement, 24 WAV-derived dimensions ===\n");
const perDimension: Array<{ name: string; rho: number }> = [];
for (const name of SHIPPED_DIMENSION_NAMES) {
  const a: number[] = [];
  const b: number[] = [];
  for (const entry of paired) {
    const x = entry.residfp.features[name];
    const y = entry.sidlite.features[name];
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
      a.push(x);
      b.push(y);
    }
  }
  perDimension.push({ name, rho: a.length > 10 ? spearman(a, b) : Number.NaN });
}
perDimension.sort((left, right) => (left.rho || 0) - (right.rho || 0));
for (const entry of perDimension.slice(0, 8)) {
  process.stdout.write(`  weakest  ${entry.name.padEnd(26)} rho ${entry.rho.toFixed(4)}\n`);
}
const finite = perDimension.filter((entry) => Number.isFinite(entry.rho));
const median = finite.length === 0 ? Number.NaN : finite[Math.floor(finite.length / 2)]!.rho;
process.stdout.write(`  median across ${finite.length} dimensions: rho ${median.toFixed(4)}\n`);

process.stdout.write("\n=== whole-vector agreement ===\n");
const residfpVectors = tracksFor(residfpRecords, residfpModel, FULL).map((track) => track.vector);
const sidliteVectors = tracksFor(sidliteRecords, sidliteModel, FULL).map((track) => track.vector);
const cosines: number[] = [];
for (let index = 0; index < residfpVectors.length; index += 1) {
  const a = residfpVectors[index]!;
  const b = sidliteVectors[index]!;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let d = 0; d < a.length; d += 1) {
    dot += a[d]! * b[d]!;
    na += a[d]! * a[d]!;
    nb += b[d]! * b[d]!;
  }
  cosines.push(na === 0 || nb === 0 ? 1 : dot / Math.sqrt(na * nb));
}
cosines.sort((l, r) => l - r);
const pct = (q: number): number => cosines[Math.min(cosines.length - 1, Math.floor(cosines.length * q))]!;
process.stdout.write(
  `  cosine(reSIDfp, SIDLite) per track:  p01 ${pct(0.01).toFixed(4)}  p50 ${pct(0.5).toFixed(4)}`
  + `  p99 ${pct(0.99).toFixed(4)}  min ${cosines[0]!.toFixed(4)}\n`,
);

// ---- product level: do the 1-5 ratings a listener filters on actually agree? ----

function ratingsFor(records: FeatureRecord[], model: ReturnType<typeof buildModel>): Array<{ e: number; m: number; c: number }> {
  const raws = records.map((record) => computeRawRatingScores(model, record.features));
  const quantiles = buildRatingQuantiles(raws);
  if (!quantiles) {
    throw new Error("too few records to calibrate ratings; the arms would not be comparable");
  }
  return raws.map((raw) => ({
    e: calibratedRatingFromRaw(raw.e, quantiles.e),
    m: calibratedRatingFromRaw(raw.m, quantiles.m),
    c: calibratedRatingFromRaw(raw.c, quantiles.c),
  }));
}

const residfpRatings = ratingsFor(residfpRecords, residfpModel);
const sidliteRatings = ratingsFor(sidliteRecords, sidliteModel);

/** Quadratic-weighted kappa: chance-corrected agreement that punishes far misses more. */
function quadraticWeightedKappa(a: number[], b: number[], levels = 5): number {
  const observed = Array.from({ length: levels }, () => new Array<number>(levels).fill(0));
  const marginalA = new Array<number>(levels).fill(0);
  const marginalB = new Array<number>(levels).fill(0);
  for (let i = 0; i < a.length; i += 1) {
    const x = Math.min(levels - 1, Math.max(0, a[i]! - 1));
    const y = Math.min(levels - 1, Math.max(0, b[i]! - 1));
    observed[x]![y] += 1;
    marginalA[x] += 1;
    marginalB[y] += 1;
  }
  const n = a.length;
  let numerator = 0;
  let denominator = 0;
  for (let x = 0; x < levels; x += 1) {
    for (let y = 0; y < levels; y += 1) {
      const weight = ((x - y) ** 2) / ((levels - 1) ** 2);
      numerator += weight * observed[x]![y]!;
      denominator += weight * ((marginalA[x]! * marginalB[y]!) / n);
    }
  }
  return denominator === 0 ? 1 : 1 - numerator / denominator;
}

process.stdout.write("\n=== rating agreement (what category stations filter on) ===\n");
const ratingSummary: Record<string, { exact: number; within1: number; kappa: number }> = {};
for (const dimension of ["e", "m", "c"] as const) {
  const a = residfpRatings.map((entry) => entry[dimension]);
  const b = sidliteRatings.map((entry) => entry[dimension]);
  let exact = 0;
  let within1 = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) exact += 1;
    if (Math.abs(a[i]! - b[i]!) <= 1) within1 += 1;
  }
  const kappa = quadraticWeightedKappa(a, b);
  ratingSummary[dimension] = { exact: exact / a.length, within1: within1 / a.length, kappa };
  process.stdout.write(
    `  ${dimension}  exact ${(100 * exact / a.length).toFixed(1)}%   within 1 ${(100 * within1 / a.length).toFixed(1)}%   quadratic-weighted kappa ${kappa.toFixed(4)}\n`,
  );
}

// ---- the pre-registered decision rule, applied mechanically ----

const GUARDRAIL_LIMIT = -5;
const guardrailsIntact = coldWav.relative >= GUARDRAIL_LIMIT && coldFull.relative >= GUARDRAIL_LIMIT;
const winner = coPrimary.some((row, index) => row.relative >= 1 && holm[index]! < 0.05 && row.residfp > row.sidlite)
  && guardrailsIntact
  ? "residfp"
  : "sidlite";

process.stdout.write("\n=== decision (rule fixed in doc/sid-engine-comparison.md before measuring) ===\n");
process.stdout.write(
  `  adopt reSIDfp only on >=1% relative gain with Holm p<0.05 on a co-primary, guardrails intact\n`,
);
process.stdout.write(`  => ${winner.toUpperCase()}\n`);

writeFileSync(
  JSON_OUT,
  `${JSON.stringify(
    {
      pairedTracks: paired.length,
      coPrimary: coPrimary.map((row, index) => ({ ...row, holmP: holm[index] })),
      guardrails: { coldWav, coldFull, intact: guardrailsIntact },
      perDimensionSpearman: perDimension,
      medianSpearman: median,
      vectorCosine: { p01: pct(0.01), p50: pct(0.5), p99: pct(0.99), min: cosines[0] },
      ratingAgreement: ratingSummary,
      winner,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`\nwritten: ${JSON_OUT}\n`);
