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
 * ~12k tracks already gives intervals far tighter than the effects being chased.
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

function subsampleByGroup(tracks: Track[], limit: number): Track[] {
  if (tracks.length <= limit) return tracks;
  const groups = new Map<string, Track[]>();
  for (const t of tracks) {
    const g = groupOf(t.sidPath) ?? `__ungrouped__/${t.sidPath}`;
    groups.set(g, [...(groups.get(g) ?? []), t]);
  }
  // Deterministic order: by group name, so the same corpus yields the same sample.
  const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const out: Track[] = [];
  for (const [, members] of ordered) {
    if (out.length + members.length > limit) continue;
    out.push(...members);
  }
  return out;
}

const loaded = loadTracks(DB);
const all = subsampleByGroup(loaded, MAX_TRACKS);
if (all.length < loaded.length) {
  process.stdout.write(`subsampled ${loaded.length} -> ${all.length} tracks (whole groups; --max-tracks to change)\n`);
}
const split = splitByGroup(all);
process.stdout.write(
  `corpus ${all.length} tracks -> train ${split.train.length} / validation ${split.validation.length} / test ${split.test.length}\n` +
    `(split by composer group, so no composer appears in two slices)\n\n`,
);

const WEIGHTS = [
  1.1, 1.1, 1.2, 1.0, 1.0, 0.9, 0.9, 0.9, 1.0, 0.9, 0.8, 1.1,
  1.2, 1.2, 1.1, 0.8, 0.8, 0.9, 0.9, 1.0, 0.9, 0.9, 0.7, 0.7,
];

// ------------------------------------------------------------ representations

const raw = (tracks: Track[]): Float64Array[] => tracks.map((t) => Float64Array.from(t.vector));

function weighted(tracks: Track[]): Float64Array[] {
  return tracks.map((t) => Float64Array.from(t.vector.map((v, i) => v * Math.sqrt(WEIGHTS[i] ?? 1))));
}

function columnStats(tracks: Track[]) {
  const d = tracks[0]!.vector.length;
  const mu = new Float64Array(d);
  const sd = new Float64Array(d);
  for (let i = 0; i < d; i++) {
    const col = tracks.map((t) => t.vector[i]!);
    mu[i] = col.reduce((s, v) => s + v, 0) / col.length;
    sd[i] = Math.sqrt(col.reduce((s, v) => s + (v - mu[i]!) ** 2, 0) / col.length) || 1;
  }
  return { mu, sd };
}

function zscore(tracks: Track[]): Float64Array[] {
  const { mu, sd } = columnStats(tracks);
  return tracks.map((t) => Float64Array.from(t.vector.map((v, i) => (v - mu[i]!) / sd[i]!)));
}

/**
 * Rank-Gaussian: map each dimension to its within-corpus rank, then to a normal
 * quantile. Removes skew and makes dimensions genuinely comparable, which
 * plain z-scoring does not do for heavy-tailed features.
 */
function rankGaussian(tracks: Track[]): Float64Array[] {
  const n = tracks.length;
  const d = tracks[0]!.vector.length;
  const out = tracks.map(() => new Float64Array(d));
  // Acklam's inverse-normal approximation; accurate to ~1e-9, ample here.
  const probit = (p: number): number => {
    const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
    const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
    const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
    const dd = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
    const pl = 0.02425;
    if (p < pl) {
      const q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((dd[0]! * q + dd[1]!) * q + dd[2]!) * q + dd[3]!) * q + 1);
    }
    if (p > 1 - pl) return -probit(1 - p);
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  };
  for (let i = 0; i < d; i++) {
    const order = tracks.map((t, j) => ({ v: t.vector[i]!, j })).sort((x, y) => x.v - y.v);
    for (let rank = 0; rank < n; rank++) {
      out[order[rank]!.j]![i] = probit((rank + 0.5) / n);
    }
  }
  return out;
}

/**
 * PCA whitening. Decorrelates the dimensions and equalises their variance, so no
 * group of correlated features silently dominates the distance.
 */
function whiten(tracks: Track[]): Float64Array[] {
  const z = zscore(tracks);
  const n = z.length;
  const d = z[0]!.length;
  const cov: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  for (const v of z) {
    for (let i = 0; i < d; i++) for (let j = i; j < d; j++) cov[i]![j]! += (v[i]! * v[j]!) / n;
  }
  for (let i = 0; i < d; i++) for (let j = 0; j < i; j++) cov[i]![j] = cov[j]![i]!;

  // Power iteration with deflation; d is 24, so this is cheap and adequate.
  const comps: Float64Array[] = [];
  const vals: number[] = [];
  let work = cov.map((r) => [...r]);
  for (let k = 0; k < d; k++) {
    let v = new Float64Array(d).fill(1 / Math.sqrt(d));
    let lambda = 0;
    for (let it = 0; it < 200; it++) {
      const w = new Float64Array(d);
      for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) w[i]! += work[i]![j]! * v[j]!;
      const norm = Math.hypot(...w);
      if (norm < 1e-12) break;
      for (let i = 0; i < d; i++) w[i]! /= norm;
      v = w;
      lambda = norm;
    }
    if (lambda < 1e-9) break;
    comps.push(v);
    vals.push(lambda);
    work = work.map((row, i) => row.map((c, j) => c - lambda * v[i]! * v[j]!));
  }

  return z.map((vec) => {
    const out = new Float64Array(comps.length);
    for (let k = 0; k < comps.length; k++) {
      let dot = 0;
      for (let i = 0; i < d; i++) dot += vec[i]! * comps[k]![i]!;
      out[k] = dot / Math.sqrt(vals[k]! + 1e-6);
    }
    return out;
  });
}

// --------------------------------------------------------------- re-rankings

/**
 * Mutual proximity: the standard fix for HUBNESS, where a few tracks become
 * everyone's nearest neighbour purely as an artefact of high-dimensional space.
 * Hubness is well documented in music similarity and quietly wrecks stations —
 * the same handful of tunes surface everywhere. MP re-expresses each distance as
 * the probability that the two points are mutually close, given the distance
 * distributions of both.
 */
function mutualProximity(distances: Float64Array[]): Float64Array[] {
  const n = distances.length;
  const mu = new Float64Array(n);
  const sd = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = 0; j < n; j++) if (i !== j) { sum += distances[i]![j]!; count++; }
    mu[i] = sum / count;
    let variance = 0;
    for (let j = 0; j < n; j++) if (i !== j) variance += (distances[i]![j]! - mu[i]!) ** 2;
    sd[i] = Math.sqrt(variance / count) || 1e-9;
  }
  // Gaussian CDF via erf approximation (Abramowitz & Stegun 7.1.26).
  const erf = (x: number): number => {
    const s = Math.sign(x);
    const a = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * a);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return s * y;
  };
  const sf = (d: number, m: number, s: number) => 0.5 * (1 - erf((d - m) / (s * Math.SQRT2)));

  const out: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = sf(distances[i]![j]!, mu[i]!, sd[i]!) * sf(distances[i]![j]!, mu[j]!, sd[j]!);
      const d = 1 - p;
      out[i]![j] = d;
      out[j]![i] = d;
    }
  }
  return out;
}

/**
 * k-reciprocal re-ranking (Zhong et al., CVPR 2017), simplified.
 * Two tracks are more likely genuinely similar if each appears in the other's
 * neighbourhood. Blends the original distance with a Jaccard distance over
 * reciprocal neighbour sets.
 */
function kReciprocal(distances: Float64Array[], k = 20, lambda = 0.3): Float64Array[] {
  const n = distances.length;
  const knn: number[][] = [];
  for (let i = 0; i < n; i++) {
    const order = Array.from({ length: n }, (_, j) => j)
      .filter((j) => j !== i)
      .sort((a, b) => distances[i]![a]! - distances[i]![b]!)
      .slice(0, k);
    knn.push(order);
  }
  const sets = knn.map((list) => new Set(list));
  const reciprocal = knn.map((list, i) => list.filter((j) => sets[j]!.has(i)));
  const rsets = reciprocal.map((list) => new Set([...list]));

  const out: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = rsets[i]!;
      const b = rsets[j]!;
      let inter = 0;
      for (const v of a) if (b.has(v)) inter++;
      const union = a.size + b.size - inter;
      const jaccard = union === 0 ? 1 : 1 - inter / union;
      const blended = lambda * distances[i]![j]! + (1 - lambda) * jaccard;
      out[i]![j] = blended;
      out[j]![i] = blended;
    }
  }
  return out;
}

/** alpha-query expansion: pull the query toward its confident neighbours. */
function queryExpansion(vectors: Float64Array[], distances: Float64Array[], k = 3, alpha = 1.5): Float64Array[] {
  const n = vectors.length;
  const d = vectors[0]!.length;
  return vectors.map((v, i) => {
    const order = Array.from({ length: n }, (_, j) => j)
      .filter((j) => j !== i)
      .sort((a, b) => distances[i]![a]! - distances[i]![b]!)
      .slice(0, k);
    const out = new Float64Array(d);
    for (let x = 0; x < d; x++) out[x] = v[x]!;
    let weightSum = 1;
    for (const j of order) {
      const w = Math.pow(1 / (1 + distances[i]![j]!), alpha);
      for (let x = 0; x < d; x++) out[x]! += w * vectors[j]![x]!;
      weightSum += w;
    }
    for (let x = 0; x < d; x++) out[x]! /= weightSum;
    return out;
  });
}

// ------------------------------------------------------------ learned weights

/**
 * Coordinate ascent on per-dimension weights, maximising train nDCG@10.
 *
 * Deliberately a diagonal metric rather than a full projection: with a few
 * thousand tracks a full matrix would overfit badly, and a diagonal weighting is
 * both regularised by construction and interpretable — you can read off which
 * features matter.
 */
function learnWeights(tracks: Track[], base: (t: Track[]) => Float64Array[]): number[] {
  const vectors = base(tracks);
  const d = vectors[0]!.length;
  let weights = new Array(d).fill(1);

  const score = (w: number[]): number => {
    const scaled = vectors.map((v) => Float64Array.from(v.map((x, i) => x * Math.sqrt(Math.max(0, w[i]!)))));
    const dist = distanceMatrix(scaled, euclidean);
    return ndcgAtK(tracks, makeRanker(tracks, dist), K).mean;
  };

  let best = score(weights);
  for (const step of [0.5, 0.25]) {
    for (let i = 0; i < d; i++) {
      for (const delta of [1 + step, 1 - step]) {
        const trial = [...weights];
        trial[i] = Math.max(0, trial[i]! * delta);
        const s = score(trial);
        if (s > best + 1e-6) {
          best = s;
          weights = trial;
        }
      }
    }
  }
  return weights;
}

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
      const v = rankGaussian(t).map((vec) => Float64Array.from(vec.map((x, i) => x * Math.sqrt(Math.max(0, w[i]!)))));
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
      const v = rankGaussian(t).map((vec) => Float64Array.from(vec.map((x, i) => x * Math.sqrt(Math.max(0, w[i]!)))));
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

  const stations = tracks.slice(0, Math.min(200, tracks.length)).map((seed, i) => ({
    seed,
    tracks: ranker(tracks.indexOf(seed), 20).map((j) => tracks[j]!),
  }));
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
  const rareSeeds = tracks.filter((t) => {
    const g = groupOf(t.sidPath);
    return g ? (groups.get(g) ?? 0) <= 3 : false;
  });
  const rare = rareSeeds.length === 0 ? { mean: 0, perSeed: [] } : ndcgAtK(rareSeeds, (i, k) => ranker(tracks.indexOf(rareSeeds[i]!), k), K);

  return { ndcg: nd.mean, perSeed: nd.perSeed, station: sq, rareNdcg: rare.mean };
}

process.stdout.write("Learning diagonal weights on TRAIN only...\n");
learned.weights = learnWeights(split.train, rankGaussian);
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
