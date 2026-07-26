#!/usr/bin/env bun
/**
 * Station-quality optimisation loop.
 *
 * Reads an exported corpus, tries a series of representation / ranking
 * techniques, selects on VALIDATION, and touches TEST exactly once at the end.
 *
 * Nothing here re-renders or re-classifies anything: every candidate operates on
 * the 24-dimension vectors already in the export, so a full pass is seconds.
 * Corpus generation is the expensive step and is done once, elsewhere.
 *
 *   bun run scripts/station-quality/optimise.ts --db <export.sqlite> [--json out.json]
 *
 * Protocol (pre-registered, see metrics.ts):
 *   primary    nDCG@10 on group retrieval
 *   guardrails station diversity, rare-group coverage, must not regress >5% rel
 *   stats      paired bootstrap per candidate, Holm-corrected across all
 *   stop       3 consecutive candidates failing to beat the incumbent
 *   success    >=20% relative gain on test, Holm-corrected p<0.05, guardrails intact
 */

import { existsSync, writeFileSync } from "node:fs";
import process from "node:process";

import { groupOf, ratingSpread, stationQuality, type Track } from "./metrics.js";
import {
  cosineDistance,
  distanceMatrix,
  euclidean,
  holmCorrection,
  loadTracks,
  makeRanker,
  ndcgAtK,
  pairedBootstrap,
  splitByGroup,
} from "./harness.js";
import {
  applyWeights,
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

const dbIndex = process.argv.indexOf("--db");
const DB = dbIndex > 0 ? process.argv[dbIndex + 1]! : "workspace/station-opt/export.sqlite";
const jsonIndex = process.argv.indexOf("--json");
const JSON_OUT = jsonIndex > 0 ? process.argv[jsonIndex + 1]! : "workspace/station-opt/optimisation.json";
const K = 10;

if (!existsSync(DB)) {
  process.stderr.write(`No export at ${DB}. Build a corpus first — see doc/station-quality.md\n`);
  process.exit(1);
}

/**
 * Tuning operates on a subsample, deliberately.
 *
 * Every candidate needs a full pairwise distance matrix, which is O(n^2) in both
 * time and memory: at HVSC's ~87k tracks that is ~60 GB per matrix, and mutual
 * proximity and k-reciprocal need several. It is also unnecessary — the
 * quantities being estimated are per-seed means, whose confidence intervals are
 * governed by the number of seeds, not by corpus size. A grouped subsample of
 * ~20k tracks already gives intervals far tighter than the effects being chased.
 *
 * Note the matrices are built per SLICE, not per corpus: with a 50/25/25 grouped
 * split a 20k subsample means ~10k rows for the train-only weight learning and
 * ~5k rows for each scored candidate, so peak residency is far below what the
 * subsample size alone suggests.
 *
 * The FULL corpus is still classified and exported; only this offline tuning
 * loop subsamples. Serving neighbours for all 87k tracks is a separate,
 * already-solved path (precomputed neighbours in the export).
 *
 * Subsampling keeps whole groups so the label structure — several tunes per
 * composer — survives. Sampling individual tracks would strand most composers
 * with a single tune and destroy the very signal being measured.
 */
const maxIndex = process.argv.indexOf("--max-tracks");
const MAX_TRACKS = maxIndex > 0 ? Number.parseInt(process.argv[maxIndex + 1]!, 10) : 12000;

const loaded = loadTracks(DB);
const all = subsampleByGroup(loaded, MAX_TRACKS);
if (all.length < loaded.length) {
  process.stdout.write(`subsampled ${loaded.length} -> ${all.length} tracks (whole groups; --max-tracks to change)\n`);
}
const split = splitByGroup(all);
process.stdout.write(
  `corpus ${all.length} tracks -> train ${split.train.length} / validation ${split.validation.length} / test ${split.test.length}\n` +
    `(split by composer group, so no composer appears in two slices)\n` +
    `sample composition: ${JSON.stringify(treeComposition(all))}\n` +
    `full corpus:        ${JSON.stringify(treeComposition(loaded))}\n\n`,
);

// ------------------------------------------------------------------ candidates

interface Candidate {
  name: string;
  rationale: string;
  build: (tracks: Track[]) => Float64Array[] | { distances: Float64Array[] };
}

const learned: { weights: number[] | null } = { weights: null };

const CANDIDATES: Candidate[] = [
  { name: "baseline: raw + weighted cosine", rationale: "what ships today", build: (t) => ({ distances: distanceMatrix(weighted(t), cosineDistance) }) },
  { name: "raw + euclidean", rationale: "is cosine helping at all?", build: (t) => ({ distances: distanceMatrix(raw(t), euclidean) }) },
  { name: "z-score + euclidean", rationale: "equalise dimension scales", build: (t) => ({ distances: distanceMatrix(zscore(t), euclidean) }) },
  { name: "rank-gaussian + euclidean", rationale: "remove skew, not just scale", build: (t) => ({ distances: distanceMatrix(rankGaussian(t), euclidean) }) },
  { name: "whitened + euclidean", rationale: "decorrelate redundant features", build: (t) => ({ distances: distanceMatrix(whiten(t), euclidean) }) },
  { name: "rank-gaussian + cosine", rationale: "direction-only after normalisation", build: (t) => ({ distances: distanceMatrix(rankGaussian(t), cosineDistance) }) },
  {
    name: "learned diagonal weights",
    rationale: "let the labels choose feature importance",
    build: (t) => {
      const w = learned.weights ?? new Array(t[0]!.vector.length).fill(1);
      const v = applyWeights(rankGaussian(t), w);
      return { distances: distanceMatrix(v, euclidean) };
    },
  },
  { name: "mutual proximity (hubness)", rationale: "kill hub tracks that appear in every station", build: (t) => ({ distances: mutualProximity(distanceMatrix(rankGaussian(t), euclidean)) }) },
  { name: "k-reciprocal re-ranking", rationale: "require neighbours to agree mutually", build: (t) => ({ distances: kReciprocal(distanceMatrix(rankGaussian(t), euclidean)) }) },
  {
    name: "query expansion",
    rationale: "denoise the query with its own neighbours",
    build: (t) => {
      const v = rankGaussian(t);
      return { distances: distanceMatrix(queryExpansion(v, distanceMatrix(v, euclidean)), euclidean) };
    },
  },
  {
    name: "rank-gaussian + MP + k-reciprocal",
    rationale: "stack the two that address different failure modes",
    build: (t) => ({ distances: kReciprocal(mutualProximity(distanceMatrix(rankGaussian(t), euclidean))) }),
  },
  {
    name: "learned weights + MP",
    rationale: "best representation plus hubness correction",
    build: (t) => {
      const w = learned.weights ?? new Array(t[0]!.vector.length).fill(1);
      const v = applyWeights(rankGaussian(t), w);
      return { distances: mutualProximity(distanceMatrix(v, euclidean)) };
    },
  },
];

// ----------------------------------------------------------------------- run

function evaluate(tracks: Track[], candidate: Candidate) {
  const built = candidate.build(tracks);
  const distances = "distances" in built ? built.distances : distanceMatrix(built, euclidean);
  const ranker = makeRanker(tracks, distances);
  const nd = ndcgAtK(tracks, ranker, K);

  // Station seeds are spread across the slice at a fixed stride rather than taken
  // from the front. Tracks arrive in path order, so the first 200 all come from
  // one corner of one HVSC tree — a diversity guardrail measured there says
  // little about the corpus. A stride is equally deterministic and representative.
  const STATION_SEEDS = 200;
  const stride = Math.max(1, Math.floor(tracks.length / STATION_SEEDS));
  const stations: Array<{ seed: Track; tracks: Track[] }> = [];
  for (let i = 0; i < tracks.length && stations.length < STATION_SEEDS; i += stride) {
    stations.push({ seed: tracks[i]!, tracks: ranker(i, 20).map((j) => tracks[j]!) });
  }
  const groups = new Map<string, number>();
  for (const t of tracks) {
    const g = groupOf(t.sidPath);
    if (g) groups.set(g, (groups.get(g) ?? 0) + 1);
  }
  const total = [...groups.values()].reduce((s, v) => s + v, 0);
  const chance = total > 1 ? [...groups.values()].reduce((s, c) => s + c * (c - 1), 0) / (total * (total - 1)) : 0;
  const sq = stationQuality(stations, chance);

  // Cold start: seeds whose group has at most 3 tracks. If a technique only works
  // for prolific composers it is not usable on a real corpus.
  //
  // Passed as seed INDICES into the full slice, not as a filtered track array.
  // The ranker returns full-slice indices, so handing ndcgAtK a filtered array
  // would have it look those indices up in a shorter label array — scoring each
  // neighbour against an unrelated track's group, and reading mostly `undefined`
  // past the end. That is what this guardrail did before, which made the
  // cold-start figure noise rather than a check.
  const rareSeedIndices: number[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const g = groupOf(tracks[i]!.sidPath);
    if (g && (groups.get(g) ?? 0) <= 3) rareSeedIndices.push(i);
  }
  const rare = rareSeedIndices.length === 0 ? { mean: 0, perSeed: [] } : ndcgAtK(tracks, ranker, K, rareSeedIndices);

  return { ndcg: nd.mean, perSeed: nd.perSeed, station: sq, rareNdcg: rare.mean };
}

process.stdout.write("Learning diagonal weights on TRAIN only...\n");
learned.weights = learnWeights(split.train, rankGaussian, K);
process.stdout.write(`  weights range ${Math.min(...learned.weights).toFixed(2)}..${Math.max(...learned.weights).toFixed(2)}\n\n`);

process.stdout.write(`=== validation (candidate selection) ===\n`);
const results: Array<{ name: string; rationale: string; ndcg: number; perSeed: number[]; station: ReturnType<typeof stationQuality>; rareNdcg: number }> = [];
for (const candidate of CANDIDATES) {
  const r = evaluate(split.validation, candidate);
  results.push({ name: candidate.name, rationale: candidate.rationale, ...r });
  process.stdout.write(
    `  ${candidate.name.padEnd(34)} nDCG@${K} ${r.ndcg.toFixed(4)}  diversity ${r.station.diversity.toFixed(3)}  rare ${r.rareNdcg.toFixed(4)}\n`,
  );
}

const baseline = results[0]!;
const comparisons = results.slice(1).map((r) => {
  const n = Math.min(r.perSeed.length, baseline.perSeed.length);
  const boot = pairedBootstrap(r.perSeed.slice(0, n), baseline.perSeed.slice(0, n));
  return { name: r.name, p: boot.pValue, diff: boot.diff, ci: boot.ci, result: r };
});
const holm = holmCorrection(comparisons.map((c) => ({ name: c.name, p: c.p })));

process.stdout.write(`\n=== significance vs baseline (Holm-corrected across ${comparisons.length} candidates) ===\n`);
for (const h of holm) {
  const c = comparisons.find((x) => x.name === h.name)!;
  const rel = (100 * c.diff) / (baseline.ndcg || 1);
  process.stdout.write(
    `  ${h.name.padEnd(34)} ${rel >= 0 ? "+" : ""}${rel.toFixed(1)}%  p=${h.p.toFixed(4)} adj=${h.adjusted.toFixed(4)} ${h.significant ? "SIGNIFICANT" : ""}\n`,
  );
}

// Guardrails: no more than 5% relative regression, and rare-group must hold.
const eligible = comparisons.filter((c) => {
  const h = holm.find((x) => x.name === c.name)!;
  if (!h.significant || c.diff <= 0) return false;
  const divOk = c.result.station.diversity >= baseline.station.diversity * 0.95;
  const rareOk = c.result.rareNdcg >= baseline.rareNdcg * 0.95;
  return divOk && rareOk;
});
eligible.sort((a, b) => b.result.ndcg - a.result.ndcg);
const winner = eligible[0];

process.stdout.write(`\n=== selection ===\n`);
if (!winner) {
  process.stdout.write(`  No candidate beat the baseline significantly without regressing a guardrail.\n`);
} else {
  process.stdout.write(`  winner: ${winner.name}\n`);
}

// -------- TEST: touched once, only now, only for the winner and the baseline
process.stdout.write(`\n=== test (touched once) ===\n`);
const testBaseline = evaluate(split.test, CANDIDATES[0]!);
const testWinner = winner ? evaluate(split.test, CANDIDATES.find((c) => c.name === winner.name)!) : null;
process.stdout.write(`  baseline nDCG@${K} ${testBaseline.ndcg.toFixed(4)}  diversity ${testBaseline.station.diversity.toFixed(3)}  rare ${testBaseline.rareNdcg.toFixed(4)}\n`);
let verdict = "no improvement found";
if (testWinner) {
  const n = Math.min(testWinner.perSeed.length, testBaseline.perSeed.length);
  const boot = pairedBootstrap(testWinner.perSeed.slice(0, n), testBaseline.perSeed.slice(0, n));
  const rel = (100 * (testWinner.ndcg - testBaseline.ndcg)) / (testBaseline.ndcg || 1);
  process.stdout.write(`  winner   nDCG@${K} ${testWinner.ndcg.toFixed(4)}  diversity ${testWinner.station.diversity.toFixed(3)}  rare ${testWinner.rareNdcg.toFixed(4)}\n`);
  process.stdout.write(`  relative gain ${rel >= 0 ? "+" : ""}${rel.toFixed(1)}%  95% CI [${boot.ci[0].toFixed(4)}, ${boot.ci[1].toFixed(4)}]  p=${boot.pValue.toFixed(4)}\n`);
  const guardOk =
    testWinner.station.diversity >= testBaseline.station.diversity * 0.95 &&
    testWinner.rareNdcg >= testBaseline.rareNdcg * 0.95;
  const met = rel >= 20 && boot.pValue < 0.05 && guardOk;
  verdict = met ? "SUCCESS CRITERION MET" : `not met (needed >=20% with guardrails intact)`;
  process.stdout.write(`  ${verdict}\n`);
}

process.stdout.write(`\nrating spread (category stations): ${JSON.stringify(ratingSpread(all), null, 0)}\n`);

writeFileSync(
  JSON_OUT,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      corpus: { total: all.length, train: split.train.length, validation: split.validation.length, test: split.test.length },
      learnedWeights: learned.weights,
      validation: results.map(({ perSeed: _p, ...rest }) => rest),
      holm,
      winner: winner?.name ?? null,
      test: {
        baseline: { ndcg: testBaseline.ndcg, diversity: testBaseline.station.diversity, rare: testBaseline.rareNdcg },
        winner: testWinner ? { ndcg: testWinner.ndcg, diversity: testWinner.station.diversity, rare: testWinner.rareNdcg } : null,
        verdict,
      },
      ratingSpread: ratingSpread(all),
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`\nwritten: ${JSON_OUT}\n`);
