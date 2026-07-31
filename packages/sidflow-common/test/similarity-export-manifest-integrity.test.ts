/**
 * The manifest must describe the file that is actually published.
 *
 * Every SIDFlow release up to and including 0.7.0 published a
 * `file_checksums.sqlite_sha256` that had never matched the artefact beside it, in any
 * release, by construction: the exporter hashed the database and then wrote the
 * manifest — including that hash — into the database's own `meta` table, mutating the
 * bytes it had just measured. `SHA256SUMS` was always right, so nothing downstream
 * broke, but a consumer following the published instruction to "verify the checksum
 * and retain the manifest" rejected every release SIDFlow ever shipped.
 *
 * These tests fail against that code. The first asserts the invariant directly. The
 * rest cover the refresh path added to repair the one artefact that cannot be rebuilt
 * without reclassifying the whole corpus.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildSimilarityExport,
  readSimilarityExportManifest,
  readSimilarityExportManifestFromDatabase,
  rewriteSimilarityExportManifest,
  SIMILARITY_VECTOR_WEIGHTS,
} from "../src/index.js";

async function sha256OfFile(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

describe("similarity export manifest integrity", () => {
  let tempRoot: string;
  let classifiedPath: string;
  let feedbackPath: string;
  let outputPath: string;
  let manifestPath: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-manifest-integrity-"));
    classifiedPath = path.join(tempRoot, "classified");
    feedbackPath = path.join(tempRoot, "feedback");
    outputPath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-1.sqlite");
    manifestPath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-1.manifest.json");

    await mkdir(classifiedPath, { recursive: true });
    await mkdir(feedbackPath, { recursive: true });

    // Eight tracks with distinct ratings, so neighbours are well defined and the
    // corpus is large enough to ask for more neighbours than some seed can supply.
    const records = [
      { sid_path: "A.sid", song_index: 1, ratings: { e: 1, m: 1, c: 1, p: 3 } },
      { sid_path: "A.sid", song_index: 2, ratings: { e: 2, m: 1, c: 2, p: 3 } },
      { sid_path: "B.sid", song_index: 1, ratings: { e: 3, m: 2, c: 3, p: 3 } },
      { sid_path: "C.sid", song_index: 1, ratings: { e: 4, m: 3, c: 3, p: 3 } },
      { sid_path: "D.sid", song_index: 1, ratings: { e: 5, m: 4, c: 4, p: 3 } },
      { sid_path: "E.sid", song_index: 1, ratings: { e: 5, m: 5, c: 5, p: 3 } },
      { sid_path: "F.sid", song_index: 1, ratings: { e: 2, m: 4, c: 1, p: 3 } },
      { sid_path: "G.sid", song_index: 1, ratings: { e: 4, m: 2, c: 5, p: 3 } },
    ];
    await writeFile(
      path.join(classifiedPath, "classification_tracks.jsonl"),
      records
        .map((record, index) => JSON.stringify({
          ...record,
          features: { bpm: 80 + (index * 7) },
          classified_at: `2026-07-27T10:0${index}:00.000Z`,
          source: "auto",
          render_engine: "wasm",
        }))
        .join("\n") + "\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("the sidecar digest matches the file that was published", async () => {
    const result = await buildSimilarityExport({
      classifiedPath,
      feedbackPath,
      outputPath,
      manifestPath,
      corpusVersion: "test",
      neighbors: 3,
    });

    const actual = await sha256OfFile(outputPath);
    expect(result.manifest.file_checksums.sqlite_sha256).toBe(actual);

    const sidecar = await readSimilarityExportManifest(manifestPath);
    expect(sidecar.file_checksums.sqlite_sha256).toBe(actual);
  });

  test("the copy embedded in the database omits file_checksums entirely", async () => {
    await buildSimilarityExport({
      classifiedPath,
      feedbackPath,
      outputPath,
      manifestPath,
      corpusVersion: "test",
      neighbors: 3,
    });

    // A file cannot contain its own digest. Storing a value there is not merely
    // redundant, it is necessarily wrong, and being wrong quietly is the failure mode
    // this release exists to remove.
    const embedded = readSimilarityExportManifestFromDatabase(outputPath) as unknown as Record<string, unknown>;
    expect(embedded.file_checksums).toBeUndefined();
    expect(embedded.track_count).toBe(8);
  });

  test("neighbor_row_count is measured, not tracks x k", async () => {
    // Asking for more neighbours than the corpus can supply is the case that separates
    // the two: 8 tracks can yield at most 7 neighbours each, so a computed 8 * 25 = 200
    // would be wrong by an order of magnitude. u64deck hard-fails its import when the
    // manifest and the table disagree, with no fallback.
    const result = await buildSimilarityExport({
      classifiedPath,
      feedbackPath,
      outputPath,
      manifestPath,
      corpusVersion: "test",
      neighbors: 25,
    });

    const database = new Database(outputPath, { readonly: true });
    try {
      const actual = (database.query("SELECT COUNT(*) AS count FROM neighbors").get() as { count: number }).count;
      expect(result.manifest.neighbor_row_count).toBe(actual);
      expect(actual).toBe(8 * 7);
      expect(result.manifest.neighbor_row_count).not.toBe(8 * 25);
    } finally {
      database.close();
    }
  });

  test("enforces neighbor endpoints and refuses to refresh an orphaned relation", async () => {
    await buildSimilarityExport({
      classifiedPath,
      feedbackPath,
      outputPath,
      manifestPath,
      corpusVersion: "test",
      neighbors: 3,
    });

    const database = new Database(outputPath, { readwrite: true, strict: true });
    try {
      const foreignKeys = database.query("PRAGMA foreign_key_list(neighbors)").all() as Array<{
        table: string;
        from: string;
        to: string;
      }>;
      expect(foreignKeys).toEqual(expect.arrayContaining([
        expect.objectContaining({ table: "tracks", from: "seed_track_id", to: "track_id" }),
        expect.objectContaining({ table: "tracks", from: "neighbor_track_id", to: "track_id" }),
      ]));

      database.exec("PRAGMA foreign_keys = ON");
      expect(() => database.query(`
        INSERT INTO neighbors (profile, seed_track_id, neighbor_track_id, rank, similarity)
        VALUES ('full', 'missing#1', 'also-missing#1', 999, 0.5)
      `).run()).toThrow(/FOREIGN KEY constraint failed/);

      // Simulate a legacy or externally corrupted artifact. A manifest rewrite must
      // not make its reported row count look legitimate.
      database.exec("PRAGMA foreign_keys = OFF");
      database.query(`
        INSERT INTO neighbors (profile, seed_track_id, neighbor_track_id, rank, similarity)
        VALUES ('full', 'missing#1', 'also-missing#1', 999, 0.5)
      `).run();
    } finally {
      database.close();
    }

    await expect(rewriteSimilarityExportManifest({ sqlitePath: outputPath }))
      .rejects.toThrow(/neighbor relation references a missing track/);
  });

  test("manifest paths are basenames, never the build host's layout", async () => {
    const result = await buildSimilarityExport({
      classifiedPath,
      feedbackPath,
      outputPath,
      manifestPath,
      corpusVersion: "test",
      neighbors: 3,
    });

    expect(result.manifest.paths.sqlite).toBe("sidcorr-test-full-sidcorr-1.sqlite");
    expect(result.manifest.paths.manifest).toBe("sidcorr-test-full-sidcorr-1.manifest.json");
    expect(path.isAbsolute(result.manifest.paths.sqlite)).toBe(false);
    expect(path.isAbsolute(result.manifest.paths.manifest)).toBe(false);
  });

  test("the metric and its weights are published for a weighted vector width", async () => {
    const result = await buildSimilarityExport({
      classifiedPath,
      feedbackPath,
      outputPath,
      manifestPath,
      corpusVersion: "test",
      neighbors: 3,
    });

    // This corpus has no stored perceptual vector, so it falls to the legacy ratings
    // width, which is explicitly unweighted. Saying "cosine" is a statement, not a gap.
    expect(result.manifest.vector_dimensions).toBeLessThanOrEqual(4);
    expect(result.manifest.similarity_metric).toBe("cosine");
    expect(result.manifest.vector_weights).toBeUndefined();
  });

  test("a weighted-width export publishes one weight per dimension", async () => {
    const wideRecords = Array.from({ length: 6 }, (_, index) => ({
      sid_path: `W${index}.sid`,
      song_index: 1,
      ratings: { e: (index % 5) + 1, m: ((index + 2) % 5) + 1, c: ((index + 4) % 5) + 1, p: 3 },
      vector: Array.from(
        { length: SIMILARITY_VECTOR_WEIGHTS.length },
        (_unused, dimension) => Math.sin((index + 1) * (dimension + 1)),
      ),
      features: { bpm: 100 + index },
      classified_at: `2026-07-27T11:0${index}:00.000Z`,
      source: "auto",
      render_engine: "wasm",
    }));
    await writeFile(
      path.join(classifiedPath, "classification_tracks.jsonl"),
      wideRecords.map((record) => JSON.stringify(record)).join("\n") + "\n",
      "utf8",
    );

    const result = await buildSimilarityExport({
      classifiedPath,
      feedbackPath,
      outputPath,
      manifestPath,
      corpusVersion: "test",
      neighbors: 3,
    });

    expect(result.manifest.vector_dimensions).toBe(SIMILARITY_VECTOR_WEIGHTS.length);
    expect(result.manifest.similarity_metric).toBe("weighted-cosine");
    expect(result.manifest.vector_weights).toHaveLength(result.manifest.vector_dimensions);
    expect(result.manifest.vector_weights).toEqual([...SIMILARITY_VECTOR_WEIGHTS]);
  });

  test("hvsc_version is recorded, and is 'unknown' rather than a guess", async () => {
    const withVersion = await buildSimilarityExport({
      classifiedPath,
      feedbackPath,
      outputPath,
      manifestPath,
      corpusVersion: "test",
      neighbors: 3,
      hvscVersion: "HVSC 85 + Update 85",
    });
    expect(withVersion.manifest.hvsc_version).toBe("HVSC 85 + Update 85");

    const withoutVersion = await buildSimilarityExport({
      classifiedPath,
      feedbackPath,
      outputPath,
      manifestPath,
      corpusVersion: "test",
      neighbors: 3,
    });
    expect(withoutVersion.manifest.hvsc_version).toBe("unknown");
  });

  describe("--rewrite-manifest", () => {
    test("repairs a manifest whose embedded copy is wrong, without touching the data", async () => {
      await buildSimilarityExport({
        classifiedPath,
        feedbackPath,
        outputPath,
        manifestPath,
        corpusVersion: "test",
        neighbors: 3,
      });

      // Reproduce the 0.7.0-era damage: a manifest that lies about the corpus and
      // carries a self-referential digest it can never match.
      const damaged = new Database(outputPath, { readwrite: true });
      try {
        damaged.query("UPDATE meta SET value = ? WHERE key = ?").run(
          JSON.stringify({
            schema_version: "sidcorr-1",
            export_profile: "full",
            generated_at: "2026-07-26T20:34:56.796Z",
            corpus_version: "hvsc",
            feature_schema_version: "1.5.0",
            vector_dimensions: 4,
            track_count: 999999,
            neighbor_row_count: 123456,
            neighbor_count_per_track: 25,
            include_vectors: true,
            paths: { sqlite: "/mnt/data/dev/c64/sidflow/data/exports/x.sqlite", manifest: "/mnt/data/x.manifest.json" },
            source_checksums: { classified: "abc", feedback: "empty" },
            file_checksums: { sqlite_sha256: "d7e5f77ae71d0b770e34f0efc85ec87741f3ec6a5257f1a2b1f238d819737d51" },
            tables: ["meta", "tracks", "neighbors"],
          }),
          "manifest_json",
        );
      } finally {
        damaged.close();
      }

      const database = new Database(outputPath, { readonly: true });
      const trackCountBefore = (database.query("SELECT COUNT(*) AS count FROM tracks").get() as { count: number }).count;
      const neighborCountBefore = (database.query("SELECT COUNT(*) AS count FROM neighbors").get() as { count: number }).count;
      database.close();

      const rewritten = await rewriteSimilarityExportManifest({
        sqlitePath: outputPath,
        hvscVersion: "HVSC 85 + Update 85",
      });

      expect(rewritten.databaseRewritten).toBe(true);
      expect(rewritten.manifest.track_count).toBe(trackCountBefore);
      expect(rewritten.manifest.neighbor_row_count).toBe(neighborCountBefore);
      expect(rewritten.manifest.hvsc_version).toBe("HVSC 85 + Update 85");
      expect(rewritten.manifest.paths.sqlite).toBe("sidcorr-test-full-sidcorr-1.sqlite");
      expect(rewritten.manifest.file_checksums.sqlite_sha256).toBe(await sha256OfFile(outputPath));

      // A repair is not a regeneration: the build's own provenance survives it.
      expect(rewritten.manifest.generated_at).toBe("2026-07-26T20:34:56.796Z");
      expect(rewritten.manifest.corpus_version).toBe("hvsc");
      expect(rewritten.manifest.source_checksums.classified).toBe("abc");

      // And the data is untouched.
      const after = new Database(outputPath, { readonly: true });
      try {
        expect((after.query("SELECT COUNT(*) AS count FROM tracks").get() as { count: number }).count).toBe(trackCountBefore);
        expect((after.query("SELECT COUNT(*) AS count FROM neighbors").get() as { count: number }).count).toBe(neighborCountBefore);
      } finally {
        after.close();
      }
    });

    test("is byte-stable when run twice on its own output", async () => {
      await buildSimilarityExport({
        classifiedPath,
        feedbackPath,
        outputPath,
        manifestPath,
        corpusVersion: "test",
        neighbors: 3,
      });

      const first = await rewriteSimilarityExportManifest({ sqlitePath: outputPath, hvscVersion: "HVSC 85" });
      const afterFirst = await sha256OfFile(outputPath);
      const firstManifestText = await readFile(manifestPath, "utf8");

      const second = await rewriteSimilarityExportManifest({ sqlitePath: outputPath, hvscVersion: "HVSC 85" });
      const afterSecond = await sha256OfFile(outputPath);
      const secondManifestText = await readFile(manifestPath, "utf8");

      expect(afterSecond).toBe(afterFirst);
      expect(secondManifestText).toBe(firstManifestText);
      expect(second.manifest.file_checksums.sqlite_sha256).toBe(afterSecond);

      // The second run must recognise there is nothing to do. SQLite bumps the file
      // change counter, the schema cookie and the version-valid-for number on every
      // VACUUM, so a rewrite that always wrote would differ in three header bytes each
      // time and byte-stability would be unreachable rather than merely unmet.
      expect(second.databaseRewritten).toBe(false);
      expect(first.manifest).toEqual(second.manifest);
    });

    test("keeps the digest true after the rewrite changes the file", async () => {
      await buildSimilarityExport({
        classifiedPath,
        feedbackPath,
        outputPath,
        manifestPath,
        corpusVersion: "test",
        neighbors: 3,
      });

      const beforeDigest = await sha256OfFile(outputPath);
      const rewritten = await rewriteSimilarityExportManifest({
        sqlitePath: outputPath,
        hvscVersion: "HVSC 85 + Update 85",
      });

      // Adding hvsc_version changes the embedded manifest, so the file genuinely moves.
      expect(rewritten.databaseRewritten).toBe(true);
      const afterDigest = await sha256OfFile(outputPath);
      expect(afterDigest).not.toBe(beforeDigest);
      expect(rewritten.manifest.file_checksums.sqlite_sha256).toBe(afterDigest);

      const sidecar = await readSimilarityExportManifest(manifestPath);
      expect(sidecar.file_checksums.sqlite_sha256).toBe(afterDigest);
    });
  });
});
