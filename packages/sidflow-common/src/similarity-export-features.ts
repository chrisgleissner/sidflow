/**
 * The features sidecar: the raw feature records, without vectors and without neighbours.
 *
 * ## Why this and not a fourth tier
 *
 * The audit built and measured nine candidate exports sitting between full and lite and
 * found that no useful tier exists there. Once `features_json` is dropped and the vector
 * is binary-encoded, the artefact is 31.7 MB — four times lite, not thirty. The apparent
 * chasm between an 8 MB lite bundle and a 1,014 MB full export is an encoding artefact,
 * and closing it collapses the space where an intermediate would have lived.
 *
 * What is genuinely missing sits on the other side. `u64deck` — the only known consumer
 * of the full export — never reads `vector_json` at all. It extracts its own 48-dimension
 * vector from `features_json`, z-normalises it corpus-wide, and discards the rest. So it
 * downloads 1,014 MB to obtain the 37% of the file it actually wants, and there is no
 * artefact that offers just that.
 *
 * This is that artefact. A consumer that wants to derive its own representation takes
 * 8 MB of lite plus this, instead of 1,014 MB of SQLite.
 *
 * It is explicitly NOT a fourth tier and not required for recommendation: lite already
 * reproduces the full export's stations at 98% overlap. This is for consumers building
 * something else.
 *
 * ## Shape
 *
 * Line-delimited JSON, gzipped, sorted by `track_id`. One object per line:
 *
 *   {"track_id": "...", "sid_path": "...", "song_index": 1, "features": { ... }}
 *
 * JSONL rather than one big array so a consumer can stream it, and rather than Parquet
 * so it can be read with nothing but gunzip and a JSON parser — which is the whole point
 * of publishing it separately from a SQLite file.
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { Database } from "bun:sqlite";
import { writeCanonicalJsonFile } from "./canonical-writer.js";
import { ensureDir } from "./fs.js";
import type { JsonValue } from "./json.js";
import { HVSC_VERSION_UNKNOWN } from "./hvsc-version.js";

export const FEATURES_SIDECAR_SCHEMA_VERSION = "sidcorr-features-1";

export interface FeaturesSidecarManifest {
  schema_version: typeof FEATURES_SIDECAR_SCHEMA_VERSION;
  generated_at: string;
  corpus_version: string;
  hvsc_version: string;
  feature_schema_version: string;
  track_count: number;
  /** Tracks whose `features_json` was absent or unparseable, and so carry `{}`. */
  tracks_without_features: number;
  content_encoding: "gzip";
  bundle_bytes: number;
  bundle_bytes_uncompressed: number;
  source: {
    sqlite: string;
  };
  source_checksums: {
    sqlite_sha256: string;
  };
  file_checksums: {
    bundle_sha256: string;
  };
  paths: {
    bundle: string;
    manifest: string;
  };
}

export interface BuildFeaturesSidecarOptions {
  sourceSqlitePath: string;
  outputPath: string;
  manifestPath?: string;
  corpusVersion?: string;
  hvscVersion?: string;
}

export interface BuildFeaturesSidecarResult {
  durationMs: number;
  outputPath: string;
  manifestPath: string;
  manifest: FeaturesSidecarManifest;
}

async function computeFileChecksum(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), async function* (source) {
    for await (const chunk of source) {
      hash.update(chunk as Buffer);
      yield chunk;
    }
  }, async (source) => {
    // Drain; the digest is the point.
    for await (const _chunk of source) {
      // no-op
    }
  });
  return hash.digest("hex");
}

function readSourceManifestField(database: Database, field: string): string | null {
  try {
    const hasMeta = database
      .query("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'meta'")
      .get() as { name: string } | null;
    if (!hasMeta) {
      return null;
    }
    const row = database.query("SELECT value FROM meta WHERE key = ?").get("manifest_json") as
      | { value: string }
      | null;
    if (!row) {
      return null;
    }
    const parsed = JSON.parse(row.value) as Record<string, unknown>;
    const value = parsed[field];
    return typeof value === "string" ? value : null;
  } catch (error) {
    console.debug(
      `Could not read ${field} from the source export's manifest: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/**
 * Stream the feature records out of a full export into a gzipped JSONL sidecar.
 *
 * Streamed rather than assembled in memory because `features_json` is 381 MB raw across
 * HVSC's 87,868 tracks — a 129-key record averaging 4,339 bytes. Building that as one
 * string to compress would cost more resident memory than the export it came from.
 */
export async function buildFeaturesSidecarExport(
  options: BuildFeaturesSidecarOptions,
): Promise<BuildFeaturesSidecarResult> {
  const startedAt = Date.now();
  const manifestPath = options.manifestPath
    ?? options.outputPath.replace(/\.jsonl\.gz$/, "").replace(/\.jsonl$/, "") + ".manifest.json";

  await ensureDir(path.dirname(options.outputPath));
  const temporaryPath = `${options.outputPath}.tmp-${process.pid}`;
  await rm(temporaryPath, { force: true });

  const database = new Database(options.sourceSqlitePath, { readonly: true, strict: true });
  let trackCount = 0;
  let tracksWithoutFeatures = 0;
  let uncompressedBytes = 0;
  let featureSchemaVersion = readSourceManifestField(database, "feature_schema_version") ?? "unknown";

  try {
    const rows = database.query(`
      SELECT track_id, sid_path, song_index, features_json, feature_schema_version
      FROM tracks
      ORDER BY track_id ASC
    `).iterate() as IterableIterator<{
      track_id: string;
      sid_path: string;
      song_index: number;
      features_json: string | null;
      feature_schema_version: string | null;
    }>;

    const gzip = createGzip({ level: 9 });
    const sink = createWriteStream(temporaryPath);
    const finished = pipeline(gzip, sink);

    for (const row of rows) {
      let features: unknown = {};
      if (row.features_json) {
        try {
          features = JSON.parse(row.features_json) as unknown;
        } catch (error) {
          tracksWithoutFeatures += 1;
          console.debug(
            `features_json for ${row.track_id} is not valid JSON and is emitted as {}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      } else {
        tracksWithoutFeatures += 1;
      }
      if (row.feature_schema_version && featureSchemaVersion === "unknown") {
        featureSchemaVersion = row.feature_schema_version;
      }

      const line = `${JSON.stringify({
        track_id: row.track_id,
        sid_path: row.sid_path,
        song_index: row.song_index,
        features,
      })}\n`;
      uncompressedBytes += Buffer.byteLength(line);
      trackCount += 1;
      if (!gzip.write(line)) {
        await new Promise<void>((resolve) => gzip.once("drain", resolve));
      }
    }

    gzip.end();
    await finished;
  } finally {
    database.close();
  }

  await rm(options.outputPath, { force: true });
  await rename(temporaryPath, options.outputPath);

  const [bundleStat, bundleChecksum, sourceChecksum] = await Promise.all([
    stat(options.outputPath),
    computeFileChecksum(options.outputPath),
    computeFileChecksum(options.sourceSqlitePath),
  ]);

  const sourceDatabase = new Database(options.sourceSqlitePath, { readonly: true, strict: true });
  let corpusVersion: string;
  let hvscVersion: string;
  try {
    corpusVersion = options.corpusVersion ?? readSourceManifestField(sourceDatabase, "corpus_version") ?? "custom";
    hvscVersion = options.hvscVersion
      ?? readSourceManifestField(sourceDatabase, "hvsc_version")
      ?? HVSC_VERSION_UNKNOWN;
  } finally {
    sourceDatabase.close();
  }

  const manifest: FeaturesSidecarManifest = {
    schema_version: FEATURES_SIDECAR_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    corpus_version: corpusVersion,
    hvsc_version: hvscVersion,
    feature_schema_version: featureSchemaVersion,
    track_count: trackCount,
    tracks_without_features: tracksWithoutFeatures,
    content_encoding: "gzip",
    bundle_bytes: bundleStat.size,
    bundle_bytes_uncompressed: uncompressedBytes,
    source: {
      sqlite: path.basename(options.sourceSqlitePath),
    },
    source_checksums: {
      sqlite_sha256: sourceChecksum,
    },
    file_checksums: {
      bundle_sha256: bundleChecksum,
    },
    paths: {
      bundle: path.basename(options.outputPath),
      manifest: path.basename(manifestPath),
    },
  };

  await writeCanonicalJsonFile(manifestPath, manifest as unknown as JsonValue, {
    action: "data:modify",
    details: {
      kind: "features-sidecar-manifest",
      trackCount: manifest.track_count,
      bundleSha256: manifest.file_checksums.bundle_sha256,
    },
  });

  return {
    durationMs: Date.now() - startedAt,
    outputPath: options.outputPath,
    manifestPath,
    manifest,
  };
}

/** Read a features sidecar manifest. */
export async function readFeaturesSidecarManifest(manifestPath: string): Promise<FeaturesSidecarManifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as FeaturesSidecarManifest;
}
