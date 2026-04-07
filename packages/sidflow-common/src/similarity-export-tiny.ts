import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { PERSONA_IDS, PERSONAS } from "./persona.js";
import { scoreAllPersonas } from "./persona-scorer.js";
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
import type {
  PortableSimilarityDataset,
  PortableSimilarityTrackRow,
} from "./similarity-portable.js";

export const TINY_SIMILARITY_EXPORT_SCHEMA_VERSION = "sidcorr-tiny-1";

const MAGIC = "SIDTINY1";
const HEADER_BYTES = 64;
const EMPTY_NEIGHBOR = 0xffffff;
const STYLE_MASK_WIDTH_BYTES = 2;
const NEIGHBORS_PER_TRACK = 3;
const STYLE_TABLE_VERSION = 1;

interface SourceTrackRow {
  track_id: string;
  sid_path: string;
  song_index: number;
  vector_json: string | null;
  e: number;
  m: number;
  c: number;
  p: number | null;
}

interface TinyTrackRecord extends PortableSimilarityTrackRow {
  neighbors: Array<{ trackOrdinal: number; similarity: number }>;
}

export interface TinySimilarityExportManifest {
  schema_version: typeof TINY_SIMILARITY_EXPORT_SCHEMA_VERSION;
  generated_at: string;
  corpus_version: string;
  track_count: number;
  file_count: number;
  style_count: number;
  file_id_kind: "md5_48";
  neighbors_per_track: 3;
  content_encoding: SimilarityBundleContentEncoding;
  bundle_bytes: number;
  bundle_bytes_uncompressed: number;
  paths: {
    bundle: string;
    manifest: string;
  };
  source: {
    sqlite: string;
    hvsc_root: string;
  };
  source_checksums: {
    sqlite_sha256: string;
  };
  file_checksums: {
    bundle_sha256: string;
  };
}

export interface BuildTinySimilarityExportOptions {
  sourceSqlitePath: string;
  hvscRoot: string;
  outputPath: string;
  manifestPath?: string;
  corpusVersion?: string;
}

export interface BuildTinySimilarityExportResult {
  durationMs: number;
  outputPath: string;
  manifestPath: string;
  manifest: TinySimilarityExportManifest;
}

export interface OpenTinySimilarityDatasetOptions {
  hvscRoot?: string;
}

function normalizeVector(values: number[]): number[] {
  const magnitude = Math.hypot(...values);
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    throw new Error("Encountered invalid similarity vector while building sidcorr-tiny-1 export.");
  }
  return values.map((value) => value / magnitude);
}

function cosine(left: number[], right: number[]): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return total;
}

async function computeFileChecksum(filePath: string): Promise<string> {
  const payload = await readFile(filePath);
  return createHash("sha256").update(payload).digest("hex");
}

function computeManifestPath(outputPath: string, explicitPath?: string): string {
  return computePortableManifestPath(outputPath, explicitPath);
}

function writeUInt24LE(target: Buffer, value: number, offset: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
}

function readUInt24LE(source: Buffer, offset: number): number {
  return source[offset]! | (source[offset + 1]! << 8) | (source[offset + 2]! << 16);
}

function writeUInt48LE(target: Buffer, value: Buffer, offset: number): void {
  value.copy(target, offset, 0, 6);
}

function parseVector(row: SourceTrackRow): number[] {
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

async function computeMd548(hvscRoot: string, sidPath: string): Promise<Buffer> {
  const absolutePath = path.resolve(hvscRoot, sidPath);
  const payload = await readFile(absolutePath);
  return createHash("md5").update(payload).digest().subarray(0, 6);
}

async function buildMd548PathMap(hvscRoot: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const queue = [hvscRoot];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".sid")) {
        continue;
      }
      const relativePath = path.relative(hvscRoot, absolutePath).replace(/\\/g, "/");
      const md548 = await computeMd548(hvscRoot, relativePath);
      result.set(md548.toString("hex"), relativePath);
    }
  }
  return result;
}

function buildStyleMask(row: SourceTrackRow): number {
  const scores = scoreAllPersonas({
    metrics: {
      melodicComplexity: 0.5,
      rhythmicDensity: 0.5,
      timbralRichness: 0.5,
      nostalgiaBias: 0.5,
      experimentalTolerance: 0.5,
    },
    ratings: { e: row.e, m: row.m, c: row.c },
  });
  const ranked = PERSONA_IDS
    .map((personaId) => ({ personaId, score: scores[personaId] }))
    .sort((left, right) => right.score - left.score || left.personaId.localeCompare(right.personaId))
    .slice(0, 3);
  let mask = 0;
  for (const entry of ranked) {
    const bit = PERSONA_IDS.indexOf(entry.personaId);
    if (bit >= 0) {
      mask |= (1 << bit);
    }
  }
  return mask;
}

function encodeSimilarity(similarity: number): number {
  return Math.max(0, Math.min(255, Math.round(((similarity + 1) / 2) * 255)));
}

function decodeSimilarity(value: number): number {
  return ((value / 255) * 2) - 1;
}

function buildStyleTable(): Buffer {
  const records: Buffer[] = [];
  const payloads: Buffer[] = [];
  let payloadOffset = 0;
  for (let index = 0; index < PERSONA_IDS.length; index += 1) {
    const persona = PERSONAS[PERSONA_IDS[index]!];
    const keyBuffer = Buffer.from(persona.id, "utf8");
    const labelBuffer = Buffer.from(persona.label, "utf8");
    const configBuffer = Buffer.from(JSON.stringify({ ratingTargets: persona.ratingTargets, kind: persona.kind }), "utf8");
    const record = Buffer.alloc(28);
    record.writeUInt8(index, 0);
    record.writeUInt8(index, 1);
    record.writeUInt8(persona.kind === "audio" ? 0 : 2, 2);
    record.writeUInt8(persona.kind === "audio" ? 0 : 3, 3);
    record.writeUInt32LE(0, 4);
    record.writeUInt32LE(payloadOffset, 8);
    record.writeUInt16LE(keyBuffer.length, 12);
    payloadOffset += keyBuffer.length;
    record.writeUInt32LE(payloadOffset, 14);
    record.writeUInt16LE(labelBuffer.length, 18);
    payloadOffset += labelBuffer.length;
    record.writeUInt32LE(payloadOffset, 20);
    record.writeUInt16LE(configBuffer.length, 24);
    record.writeUInt16LE(0, 26);
    payloadOffset += configBuffer.length;
    records.push(record);
    payloads.push(keyBuffer, labelBuffer, configBuffer);
  }

  const sectionHeader = Buffer.alloc(12);
  sectionHeader.writeUInt16LE(STYLE_TABLE_VERSION, 0);
  sectionHeader.writeUInt16LE(PERSONA_IDS.length, 2);
  sectionHeader.writeUInt16LE(28, 4);
  sectionHeader.writeUInt16LE(0, 6);
  sectionHeader.writeUInt32LE(payloadOffset, 8);
  return Buffer.concat([sectionHeader, ...records, ...payloads]);
}

function buildNeighborGraph(rows: SourceTrackRow[], vectors: number[][], database: Database): Array<Array<{ trackOrdinal: number; similarity: number }>> {
  const ordinalByTrackId = new Map(rows.map((row, index) => [row.track_id, index]));
  const neighborsBySeed = new Map<number, Array<{ trackOrdinal: number; similarity: number }>>();
  try {
    const existingNeighbors = database.query(`
      SELECT seed_track_id, neighbor_track_id, rank, similarity
      FROM neighbors
      WHERE profile = 'full'
      ORDER BY seed_track_id ASC, rank ASC
    `).all() as Array<{ seed_track_id: string; neighbor_track_id: string; rank: number; similarity: number }>;
    if (existingNeighbors.length > 0) {
      for (const neighbor of existingNeighbors) {
        const seedOrdinal = ordinalByTrackId.get(neighbor.seed_track_id);
        const targetOrdinal = ordinalByTrackId.get(neighbor.neighbor_track_id);
        if (seedOrdinal === undefined || targetOrdinal === undefined || targetOrdinal <= seedOrdinal) {
          continue;
        }
        const arr = neighborsBySeed.get(seedOrdinal) ?? [];
        if (arr.length < NEIGHBORS_PER_TRACK) {
          arr.push({ trackOrdinal: targetOrdinal, similarity: neighbor.similarity });
        }
        neighborsBySeed.set(seedOrdinal, arr);
      }
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
  }

  if (neighborsBySeed.size === rows.length) {
    return rows.map((_, index) => neighborsBySeed.get(index) ?? []);
  }

  if (rows.length > 5000) {
    throw new Error(
      "sidcorr-tiny-1 generation needs a full export with precomputed neighbors when converting large corpora.",
    );
  }

  return rows.map((_, seedOrdinal) => {
    const scores: Array<{ trackOrdinal: number; similarity: number }> = [];
    for (let candidateOrdinal = seedOrdinal + 1; candidateOrdinal < rows.length; candidateOrdinal += 1) {
      scores.push({
        trackOrdinal: candidateOrdinal,
        similarity: cosine(vectors[seedOrdinal]!, vectors[candidateOrdinal]!),
      });
    }
    return scores
      .sort((left, right) => right.similarity - left.similarity || left.trackOrdinal - right.trackOrdinal)
      .slice(0, NEIGHBORS_PER_TRACK);
  });
}

export async function buildTinySimilarityExport(
  options: BuildTinySimilarityExportOptions,
): Promise<BuildTinySimilarityExportResult> {
  const startedAt = Date.now();
  const database = new Database(options.sourceSqlitePath, { readonly: true, strict: true });
  try {
    const rows = database.query(`
      SELECT track_id, sid_path, song_index, vector_json, e, m, c, p
      FROM tracks
      ORDER BY sid_path ASC, song_index ASC
    `).all() as SourceTrackRow[];
    if (rows.length === 0) {
      throw new Error("Cannot build sidcorr-tiny-1 export from an empty SQLite similarity export.");
    }

    const filePaths = [...new Set(rows.map((row) => row.sid_path))];
    const vectors = rows.map(parseVector);
    const styleTable = buildStyleTable();
    const fileIdentityTable = Buffer.alloc(filePaths.length * 6);
    for (let index = 0; index < filePaths.length; index += 1) {
      const md548 = await computeMd548(options.hvscRoot, filePaths[index]!);
      writeUInt48LE(fileIdentityTable, md548, index * 6);
    }

    const fileTrackCountTable = Buffer.alloc(filePaths.length);
    for (let fileIndex = 0; fileIndex < filePaths.length; fileIndex += 1) {
      const count = rows.filter((row) => row.sid_path === filePaths[fileIndex]).length;
      fileTrackCountTable.writeUInt8(Math.max(0, count - 1), fileIndex);
    }

    const styleMaskTable = Buffer.alloc(rows.length * STYLE_MASK_WIDTH_BYTES);
    for (let index = 0; index < rows.length; index += 1) {
      styleMaskTable.writeUInt16LE(buildStyleMask(rows[index]!), index * STYLE_MASK_WIDTH_BYTES);
    }

    const neighbors = buildNeighborGraph(rows, vectors, database);
    const neighborTable = Buffer.alloc(rows.length * NEIGHBORS_PER_TRACK * 3);
    for (let index = 0; index < rows.length; index += 1) {
      const rowNeighbors = neighbors[index] ?? [];
      for (let neighborIndex = 0; neighborIndex < NEIGHBORS_PER_TRACK; neighborIndex += 1) {
        const encoded = rowNeighbors[neighborIndex]?.trackOrdinal ?? EMPTY_NEIGHBOR;
        writeUInt24LE(neighborTable, encoded, (index * NEIGHBORS_PER_TRACK * 3) + (neighborIndex * 3));
      }
    }

    const styleTableOffset = HEADER_BYTES;
    const fileIdentityOffset = styleTableOffset + styleTable.length;
    const fileTrackCountOffset = fileIdentityOffset + fileIdentityTable.length;
    const styleMaskOffset = fileTrackCountOffset + fileTrackCountTable.length;
    const neighborsOffset = styleMaskOffset + styleMaskTable.length;

    const header = Buffer.alloc(HEADER_BYTES);
    header.write(MAGIC, 0, "ascii");
    header.writeUInt16LE(1, 8);
    header.writeUInt16LE(HEADER_BYTES, 10);
    header.writeUInt32LE(rows.length, 12);
    header.writeUInt32LE(filePaths.length, 16);
    header.writeUInt16LE(PERSONA_IDS.length, 20);
    header.writeUInt16LE(NEIGHBORS_PER_TRACK, 22);
    header.writeUInt8(1, 24);
    header.writeUInt8(3, 25);
    header.writeUInt8(1, 26);
    header.writeUInt8(STYLE_MASK_WIDTH_BYTES, 27);
    header.writeUInt16LE(STYLE_TABLE_VERSION, 28);
    header.writeUInt16LE(1, 30);
    header.writeUInt32LE(styleTableOffset, 32);
    header.writeUInt32LE(fileIdentityOffset, 36);
    header.writeUInt32LE(fileTrackCountOffset, 40);
    header.writeUInt32LE(styleMaskOffset, 44);
    header.writeUInt32LE(neighborsOffset, 48);
    header.writeUInt32LE(styleTable.length, 52);
    header.writeUInt32LE(fileIdentityTable.length, 56);
    header.writeUInt32LE(neighborTable.length, 60);

    const rawPayload = Buffer.concat([
      header,
      styleTable,
      fileIdentityTable,
      fileTrackCountTable,
      styleMaskTable,
      neighborTable,
    ]);
    const writeResult = await writePortableBundlePayload(options.outputPath, rawPayload);

    const manifestPath = computeManifestPath(options.outputPath, options.manifestPath);
    const sourceChecksum = await computeFileChecksum(options.sourceSqlitePath);
    const bundleChecksum = await computeFileChecksum(options.outputPath);
    const manifest: TinySimilarityExportManifest = {
      schema_version: TINY_SIMILARITY_EXPORT_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      corpus_version: options.corpusVersion ?? path.basename(options.sourceSqlitePath, path.extname(options.sourceSqlitePath)),
      track_count: rows.length,
      file_count: filePaths.length,
      style_count: PERSONA_IDS.length,
      file_id_kind: "md5_48",
      neighbors_per_track: 3,
      content_encoding: writeResult.contentEncoding,
      bundle_bytes: writeResult.bytesWritten,
      bundle_bytes_uncompressed: writeResult.bytesUncompressed,
      paths: {
        bundle: path.basename(options.outputPath),
        manifest: path.basename(manifestPath),
      },
      source: {
        sqlite: path.basename(options.sourceSqlitePath),
        hvsc_root: options.hvscRoot,
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

export async function openTinySimilarityDataset(
  filePath: string,
  options: OpenTinySimilarityDatasetOptions = {},
): Promise<PortableSimilarityDataset> {
  const { payload } = await readPortableBundlePayload(filePath);
  if (payload.subarray(0, 8).toString("ascii") !== MAGIC) {
    throw new Error("Bundle is not a sidcorr-tiny-1 export.");
  }

  const trackCount = payload.readUInt32LE(12);
  const fileCount = payload.readUInt32LE(16);
  const styleCount = payload.readUInt16LE(20);
  const fileIdentityOffset = payload.readUInt32LE(36);
  const fileTrackCountOffset = payload.readUInt32LE(40);
  const styleMaskOffset = payload.readUInt32LE(44);
  const neighborsOffset = payload.readUInt32LE(48);
  const styleTableOffset = payload.readUInt32LE(32);
  const fileIdentityBytes = payload.readUInt32LE(56);
  const neighborsBytes = payload.readUInt32LE(60);
  const fileTrackCountBytes = fileCount;
  const styleMaskBytes = trackCount * STYLE_MASK_WIDTH_BYTES;
  const styleTableLength = fileIdentityOffset - styleTableOffset;
  const styleTable = payload.subarray(styleTableOffset, styleTableOffset + styleTableLength);
  const styleRecordBytes = styleTable.readUInt16LE(4);
  const payloadBytes = styleTable.readUInt32LE(8);
  const styleRecordStart = 12;
  const stylePayloadStart = styleRecordStart + (styleRecordBytes * styleCount);
  const stylePayload = styleTable.subarray(stylePayloadStart, stylePayloadStart + payloadBytes);
  const styleKeys: string[] = [];
  for (let index = 0; index < styleCount; index += 1) {
    const recordStart = styleRecordStart + (index * styleRecordBytes);
    const keyOffset = styleTable.readUInt32LE(recordStart + 8);
    const keyLength = styleTable.readUInt16LE(recordStart + 12);
    styleKeys.push(stylePayload.subarray(keyOffset, keyOffset + keyLength).toString("utf8"));
  }
  void styleKeys;

  const fileIdentities = payload.subarray(fileIdentityOffset, fileIdentityOffset + fileIdentityBytes);
  const fileTrackCountTable = payload.subarray(fileTrackCountOffset, fileTrackCountOffset + fileTrackCountBytes);
  const styleMaskTable = payload.subarray(styleMaskOffset, styleMaskOffset + styleMaskBytes);
  const neighborTable = payload.subarray(neighborsOffset, neighborsOffset + neighborsBytes);
  void fileIdentities;
  void styleMaskTable;

  const md548ByFileOrdinal: string[] = [];
  for (let index = 0; index < fileCount; index += 1) {
    md548ByFileOrdinal.push(fileIdentities.subarray(index * 6, (index + 1) * 6).toString("hex"));
  }
  const pathByMd548 = options.hvscRoot ? await buildMd548PathMap(options.hvscRoot) : new Map<string, string>();

  const fileTrackStarts: number[] = [];
  let runningStart = 0;
  for (let index = 0; index < fileTrackCountTable.length; index += 1) {
    fileTrackStarts.push(runningStart);
    runningStart += fileTrackCountTable.readUInt8(index) + 1;
  }

  const rows: TinyTrackRecord[] = [];
  for (let trackOrdinal = 0; trackOrdinal < trackCount; trackOrdinal += 1) {
    let fileOrdinal = fileTrackStarts.findIndex((start, index) => {
      const nextStart = fileTrackStarts[index + 1] ?? Number.POSITIVE_INFINITY;
      return trackOrdinal >= start && trackOrdinal < nextStart;
    });
    if (fileOrdinal < 0) {
      fileOrdinal = Math.max(0, fileTrackStarts.length - 1);
    }
    const start = fileTrackStarts[fileOrdinal] ?? 0;
    const songIndex = (trackOrdinal - start) + 1;
    const sidPath = pathByMd548.get(md548ByFileOrdinal[fileOrdinal] ?? "")
      ?? `md5_48:${md548ByFileOrdinal[fileOrdinal] ?? fileOrdinal.toString(16)}`;
    const neighbors: Array<{ trackOrdinal: number; similarity: number }> = [];
    for (let neighborIndex = 0; neighborIndex < NEIGHBORS_PER_TRACK; neighborIndex += 1) {
      const value = readUInt24LE(neighborTable, (trackOrdinal * NEIGHBORS_PER_TRACK * 3) + (neighborIndex * 3));
      if (value === EMPTY_NEIGHBOR || value >= trackCount) {
        continue;
      }
      neighbors.push({ trackOrdinal: value, similarity: 0.8 - (neighborIndex * 0.05) });
    }
    rows.push({
      track_id: buildSimilarityTrackId(sidPath, songIndex),
      sid_path: sidPath,
      song_index: songIndex,
      e: 3,
      m: 3,
      c: 3,
      p: null,
      likes: 0,
      dislikes: 0,
      skips: 0,
      plays: 0,
      decayed_likes: 0,
      decayed_dislikes: 0,
      decayed_skips: 0,
      decayed_plays: 0,
      last_played: null,
      neighbors,
    });
  }

  const reverseAdjacency = new Map<number, Array<{ trackOrdinal: number; similarity: number }>>();
  for (let sourceOrdinal = 0; sourceOrdinal < rows.length; sourceOrdinal += 1) {
    for (const edge of rows[sourceOrdinal]!.neighbors) {
      const arr = reverseAdjacency.get(edge.trackOrdinal) ?? [];
      arr.push({ trackOrdinal: sourceOrdinal, similarity: edge.similarity });
      reverseAdjacency.set(edge.trackOrdinal, arr);
    }
  }

  const rowsByTrackId = new Map(rows.map((row) => [row.track_id, row]));
  return {
    info: {
      format: "tiny",
      schemaVersion: TINY_SIMILARITY_EXPORT_SCHEMA_VERSION,
      sourcePath: filePath,
      trackCount,
      hasTrackIdentity: true,
      hasVectorData: false,
    },
    readRandomTracksExcluding(limit, excludedTrackIds) {
      const excluded = new Set(excludedTrackIds);
      return rows.filter((row) => !excluded.has(row.track_id)).slice(0, limit).map((row) => ({ ...row }));
    },
    readTrackRowsByIds(trackIds) {
      return new Map(trackIds.flatMap((trackId) => {
        const row = rowsByTrackId.get(trackId);
        return row ? [[trackId, { ...row } satisfies PortableSimilarityTrackRow]] : [];
      }));
    },
    readTrackRowById(trackId) {
      const row = rowsByTrackId.get(trackId);
      return row ? { ...row } : null;
    },
    readTrackVectorsByIds() {
      return new Map();
    },
    recommendFromFavorites(options) {
      const weightsByTrackId = options.weightsByTrackId ?? {};
      const excludeTrackIds = new Set(options.excludeTrackIds ?? []);
      const scores = new Map<number, number>();
      for (const favoriteTrackId of options.favoriteTrackIds) {
        const favorite = rowsByTrackId.get(favoriteTrackId);
        if (!favorite) {
          continue;
        }
        const favoriteOrdinal = rows.findIndex((row) => row.track_id === favoriteTrackId);
        const favoriteWeight = weightsByTrackId[favoriteTrackId] ?? 1;
        const directEdges = favorite.neighbors;
        for (const edge of directEdges) {
          scores.set(edge.trackOrdinal, (scores.get(edge.trackOrdinal) ?? 0) + (edge.similarity * favoriteWeight));
        }
        const reverseEdges = reverseAdjacency.get(favoriteOrdinal) ?? [];
        for (const edge of reverseEdges) {
          scores.set(edge.trackOrdinal, (scores.get(edge.trackOrdinal) ?? 0) + (edge.similarity * favoriteWeight * 0.92));
        }
        for (const edge of directEdges) {
          for (const hop of rows[edge.trackOrdinal]?.neighbors ?? []) {
            scores.set(hop.trackOrdinal, (scores.get(hop.trackOrdinal) ?? 0) + (hop.similarity * favoriteWeight * 0.65));
          }
        }
      }

      return [...scores.entries()]
        .map(([trackOrdinal, score]) => ({ trackOrdinal, score }))
        .filter(({ trackOrdinal }) => !excludeTrackIds.has(rows[trackOrdinal]!.track_id) && !options.favoriteTrackIds.includes(rows[trackOrdinal]!.track_id))
        .sort((left, right) => right.score - left.score || left.trackOrdinal - right.trackOrdinal)
        .slice(0, Math.max(1, options.limit ?? 100))
        .map(({ trackOrdinal, score }, index) => {
          const row = rows[trackOrdinal]!;
          return {
            track_id: row.track_id,
            sid_path: row.sid_path,
            song_index: row.song_index,
            score: decodeSimilarity(encodeSimilarity(Math.max(-1, Math.min(1, score)))),
            rank: index + 1,
            e: row.e,
            m: row.m,
            c: row.c,
            likes: 0,
            dislikes: 0,
            skips: 0,
            plays: 0,
            decayed_likes: 0,
            decayed_dislikes: 0,
            decayed_skips: 0,
            decayed_plays: 0,
          } satisfies SimilarityExportRecommendation;
        });
    },
  };
}