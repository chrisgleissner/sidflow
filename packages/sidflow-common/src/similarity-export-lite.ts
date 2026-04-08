import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { writeCanonicalJsonFile } from "./canonical-writer.js";
import { ensureDir } from "./fs.js";
import type { JsonValue } from "./json.js";
import {
  computePortableManifestPath,
  readPortableBundlePayload,
  writePortableBundlePayload,
  type SimilarityBundleContentEncoding,
} from "./similarity-bundle-file.js";
import {
  buildSimilarityTrackId,
  type SimilarityExportRecommendation,
} from "./similarity-export.js";
import { cosineSimilarity } from "./vector-similarity.js";
import {
  computeSimilarityStyleMask,
  packCompactRatings,
  pickRandomRows,
  unpackCompactRatings,
  type PortableRecommendFromFavoritesOptions,
  type SimilarityDataset,
  type SimilarityTrackRow,
} from "./similarity-portable.js";

export const LITE_SIMILARITY_EXPORT_SCHEMA_VERSION = "sidcorr-lite-1";

const MAGIC = "SIDCORR\0";
const FORMAT_VERSION = 1;
const HEADER_BYTES = 32;
const FOOTER_BYTES = 40;
const EPOCH_HEADER_BYTES = 40;
const INDEX_ENTRY_BYTES = 32;
const FLAG_HAS_NEIGHBORS = 1 << 0;

interface SourceTrackRow {
  track_id: string;
  sid_path: string;
  song_index: number;
  vector_json: string | null;
  e: number;
  m: number;
  c: number;
  p: number | null;
  likes: number;
  dislikes: number;
  skips: number;
  plays: number;
  decayed_likes: number;
  decayed_dislikes: number;
  decayed_skips: number;
  decayed_plays: number;
  last_played: string | null;
}

interface LiteTrackRecord extends SimilarityTrackRow {
  vector: number[];
}

export interface DecodedLiteSimilarityExport {
  rows: LiteTrackRecord[];
}

interface LiteHeader {
  vectorDimensions: number;
  fileIdWidth: number;
  songIndexWidth: number;
  pqSubspaces: number;
  pqCentroidsPerSubspace: number;
  clusterCount: number;
  modelFlags: number;
  codebookOffset: number;
  firstEpochOffset: number;
}

interface LiteFooter {
  indexOffset: number;
  indexLength: number;
  epochCount: number;
  fileCount: number;
  trackCount: number;
}

export interface LiteSimilarityExportManifest {
  schema_version: typeof LITE_SIMILARITY_EXPORT_SCHEMA_VERSION;
  generated_at: string;
  corpus_version: string;
  track_count: number;
  file_count: number;
  vector_dimensions: number;
  pq_subspaces: number;
  pq_centroids_per_subspace: number;
  cluster_count: number;
  content_encoding: SimilarityBundleContentEncoding;
  bundle_bytes: number;
  bundle_bytes_uncompressed: number;
  source: {
    sqlite: string;
  };
  paths: {
    bundle: string;
    manifest: string;
  };
  source_checksums: {
    sqlite_sha256: string;
  };
  file_checksums: {
    bundle_sha256: string;
  };
}

export interface BuildLiteSimilarityExportOptions {
  sourceSqlitePath: string;
  outputPath: string;
  manifestPath?: string;
  corpusVersion?: string;
  pqCentroidsPerSubspace?: number;
}

export interface BuildLiteSimilarityExportResult {
  durationMs: number;
  outputPath: string;
  manifestPath: string;
  manifest: LiteSimilarityExportManifest;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeVector(values: number[]): number[] {
  const magnitude = Math.hypot(...values);
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    throw new Error("Encountered invalid similarity vector while building sidcorr-lite-1 export.");
  }
  return values.map((value) => value / magnitude);
}

function computeManifestPath(outputPath: string, explicitPath?: string): string {
  return computePortableManifestPath(outputPath, explicitPath);
}

async function computeFileChecksum(filePath: string): Promise<string> {
  const payload = await readFile(filePath);
  return createHash("sha256").update(payload).digest("hex");
}

function parseSourceVector(row: SourceTrackRow): number[] {
  if (row.vector_json) {
    const parsed = JSON.parse(row.vector_json) as number[];
    if (Array.isArray(parsed) && parsed.length >= 3) {
      return normalizeVector(parsed.slice(0, parsed.length >= 4 ? 4 : 3));
    }
  }
  const values = [row.e, row.m, row.c];
  if (typeof row.p === "number" && Number.isFinite(row.p)) {
    values.push(row.p);
  }
  return normalizeVector(values);
}

function buildScalarCodebooks(vectors: number[][], pqCentroidsPerSubspace: number): number[][] {
  const dimensions = vectors[0]?.length ?? 0;
  const codebooks: number[][] = [];
  for (let dimension = 0; dimension < dimensions; dimension += 1) {
    const sorted = vectors.map((vector) => vector[dimension] ?? 0).sort((left, right) => left - right);
    const centroids: number[] = [];
    for (let centroid = 0; centroid < pqCentroidsPerSubspace; centroid += 1) {
      const start = Math.floor((centroid * sorted.length) / pqCentroidsPerSubspace);
      const end = Math.floor(((centroid + 1) * sorted.length) / pqCentroidsPerSubspace);
      if (sorted.length === 0) {
        centroids.push(0);
        continue;
      }
      if (end <= start) {
        centroids.push(sorted[Math.min(start, sorted.length - 1)] ?? 0);
        continue;
      }
      let total = 0;
      for (let index = start; index < end; index += 1) {
        total += sorted[index] ?? 0;
      }
      centroids.push(total / (end - start));
    }
    codebooks.push(centroids);
  }
  return codebooks;
}

function quantizeVector(vector: number[], codebooks: number[][]): Uint8Array {
  const codes = new Uint8Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    const centroids = codebooks[index] ?? [];
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex += 1) {
      const distance = Math.abs((centroids[centroidIndex] ?? 0) - (vector[index] ?? 0));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = centroidIndex;
      }
    }
    codes[index] = bestIndex;
  }
  return codes;
}

function reconstructVector(codes: Uint8Array | number[], codebooks: number[][]): number[] {
  return normalizeVector(codebooks.map((centroids, index) => centroids[codes[index] ?? 0] ?? 0));
}

function writeUInt24LE(target: Buffer, value: number, offset: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
}

function readUInt24LE(source: Buffer, offset: number): number {
  return source[offset]! | (source[offset + 1]! << 8) | (source[offset + 2]! << 16);
}

function scoreRows(
  rows: LiteTrackRecord[],
  favoriteTrackIds: string[],
  weightsByTrackId: Record<string, number>,
  excludeTrackIds: Set<string>,
  limit: number,
): SimilarityExportRecommendation[] {
  const favoriteRows = favoriteTrackIds
    .map((trackId) => rows.find((row) => row.track_id === trackId) ?? null)
    .filter((row): row is LiteTrackRecord => row !== null);
  if (favoriteRows.length === 0) {
    return [];
  }

  const centroid = new Array(favoriteRows[0]!.vector.length).fill(0);
  let totalWeight = 0;
  for (const row of favoriteRows) {
    const weight = weightsByTrackId[row.track_id] ?? 1;
    totalWeight += weight;
    for (let index = 0; index < row.vector.length; index += 1) {
      centroid[index] += (row.vector[index] ?? 0) * weight;
    }
  }
  const normalizedCentroid = normalizeVector(centroid.map((value) => value / Math.max(totalWeight, 1)));

  return rows
    .filter((row) => !favoriteTrackIds.includes(row.track_id) && !excludeTrackIds.has(row.track_id))
    .map((row) => ({ row, score: cosineSimilarity(normalizedCentroid, row.vector) }))
    .sort((left, right) => right.score - left.score || left.row.track_id.localeCompare(right.row.track_id))
    .slice(0, limit)
    .map(({ row, score }, index) => ({
      track_id: row.track_id,
      sid_path: row.sid_path,
      song_index: row.song_index,
      score,
      rank: index + 1,
      e: row.e,
      m: row.m,
      c: row.c,
      p: row.p ?? undefined,
      likes: row.likes,
      dislikes: row.dislikes,
      skips: row.skips,
      plays: row.plays,
      decayed_likes: row.decayed_likes,
      decayed_dislikes: row.decayed_dislikes,
      decayed_skips: row.decayed_skips,
      decayed_plays: row.decayed_plays,
      last_played: row.last_played ?? undefined,
    }));
}

function cloneTrackRow(row: LiteTrackRecord): SimilarityTrackRow {
  return {
    track_id: row.track_id,
    sid_path: row.sid_path,
    song_index: row.song_index,
    e: row.e,
    m: row.m,
    c: row.c,
    p: row.p,
    likes: row.likes,
    dislikes: row.dislikes,
    skips: row.skips,
    plays: row.plays,
    decayed_likes: row.decayed_likes,
    decayed_dislikes: row.decayed_dislikes,
    decayed_skips: row.decayed_skips,
    decayed_plays: row.decayed_plays,
    last_played: row.last_played,
  };
}

function buildDataset(sourcePath: string, rows: LiteTrackRecord[]): SimilarityDataset {
  const rowsByTrackId = new Map(rows.map((row) => [row.track_id, row]));
  return {
    info: {
      format: "lite",
      schemaVersion: LITE_SIMILARITY_EXPORT_SCHEMA_VERSION,
      sourcePath,
      trackCount: rows.length,
      hasTrackIdentity: true,
      hasVectorData: true,
    },
    readRandomTracksExcluding(limit, excludedTrackIds, random) {
      return pickRandomRows(rows, limit, excludedTrackIds, random).map(cloneTrackRow);
    },
    resolveTracks(trackIds) {
      return new Map(trackIds.flatMap((trackId) => {
        const row = rowsByTrackId.get(trackId);
        return row ? [[trackId, cloneTrackRow(row)]] : [];
      }));
    },
    resolveTrack(trackId) {
      const row = rowsByTrackId.get(trackId);
      return row ? cloneTrackRow(row) : null;
    },
    getTrackVectors(trackIds) {
      return new Map(trackIds.flatMap((trackId) => {
        const row = rowsByTrackId.get(trackId);
        return row ? [[trackId, [...row.vector]]] : [];
      }));
    },
    getNeighbors(trackId, limit = 20, excludeTrackIds = []) {
      return scoreRows(rows, [trackId], {}, new Set(excludeTrackIds), Math.max(1, limit));
    },
    getStyleMask(trackId) {
      const row = rowsByTrackId.get(trackId);
      return row ? computeSimilarityStyleMask(row) : null;
    },
    recommendFromFavorites(options) {
      return scoreRows(
        rows,
        options.favoriteTrackIds,
        options.weightsByTrackId ?? {},
        new Set(options.excludeTrackIds ?? []),
        Math.max(1, options.limit ?? 100),
      );
    },
  };
}

export async function buildLiteSimilarityExport(
  options: BuildLiteSimilarityExportOptions,
): Promise<BuildLiteSimilarityExportResult> {
  const startedAt = Date.now();
  const database = new Database(options.sourceSqlitePath, { readonly: true, strict: true });
  try {
    const rows = database.query(`
      SELECT
        track_id,
        sid_path,
        song_index,
        vector_json,
        e,
        m,
        c,
        p,
        likes,
        dislikes,
        skips,
        plays,
        COALESCE(decayed_likes, 0) AS decayed_likes,
        COALESCE(decayed_dislikes, 0) AS decayed_dislikes,
        COALESCE(decayed_skips, 0) AS decayed_skips,
        COALESCE(decayed_plays, 0) AS decayed_plays,
        last_played
      FROM tracks
      ORDER BY sid_path ASC, song_index ASC
    `).all() as SourceTrackRow[];

    if (rows.length === 0) {
      throw new Error("Cannot build sidcorr-lite-1 export from an empty SQLite similarity export.");
    }

    const vectors = rows.map(parseSourceVector);
    const vectorDimensions = vectors[0]!.length;
    const pqCentroidsPerSubspace = clamp(options.pqCentroidsPerSubspace ?? 256, 2, 256);
    const codebooks = buildScalarCodebooks(vectors, pqCentroidsPerSubspace);
    const clusterPrototype = normalizeVector(
      new Array(vectorDimensions)
        .fill(0)
        .map((_, dimension) => vectors.reduce((total, vector) => total + (vector[dimension] ?? 0), 0) / vectors.length),
    );

    const orderedFilePaths = [...new Set(rows.map((row) => row.sid_path))].sort((left, right) => left.localeCompare(right));
    const fileIdByPath = new Map(orderedFilePaths.map((sidPath, index) => [sidPath, index]));
    const fileIdWidth = orderedFilePaths.length <= 0xffff ? 2 : 3;
    const songIndexWidth = rows.every((row) => row.song_index >= 0 && row.song_index <= 0xff) ? 1 : 2;
    const trackRowBytes = fileIdWidth + songIndexWidth + 2 + vectorDimensions;

    const codebookBuffer = Buffer.alloc(4 + (vectorDimensions * pqCentroidsPerSubspace * 4));
    codebookBuffer.writeUInt16LE(vectorDimensions, 0);
    codebookBuffer.writeUInt16LE(pqCentroidsPerSubspace, 2);
    let cursor = 4;
    for (const centroids of codebooks) {
      for (const centroid of centroids) {
        codebookBuffer.writeFloatLE(centroid, cursor);
        cursor += 4;
      }
    }

    const clusterBuffer = Buffer.alloc(4 + (vectorDimensions * 4));
    clusterBuffer.writeUInt16LE(1, 0);
    clusterBuffer.writeUInt16LE(vectorDimensions, 2);
    cursor = 4;
    for (const value of clusterPrototype) {
      clusterBuffer.writeFloatLE(value, cursor);
      cursor += 4;
    }

    const epochHeader = Buffer.alloc(EPOCH_HEADER_BYTES);
    const fileDictionaryBytes = orderedFilePaths.reduce((total, sidPath) => total + 2 + Buffer.byteLength(sidPath), 0);
    const trackTableBytes = rows.length * trackRowBytes;
    epochHeader.writeUInt32LE(rows.length, 0);
    epochHeader.writeUInt32LE(orderedFilePaths.length, 4);
    epochHeader.writeUInt32LE(fileDictionaryBytes, 8);
    epochHeader.writeUInt32LE(trackTableBytes, 12);
    epochHeader.writeUInt32LE(0, 16);
    epochHeader.writeUInt32LE(0, 20);
    epochHeader.writeUInt32LE(0, 24);
    epochHeader.writeUInt32LE(0, 28);
    epochHeader.writeUInt32LE(0, 32);
    epochHeader.writeUInt32LE(0, 36);

    const fileDictionary = Buffer.alloc(fileDictionaryBytes);
    cursor = 0;
    for (const sidPath of orderedFilePaths) {
      const utf8 = Buffer.from(sidPath, "utf8");
      fileDictionary.writeUInt16LE(utf8.length, cursor);
      cursor += 2;
      utf8.copy(fileDictionary, cursor);
      cursor += utf8.length;
    }

    const trackTable = Buffer.alloc(trackTableBytes);
    cursor = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const fileId = fileIdByPath.get(row.sid_path);
      if (fileId === undefined) {
        throw new Error(`sidcorr-lite-1 build lost file mapping for ${row.sid_path}`);
      }
      if (fileIdWidth === 2) {
        trackTable.writeUInt16LE(fileId, cursor);
      } else {
        writeUInt24LE(trackTable, fileId, cursor);
      }
      cursor += fileIdWidth;
      if (songIndexWidth === 1) {
        trackTable.writeUInt8(row.song_index, cursor);
      } else {
        trackTable.writeUInt16LE(row.song_index, cursor);
      }
      cursor += songIndexWidth;
      trackTable.writeUInt16LE(packCompactRatings(row), cursor);
      cursor += 2;
      const codes = quantizeVector(vectors[index]!, codebooks);
      Buffer.from(codes).copy(trackTable, cursor);
      cursor += vectorDimensions;
    }

    const header = Buffer.alloc(HEADER_BYTES);
    header.write(MAGIC, 0, "ascii");
    header.writeUInt16LE(FORMAT_VERSION, 8);
    header.writeUInt16LE(HEADER_BYTES, 10);
    header.writeUInt16LE(vectorDimensions, 12);
    header.writeUInt8(fileIdWidth, 14);
    header.writeUInt8(songIndexWidth, 15);
    header.writeUInt16LE(vectorDimensions, 16);
    header.writeUInt16LE(pqCentroidsPerSubspace, 18);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(0, 22);
    header.writeUInt32LE(HEADER_BYTES, 24);
    header.writeUInt32LE(HEADER_BYTES + codebookBuffer.length, 28);

    const firstEpochOffset = HEADER_BYTES + codebookBuffer.length + clusterBuffer.length;
    const headerWithEpoch = Buffer.from(header);
    headerWithEpoch.writeUInt32LE(firstEpochOffset, 28);

    const indexBuffer = Buffer.alloc(INDEX_ENTRY_BYTES);
    indexBuffer.writeBigUInt64LE(BigInt(firstEpochOffset), 0);
    indexBuffer.writeBigUInt64LE(BigInt(EPOCH_HEADER_BYTES + fileDictionaryBytes + trackTableBytes), 8);
    indexBuffer.writeUInt32LE(0, 16);
    indexBuffer.writeUInt32LE(rows.length, 20);
    indexBuffer.writeUInt32LE(orderedFilePaths.length, 24);
    indexBuffer.writeUInt32LE(0, 28);

    const indexOffset = firstEpochOffset + EPOCH_HEADER_BYTES + fileDictionaryBytes + trackTableBytes;
    const footer = Buffer.alloc(FOOTER_BYTES);
    footer.writeBigUInt64LE(BigInt(indexOffset), 0);
    footer.writeBigUInt64LE(BigInt(indexBuffer.length), 8);
    footer.writeUInt32LE(1, 16);
    footer.writeUInt32LE(orderedFilePaths.length, 20);
    footer.writeUInt32LE(rows.length, 24);
    footer.writeUInt32LE(0, 28);
    footer.writeUInt32LE(0, 32);
    footer.writeUInt32LE(0, 36);

    const rawPayload = Buffer.concat([
      headerWithEpoch,
      codebookBuffer,
      clusterBuffer,
      epochHeader,
      fileDictionary,
      trackTable,
      indexBuffer,
      footer,
    ]);
    const writeResult = await writePortableBundlePayload(options.outputPath, rawPayload);

    const manifestPath = computeManifestPath(options.outputPath, options.manifestPath);
    const sourceChecksum = await computeFileChecksum(options.sourceSqlitePath);
    const bundleChecksum = await computeFileChecksum(options.outputPath);
    const manifest: LiteSimilarityExportManifest = {
      schema_version: LITE_SIMILARITY_EXPORT_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      corpus_version: options.corpusVersion ?? path.basename(options.sourceSqlitePath, path.extname(options.sourceSqlitePath)),
      track_count: rows.length,
      file_count: orderedFilePaths.length,
      vector_dimensions: vectorDimensions,
      pq_subspaces: vectorDimensions,
      pq_centroids_per_subspace: pqCentroidsPerSubspace,
      cluster_count: 1,
      content_encoding: writeResult.contentEncoding,
      bundle_bytes: writeResult.bytesWritten,
      bundle_bytes_uncompressed: writeResult.bytesUncompressed,
      source: {
        sqlite: path.basename(options.sourceSqlitePath),
      },
      paths: {
        bundle: path.basename(options.outputPath),
        manifest: path.basename(manifestPath),
      },
      source_checksums: {
        sqlite_sha256: sourceChecksum,
      },
      file_checksums: {
        bundle_sha256: bundleChecksum,
      },
    };
    await writeCanonicalJsonFile(manifestPath, manifest as unknown as JsonValue, {
      action: "data:modify",
    });

    return {
      durationMs: Date.now() - startedAt,
      outputPath: options.outputPath,
      manifestPath,
      manifest,
    };
  } finally {
    database.close();
  }
}

function parseHeader(payload: Buffer): LiteHeader {
  if (payload.length < HEADER_BYTES + FOOTER_BYTES) {
    throw new Error("sidcorr-lite-1 bundle is truncated.");
  }
  if (payload.subarray(0, 8).toString("ascii") !== MAGIC) {
    throw new Error("Bundle is not a sidcorr-lite-1 export.");
  }
  return {
    vectorDimensions: payload.readUInt16LE(12),
    fileIdWidth: payload.readUInt8(14),
    songIndexWidth: payload.readUInt8(15),
    pqSubspaces: payload.readUInt16LE(16),
    pqCentroidsPerSubspace: payload.readUInt16LE(18),
    clusterCount: payload.readUInt16LE(20),
    modelFlags: payload.readUInt16LE(22),
    codebookOffset: payload.readUInt32LE(24),
    firstEpochOffset: payload.readUInt32LE(28),
  };
}

function parseFooter(payload: Buffer): LiteFooter {
  const start = payload.length - FOOTER_BYTES;
  return {
    indexOffset: Number(payload.readBigUInt64LE(start)),
    indexLength: Number(payload.readBigUInt64LE(start + 8)),
    epochCount: payload.readUInt32LE(start + 16),
    fileCount: payload.readUInt32LE(start + 20),
    trackCount: payload.readUInt32LE(start + 24),
  };
}

export async function decodeLiteSimilarityExport(filePath: string): Promise<DecodedLiteSimilarityExport> {
  const { payload } = await readPortableBundlePayload(filePath);
  const header = parseHeader(payload);
  const footer = parseFooter(payload);
  const codebookCount = header.vectorDimensions * header.pqCentroidsPerSubspace;
  const codebookBuffer = payload.subarray(HEADER_BYTES, HEADER_BYTES + 4 + (codebookCount * 4));
  const codebooks: number[][] = [];
  let cursor = 4;
  for (let dimension = 0; dimension < header.vectorDimensions; dimension += 1) {
    const centroids: number[] = [];
    for (let centroid = 0; centroid < header.pqCentroidsPerSubspace; centroid += 1) {
      centroids.push(codebookBuffer.readFloatLE(cursor));
      cursor += 4;
    }
    codebooks.push(centroids);
  }

  const epochOffset = payload.readBigUInt64LE(footer.indexOffset);
  const epochStart = Number(epochOffset);
  const trackCount = payload.readUInt32LE(epochStart);
  const fileCount = payload.readUInt32LE(epochStart + 4);
  const fileDictionaryBytes = payload.readUInt32LE(epochStart + 8);
  const trackTableBytes = payload.readUInt32LE(epochStart + 12);
  const fileDictionaryStart = epochStart + EPOCH_HEADER_BYTES;
  const fileDictionaryEnd = fileDictionaryStart + fileDictionaryBytes;
  const trackTableStart = fileDictionaryEnd;

  const filePaths: string[] = [];
  cursor = fileDictionaryStart;
  while (cursor < fileDictionaryEnd) {
    const utf8Length = payload.readUInt16LE(cursor);
    cursor += 2;
    filePaths.push(payload.subarray(cursor, cursor + utf8Length).toString("utf8"));
    cursor += utf8Length;
  }

  const trackRowBytes = header.fileIdWidth + header.songIndexWidth + 2 + header.vectorDimensions;
  if (trackTableBytes !== trackCount * trackRowBytes) {
    throw new Error("sidcorr-lite-1 track table size does not match header metadata.");
  }

  const rows: LiteTrackRecord[] = [];
  cursor = trackTableStart;
  for (let index = 0; index < trackCount; index += 1) {
    const fileId = header.fileIdWidth === 2 ? payload.readUInt16LE(cursor) : readUInt24LE(payload, cursor);
    cursor += header.fileIdWidth;
    const songIndex = header.songIndexWidth === 1 ? payload.readUInt8(cursor) : payload.readUInt16LE(cursor);
    cursor += header.songIndexWidth;
    const ratings = unpackCompactRatings(payload.readUInt16LE(cursor));
    cursor += 2;
    const codes = [...payload.subarray(cursor, cursor + header.vectorDimensions)];
    cursor += header.vectorDimensions;
    const vector = reconstructVector(codes, codebooks);
    rows.push({
      track_id: buildSimilarityTrackId(filePaths[fileId] ?? `missing-${fileId}`, songIndex),
      sid_path: filePaths[fileId] ?? `missing-${fileId}`,
      song_index: songIndex,
      e: ratings.e,
      m: ratings.m,
      c: ratings.c,
      p: ratings.p,
      likes: 0,
      dislikes: 0,
      skips: 0,
      plays: 0,
      decayed_likes: 0,
      decayed_dislikes: 0,
      decayed_skips: 0,
      decayed_plays: 0,
      last_played: null,
      vector,
    });
  }

  if (fileCount !== filePaths.length || footer.trackCount !== rows.length) {
    throw new Error("sidcorr-lite-1 footer metadata does not match decoded content.");
  }

  return { rows };
}

export async function openLiteSimilarityDataset(filePath: string): Promise<SimilarityDataset> {
  const decoded = await decodeLiteSimilarityExport(filePath);

  return buildDataset(filePath, decoded.rows);
}