/**
 * Loaders for the published `sidcorr-1` full export, shared by every measurement script
 * in this directory.
 *
 * Two things live here because getting either of them subtly wrong invalidates every
 * number downstream:
 *
 * 1. **Track ordinals.** `sidcorr-tiny-1` numbers tracks by `sid_path` ascending then
 *    `song_index` ascending (`doc/similarity-export-tiny.md` §4.2), and the tiny bundle's
 *    edges are those ordinals. Reading the full export in any other order — `track_id`
 *    order, for instance, which is nearly but not exactly the same — silently compares one
 *    graph against a permutation of another.
 * 2. **The metric.** The export's `similarity_metric` is `weighted-cosine`, and the
 *    weights are published in the manifest as `vector_weights`. Scaling every vector by
 *    `sqrt(weight)` per dimension and then L2-normalising makes that weighted cosine a
 *    plain dot product, because
 *    `sum(w*l*r) / (sqrt(sum(w*l^2)) * sqrt(sum(w*r^2)))` is the ordinary cosine of the
 *    scaled vectors. Every distance in these scripts is therefore `1 - dot`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";

export interface FullExportManifest {
  schema_version: string;
  track_count: number;
  vector_dimensions: number;
  neighbor_count_per_track: number;
  similarity_metric: string;
  vector_weights: number[];
  hvsc_version?: string;
}

export function readFullExportManifest(manifestPath: string): FullExportManifest {
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as FullExportManifest;
  if (!Array.isArray(parsed.vector_weights) || parsed.vector_weights.length === 0) {
    throw new Error(`${manifestPath} carries no vector_weights; the metric cannot be reproduced.`);
  }
  return parsed;
}

export interface FullExportTracks {
  trackCount: number;
  fileCount: number;
  trackIds: string[];
  sidPaths: string[];
  songIndexes: Int32Array;
  /** File ordinal per track. Subsongs of one `.sid` file share one file ordinal. */
  fileOrdinalByTrack: Int32Array;
  /** Track ordinal by `track_id`, for resolving the `neighbors` table. */
  ordinalByTrackId: Map<string, number>;
}

/** Read the track table in tiny's ordinal order. */
export function loadFullExportTracks(database: Database): FullExportTracks {
  const rows = database.query(
    "SELECT track_id, sid_path, song_index FROM tracks ORDER BY sid_path ASC, song_index ASC",
  ).all() as Array<{ track_id: string; sid_path: string; song_index: number }>;

  const trackCount = rows.length;
  const trackIds: string[] = new Array(trackCount);
  const sidPaths: string[] = new Array(trackCount);
  const songIndexes = new Int32Array(trackCount);
  const fileOrdinalByTrack = new Int32Array(trackCount);
  const ordinalByTrackId = new Map<string, number>();
  const fileOrdinalByPath = new Map<string, number>();

  for (let ordinal = 0; ordinal < trackCount; ordinal += 1) {
    const row = rows[ordinal]!;
    trackIds[ordinal] = row.track_id;
    sidPaths[ordinal] = row.sid_path;
    songIndexes[ordinal] = row.song_index;
    ordinalByTrackId.set(row.track_id, ordinal);
    let fileOrdinal = fileOrdinalByPath.get(row.sid_path);
    if (fileOrdinal === undefined) {
      fileOrdinal = fileOrdinalByPath.size;
      fileOrdinalByPath.set(row.sid_path, fileOrdinal);
    }
    fileOrdinalByTrack[ordinal] = fileOrdinal;
  }

  return {
    trackCount,
    fileCount: fileOrdinalByPath.size,
    trackIds,
    sidPaths,
    songIndexes,
    fileOrdinalByTrack,
    ordinalByTrackId,
  };
}

export interface FullExportNeighbours {
  /** Slots per seed, taken from the manifest's `neighbor_count_per_track`. */
  neighboursPerTrack: number;
  /** `trackCount * neighboursPerTrack` target ordinals in rank order, `-1` if unfilled. */
  targets: Int32Array;
  /** Published similarity per slot, `NaN` if unfilled. */
  similarities: Float64Array;
}

/**
 * Read the `neighbors` table for the `full` profile into rank-ordered flat arrays.
 *
 * Self-edges are dropped rather than kept: they are not present in the published export,
 * and a self-edge that slipped in would make a pruning rule look better than it is.
 */
export function loadFullExportNeighbours(
  database: Database,
  tracks: FullExportTracks,
  neighboursPerTrack: number,
): FullExportNeighbours {
  const slots = tracks.trackCount * neighboursPerTrack;
  const targets = new Int32Array(slots).fill(-1);
  const similarities = new Float64Array(slots).fill(Number.NaN);

  const rows = database.query(`
    SELECT seed_track_id, neighbor_track_id, rank, similarity
    FROM neighbors
    WHERE profile = 'full'
    ORDER BY seed_track_id ASC, rank ASC
  `).all() as Array<{ seed_track_id: string; neighbor_track_id: string; rank: number; similarity: number }>;

  for (const row of rows) {
    const seed = tracks.ordinalByTrackId.get(row.seed_track_id);
    const target = tracks.ordinalByTrackId.get(row.neighbor_track_id);
    if (seed === undefined || target === undefined || target === seed) {
      continue;
    }
    const slot = row.rank - 1;
    if (slot < 0 || slot >= neighboursPerTrack) {
      continue;
    }
    targets[(seed * neighboursPerTrack) + slot] = target;
    similarities[(seed * neighboursPerTrack) + slot] = row.similarity;
  }

  return { neighboursPerTrack, targets, similarities };
}

export interface WeightedVectors {
  dimensions: number;
  /** `trackCount * dimensions`, weighted by `sqrt(vector_weights)` and L2-normalised. */
  values: Float64Array;
}

const VECTOR_CACHE_MAGIC = 0x53_49_44_57; // "SIDW"

/**
 * Load every track's vector, apply the published weights and normalise, so weighted cosine
 * becomes a dot product.
 *
 * Parsing 87,868 JSON vectors takes long enough that an alpha sweep would spend most of its
 * time here, so an optional binary cache is supported. The cache records the track count and
 * the dimension count and is rejected if either disagrees, which is the only way it can go
 * stale that matters — a different corpus or a different vector definition.
 */
export function loadWeightedVectors(
  database: Database,
  tracks: FullExportTracks,
  weights: readonly number[],
  cachePath?: string,
): WeightedVectors {
  const dimensions = weights.length;
  if (cachePath) {
    const cached = readVectorCache(cachePath, tracks.trackCount, dimensions);
    if (cached) {
      return { dimensions, values: cached };
    }
  }

  const values = new Float64Array(tracks.trackCount * dimensions);
  const scale = weights.map((weight) => Math.sqrt(weight));
  const rows = database.query(
    "SELECT track_id, vector_json FROM tracks WHERE vector_json IS NOT NULL AND vector_json != ''",
  ).all() as Array<{ track_id: string; vector_json: string }>;

  let loaded = 0;
  for (const row of rows) {
    const ordinal = tracks.ordinalByTrackId.get(row.track_id);
    if (ordinal === undefined) {
      continue;
    }
    const parsed = JSON.parse(row.vector_json) as number[];
    if (!Array.isArray(parsed) || parsed.length !== dimensions) {
      continue;
    }
    const base = ordinal * dimensions;
    let norm = 0;
    for (let index = 0; index < dimensions; index += 1) {
      const scaled = (parsed[index] ?? 0) * scale[index]!;
      values[base + index] = scaled;
      norm += scaled * scaled;
    }
    if (norm > 0) {
      const inverse = 1 / Math.sqrt(norm);
      for (let index = 0; index < dimensions; index += 1) {
        values[base + index]! *= inverse;
      }
    }
    loaded += 1;
  }

  if (loaded !== tracks.trackCount) {
    throw new Error(
      `Loaded ${loaded} vectors for ${tracks.trackCount} tracks; the export is incomplete and no distance here would be trustworthy.`,
    );
  }

  if (cachePath) {
    writeVectorCache(cachePath, tracks.trackCount, dimensions, values);
  }
  return { dimensions, values };
}

function readVectorCache(cachePath: string, trackCount: number, dimensions: number): Float64Array | null {
  let raw: Buffer;
  try {
    raw = readFileSync(cachePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.debug(`Ignoring unreadable vector cache ${cachePath}: ${(error as Error).message}`);
    }
    return null;
  }
  if (raw.length < 16 || raw.readUInt32LE(0) !== VECTOR_CACHE_MAGIC) {
    console.debug(`Ignoring vector cache ${cachePath}: not a vector cache.`);
    return null;
  }
  if (raw.readUInt32LE(4) !== trackCount || raw.readUInt32LE(8) !== dimensions) {
    console.debug(`Ignoring vector cache ${cachePath}: built for a different corpus or vector width.`);
    return null;
  }
  const expected = trackCount * dimensions * 8;
  if (raw.length !== 16 + expected) {
    console.debug(`Ignoring truncated vector cache ${cachePath}.`);
    return null;
  }
  const values = new Float64Array(trackCount * dimensions);
  Buffer.from(values.buffer).set(raw.subarray(16));
  return values;
}

function writeVectorCache(
  cachePath: string,
  trackCount: number,
  dimensions: number,
  values: Float64Array,
): void {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(VECTOR_CACHE_MAGIC, 0);
  header.writeUInt32LE(trackCount, 4);
  header.writeUInt32LE(dimensions, 8);
  writeFileSync(cachePath, Buffer.concat([header, Buffer.from(values.buffer, values.byteOffset, values.byteLength)]));
}

/** Weighted cosine between two track ordinals, given normalised weighted vectors. */
export function similarityBetween(
  vectors: WeightedVectors,
  left: number,
  right: number,
): number {
  const { dimensions, values } = vectors;
  const leftBase = left * dimensions;
  const rightBase = right * dimensions;
  let total = 0;
  for (let index = 0; index < dimensions; index += 1) {
    total += values[leftBase + index]! * values[rightBase + index]!;
  }
  return total;
}

/** The true nearest neighbour by weighted cosine, by exhaustive scan. */
export function trueNearestNeighbour(vectors: WeightedVectors, query: number, trackCount: number): number {
  let best = -1;
  let bestSimilarity = Number.NEGATIVE_INFINITY;
  for (let candidate = 0; candidate < trackCount; candidate += 1) {
    if (candidate === query) {
      continue;
    }
    const similarity = similarityBetween(vectors, query, candidate);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      best = candidate;
    }
  }
  return best;
}

/** Deterministic 32-bit PRNG, so every sample in these scripts is reproducible. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A deterministic sample of distinct track ordinals. */
export function sampleOrdinals(trackCount: number, size: number, seed: number): Int32Array {
  const random = createRandom(seed);
  const taken = new Set<number>();
  const limit = Math.min(size, trackCount);
  while (taken.size < limit) {
    taken.add(Math.floor(random() * trackCount));
  }
  return Int32Array.from(taken);
}
