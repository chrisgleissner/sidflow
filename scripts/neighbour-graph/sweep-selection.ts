/**
 * Sweep the neighbour-selection parameters and report the curve.
 *
 * The pruning rule has one parameter, `alpha`, and the hubness correction is a choice between
 * three options. Rather than pick values and assert they are good, this builds the graph each
 * configuration would produce — directly from the published full export, without writing a
 * bundle or touching HVSC — and measures all of them the same way.
 *
 * It reports, per configuration: slot occupancy, in-degree distribution, zero-in and zero-out
 * counts, undirected connectivity, reciprocity, greedy routing recall, same-file rate, and the
 * number of distinct tracks a station serves.
 *
 * ## Usage
 *
 *   node scripts/run-bun.mjs run scripts/neighbour-graph/sweep-selection.ts \
 *     --sqlite tmp/rebuild-0.8.2/sidcorr-hvsc-full-sidcorr-1.sqlite \
 *     --manifest tmp/rebuild-0.8.2/sidcorr-hvsc-full-sidcorr-1.manifest.json \
 *     --alphas 1.0,1.05,1.1,1.2 --corrections none,mutual-proximity,local-scaling \
 *     --json tmp/sweep.json
 *
 * Flags:
 *   --alphas LIST        comma-separated alpha values (default 1.0,1.05,1.1,1.2,1.4)
 *   --corrections LIST   none | mutual-proximity | local-scaling (default all three)
 *   --no-reverse         also report the configuration without reverse insertion
 *   --stations N         station sample per configuration (default 150, 0 to skip)
 *   --queries N          greedy routing sample (default 1000)
 *   --vector-cache PATH  reuse the weighted, normalised vectors
 */

import { writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import {
  buildLocalScalingDistance,
  buildMutualProximityModel,
  buildNavigableNeighbourGraph,
  selectDiversifiedNeighbours,
  type NeighbourCandidate,
  type SelectionDistance,
} from "../../packages/sidflow-common/src/index.js";
import {
  createRandom,
  loadFullExportNeighbours,
  loadFullExportTracks,
  loadWeightedVectors,
  readFullExportManifest,
  sampleOrdinals,
  similarityBetween as dotSimilarity,
  trueNearestNeighbour,
  type FullExportTracks,
  type WeightedVectors,
} from "./full-export.js";
import {
  analyseGraph,
  formatAnalysis,
  type GraphAnalysis,
  type NeighbourGraph,
} from "./graph-metrics.js";
import { buildStationBundle, type StationSeed } from "./station-engine-port.js";
import { runStation, summarise, type StationSummary } from "./station-metrics.js";
import { groupRetrieval, type Track } from "../station-quality/metrics.js";
import { ndcgAtK } from "../station-quality/harness.js";

type Correction = "none" | "mutual-proximity" | "local-scaling";
/**
 * `prune` selects three of the source export's 25 nearest neighbours. `navigable` runs the
 * Vamana construction, whose candidate pool comes from a search over the graph being built and
 * therefore contains long edges the top-25 pool does not.
 */
type Builder = "prune" | "navigable";

interface Options {
  sqlite: string;
  manifest: string;
  alphas: number[];
  corrections: Correction[];
  builders: Builder[];
  searchListSizes: number[];
  inDegreeCaps: number[];
  driftStations: number;
  entryPointCounts: number[];
  forcedNearestCounts: number[];
  qualitySeeds: number;
  includeNoReverse: boolean;
  stations: number;
  queries: number;
  vectorCache?: string;
  json?: string;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    sqlite: "",
    manifest: "",
    alphas: [1, 1.05, 1.1, 1.2, 1.4],
    corrections: ["none", "mutual-proximity", "local-scaling"],
    builders: ["prune"],
    searchListSizes: [96],
    inDegreeCaps: [8],
    driftStations: 0,
    entryPointCounts: [1],
    forcedNearestCounts: [0],
    qualitySeeds: 0,
    includeNoReverse: false,
    stations: 150,
    queries: 1_000,
  };
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
      case "--alphas":
        options.alphas = (next ?? "").split(",").filter(Boolean).map(Number);
        index += 1;
        break;
      case "--corrections":
        options.corrections = (next ?? "").split(",").filter(Boolean) as Correction[];
        index += 1;
        break;
      case "--builders":
        options.builders = (next ?? "").split(",").filter(Boolean) as Builder[];
        index += 1;
        break;
      case "--forced-nearest":
        options.forcedNearestCounts = (next ?? "").split(",").filter(Boolean).map(Number);
        index += 1;
        break;
      case "--quality-seeds":
        options.qualitySeeds = Number.parseInt(next ?? "", 10);
        index += 1;
        break;
      case "--entry-points":
        options.entryPointCounts = (next ?? "").split(",").filter(Boolean).map(Number);
        index += 1;
        break;
      case "--drift-stations":
        options.driftStations = Number.parseInt(next ?? "", 10);
        index += 1;
        break;
      case "--in-degree-caps":
        options.inDegreeCaps = (next ?? "").split(",").filter(Boolean).map(Number);
        index += 1;
        break;
      case "--search-lists":
        options.searchListSizes = (next ?? "").split(",").filter(Boolean).map(Number);
        index += 1;
        break;
      case "--no-reverse":
        options.includeNoReverse = true;
        break;
      case "--stations":
        options.stations = Number.parseInt(next ?? "", 10);
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
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.sqlite || !options.manifest) {
    throw new Error("--sqlite and --manifest are required");
  }
  return options;
}

interface SweepRow {
  builder: Builder;
  alpha: number;
  correction: Correction;
  searchListSize?: number;
  reverseInsertion: boolean;
  analysis: GraphAnalysis;
  stations?: StationSummary;
  driftStations?: StationSummary;
  forcedNearestSlots?: number;
  composerLift?: number;
  ndcgAt10?: number;
  selectionStats?: ReturnType<typeof selectDiversifiedNeighbours>["stats"];
  buildStats?: ReturnType<typeof buildNavigableNeighbourGraph>["stats"];
}

/**
 * Station length under a given policy.
 *
 * Both policies are measured because they answer different questions. `fixed` reproduces the
 * client as it ships and says what the artefact alone delivers. `drift` reproduces the policy Part E
 * adds and says whether a structural property of the graph still matters once the retrieval centre
 * moves — which is the only basis on which a graph-side trade-off can be decided, since the client
 * change is landing in the same release.
 */
function stationSummaryFor(
  graph: NeighbourGraph,
  sample: number,
  label: string,
  policy: "fixed" | "drift" = "fixed",
  cap = 60_000,
): StationSummary {
  const bundle = buildStationBundle({
    trackCount: graph.trackCount,
    neighborsPerTrack: graph.neighboursPerTrack,
    targets: graph.targets,
    fileOrdinalByTrack: graph.fileOrdinalByTrack,
    styleMaskByTrack: new Uint16Array(graph.trackCount),
  });
  const random = createRandom(20_260_730);
  const runs = [];
  for (let index = 0; index < sample; index += 1) {
    const shuffleSeed = Math.floor(random() * 0x7f_ff_ff_ff);
    const seed: StationSeed = {
      kind: "song",
      fileOrdinal: Math.floor(random() * bundle.fileTrackCount.length),
    };
    runs.push(runStation(bundle, seed, shuffleSeed, {
      policy,
      recent: 5,
      recentWeight: 1,
      recentDecay: 0.6,
      originWeight: 0.3,
      dedupeTune: false,
      cap,
    }));
  }
  return summarise(`${label} [${policy}]`, runs);
}

/**
 * Composer lift and nDCG@10 over a candidate graph's own edges.
 *
 * This is the release guardrail, and once the construction started spending a slot on reach it
 * became the metric that decides the parameter rather than a check applied at the end. Reusing the
 * station-quality harness matters: it excludes same-file siblings from both the ranking and the
 * ideal, and 14.42% of rank-1 neighbours are siblings, so a metric that did not would mostly measure
 * subsong density.
 */
function qualityOf(
  graph: NeighbourGraph,
  tracks: Track[],
  seedOrdinals: Int32Array,
): { composerLift: number; ndcgAt10: number } {
  const rankOrdinals = (seed: number, limit: number): number[] => {
    const out: number[] = [];
    for (let slot = 0; slot < graph.neighboursPerTrack && out.length < limit; slot += 1) {
      const target = graph.targets[(seed * graph.neighboursPerTrack) + slot]!;
      if (target >= 0) {
        out.push(target);
      }
    }
    return out;
  };
  const ordinalOfTrack = new Map(tracks.map((track, ordinal) => [track.trackId, ordinal]));
  const lift = groupRetrieval(
    [...seedOrdinals].map((ordinal) => tracks[ordinal]!),
    (seed) => rankOrdinals(ordinalOfTrack.get(seed.trackId)!, 3).map((target) => tracks[target]!),
    3,
  );
  const ndcg = ndcgAtK(tracks, rankOrdinals, 10, [...seedOrdinals]);
  return { composerLift: lift.lift, ndcgAt10: ndcg.mean };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const manifest = readFullExportManifest(options.manifest);
  const database = new Database(options.sqlite, { readonly: true, strict: true });

  let tracks: FullExportTracks;
  let vectors: WeightedVectors;
  let candidates: NeighbourCandidate[][];
  try {
    tracks = loadFullExportTracks(database);
    vectors = loadWeightedVectors(database, tracks, manifest.vector_weights, options.vectorCache);
    const neighbours = loadFullExportNeighbours(database, tracks, manifest.neighbor_count_per_track);
    candidates = Array.from({ length: tracks.trackCount }, () => [] as NeighbourCandidate[]);
    for (let seed = 0; seed < tracks.trackCount; seed += 1) {
      for (let slot = 0; slot < neighbours.neighboursPerTrack; slot += 1) {
        const index = (seed * neighbours.neighboursPerTrack) + slot;
        const target = neighbours.targets[index]!;
        if (target < 0) {
          continue;
        }
        candidates[seed]!.push({ trackOrdinal: target, similarity: neighbours.similarities[index]! });
      }
    }
  } finally {
    database.close();
  }

  const trackCount = tracks.trackCount;
  const similarityBetween = (left: number, right: number): number => dotSimilarity(vectors, left, right);

  process.stdout.write(`corpus ${trackCount} tracks, ${manifest.neighbor_count_per_track} candidates each\n`);

  const qualityTracks: Track[] = tracks.trackIds.map((trackId, ordinal) => ({
    trackId,
    sidPath: tracks.sidPaths[ordinal]!,
    vector: [],
    e: 0,
    m: 0,
    c: 0,
  }));
  const qualitySeeds = options.qualitySeeds > 0
    ? sampleOrdinals(trackCount, options.qualitySeeds, 20_260_730)
    : undefined;

  const queries = options.queries > 0 ? sampleOrdinals(trackCount, options.queries, 20_260_730) : undefined;
  let trueNearest: Int32Array | undefined;
  if (queries) {
    trueNearest = new Int32Array(queries.length);
    for (let index = 0; index < queries.length; index += 1) {
      trueNearest[index] = trueNearestNeighbour(vectors, queries[index]!, trackCount);
    }
    process.stdout.write(`resolved true nearest neighbours for ${queries.length} routing queries\n`);
  }

  const distanceCache = new Map<Correction, SelectionDistance>();
  const distanceFor = (correction: Correction): SelectionDistance => {
    const cached = distanceCache.get(correction);
    if (cached) {
      return cached;
    }
    let built: SelectionDistance;
    if (correction === "none") {
      built = (left, right, similarity) => 1 - (similarity ?? similarityBetween(left, right));
    } else if (correction === "mutual-proximity") {
      const started = Date.now();
      const model = buildMutualProximityModel({ trackCount, similarityBetween });
      process.stdout.write(
        `fitted mutual proximity in ${((Date.now() - started) / 1000).toFixed(1)}s`
        + ` (mean distance ${(model.mean.reduce((a, b) => a + b, 0) / trackCount).toFixed(4)})\n`,
      );
      built = model.distance;
    } else {
      built = buildLocalScalingDistance({ trackCount, candidates, similarityBetween }).distance;
    }
    distanceCache.set(correction, built);
    return built;
  };

  const rows: SweepRow[] = [];
  const reverseModes = options.includeNoReverse ? [true, false] : [true];

  const toGraph = (selected: ReadonlyArray<ReadonlyArray<NeighbourCandidate>>): NeighbourGraph => {
    const targets = new Int32Array(trackCount * 3).fill(-1);
    const similarities = new Float64Array(trackCount * 3).fill(Number.NaN);
    for (let seed = 0; seed < trackCount; seed += 1) {
      const row = selected[seed] ?? [];
      for (let slot = 0; slot < Math.min(row.length, 3); slot += 1) {
        targets[(seed * 3) + slot] = row[slot]!.trackOrdinal;
        similarities[(seed * 3) + slot] = row[slot]!.similarity;
      }
    }
    return {
      trackCount,
      neighboursPerTrack: 3,
      targets,
      similarities,
      fileOrdinalByTrack: tracks.fileOrdinalByTrack,
    };
  };

  const record = (row: SweepRow, extra: string, elapsedMs: number): void => {
    rows.push(row);
    process.stdout.write(
      `\n${formatAnalysis(row.analysis)}\n${extra}`
      + (row.stations
        ? `stations [fixed]: median ${row.stations.distinctServedMedian},`
          + ` p10 ${row.stations.distinctServedP10}, p90 ${row.stations.distinctServedP90}\n`
        : "")
      + (row.driftStations
        ? `stations [drift]: median ${row.driftStations.distinctServedMedian},`
          + ` p10 ${row.driftStations.distinctServedP10}, p90 ${row.driftStations.distinctServedP90},`
          + ` at cap ${row.driftStations.stationsAtCap} of ${row.driftStations.stations}\n`
        : "")
      + `(${(elapsedMs / 1000).toFixed(1)}s)\n`,
    );
  };

  for (const correction of options.corrections) {
    const selectionDistance = distanceFor(correction);
    for (const alpha of options.alphas) {
      if (options.builders.includes("prune")) {
        for (const reverseInsertion of reverseModes) {
          const started = Date.now();
          const selection = selectDiversifiedNeighbours({
            trackCount,
            candidates,
            neighboursPerTrack: 3,
            alpha,
            selectionDistance,
            similarityBetween,
            reverseInsertion,
          });
          const graph = toGraph(selection.rows);
          const label = `prune alpha=${alpha} correction=${correction}`
            + (reverseInsertion ? "" : " (no reverse insertion)");
          const analysis = analyseGraph(label, graph, { vectors, queries, trueNearest });
          const stations = options.stations > 0
            ? stationSummaryFor(graph, options.stations, label)
            : undefined;
          record(
            {
              builder: "prune",
              alpha,
              correction,
              reverseInsertion,
              analysis,
              stations,
              selectionStats: selection.stats,
            },
            `selection: pruned ${selection.stats.prunedSlots}, backfilled ${selection.stats.backfilledSlots},`
            + ` empty ${selection.stats.emptySlots}, reverse accepted ${selection.stats.reverseEdgesAccepted}`
            + ` of ${selection.stats.reverseEdgesOffered} offered,`
            + ` re-prunes ${selection.stats.reverseRePrunes}, displaced ${selection.stats.reverseDisplacedEdges}\n`,
            Date.now() - started,
          );
        }
      }
      if (options.builders.includes("navigable")) {
        for (const searchListSize of options.searchListSizes) {
        for (const inDegreeCapMultiple of options.inDegreeCaps) {
        for (const entryPointCount of options.entryPointCounts) {
        for (const forcedNearestSlots of options.forcedNearestCounts) {
          const started = Date.now();
          const built = buildNavigableNeighbourGraph({
            trackCount,
            neighboursPerTrack: 3,
            similarityBetween,
            candidates,
            alpha,
            searchListSize,
            inDegreeCapMultiple,
            entryPointCount,
            forcedNearestSlots,
            selectionDistance,
            onProgress: (fraction, stage) => {
              process.stdout.write(`  ${stage} ${(fraction * 100).toFixed(0)}%\r`);
            },
          });
          const graph = toGraph(built.rows);
          const label = `navigable alpha=${alpha} correction=${correction} L=${searchListSize}`
            + ` cap=${inDegreeCapMultiple === 0 ? "off" : `${inDegreeCapMultiple}x`}`
            + ` entries=${entryPointCount} forced=${forcedNearestSlots}`;
          const analysis = analyseGraph(label, graph, { vectors, queries, trueNearest });
          const stations = options.stations > 0
            ? stationSummaryFor(graph, options.stations, label)
            : undefined;
          const driftStations = options.driftStations > 0
            ? stationSummaryFor(graph, options.driftStations, label, "drift", 25_000)
            : undefined;
          const quality = qualitySeeds ? qualityOf(graph, qualityTracks, qualitySeeds) : undefined;
          record(
            {
              builder: "navigable",
              alpha,
              correction,
              searchListSize,
              reverseInsertion: true,
              forcedNearestSlots,
              analysis,
              stations,
              driftStations,
              composerLift: quality?.composerLift,
              ndcgAt10: quality?.ndcgAt10,
              buildStats: built.stats,
            },
            `build: medoid ${built.medoid}, mean visited ${built.stats.meanVisited.toFixed(0)},`
            + ` mean edge distance ${built.stats.meanEdgeDistance.toFixed(4)},`
            + ` max ${built.stats.maxEdgeDistance.toFixed(4)},`
            + ` ${(built.stats.distanceEvaluations / 1e6).toFixed(0)}M distance evaluations\n`
            + `repair: ${built.stats.unreachableBeforeRepair} unreachable before,`
            + ` ${built.stats.repaired} repaired, ${built.stats.unreachableAfterRepair} left\n`
            + `trim: in-degree max ${built.stats.inDegreeMaxBeforeTrim} -> ${built.stats.inDegreeMaxAfterTrim},`
            + ` ${built.stats.trimmedEdges} edges moved\n`
            + (quality
              ? `quality: composer lift ${quality.composerLift.toFixed(3)},`
                + ` nDCG@10 ${quality.ndcgAt10.toFixed(4)}\n`
              : ""),
            Date.now() - started,
          );
        }
        }
        }
        }
      }
    }
  }

  process.stdout.write(`\n${formatTable(rows)}\n`);
  if (options.json) {
    writeFileSync(options.json, `${JSON.stringify(rows, null, 2)}\n`);
    process.stdout.write(`\nwrote ${options.json}\n`);
  }
}

function formatTable(rows: SweepRow[]): string {
  const header = [
    "builder", "alpha", "correction", "L", "forced", "rev", "out-deg", "zero-in", "zero-out",
    "in-max", "in-max/mean", "largest-cc", "recip", "recall@1", "hops", "slot0-sim", "same-file", "lift", "ndcg", "station-med", "drift-med",
  ];
  const body = rows.map((row) => {
    const { degrees, connectivity, sameFile, routing, slotSimilarity } = row.analysis;
    return [
      row.builder,
      row.alpha.toFixed(2),
      row.correction,
      row.searchListSize === undefined ? "-" : String(row.searchListSize),
      row.forcedNearestSlots === undefined ? "-" : String(row.forcedNearestSlots),
      row.reverseInsertion ? "y" : "n",
      degrees.outDegreeMean.toFixed(3),
      `${degrees.inDegreeZero} (${(degrees.inDegreeZeroFraction * 100).toFixed(3)}%)`,
      String(degrees.outDegreeZero),
      String(degrees.inDegreeMax),
      degrees.inDegreeMaxOverMean.toFixed(1),
      `${(connectivity.largestComponentFraction * 100).toFixed(3)}%`,
      `${(row.analysis.reciprocity * 100).toFixed(2)}%`,
      routing ? `${(routing.recallAt1 * 100).toFixed(2)}%` : "-",
      routing ? routing.meanHops.toFixed(1) : "-",
      (slotSimilarity.meanBySlot[0] ?? Number.NaN).toFixed(4),
      `${(sameFile.allSlots * 100).toFixed(2)}%`,
      row.composerLift === undefined ? "-" : row.composerLift.toFixed(2),
      row.ndcgAt10 === undefined ? "-" : row.ndcgAt10.toFixed(4),
      row.stations ? String(row.stations.distinctServedMedian) : "-",
      row.driftStations ? String(row.driftStations.distinctServedMedian) : "-",
    ];
  });
  const widths = header.map((label, column) =>
    Math.max(label.length, ...body.map((line) => line[column]!.length)));
  const render = (cells: string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column]!)).join("  ");
  return [render(header), render(widths.map((width) => "-".repeat(width))), ...body.map(render)].join("\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
