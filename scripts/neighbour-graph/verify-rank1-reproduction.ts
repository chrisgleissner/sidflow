/**
 * Prove the published neighbour graph is derivable from the published vectors.
 *
 * ## Why this runs first
 *
 * Everything else in this directory reasons about what the neighbour graph *should* contain
 * by recomputing similarities from `tracks.vector_json`. That is only legitimate if the
 * recomputation reproduces what the export actually shipped. If it does not, then either
 * the metric is not the one the manifest declares, or the vectors are not the ones the
 * neighbours were selected from, and in either case no measurement built on the
 * recomputation means anything.
 *
 * It is also the check that makes a rebuild possible without reclassifying. Reclassification
 * is a full render pass over 87,868 subsongs; if the vectors in the export are sufficient to
 * reproduce its own neighbour selection, then a new graph can be built from the published
 * artefact alone.
 *
 * ## What it checks
 *
 * For a sample of seed tracks, the argmax of weighted cosine over the whole corpus must
 * equal the rank-1 neighbour the export published. The metric is reconstructed from the
 * manifest, not from constants in this repository, so the check would fail if the shipped
 * weights and the code's weights ever diverged.
 *
 * ## Usage
 *
 *   node scripts/run-bun.mjs run scripts/neighbour-graph/verify-rank1-reproduction.ts \
 *     --sqlite tmp/rebuild-0.8.2/sidcorr-hvsc-full-sidcorr-1.sqlite \
 *     --manifest tmp/rebuild-0.8.2/sidcorr-hvsc-full-sidcorr-1.manifest.json
 *
 * Optional flags:
 *   --probes 0,1000,50000   explicit seed ordinals to check (default: the three below)
 *   --sample 200            additionally check this many deterministically sampled seeds
 *   --vector-cache PATH     cache the weighted, normalised vectors for later runs
 *
 * Exit code 0 means every probed seed reproduced.
 */

import { Database } from "bun:sqlite";
import {
  loadFullExportNeighbours,
  loadFullExportTracks,
  loadWeightedVectors,
  readFullExportManifest,
  sampleOrdinals,
  similarityBetween,
  trueNearestNeighbour,
  type FullExportNeighbours,
  type FullExportTracks,
  type WeightedVectors,
} from "./full-export.js";

/**
 * The three probes quoted in `doc/plans/neighbour-graph-redesign/prompt.md` Appendix A, with
 * the rank-1 targets the published 0.8.0/0.8.2 export carries for them. They are pinned so a
 * corpus that silently changed identity fails loudly instead of reproducing itself.
 */
const DEFAULT_PROBES = [0, 1_000, 50_000] as const;
const EXPECTED_TARGETS = new Map<number, number>([
  [0, 86_297],
  [1_000, 359],
  [50_000, 61_874],
]);

interface Options {
  sqlite: string;
  manifest: string;
  probes: number[];
  sample: number;
  vectorCache?: string;
}

function parseOptions(argv: string[]): Options {
  let sqlite = "";
  let manifest = "";
  let probes: number[] | null = null;
  let sample = 0;
  let vectorCache: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const next = argv[index + 1];
    switch (argument) {
      case "--sqlite":
        sqlite = next ?? "";
        index += 1;
        break;
      case "--manifest":
        manifest = next ?? "";
        index += 1;
        break;
      case "--probes":
        probes = (next ?? "").split(",").filter(Boolean).map((value) => Number.parseInt(value, 10));
        index += 1;
        break;
      case "--sample":
        sample = Number.parseInt(next ?? "0", 10);
        index += 1;
        break;
      case "--vector-cache":
        vectorCache = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!sqlite) {
    throw new Error("--sqlite is required");
  }
  if (!manifest) {
    throw new Error("--manifest is required");
  }
  return { sqlite, manifest, probes: probes ?? [...DEFAULT_PROBES], sample, vectorCache };
}

interface ProbeResult {
  seed: number;
  published: number;
  recomputed: number;
  publishedSimilarity: number;
  recomputedSimilarity: number;
  pinnedTarget?: number;
}

function probe(
  seed: number,
  tracks: FullExportTracks,
  neighbours: FullExportNeighbours,
  vectors: WeightedVectors,
): ProbeResult {
  const published = neighbours.targets[seed * neighbours.neighboursPerTrack]!;
  const recomputed = trueNearestNeighbour(vectors, seed, tracks.trackCount);
  return {
    seed,
    published,
    recomputed,
    publishedSimilarity: neighbours.similarities[seed * neighbours.neighboursPerTrack]!,
    recomputedSimilarity: similarityBetween(vectors, seed, recomputed),
    pinnedTarget: EXPECTED_TARGETS.get(seed),
  };
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const manifest = readFullExportManifest(options.manifest);
  process.stdout.write(
    `export ${manifest.schema_version}, ${manifest.track_count} tracks, `
    + `${manifest.vector_dimensions} dimensions, metric ${manifest.similarity_metric}\n`,
  );
  if (manifest.similarity_metric !== "weighted-cosine") {
    throw new Error(
      `This check reconstructs weighted cosine; the manifest declares ${manifest.similarity_metric}.`,
    );
  }

  const database = new Database(options.sqlite, { readonly: true, strict: true });
  let failures = 0;
  try {
    const tracks = loadFullExportTracks(database);
    process.stdout.write(`loaded ${tracks.trackCount} tracks over ${tracks.fileCount} files\n`);
    if (tracks.trackCount !== manifest.track_count) {
      throw new Error(
        `The SQLite holds ${tracks.trackCount} tracks and the manifest declares ${manifest.track_count}.`,
      );
    }
    const neighbours = loadFullExportNeighbours(database, tracks, manifest.neighbor_count_per_track);
    const vectors = loadWeightedVectors(database, tracks, manifest.vector_weights, options.vectorCache);
    process.stdout.write(`loaded ${vectors.dimensions}-dimension weighted vectors\n\n`);

    const seeds = [...options.probes];
    if (options.sample > 0) {
      for (const ordinal of sampleOrdinals(tracks.trackCount, options.sample, 20_260_730)) {
        if (!seeds.includes(ordinal)) {
          seeds.push(ordinal);
        }
      }
    }

    for (const seed of seeds) {
      const result = probe(seed, tracks, neighbours, vectors);
      const reproduced = result.published === result.recomputed;
      const pinnedHolds = result.pinnedTarget === undefined || result.pinnedTarget === result.published;
      if (!reproduced || !pinnedHolds) {
        failures += 1;
      }
      // Only the pinned probes and the failures are worth printing in full; a 200-seed
      // sample that all passes says everything it needs to say in the summary.
      if (result.pinnedTarget !== undefined || !reproduced || !pinnedHolds) {
        process.stdout.write(
          `${reproduced && pinnedHolds ? "PASS" : "FAIL"} seed ${result.seed} `
          + `(${tracks.trackIds[result.seed]})\n`
          + `  published rank 1 ${result.published} @ ${result.publishedSimilarity.toFixed(6)}\n`
          + `  recomputed argmax ${result.recomputed} @ ${result.recomputedSimilarity.toFixed(6)}\n`
          + (result.pinnedTarget === undefined
            ? ""
            : `  pinned expectation ${result.pinnedTarget}${pinnedHolds ? "" : " MISMATCH"}\n`),
        );
      }
    }

    process.stdout.write(
      `\n${seeds.length - failures} of ${seeds.length} seeds reproduced their published rank-1 neighbour\n`,
    );
  } finally {
    database.close();
  }

  if (failures > 0) {
    process.stdout.write(
      "\nThe published graph is NOT derivable from the published vectors under the published metric.\n"
      + "Stop here: nothing measured against a recomputed similarity is trustworthy until this is understood.\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    "\nThe published graph is derivable from the published vectors under the published metric.\n",
  );
}

main();
