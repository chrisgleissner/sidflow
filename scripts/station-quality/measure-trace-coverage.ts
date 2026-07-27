#!/usr/bin/env bun
/**
 * Is the improvement uniform across the corpus? No — and this measures by how much.
 *
 * 34 of the 58 similarity dimensions are read from the SID register write trace, and
 * they are where almost all of the measured gain came from. On the full 87,868-track
 * HVSC corpus, **16,398 tracks (18.66%) carry the empty-trace default**: all 22
 * playroutine and driver dimensions are exactly zero and `sidSilentFrameRatio` is 1.
 * Every one of them also has `sidTonalVariant: insufficient`, so all 34 trace-derived
 * dimensions are constant across the group.
 *
 * Those tracks are not silent — median RMS 0.0556 against 0.1021 for the rest, and only
 * 69 are truly silent — so they are real, audible tunes whose analysis window happens to
 * contain no traced register writes.
 *
 * The consequence for a listener is specific: a station seeded from one of those tracks
 * is built almost entirely from the 24 perceptual dimensions, which is close to the old
 * behaviour. Reporting one corpus-wide figure would hide that, so this splits it.
 *
 *   bun run scripts/station-quality/measure-trace-coverage.ts --features <combined.jsonl>
 */

import { existsSync, writeFileSync } from "node:fs";
import process from "node:process";

import { groupOf, type Track } from "./metrics.js";
import { cosineDistance, distanceMatrix, makeRanker, ndcgAtK, pairedBootstrap, splitByGroup } from "./harness.js";
import { applyWeights, rankUniform, subsampleByGroup, weighted } from "./techniques.js";
import { buildModel, loadFeatureRecords, type FeatureRecord } from "./load-features.js";
import { SHIPPED_DIMENSION_NAMES, makeSpec } from "./vector-specs.js";
import {
  SIMILARITY_APPENDED_DIMENSIONS,
  SIMILARITY_DRIVER_SHAPE_DIMENSIONS,
  SIMILARITY_PLAYROUTINE_DIMENSIONS,
} from "../../packages/sidflow-classify/src/similarity-vector.js";
import { weightsForDimensions } from "../../packages/sidflow-common/src/vector-similarity.js";

const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const FEATURES = arg("--features");
const MAX_TRACKS = Number.parseInt(arg("--max-tracks") ?? "24000", 10);
const JSON_OUT = arg("--json") ?? "workspace/station-opt/trace-coverage.json";
const K = 10;

if (!FEATURES || !existsSync(FEATURES)) {
  process.stderr.write("usage: measure-trace-coverage.ts --features <features.jsonl>\n");
  process.exit(1);
}

/**
 * The trace dimensions excluding `sidSilentFrameRatio`, which the empty-trace default
 * sets to 1 rather than 0. Including it would make every empty record look as though it
 * carried one real value.
 */
const TRACE_DIMENSIONS = [...SIMILARITY_PLAYROUTINE_DIMENSIONS, ...SIMILARITY_DRIVER_SHAPE_DIMENSIONS]
  .filter((name) => name !== "sidSilentFrameRatio");

function hasUsableTrace(record: FeatureRecord): boolean {
  return TRACE_DIMENSIONS.some((name) => {
    const value = record.features[name];
    return typeof value === "number" && Number.isFinite(value) && value !== 0;
  });
}

const all = loadFeatureRecords(FEATURES);
const withTrace = all.filter(hasUsableTrace).length;
process.stdout.write(
  `corpus ${all.length}: ${withTrace} with a usable trace (${(100 * withTrace / all.length).toFixed(2)}%),`
  + ` ${all.length - withTrace} on the empty-trace default (${(100 * (all.length - withTrace) / all.length).toFixed(2)}%)\n\n`,
);

// Subsampled by whole composer groups: a full pairwise matrix over 87,868 tracks is
// 7.7 billion pairs, and the split below needs a matrix.
const identity: Track[] = all.map((record) => ({ trackId: record.trackId, sidPath: record.sidPath, vector: [0], e: 3, m: 3, c: 3 }));
const keep = new Set(subsampleByGroup(identity, MAX_TRACKS).map((track) => track.trackId));
const records = all.filter((record) => keep.has(record.trackId));
const model = buildModel(records);

const SHIPPED = makeSpec("shipped", "", SHIPPED_DIMENSION_NAMES, SIMILARITY_APPENDED_DIMENSIONS);
const PERCEPTUAL = makeSpec("perceptual", "", SHIPPED_DIMENSION_NAMES, []);

function tracksFor(spec: typeof SHIPPED): Track[] {
  return records.map((record) => ({
    trackId: record.trackId,
    sidPath: record.sidPath,
    vector: spec.build(model, record.features),
    e: 3,
    m: 3,
    c: 3,
  }));
}

const traceById = new Map(records.map((record) => [record.trackId, hasUsableTrace(record)]));

function evaluate(label: string, tracks: Track[], mode: "shipped" | "perceptual"): void {
  const split = splitByGroup(tracks);
  let vectors: Array<Float64Array | number[]>;
  if (mode === "shipped") {
    const weights = weightsForDimensions(tracks[0]!.vector.length);
    const normalised = rankUniform(split.test);
    vectors = weights ? applyWeights(normalised, [...weights]) : normalised;
  } else {
    vectors = weighted(split.test);
  }
  const ranker = makeRanker(split.test, distanceMatrix(vectors as Float64Array[], cosineDistance));

  const traced: number[] = [];
  const untraced: number[] = [];
  for (let index = 0; index < split.test.length; index += 1) {
    (traceById.get(split.test[index]!.trackId) ? traced : untraced).push(index);
  }

  const overall = ndcgAtK(split.test, ranker, K);
  const a = traced.length > 0 ? ndcgAtK(split.test, ranker, K, traced) : { mean: Number.NaN, perSeed: [] as number[] };
  const b = untraced.length > 0 ? ndcgAtK(split.test, ranker, K, untraced) : { mean: Number.NaN, perSeed: [] as number[] };

  process.stdout.write(
    `  ${label.padEnd(30)} all ${overall.mean.toFixed(4)}`
    + `   trace-present ${a.mean.toFixed(4)} (n=${traced.length})`
    + `   empty-trace ${b.mean.toFixed(4)} (n=${untraced.length})\n`,
  );
  results.push({ label, all: overall.mean, tracePresent: a.mean, emptyTrace: b.mean, tracedSeeds: traced.length, untracedSeeds: untraced.length, tracedPerSeed: a.perSeed, untracedPerSeed: b.perSeed });
}

const results: Array<{
  label: string;
  all: number;
  tracePresent: number;
  emptyTrace: number;
  tracedSeeds: number;
  untracedSeeds: number;
  tracedPerSeed: number[];
  untracedPerSeed: number[];
}> = [];

process.stdout.write(`=== nDCG@${K}, split by whether the seed has a usable register trace ===\n`);
evaluate("24-dim perceptual (previous)", tracksFor(PERCEPTUAL), "perceptual");
evaluate("58-dim shipped", tracksFor(SHIPPED), "shipped");

const previous = results[0]!;
const shipped = results[1]!;

process.stdout.write(`\n=== what the improvement is worth to each group ===\n`);
for (const [name, before, after, beforeSeeds, afterSeeds] of [
  ["seeds WITH a usable trace", previous.tracePresent, shipped.tracePresent, previous.tracedPerSeed, shipped.tracedPerSeed],
  ["seeds on the empty-trace default", previous.emptyTrace, shipped.emptyTrace, previous.untracedPerSeed, shipped.untracedPerSeed],
] as const) {
  const n = Math.min(beforeSeeds.length, afterSeeds.length);
  const boot = n > 1 ? pairedBootstrap(afterSeeds.slice(0, n), beforeSeeds.slice(0, n)) : null;
  const relative = (100 * (after - before)) / (before || 1);
  process.stdout.write(
    `  ${name.padEnd(34)} ${before.toFixed(4)} -> ${after.toFixed(4)}`
    + `  ${relative >= 0 ? "+" : ""}${relative.toFixed(1)}%`
    + (boot ? `  p=${boot.pValue.toFixed(4)}` : "")
    + `\n`,
  );
}

writeFileSync(
  JSON_OUT,
  `${JSON.stringify(
    {
      corpus: FEATURES,
      corpusTracks: all.length,
      tracksWithUsableTrace: withTrace,
      measuredOn: records.length,
      results: results.map(({ tracedPerSeed: _a, untracedPerSeed: _b, ...rest }) => rest),
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`\nwritten: ${JSON_OUT}\n`);
