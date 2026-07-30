/**
 * Retrieval quality of an exported neighbour graph: composer lift and nDCG@10.
 *
 * This is the guardrail. A graph that streams forever through worse matches is not an
 * improvement, so the structural gains from the construction have to be bought without giving up
 * match quality — the release requires no more than a 5% relative regression against 0.8.2.
 *
 * ## What is measured, and against what label
 *
 * Both metrics use the composer directory as the relevance label, via
 * `scripts/station-quality/metrics.ts`. That harness is reused rather than reimplemented because
 * its two subtleties are easy to get wrong and both matter here:
 *
 * - **Same-file siblings are excluded from the ranking and from the ideal.** Another subsong of the
 *   tune already playing is trivially "same composer" and would inflate the score without producing
 *   a better station. With 14.42% of rank-1 neighbours being siblings, not excluding them would
 *   make the metric mostly a measure of subsong density.
 * - **Chance is computed over the population the neighbours are drawn from**, so lift is a
 *   multiple of what random retrieval would achieve on this corpus rather than a bare precision.
 *
 * ## Usage
 *
 *   node scripts/run-bun.mjs run scripts/neighbour-graph/retrieval-quality.ts \
 *     --sqlite <full>.sqlite --manifest <full>.manifest.json \
 *     --tiny tmp/rebuild-0.8.2/sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr \
 *     --tiny tmp/new/sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr \
 *     --seeds 8000
 *
 * `--tiny` may be repeated; each bundle is measured and the second onward is reported as a relative
 * change against the first, which is the form the 5% guardrail is stated in. With no `--tiny` the
 * full export's own neighbour table is measured at `--k`.
 *
 * Flags:
 *   --k N        neighbours per seed to score (default 10)
 *   --seeds N    seed sample size (default 8000, 0 for every track)
 *   --json PATH  write the measurements as JSON
 */

import { writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { decodeTinyNeighbourGraph } from "../../packages/sidflow-common/src/index.js";
import { groupRetrieval, type Track } from "../station-quality/metrics.js";
import { ndcgAtK } from "../station-quality/harness.js";
import {
  loadFullExportNeighbours,
  loadFullExportTracks,
  readFullExportManifest,
  sampleOrdinals,
} from "./full-export.js";

interface Options {
  sqlite: string;
  manifest: string;
  tiny: string[];
  k: number;
  seeds: number;
  json?: string;
}

function parseOptions(argv: string[]): Options {
  const options: Options = { sqlite: "", manifest: "", tiny: [], k: 10, seeds: 8_000 };
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
      case "--tiny":
        if (next) {
          options.tiny.push(next);
        }
        index += 1;
        break;
      case "--k":
        options.k = Number.parseInt(next ?? "", 10);
        index += 1;
        break;
      case "--seeds":
        options.seeds = Number.parseInt(next ?? "", 10);
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
    throw new Error("--sqlite and --manifest are required; they supply the corpus and its labels.");
  }
  return options;
}

export interface QualityResult {
  label: string;
  neighboursPerSeed: number;
  composerLift: number;
  composerPrecision: number;
  chance: number;
  ndcgAt10: number;
  seedsScored: number;
  sameFileRate: number;
}

function measure(
  label: string,
  tracks: Track[],
  targetsBySeed: Int32Array,
  slotsPerSeed: number,
  fileOrdinalByTrack: Int32Array,
  seedOrdinals: Int32Array,
  k: number,
): QualityResult {
  const rankOrdinals = (seed: number, limit: number): number[] => {
    const out: number[] = [];
    for (let slot = 0; slot < slotsPerSeed && out.length < limit; slot += 1) {
      const target = targetsBySeed[(seed * slotsPerSeed) + slot]!;
      if (target >= 0) {
        out.push(target);
      }
    }
    return out;
  };

  const seedTracks = [...seedOrdinals].map((ordinal) => tracks[ordinal]!);
  const ordinalOfTrack = new Map(tracks.map((track, ordinal) => [track.trackId, ordinal]));
  const lift = groupRetrieval(
    seedTracks,
    (seed) => {
      const ordinal = ordinalOfTrack.get(seed.trackId)!;
      return rankOrdinals(ordinal, k).map((target) => tracks[target]!);
    },
    k,
  );
  const ndcg = ndcgAtK(tracks, rankOrdinals, 10, [...seedOrdinals]);

  let sameFile = 0;
  let edges = 0;
  for (const seed of seedOrdinals) {
    for (const target of rankOrdinals(seed, k)) {
      edges += 1;
      if (fileOrdinalByTrack[target] === fileOrdinalByTrack[seed]) {
        sameFile += 1;
      }
    }
  }

  return {
    label,
    neighboursPerSeed: slotsPerSeed,
    composerLift: lift.lift,
    composerPrecision: lift.precisionAtK,
    chance: lift.chance,
    ndcgAt10: ndcg.mean,
    seedsScored: lift.seeds,
    sameFileRate: edges === 0 ? 0 : sameFile / edges,
  };
}

function formatResult(result: QualityResult, baseline?: QualityResult): string {
  const relative = (value: number, against: number): string =>
    against === 0 ? "n/a" : `${value >= against ? "+" : ""}${(((value / against) - 1) * 100).toFixed(2)}%`;
  const lines = [
    `=== ${result.label} ===`,
    `slots per seed ${result.neighboursPerSeed}, seeds scored ${result.seedsScored}`,
    `composer lift ${result.composerLift.toFixed(4)}`
    + ` (precision ${(result.composerPrecision * 100).toFixed(2)}%,`
    + ` chance ${(result.chance * 100).toFixed(4)}%)`
    + (baseline ? `  ${relative(result.composerLift, baseline.composerLift)} vs baseline` : ""),
    `nDCG@10 ${result.ndcgAt10.toFixed(4)}`
    + (baseline ? `  ${relative(result.ndcgAt10, baseline.ndcgAt10)} vs baseline` : ""),
    `same-file edges ${(result.sameFileRate * 100).toFixed(2)}%`,
  ];
  if (baseline) {
    const liftDrop = 1 - (result.composerLift / baseline.composerLift);
    const ndcgDrop = 1 - (result.ndcgAt10 / baseline.ndcgAt10);
    const worst = Math.max(liftDrop, ndcgDrop);
    lines.push(
      `guardrail (no more than 5% relative regression): ${worst <= 0.05 ? "PASS" : "FAIL"}`
      + ` — worst regression ${(worst * 100).toFixed(2)}%`,
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const manifest = readFullExportManifest(options.manifest);
  const database = new Database(options.sqlite, { readonly: true, strict: true });
  const results: QualityResult[] = [];
  try {
    const exported = loadFullExportTracks(database);
    // The harness's Track carries a vector field it does not use for these two metrics — both are
    // computed from the supplied ranking and the composer label — so it is left empty rather than
    // loading 87,868 vectors this script has no use for.
    const tracks: Track[] = exported.trackIds.map((trackId, ordinal) => ({
      trackId,
      sidPath: exported.sidPaths[ordinal]!,
      vector: [],
      e: 0,
      m: 0,
      c: 0,
    }));
    const seedOrdinals = options.seeds > 0
      ? sampleOrdinals(exported.trackCount, options.seeds, 20_260_730)
      : Int32Array.from({ length: exported.trackCount }, (_, index) => index);

    if (options.tiny.length === 0) {
      const neighbours = loadFullExportNeighbours(database, exported, manifest.neighbor_count_per_track);
      results.push(measure(
        `sidcorr-1 neighbours, k=${options.k}`,
        tracks,
        neighbours.targets,
        manifest.neighbor_count_per_track,
        exported.fileOrdinalByTrack,
        seedOrdinals,
        options.k,
      ));
    } else {
      for (const tinyPath of options.tiny) {
        const decoded = await decodeTinyNeighbourGraph(tinyPath);
        if (decoded.trackCount !== exported.trackCount) {
          throw new Error(
            `${tinyPath} holds ${decoded.trackCount} tracks and the full export holds `
            + `${exported.trackCount}; they are different corpora.`,
          );
        }
        results.push(measure(
          tinyPath,
          tracks,
          decoded.targets,
          decoded.neighborsPerTrack,
          decoded.fileOrdinalByTrack,
          seedOrdinals,
          options.k,
        ));
      }
    }
  } finally {
    database.close();
  }

  const [baseline] = results;
  results.forEach((result, index) => {
    process.stdout.write(`${formatResult(result, index === 0 ? undefined : baseline)}\n\n`);
  });
  if (options.json) {
    writeFileSync(options.json, `${JSON.stringify(results, null, 2)}\n`);
    process.stdout.write(`wrote ${options.json}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
