/**
 * Would a hubness correction improve `sidcorr-1`'s own 25-neighbour retrieval table?
 *
 * The full export's `neighbors` table is a **retrieval** answer: `u64deck` uses it for
 * "♪ More like this", a single-hop query where "the 25 most similar" is exactly right. Changing it
 * costs every consumer a re-download of a 982 MB artefact, so the change has to earn that. This
 * script is the evidence for the decision, recorded in `CHANGES.md` and
 * `doc/neighbour-graph-design.md`.
 *
 * ## What it can and cannot answer
 *
 * It re-ranks each seed's **published 25 candidates** by mutual-proximity distance and by local
 * scaling, and reports what that does to composer lift, nDCG@10 and rank agreement.
 *
 * Re-ranking changes the order within a row, never the membership. That bounds the experiment in a
 * way worth being explicit about:
 *
 * - The headline hubness figures — in-degree max 217, and 456 tracks with no incoming edge — are
 *   properties of which tracks appear in *someone's* 25. Re-ranking cannot move them at all, so
 *   this script reports them unchanged and they are not evidence either way.
 * - Changing membership would need exact 25-nearest-neighbour search under the corrected distance
 *   over 87,868 points, and would change what ranks 5 through 25 mean. That meaning is part of the
 *   table's contract, so it is a bigger decision than a re-rank and needs a bigger justification.
 *
 * What the script therefore answers is narrower and still decisive: **if the correction cannot
 * improve retrieval quality even when it is free to reorder the whole row, the case for rebuilding
 * the authoritative artefact is weak.**
 *
 * ## Usage
 *
 *   node scripts/run-bun.mjs run scripts/neighbour-graph/full-export-hubness.ts \
 *     --sqlite <full>.sqlite --manifest <full>.manifest.json --seeds 8000
 */

import { writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import {
  buildLocalScalingDistance,
  buildMutualProximityModel,
} from "../../packages/sidflow-common/src/index.js";
import { groupRetrieval, type Track } from "../station-quality/metrics.js";
import { ndcgAtK } from "../station-quality/harness.js";
import {
  loadFullExportNeighbours,
  loadFullExportTracks,
  loadWeightedVectors,
  readFullExportManifest,
  sampleOrdinals,
  similarityBetween as dotSimilarity,
} from "./full-export.js";

interface Options {
  sqlite: string;
  manifest: string;
  seeds: number;
  vectorCache?: string;
  json?: string;
}

function parseOptions(argv: string[]): Options {
  const options: Options = { sqlite: "", manifest: "", seeds: 8_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const next = argv[index + 1];
    switch (argument) {
      case "--sqlite":
        options.sqlite = next ?? "";
        index += 1;
        break;
      case "--manifest":
        options.manifest = next ?? "";
        index += 1;
        break;
      case "--seeds":
        options.seeds = Number.parseInt(next ?? "", 10);
        index += 1;
        break;
      case "--vector-cache":
        options.vectorCache = next;
        index += 1;
        break;
      case "--json":
        options.json = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.sqlite || !options.manifest) {
    throw new Error("--sqlite and --manifest are required");
  }
  return options;
}

/** Spearman rank correlation between two orderings of the same items. */
function spearman(left: readonly number[], right: readonly number[]): number {
  const size = left.length;
  if (size < 2) {
    return 1;
  }
  const rankOf = (order: readonly number[]): Map<number, number> => {
    const ranks = new Map<number, number>();
    order.forEach((item, index) => ranks.set(item, index));
    return ranks;
  };
  const leftRanks = rankOf(left);
  const rightRanks = rankOf(right);
  let sumSquares = 0;
  for (const item of left) {
    const a = leftRanks.get(item)!;
    const b = rightRanks.get(item);
    if (b === undefined) {
      return 0;
    }
    sumSquares += (a - b) * (a - b);
  }
  return 1 - ((6 * sumSquares) / (size * ((size * size) - 1)));
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const manifest = readFullExportManifest(options.manifest);
  const database = new Database(options.sqlite, { readonly: true, strict: true });
  const report: Record<string, unknown> = {};
  try {
    const exported = loadFullExportTracks(database);
    const vectors = loadWeightedVectors(database, exported, manifest.vector_weights, options.vectorCache);
    const width = manifest.neighbor_count_per_track;
    const published = loadFullExportNeighbours(database, exported, width);
    const similarityBetween = (left: number, right: number): number => dotSimilarity(vectors, left, right);

    const tracks: Track[] = exported.trackIds.map((trackId, ordinal) => ({
      trackId,
      sidPath: exported.sidPaths[ordinal]!,
      vector: [],
      e: 0,
      m: 0,
      c: 0,
    }));

    // In-degree over the whole table, which re-ranking cannot change. Reported so the record shows
    // it was measured rather than assumed away.
    const inDegree = new Int32Array(exported.trackCount);
    for (const target of published.targets) {
      if (target >= 0) {
        inDegree[target]! += 1;
      }
    }
    const sortedInDegree = Int32Array.from(inDegree).sort();
    const zeroInDegree = [...inDegree].filter((degree) => degree === 0).length;
    report.membership = {
      note: "Re-ranking cannot change these; only changing which tracks appear in a row can.",
      inDegreeMean: published.targets.filter((target) => target >= 0).length / exported.trackCount,
      inDegreeMedian: sortedInDegree[Math.floor(exported.trackCount / 2)],
      inDegreeMax: sortedInDegree[exported.trackCount - 1],
      zeroInDegree,
      zeroInDegreeFraction: zeroInDegree / exported.trackCount,
    };
    process.stdout.write(
      `=== membership (unchanged by any re-ranking) ===\n`
      + `in-degree mean ${(report.membership as { inDegreeMean: number }).inDegreeMean.toFixed(2)},`
      + ` median ${sortedInDegree[Math.floor(exported.trackCount / 2)]},`
      + ` max ${sortedInDegree[exported.trackCount - 1]}\n`
      + `tracks with no incoming edge ${zeroInDegree}`
      + ` (${((zeroInDegree / exported.trackCount) * 100).toFixed(2)}%)\n\n`,
    );

    const seedOrdinals = sampleOrdinals(exported.trackCount, options.seeds, 20_260_730);

    const mutualProximity = buildMutualProximityModel({
      trackCount: exported.trackCount,
      similarityBetween,
    });
    const candidatesForScaling = Array.from({ length: exported.trackCount }, (_unused, seed) => {
      const list: Array<{ trackOrdinal: number; similarity: number }> = [];
      for (let slot = 0; slot < width; slot += 1) {
        const index = (seed * width) + slot;
        const target = published.targets[index]!;
        if (target >= 0) {
          list.push({ trackOrdinal: target, similarity: published.similarities[index]! });
        }
      }
      return list;
    });
    const localScaling = buildLocalScalingDistance({
      trackCount: exported.trackCount,
      candidates: candidatesForScaling,
      similarityBetween,
    });

    const orderings: Array<{
      label: string;
      order: (seed: number) => number[];
    }> = [
      {
        label: "published (raw weighted cosine)",
        order: (seed) => candidatesForScaling[seed]!.map((candidate) => candidate.trackOrdinal),
      },
      {
        label: "re-ranked by mutual proximity",
        order: (seed) => [...candidatesForScaling[seed]!]
          .sort((left, right) =>
            mutualProximity.distance(seed, left.trackOrdinal, left.similarity)
            - mutualProximity.distance(seed, right.trackOrdinal, right.similarity)
            || left.trackOrdinal - right.trackOrdinal)
          .map((candidate) => candidate.trackOrdinal),
      },
      {
        label: "re-ranked by local scaling",
        order: (seed) => [...candidatesForScaling[seed]!]
          .sort((left, right) =>
            localScaling.distance(seed, left.trackOrdinal, left.similarity)
            - localScaling.distance(seed, right.trackOrdinal, right.similarity)
            || left.trackOrdinal - right.trackOrdinal)
          .map((candidate) => candidate.trackOrdinal),
      },
    ];

    const results: Array<Record<string, number | string>> = [];
    const baselineOrder = new Map<number, number[]>();
    for (const seed of seedOrdinals) {
      baselineOrder.set(seed, orderings[0]!.order(seed));
    }

    for (const { label, order } of orderings) {
      const cache = new Map<number, number[]>();
      const ordered = (seed: number): number[] => {
        const cached = cache.get(seed);
        if (cached) {
          return cached;
        }
        const value = order(seed);
        cache.set(seed, value);
        return value;
      };
      const ordinalOfTrack = new Map(tracks.map((track, ordinal) => [track.trackId, ordinal]));
      const lift = groupRetrieval(
        [...seedOrdinals].map((ordinal) => tracks[ordinal]!),
        (seed) => ordered(ordinalOfTrack.get(seed.trackId)!).slice(0, 10).map((target) => tracks[target]!),
        10,
      );
      const ndcg = ndcgAtK(tracks, (seed, k) => ordered(seed).slice(0, k), 10, [...seedOrdinals]);

      let changedRows = 0;
      let rankAgreement = 0;
      let top1Changed = 0;
      for (const seed of seedOrdinals) {
        const base = baselineOrder.get(seed)!;
        const now = ordered(seed);
        if (base.length !== now.length || base.some((value, index) => value !== now[index])) {
          changedRows += 1;
        }
        if (base[0] !== now[0]) {
          top1Changed += 1;
        }
        rankAgreement += spearman(base, now);
      }

      const entry = {
        label,
        composerLift: Number(lift.lift.toFixed(4)),
        composerPrecisionAt10: Number((lift.precisionAtK * 100).toFixed(2)),
        ndcgAt10: Number(ndcg.mean.toFixed(4)),
        rowsReordered: changedRows,
        rowsWhereRank1Changed: top1Changed,
        meanSpearmanVsPublished: Number((rankAgreement / seedOrdinals.length).toFixed(4)),
      };
      results.push(entry);
      const baseline = results[0]!;
      process.stdout.write(
        `=== ${label} ===\n`
        + `composer lift ${entry.composerLift} (precision@10 ${entry.composerPrecisionAt10}%)`
        + (label === results[0]!.label
          ? "\n"
          : `  ${(((entry.composerLift as number) / (baseline.composerLift as number) - 1) * 100).toFixed(2)}%\n`)
        + `nDCG@10 ${entry.ndcgAt10}`
        + (label === results[0]!.label
          ? "\n"
          : `  ${(((entry.ndcgAt10 as number) / (baseline.ndcgAt10 as number) - 1) * 100).toFixed(2)}%\n`)
        + `rows reordered ${entry.rowsReordered} of ${seedOrdinals.length},`
        + ` rank 1 changed in ${entry.rowsWhereRank1Changed},`
        + ` mean Spearman vs published ${entry.meanSpearmanVsPublished}\n\n`,
      );
    }
    report.orderings = results;
  } finally {
    database.close();
  }

  if (options.json) {
    writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`wrote ${options.json}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
