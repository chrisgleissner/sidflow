/**
 * Measure the structure of an exported neighbour graph.
 *
 * Every structural number quoted in `doc/neighbour-graph-design.md`, in the release notes and
 * in the migration guide comes from this script. It exists because the 0.8.0 and 0.8.2
 * measurements were made with throwaway code that no longer runs, so nothing could be
 * re-derived and nothing could be compared.
 *
 * ## Usage
 *
 * Against a shipped tiny bundle, with the full export supplying the vectors that greedy
 * routing needs:
 *
 *   node scripts/run-bun.mjs run scripts/neighbour-graph/analyse.ts \
 *     --tiny tmp/rebuild-0.8.2/sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr \
 *     --sqlite tmp/rebuild-0.8.2/sidcorr-hvsc-full-sidcorr-1.sqlite \
 *     --manifest tmp/rebuild-0.8.2/sidcorr-hvsc-full-sidcorr-1.manifest.json
 *
 * Against the full export's own retrieval table, at a chosen width:
 *
 *   node scripts/run-bun.mjs run scripts/neighbour-graph/analyse.ts \
 *     --sqlite ...sqlite --manifest ...manifest.json --k 25
 *
 * Flags:
 *   --k N              truncate the full export's neighbour list to N (default: all of it)
 *   --queries N        greedy routing sample size (default 1000)
 *   --vector-cache P   reuse the weighted, normalised vectors across runs
 *   --json P           also write the measurements as JSON
 *   --label TEXT       a name for this graph in the output
 *   --no-routing       skip greedy routing (it is the only slow measurement)
 */

import { writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { decodeTinyNeighbourGraph } from "../../packages/sidflow-common/src/index.js";
import {
  loadFullExportNeighbours,
  loadFullExportTracks,
  loadWeightedVectors,
  readFullExportManifest,
  sampleOrdinals,
  trueNearestNeighbour,
} from "./full-export.js";
import { analyseGraph, formatAnalysis, truncate, type NeighbourGraph } from "./graph-metrics.js";

interface Options {
  tiny?: string;
  sqlite: string;
  manifest: string;
  k?: number;
  queries: number;
  vectorCache?: string;
  json?: string;
  label?: string;
  routing: boolean;
}

function parseOptions(argv: string[]): Options {
  const options: Options = { sqlite: "", manifest: "", queries: 1_000, routing: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const next = argv[index + 1];
    switch (argument) {
      case "--tiny":
        options.tiny = next;
        index += 1;
        break;
      case "--sqlite":
        options.sqlite = next ?? "";
        index += 1;
        break;
      case "--manifest":
        options.manifest = next ?? "";
        index += 1;
        break;
      case "--k":
        options.k = Number.parseInt(next ?? "", 10);
        index += 1;
        break;
      case "--queries":
        options.queries = Number.parseInt(next ?? "", 10);
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
      case "--label":
        options.label = next;
        index += 1;
        break;
      case "--no-routing":
        options.routing = false;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.sqlite || !options.manifest) {
    throw new Error("--sqlite and --manifest are required; they supply the corpus and the metric.");
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const manifest = readFullExportManifest(options.manifest);
  const database = new Database(options.sqlite, { readonly: true, strict: true });
  try {
    const tracks = loadFullExportTracks(database);
    const vectors = loadWeightedVectors(database, tracks, manifest.vector_weights, options.vectorCache);

    let graph: NeighbourGraph;
    let graphFlags: number | undefined;
    let label = options.label;

    if (options.tiny) {
      const decoded = await decodeTinyNeighbourGraph(options.tiny);
      if (decoded.trackCount !== tracks.trackCount) {
        throw new Error(
          `The tiny bundle holds ${decoded.trackCount} tracks and the full export holds `
          + `${tracks.trackCount}; they are different corpora and no shared metric applies.`,
        );
      }
      graph = {
        trackCount: decoded.trackCount,
        neighboursPerTrack: decoded.neighborsPerTrack,
        targets: decoded.targets,
        similarities: decoded.similarities,
        fileOrdinalByTrack: decoded.fileOrdinalByTrack,
      };
      graphFlags = decoded.graphFlags;
      label ??= `${options.tiny} (binary_format_version ${decoded.binaryFormatVersion})`;
    } else {
      const width = options.k ?? manifest.neighbor_count_per_track;
      const neighbours = loadFullExportNeighbours(database, tracks, manifest.neighbor_count_per_track);
      graph = truncate(
        {
          trackCount: tracks.trackCount,
          neighboursPerTrack: manifest.neighbor_count_per_track,
          targets: neighbours.targets,
          similarities: neighbours.similarities,
          fileOrdinalByTrack: tracks.fileOrdinalByTrack,
        },
        width,
      );
      label ??= `sidcorr-1 neighbours, k=${width}`;
    }

    let queries: Int32Array | undefined;
    let trueNearest: Int32Array | undefined;
    if (options.routing && options.queries > 0) {
      queries = sampleOrdinals(tracks.trackCount, options.queries, 20_260_730);
      trueNearest = new Int32Array(queries.length);
      for (let index = 0; index < queries.length; index += 1) {
        trueNearest[index] = trueNearestNeighbour(vectors, queries[index]!, tracks.trackCount);
      }
    }

    const analysis = analyseGraph(label ?? "graph", graph, { vectors, queries, trueNearest, graphFlags });
    process.stdout.write(`${formatAnalysis(analysis)}\n`);
    if (options.json) {
      writeFileSync(options.json, `${JSON.stringify(analysis, null, 2)}\n`);
      process.stdout.write(`\nwrote ${options.json}\n`);
    }
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
