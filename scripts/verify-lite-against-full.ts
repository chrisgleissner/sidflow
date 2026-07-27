/**
 * Prove that a third party can reproduce the full export's neighbours from the lite
 * bundle and its manifest alone.
 *
 * ## Why this exists
 *
 * The full export's neighbours are ranked by WEIGHTED cosine: a 58-entry learned weight
 * table, fitted by coordinate ascent on nDCG@10, with weights spanning 0.328 to 2.109 --
 * a 6.4x spread. Until 0.8.0 that table lived only in TypeScript source. It was not in
 * the bundle, not in any manifest, and not mentioned in any of the three published
 * specifications.
 *
 * So a consumer who implemented the published lite spec exactly, and had every reason to
 * believe they were correct, computed a plain cosine and agreed with the authoritative
 * neighbours on roughly half their results. Measured over 3,000 seeds: R@1 = 0.478 and
 * 40% station overlap, against 0.983 and 98% with the weights applied. The lite bundle
 * was never lossy -- the specification was.
 *
 * This script is the regression test for that. It deliberately does NOT import SIDFlow's
 * decoder or its weight constant. It parses the bundle from the format description and
 * takes the metric from `vector_weights` in the manifest, exactly as a third party would,
 * so if either the format drifts from its spec or the weights stop being published, this
 * fails.
 *
 * Usage:
 *   bun run scripts/verify-lite-against-full.ts \
 *     --lite data/exports/sidcorr-hvsc-full-sidcorr-lite-1.sidcorr \
 *     --full data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite \
 *     [--seeds 1000] [--min-recall 0.98]
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Database } from "bun:sqlite";
import { gunzipSync } from "node:zlib";

const HEADER_BYTES = 32;
const FOOTER_BYTES = 40;
const EPOCH_HEADER_BYTES = 40;
const MAGIC = "SIDCORR\0";

interface LiteBundle {
  vectorDimensions: number;
  trackIds: string[];
  /** Row-major, already scaled by sqrt(weight) and L2-normalised. */
  vectors: Float32Array;
}

interface LiteManifest {
  vector_dimensions: number;
  similarity_metric?: string;
  vector_weights?: number[];
  pq_centroids_per_subspace: number;
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(2);
}

/**
 * Decode the bundle from its published description, not with SIDFlow's own reader.
 *
 * Using `decodeLiteSimilarityExport` here would make the check circular: it would prove
 * that SIDFlow agrees with itself, which is not the property in question.
 */
function decodeLite(raw: Buffer, manifest: LiteManifest, weights: number[] | null): LiteBundle {
  // The bundle may be stored gzipped; the manifest's content_encoding says which, but
  // sniffing the magic is enough and keeps this readable.
  const payload = raw.subarray(0, 2).toString("hex") === "1f8b" ? gunzipSync(raw) : raw;
  if (payload.subarray(0, 8).toString("ascii") !== MAGIC) {
    fail("not a sidcorr-lite-1 bundle");
  }

  const vectorDimensions = payload.readUInt16LE(12);
  const fileIdWidth = payload.readUInt8(14);
  const songIndexWidth = payload.readUInt8(15);
  const centroidsPerSubspace = payload.readUInt16LE(18);
  const codebookOffset = payload.readUInt32LE(24);

  // Codebooks: uint16 dimensions, uint16 centroids, then dimensions * centroids float32.
  const codebooks: Float32Array[] = [];
  let cursor = codebookOffset + 4;
  for (let dimension = 0; dimension < vectorDimensions; dimension += 1) {
    const centroids = new Float32Array(centroidsPerSubspace);
    for (let centroid = 0; centroid < centroidsPerSubspace; centroid += 1) {
      centroids[centroid] = payload.readFloatLE(cursor);
      cursor += 4;
    }
    codebooks.push(centroids);
  }

  const footerStart = payload.length - FOOTER_BYTES;
  const indexOffset = Number(payload.readBigUInt64LE(footerStart));
  const epochStart = Number(payload.readBigUInt64LE(indexOffset));

  const trackCount = payload.readUInt32LE(epochStart);
  const fileDictionaryBytes = payload.readUInt32LE(epochStart + 8);
  const fileDictionaryStart = epochStart + EPOCH_HEADER_BYTES;
  const trackTableStart = fileDictionaryStart + fileDictionaryBytes;

  const filePaths: string[] = [];
  cursor = fileDictionaryStart;
  while (cursor < trackTableStart) {
    const length = payload.readUInt16LE(cursor);
    cursor += 2;
    filePaths.push(payload.subarray(cursor, cursor + length).toString("utf8"));
    cursor += length;
  }

  // Weighted cosine equals a plain cosine over vectors whose components are scaled by
  // sqrt(weight): sum w*l*r = sum (sqrt(w)*l)(sqrt(w)*r), and both norms transform the
  // same way. Doing the scaling once turns every subsequent comparison into a dot
  // product -- which is also the clearest statement of what the weights mean.
  const scale = new Float64Array(vectorDimensions);
  for (let dimension = 0; dimension < vectorDimensions; dimension += 1) {
    scale[dimension] = Math.sqrt(weights ? (weights[dimension] ?? 1) : 1);
  }

  const trackIds: string[] = new Array(trackCount);
  const vectors = new Float32Array(trackCount * vectorDimensions);
  const rowBytes = fileIdWidth + songIndexWidth + 2 + vectorDimensions;
  const reconstructed = new Float64Array(vectorDimensions);

  for (let index = 0; index < trackCount; index += 1) {
    const rowStart = trackTableStart + (index * rowBytes);
    const fileId = fileIdWidth === 2
      ? payload.readUInt16LE(rowStart)
      : payload[rowStart]! | (payload[rowStart + 1]! << 8) | (payload[rowStart + 2]! << 16);
    const songIndex = songIndexWidth === 1
      ? payload.readUInt8(rowStart + fileIdWidth)
      : payload.readUInt16LE(rowStart + fileIdWidth);
    const codesStart = rowStart + fileIdWidth + songIndexWidth + 2;

    trackIds[index] = `${filePaths[fileId] ?? `missing-${fileId}`}#${songIndex}`;

    // Reconstruct: the stored code per dimension indexes that dimension's codebook. The
    // reconstruction is then re-normalised, exactly as the format describes.
    let magnitude = 0;
    for (let dimension = 0; dimension < vectorDimensions; dimension += 1) {
      const value = codebooks[dimension]![payload[codesStart + dimension]!]!;
      reconstructed[dimension] = value;
      magnitude += value * value;
    }
    magnitude = Math.sqrt(magnitude);
    if (magnitude <= 0) {
      fail(`degenerate reconstructed vector at track ${index}`);
    }

    // Normalise, then apply sqrt(weight), then normalise again so the dot product is a
    // cosine. Weighted cosine is scale-invariant per vector, so the first normalisation
    // is the format's and the second is the metric's.
    let weightedMagnitude = 0;
    for (let dimension = 0; dimension < vectorDimensions; dimension += 1) {
      const scaled = (reconstructed[dimension]! / magnitude) * scale[dimension]!;
      reconstructed[dimension] = scaled;
      weightedMagnitude += scaled * scaled;
    }
    weightedMagnitude = Math.sqrt(weightedMagnitude);
    const base = index * vectorDimensions;
    for (let dimension = 0; dimension < vectorDimensions; dimension += 1) {
      vectors[base + dimension] = reconstructed[dimension]! / weightedMagnitude;
    }
  }

  if (manifest.vector_dimensions !== vectorDimensions) {
    fail(`manifest says ${manifest.vector_dimensions} dimensions, bundle says ${vectorDimensions}`);
  }

  return { vectorDimensions, trackIds, vectors };
}

function topK(bundle: LiteBundle, seedIndex: number, k: number): string[] {
  const { vectorDimensions, vectors, trackIds } = bundle;
  const trackCount = trackIds.length;
  const seedBase = seedIndex * vectorDimensions;
  const bestScore = new Float64Array(k).fill(Number.NEGATIVE_INFINITY);
  const bestIndex = new Int32Array(k).fill(-1);
  let size = 0;
  let worst = Number.NEGATIVE_INFINITY;

  for (let candidate = 0; candidate < trackCount; candidate += 1) {
    if (candidate === seedIndex) {
      continue;
    }
    const base = candidate * vectorDimensions;
    let dot = 0;
    for (let dimension = 0; dimension < vectorDimensions; dimension += 1) {
      dot += vectors[seedBase + dimension]! * vectors[base + dimension]!;
    }
    if (size === k && dot <= worst) {
      continue;
    }
    let position = size < k ? size : k - 1;
    while (position > 0 && bestScore[position - 1]! < dot) {
      bestScore[position] = bestScore[position - 1]!;
      bestIndex[position] = bestIndex[position - 1]!;
      position -= 1;
    }
    bestScore[position] = dot;
    bestIndex[position] = candidate;
    if (size < k) {
      size += 1;
    }
    worst = bestScore[size - 1]!;
  }

  const result: string[] = [];
  for (let rank = 0; rank < size; rank += 1) {
    result.push(trackIds[bestIndex[rank]!]!);
  }
  return result;
}

/** Deterministic sampling, so a failure can be reproduced exactly. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

async function main(argv: string[]): Promise<number> {
  let litePath = "";
  let fullPath = "";
  let seedCount = 1000;
  let minimumRecall = 0.98;
  let sampleSeed = 20260727;

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value) {
      fail(`${flag} needs a value`);
    }
    if (flag === "--lite") litePath = value;
    else if (flag === "--full") fullPath = value;
    else if (flag === "--seeds") seedCount = Number.parseInt(value, 10);
    else if (flag === "--min-recall") minimumRecall = Number.parseFloat(value);
    else if (flag === "--sample-seed") sampleSeed = Number.parseInt(value, 10);
    else fail(`unknown argument ${flag}`);
  }

  if (!litePath || !fullPath) {
    fail("both --lite and --full are required");
  }

  const manifestPath = litePath.replace(/\.sidcorr(\.gz)?$/, "") + ".manifest.json";
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as LiteManifest;

  process.stdout.write(`lite     ${path.basename(litePath)}\n`);
  process.stdout.write(`manifest ${path.basename(manifestPath)}\n`);
  process.stdout.write(`full     ${path.basename(fullPath)}\n\n`);

  // The whole point: the metric comes from the manifest, not from SIDFlow's source.
  const metric = manifest.similarity_metric ?? "cosine";
  let weights: number[] | null = null;
  if (metric === "weighted-cosine") {
    if (!Array.isArray(manifest.vector_weights)) {
      fail("manifest declares weighted-cosine but publishes no vector_weights");
    }
    if (manifest.vector_weights.length !== manifest.vector_dimensions) {
      fail(
        `vector_weights has ${manifest.vector_weights.length} entries `
        + `for ${manifest.vector_dimensions} dimensions`,
      );
    }
    weights = manifest.vector_weights;
  }
  process.stdout.write(`metric   ${metric}`);
  process.stdout.write(weights ? ` with ${weights.length} published weights\n\n` : " (unweighted)\n\n");

  const bundle = decodeLite(await readFile(litePath), manifest, weights);
  process.stdout.write(`decoded ${bundle.trackIds.length} tracks x ${bundle.vectorDimensions} dimensions\n`);

  const indexByTrackId = new Map(bundle.trackIds.map((trackId, index) => [trackId, index]));

  const database = new Database(fullPath, { readonly: true, strict: true });
  let seeds: string[];
  let storedNeighbors: Map<string, string[]>;
  let neighborDepth: number;
  try {
    const seedRows = database
      .query("SELECT DISTINCT seed_track_id FROM neighbors ORDER BY seed_track_id")
      .all() as Array<{ seed_track_id: string }>;
    if (seedRows.length === 0) {
      fail("the full export has no neighbours to verify against");
    }

    const random = createRandom(sampleSeed);
    const pool = seedRows.map((row) => row.seed_track_id).filter((id) => indexByTrackId.has(id));
    const take = Math.min(seedCount, pool.length);
    for (let index = 0; index < take; index += 1) {
      const swap = index + Math.floor(random() * (pool.length - index));
      const next = pool[index]!;
      pool[index] = pool[swap]!;
      pool[swap] = next;
    }
    seeds = pool.slice(0, take);

    const depthRow = database.query("SELECT MAX(rank) AS depth FROM neighbors").get() as { depth: number };
    neighborDepth = depthRow.depth;

    storedNeighbors = new Map();
    const statement = database.query(
      "SELECT neighbor_track_id FROM neighbors WHERE seed_track_id = ? ORDER BY rank ASC",
    );
    for (const seed of seeds) {
      storedNeighbors.set(
        seed,
        (statement.all(seed) as Array<{ neighbor_track_id: string }>).map((row) => row.neighbor_track_id),
      );
    }
  } finally {
    database.close();
  }

  process.stdout.write(`sampling ${seeds.length} seeds, comparing top-${neighborDepth}\n\n`);

  let recallTotal = 0;
  let rankOneHits = 0;
  let compared = 0;
  const startedAt = Date.now();
  for (const [position, seed] of seeds.entries()) {
    const seedIndex = indexByTrackId.get(seed);
    if (seedIndex === undefined) {
      continue;
    }
    const expected = storedNeighbors.get(seed) ?? [];
    if (expected.length === 0) {
      continue;
    }
    const actual = topK(bundle, seedIndex, neighborDepth);
    const actualSet = new Set(actual);
    let hits = 0;
    for (const trackId of expected) {
      if (actualSet.has(trackId)) {
        hits += 1;
      }
    }
    recallTotal += hits / expected.length;
    if (actual[0] === expected[0]) {
      rankOneHits += 1;
    }
    compared += 1;

    if ((position + 1) % 100 === 0) {
      const elapsed = (Date.now() - startedAt) / 1000;
      process.stdout.write(
        `  ${position + 1}/${seeds.length} seeds, R@${neighborDepth} so far ${(recallTotal / compared).toFixed(4)} (${elapsed.toFixed(0)}s)\n`,
      );
    }
  }

  if (compared === 0) {
    fail("no seeds could be compared");
  }

  const recall = recallTotal / compared;
  const rankOne = rankOneHits / compared;
  process.stdout.write(`\nseeds compared   ${compared}\n`);
  process.stdout.write(`R@${neighborDepth}            ${recall.toFixed(4)}\n`);
  process.stdout.write(`R@1              ${rankOne.toFixed(4)}\n`);
  process.stdout.write(`threshold        ${minimumRecall.toFixed(4)}\n\n`);

  if (recall < minimumRecall) {
    process.stdout.write(
      `FAIL: a consumer implementing the published lite specification reaches R@${neighborDepth} `
      + `${recall.toFixed(4)}, below the ${minimumRecall.toFixed(4)} the specification promises.\n`,
    );
    return 1;
  }
  process.stdout.write(
    `OK: the lite bundle and its manifest are sufficient to reproduce the full export's neighbours.\n`,
  );
  return 0;
}

process.exit(await main(process.argv.slice(2)));
