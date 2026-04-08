import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildLiteSimilarityExport,
  buildSimilarityTrackId,
  buildSimilarityExport,
  buildTinySimilarityExport,
  openLiteSimilarityDataset,
  openTinySimilarityDataset,
  recommendFromFavorites as recommendFromFavoritesFromSqlite,
  readSimilarityExportManifest,
  readSimilarityExportManifestFromDatabase,
  recommendFromFavorites,
  recommendFromSeedTrack,
} from "../src/index.js";

describe("similarity-export", () => {
  let tempRoot: string;
  let classifiedPath: string;
  let feedbackPath: string;
  let hvscRoot: string;
  let outputPath: string;
  let manifestPath: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-similarity-export-"));
    classifiedPath = path.join(tempRoot, "classified");
    feedbackPath = path.join(tempRoot, "feedback", "2026", "03", "13");
    hvscRoot = path.join(tempRoot, "hvsc");
    outputPath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-1.sqlite");
    manifestPath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-1.manifest.json");

    await mkdir(classifiedPath, { recursive: true });
    await mkdir(feedbackPath, { recursive: true });
    await mkdir(hvscRoot, { recursive: true });

    await writeFile(
      path.join(classifiedPath, "classification_tracks.jsonl"),
      [
        JSON.stringify({ sid_path: "A.sid", song_index: 1, ratings: { e: 1, m: 1, c: 1, p: 3 }, features: { bpm: 90 }, classified_at: "2026-03-13T10:00:00.000Z", source: "auto", render_engine: "wasm" }),
        JSON.stringify({ sid_path: "A.sid", song_index: 2, ratings: { e: 5, m: 5, c: 5, p: 4 }, features: { bpm: 145 }, classified_at: "2026-03-13T10:00:30.000Z", source: "auto", render_engine: "wasm" }),
        JSON.stringify({ sid_path: "B.sid", song_index: 1, ratings: { e: 1, m: 1, c: 2, p: 3 }, features: { bpm: 92 }, classified_at: "2026-03-13T10:01:00.000Z", source: "auto", render_engine: "wasm" }),
        JSON.stringify({ sid_path: "C.sid", song_index: 1, ratings: { e: 5, m: 5, c: 4, p: 3 }, features: { bpm: 140 }, classified_at: "2026-03-13T10:02:00.000Z", source: "auto", render_engine: "wasm" }),
        JSON.stringify({ sid_path: "D.sid", song_index: 1, ratings: { e: 1, m: 2, c: 1, p: 4 }, features: { bpm: 88 }, classified_at: "2026-03-13T10:03:00.000Z", source: "manual", render_engine: "sidplayfp-cli" }),
      ].join("\n") + "\n",
      "utf8",
    );

    await writeFile(
      path.join(feedbackPath, "events.jsonl"),
      [
        JSON.stringify({ ts: "2026-03-13T11:00:00.000Z", sid_path: "A.sid", song_index: 2, action: "play" }),
        JSON.stringify({ ts: "2026-03-13T11:01:00.000Z", sid_path: "A.sid", song_index: 2, action: "like" }),
        JSON.stringify({ ts: "2026-03-13T11:02:00.000Z", sid_path: "B.sid", song_index: 1, action: "play" }),
        JSON.stringify({ ts: "2026-03-13T11:03:00.000Z", sid_path: "D.sid", song_index: 1, action: "like" }),
      ].join("\n") + "\n",
      "utf8",
    );

    for (const sidName of ["A.sid", "B.sid", "C.sid", "D.sid"]) {
      await writeFile(path.join(hvscRoot, sidName), Buffer.from(`PSID-${sidName}`, "utf8"));
    }
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("builds a manifest-backed SQLite export", async () => {
    const result = await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath,
      manifestPath,
      corpusVersion: "TEST-1",
      neighbors: 2,
    });

    expect(result.manifest.track_count).toBe(5);
    expect(result.manifest.neighbor_row_count).toBe(10);
    expect(result.manifest.file_checksums.sqlite_sha256).toHaveLength(64);

    const manifestFromFile = await readSimilarityExportManifest(manifestPath);
    const manifestFromDatabase = readSimilarityExportManifestFromDatabase(outputPath);
    expect(manifestFromFile.schema_version).toBe("sidcorr-1");
    expect(manifestFromDatabase.track_count).toBe(5);
    expect(manifestFromDatabase.corpus_version).toBe("TEST-1");

    const database = new Database(outputPath, { readonly: true, strict: true });
    try {
      const firstTrack = database
        .query("SELECT likes, plays, decayed_likes, decayed_plays FROM tracks WHERE track_id = ?")
        .get(buildSimilarityTrackId("A.sid", 1)) as { likes: number; plays: number; decayed_likes: number; decayed_plays: number };
      const secondTrack = database
        .query("SELECT likes, plays, decayed_likes, decayed_plays FROM tracks WHERE track_id = ?")
        .get(buildSimilarityTrackId("A.sid", 2)) as { likes: number; plays: number; decayed_likes: number; decayed_plays: number };
      const neighborIndex = database
        .query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'neighbors_seed_idx'")
        .get() as { name: string } | null;

      expect(firstTrack).toEqual({ likes: 0, plays: 0, decayed_likes: 0, decayed_plays: 0 });
      expect(secondTrack.likes).toBe(1);
      expect(secondTrack.plays).toBe(1);
      expect(secondTrack.decayed_likes).toBeGreaterThan(0);
      expect(secondTrack.decayed_plays).toBeGreaterThan(0);
      expect(neighborIndex).toBeNull();
    } finally {
      database.close();
    }
  });

  test("recommends similar tracks from a seed track id", async () => {
    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath,
      manifestPath,
      neighbors: 2,
    });

    const recommendations = recommendFromSeedTrack(outputPath, {
      seedTrackId: buildSimilarityTrackId("A.sid", 1),
      limit: 2,
    });

    expect(recommendations.map((entry) => entry.track_id)).toEqual([
      buildSimilarityTrackId("D.sid", 1),
      buildSimilarityTrackId("B.sid", 1),
    ]);
    expect(recommendations[0].score).toBeGreaterThan(recommendations[1].score);
  });

  test("recommends a centroid-based playlist from favorite track ids", async () => {
    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath,
      manifestPath,
      neighbors: 0,
    });

    const recommendations = recommendFromFavorites(outputPath, {
      favoriteTrackIds: [
        buildSimilarityTrackId("A.sid", 2),
        buildSimilarityTrackId("C.sid", 1),
      ],
      limit: 2,
    });

    expect(recommendations.map((entry) => entry.track_id)).toEqual([
      buildSimilarityTrackId("B.sid", 1),
      buildSimilarityTrackId("A.sid", 1),
    ]);
    expect(recommendations[0].rank).toBe(1);
  });

  test("converts a full sqlite export into a lite bundle with matching top recommendations", async () => {
    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath,
      manifestPath,
      neighbors: 2,
    });

    const litePath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-lite-1.sidcorr");
    await buildLiteSimilarityExport({
      sourceSqlitePath: outputPath,
      outputPath: litePath,
      corpusVersion: "TEST-1",
    });

    const sqliteRecommendations = recommendFromFavoritesFromSqlite(outputPath, {
      favoriteTrackIds: [buildSimilarityTrackId("A.sid", 2)],
      limit: 2,
    }).map((entry) => entry.track_id);
    const liteRecommendations = (await openLiteSimilarityDataset(litePath)).recommendFromFavorites({
      favoriteTrackIds: [buildSimilarityTrackId("A.sid", 2)],
      limit: 2,
    }).map((entry) => entry.track_id);

    expect(liteRecommendations[0]).toBe(sqliteRecommendations[0]);
    expect(new Set(liteRecommendations)).toEqual(new Set(sqliteRecommendations));
  });

  test("derives a tiny bundle whose graph recommendations overlap the source sqlite export", async () => {
    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath,
      manifestPath,
      neighbors: 3,
    });

    const litePath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-lite-1.sidcorr");
    await buildLiteSimilarityExport({
      sourceSqlitePath: outputPath,
      outputPath: litePath,
      corpusVersion: "TEST-1",
    });

    const tinyPath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-tiny-1.sidcorr");
    await buildTinySimilarityExport({
      sourceLitePath: litePath,
      hvscRoot,
      outputPath: tinyPath,
      corpusVersion: "TEST-1",
      neighborSqlitePath: outputPath,
    });

    const sqliteTop = recommendFromFavoritesFromSqlite(outputPath, {
      favoriteTrackIds: [buildSimilarityTrackId("A.sid", 1)],
      limit: 3,
    }).map((entry) => entry.track_id);
    const tinyTop = (await openTinySimilarityDataset(tinyPath, { hvscRoot })).recommendFromFavorites({
      favoriteTrackIds: [buildSimilarityTrackId("A.sid", 1)],
      limit: 3,
    }).map((entry) => entry.track_id);

    const overlap = tinyTop.filter((trackId) => sqliteTop.includes(trackId));
    expect(overlap.length).toBeGreaterThanOrEqual(2);
  });

  test("opens optional gzip-compressed lite and tiny bundles", async () => {
    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath,
      manifestPath,
      neighbors: 3,
    });

    const litePath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-lite-1.sidcorr.gz");
    const tinyPath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-tiny-1.sidcorr.gz");
    await buildLiteSimilarityExport({
      sourceSqlitePath: outputPath,
      outputPath: litePath,
      corpusVersion: "TEST-1",
    });
    await buildTinySimilarityExport({
      sourceLitePath: litePath,
      hvscRoot,
      outputPath: tinyPath,
      corpusVersion: "TEST-1",
      neighborSqlitePath: outputPath,
    });

    const liteRecommendations = (await openLiteSimilarityDataset(litePath)).recommendFromFavorites({
      favoriteTrackIds: [buildSimilarityTrackId("A.sid", 2)],
      limit: 1,
    });
    const tinyRecommendations = (await openTinySimilarityDataset(tinyPath, { hvscRoot })).recommendFromFavorites({
      favoriteTrackIds: [buildSimilarityTrackId("A.sid", 1)],
      limit: 1,
    });

    expect(liteRecommendations.length).toBe(1);
    expect(tinyRecommendations.length).toBe(1);
  });

  test("resolves tiny track paths from Songlengths.md5 without rescanning the SID tree", async () => {
    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath,
      manifestPath,
      neighbors: 3,
    });

    const litePath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-lite-1.sidcorr");
    await buildLiteSimilarityExport({
      sourceSqlitePath: outputPath,
      outputPath: litePath,
      corpusVersion: "TEST-1",
    });

    const tinyPath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-tiny-1.sidcorr");
    await buildTinySimilarityExport({
      sourceLitePath: litePath,
      hvscRoot,
      outputPath: tinyPath,
      corpusVersion: "TEST-1",
      neighborSqlitePath: outputPath,
    });

    const documentsDir = path.join(hvscRoot, "DOCUMENTS");
    await mkdir(documentsDir, { recursive: true });
    await writeFile(
      path.join(documentsDir, "Songlengths.md5"),
      [
        "[Database]",
        ...["A.sid", "B.sid", "C.sid", "D.sid"].flatMap((sidName) => [
          `; /${sidName}`,
          `${createHash("md5").update(Buffer.from(`PSID-${sidName}`, "utf8")).digest("hex")}=0:30`,
        ]),
      ].join("\n"),
      "utf8",
    );

    for (const sidName of ["A.sid", "B.sid", "C.sid", "D.sid"]) {
      await rm(path.join(hvscRoot, sidName), { force: true });
    }

    const tiny = await openTinySimilarityDataset(tinyPath, { hvscRoot });
    expect(tiny.resolveTrack(buildSimilarityTrackId("A.sid", 1))?.sid_path).toBe("A.sid");
  });

  test("builds tiny bundles when HVSC music files live under C64Music", async () => {
    const nestedHvscRoot = path.join(tempRoot, "hvsc-nested");
    const nestedMusicRoot = path.join(nestedHvscRoot, "C64Music", "DEMOS", "A-F");
    const nestedClassifiedPath = path.join(tempRoot, "classified-nested");
    const nestedSqlitePath = path.join(tempRoot, "exports", "sidcorr-nested-full-sidcorr-1.sqlite");
    const nestedLitePath = path.join(tempRoot, "exports", "sidcorr-nested-full-sidcorr-lite-1.sidcorr");
    const nestedTinyPath = path.join(tempRoot, "exports", "sidcorr-nested-full-sidcorr-tiny-1.sidcorr");

    await mkdir(nestedMusicRoot, { recursive: true });
    await mkdir(nestedClassifiedPath, { recursive: true });
    await writeFile(path.join(nestedMusicRoot, "Track_A.sid"), Buffer.from("PSID-Track-A", "utf8"));
    await writeFile(path.join(nestedMusicRoot, "Track_B.sid"), Buffer.from("PSID-Track-B", "utf8"));
    await writeFile(
      path.join(nestedClassifiedPath, "classification_tracks.jsonl"),
      [
        JSON.stringify({ sid_path: "DEMOS/A-F/Track_A.sid", song_index: 1, ratings: { e: 1, m: 2, c: 3, p: 3 }, features: { bpm: 90 }, classified_at: "2026-03-13T10:00:00.000Z", source: "auto", render_engine: "wasm" }),
        JSON.stringify({ sid_path: "DEMOS/A-F/Track_B.sid", song_index: 1, ratings: { e: 5, m: 4, c: 4, p: 3 }, features: { bpm: 140 }, classified_at: "2026-03-13T10:00:30.000Z", source: "auto", render_engine: "wasm" }),
      ].join("\n") + "\n",
      "utf8",
    );

    await buildSimilarityExport({
      classifiedPath: nestedClassifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath: nestedSqlitePath,
      neighbors: 1,
    });
    await buildLiteSimilarityExport({
      sourceSqlitePath: nestedSqlitePath,
      outputPath: nestedLitePath,
      corpusVersion: "TEST-NESTED",
    });
    await buildTinySimilarityExport({
      sourceLitePath: nestedLitePath,
      hvscRoot: nestedHvscRoot,
      outputPath: nestedTinyPath,
      corpusVersion: "TEST-NESTED",
      neighborSqlitePath: nestedSqlitePath,
    });

    const tiny = await openTinySimilarityDataset(nestedTinyPath, { hvscRoot: nestedHvscRoot });
    expect(tiny.resolveTrack(buildSimilarityTrackId("DEMOS/A-F/Track_A.sid", 1))?.sid_path).toBe("DEMOS/A-F/Track_A.sid");
  });

  test("reads recommendation data from cached pre-decay sidcorr bundles", async () => {
    const legacyDbPath = path.join(tempRoot, "exports", "sidcorr-legacy.sqlite");
    await mkdir(path.dirname(legacyDbPath), { recursive: true });

    const legacyDb = new Database(legacyDbPath, { create: true, strict: true });
    try {
      legacyDb.exec(`
        CREATE TABLE tracks (
          track_id TEXT PRIMARY KEY,
          sid_path TEXT NOT NULL,
          song_index INTEGER NOT NULL,
          vector_json TEXT,
          e REAL NOT NULL,
          m REAL NOT NULL,
          c REAL NOT NULL,
          p REAL,
          likes INTEGER NOT NULL,
          dislikes INTEGER NOT NULL,
          skips INTEGER NOT NULL,
          plays INTEGER NOT NULL,
          last_played TEXT
        ) WITHOUT ROWID;
        CREATE TABLE neighbors (
          profile TEXT NOT NULL,
          seed_track_id TEXT NOT NULL,
          neighbor_track_id TEXT NOT NULL,
          rank INTEGER NOT NULL,
          similarity REAL NOT NULL,
          PRIMARY KEY (profile, seed_track_id, rank)
        ) WITHOUT ROWID;
      `);

      const insertTrack = legacyDb.query(`
        INSERT INTO tracks (
          track_id, sid_path, song_index, vector_json, e, m, c, p, likes, dislikes, skips, plays, last_played
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertTrack.run(buildSimilarityTrackId("A.sid", 1), "A.sid", 1, JSON.stringify([1, 0, 0, 0]), 1, 1, 1, 3, 0, 0, 0, 0, null);
      insertTrack.run(buildSimilarityTrackId("B.sid", 1), "B.sid", 1, JSON.stringify([0.9, 0.1, 0, 0]), 1, 1, 2, 3, 2, 0, 0, 2, "2026-03-13T11:00:00.000Z");
      insertTrack.run(buildSimilarityTrackId("C.sid", 1), "C.sid", 1, JSON.stringify([0, 1, 0, 0]), 5, 5, 5, 4, 5, 0, 0, 5, "2026-03-13T11:05:00.000Z");

      legacyDb.query(
        "INSERT INTO neighbors (profile, seed_track_id, neighbor_track_id, rank, similarity) VALUES (?, ?, ?, ?, ?)",
      ).run("full", buildSimilarityTrackId("A.sid", 1), buildSimilarityTrackId("B.sid", 1), 1, 0.97);
    } finally {
      legacyDb.close();
    }

    const fromFavorites = recommendFromFavorites(legacyDbPath, {
      favoriteTrackIds: [buildSimilarityTrackId("A.sid", 1)],
      limit: 2,
    });
    expect(fromFavorites[0]?.track_id).toBe(buildSimilarityTrackId("B.sid", 1));
    expect(fromFavorites[0]?.decayed_likes).toBe(0);
    expect(fromFavorites[0]?.decayed_plays).toBe(0);

    const fromSeed = recommendFromSeedTrack(legacyDbPath, {
      seedTrackId: buildSimilarityTrackId("A.sid", 1),
      limit: 1,
    });
    expect(fromSeed[0]?.track_id).toBe(buildSimilarityTrackId("B.sid", 1));
    expect(fromSeed[0]?.decayed_likes).toBe(0);
  });

  test("deduplicates repeated track records by keeping the newest classification", async () => {
    await writeFile(
      path.join(classifiedPath, "classification_dupe.jsonl"),
      [
        JSON.stringify({ sid_path: "A.sid", song_index: 1, ratings: { e: 4, m: 4, c: 4, p: 2 }, features: { bpm: 110 }, classified_at: "2026-03-13T12:00:00.000Z", source: "auto", render_engine: "sidplayfp-cli" }),
      ].join("\n") + "\n",
      "utf8",
    );

    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath,
      manifestPath,
      neighbors: 1,
    });

    const recommendations = recommendFromSeedTrack(outputPath, {
      seedTrackId: buildSimilarityTrackId("A.sid", 1),
      limit: 1,
    });

    expect(recommendations[0]?.track_id).toBe(buildSimilarityTrackId("C.sid", 1));
  });

  test("skips malformed classification rows without ratings", async () => {
    await writeFile(
      path.join(classifiedPath, "classification_invalid.jsonl"),
      [
        JSON.stringify({ sid_path: "BROKEN.sid", features: { bpm: 100 }, classified_at: "2026-03-13T12:05:00.000Z", source: "auto", render_engine: "wasm" }),
      ].join("\n") + "\n",
      "utf8",
    );

    const result = await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath,
      manifestPath,
      neighbors: 1,
    });

    expect(result.manifest.track_count).toBe(5);
  });

  test("recovers exportable tracks from orphaned feature-phase JSONL files", async () => {
    await writeFile(
      path.join(classifiedPath, "features_2026-03-13_18-02-43-329.jsonl"),
      [
        JSON.stringify({
          sid_path: "E.sid",
          song_index: 1,
          song_count: 1,
          manual_ratings: null,
          render_engine: "wasm",
          features: {
            featureSetVersion: "1.2.0",
            bpm: 100,
            confidence: 0.8,
            rms: 0.12,
            energy: 0.04,
            spectralCentroid: 300,
            spectralRolloff: 2200,
            spectralFlatnessDb: 0.2,
            spectralEntropy: 6.5,
            spectralCrest: 30,
            spectralHfc: 5000,
            zeroCrossingRate: 0.04,
          },
        }),
        JSON.stringify({
          sid_path: "F.sid",
          song_index: 2,
          song_count: 1,
          manual_ratings: { e: 5 },
          render_engine: "wasm",
          features: {
            featureSetVersion: "1.2.0",
            bpm: 140,
            confidence: 0.7,
            rms: 0.2,
            energy: 0.08,
            spectralCentroid: 800,
            spectralRolloff: 6400,
            spectralFlatnessDb: 0.35,
            spectralEntropy: 8.9,
            spectralCrest: 55,
            spectralHfc: 14000,
            zeroCrossingRate: 0.14,
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const result = await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath,
      manifestPath,
      neighbors: 0,
    });

    expect(result.manifest.track_count).toBe(7);

    const recommendations = recommendFromFavorites(outputPath, {
      favoriteTrackIds: [buildSimilarityTrackId("E.sid", 1)],
      limit: 2,
    });

    expect(recommendations.length).toBe(2);
  });

  test("prefers stored 24D perceptual vectors and reports 24D exports in the manifest", async () => {
    const vectorSeed = Array.from({ length: 24 }, (_, index) => (index === 19 ? 1 : 0));
    const vectorNear = Array.from({ length: 24 }, (_, index) => (index === 19 ? 0.95 : index === 20 ? 0.2 : 0));
    const vectorFar = Array.from({ length: 24 }, (_, index) => (index === 14 ? 1 : 0));

    await writeFile(
      path.join(classifiedPath, "classification_24d.jsonl"),
      [
        JSON.stringify({ sid_path: "P24/seed.sid", song_index: 1, ratings: { e: 4, m: 4, c: 4 }, vector: vectorSeed, classified_at: "2026-03-13T12:10:00.000Z", source: "auto", render_engine: "wasm" }),
        JSON.stringify({ sid_path: "P24/near.sid", song_index: 1, ratings: { e: 4, m: 4, c: 4 }, vector: vectorNear, classified_at: "2026-03-13T12:10:01.000Z", source: "auto", render_engine: "wasm" }),
        JSON.stringify({ sid_path: "P24/far.sid", song_index: 1, ratings: { e: 4, m: 4, c: 4 }, vector: vectorFar, classified_at: "2026-03-13T12:10:02.000Z", source: "auto", render_engine: "wasm" }),
      ].join("\n") + "\n",
      "utf8",
    );

    const result = await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath,
      manifestPath,
      neighbors: 0,
    });

    expect(result.manifest.vector_dimensions).toBe(24);

    const recommendations = recommendFromFavorites(outputPath, {
      favoriteTrackIds: [buildSimilarityTrackId("P24/seed.sid", 1)],
      limit: 2,
    });

    expect(recommendations[0]?.track_id).toBe(buildSimilarityTrackId("P24/near.sid", 1));

    const database = new Database(outputPath, { readonly: true, strict: true });
    try {
      const row = database.query("SELECT vector_json FROM tracks WHERE track_id = ?").get(buildSimilarityTrackId("P24/seed.sid", 1)) as { vector_json: string | null };
      expect(JSON.parse(row.vector_json ?? "[]")).toHaveLength(24);
    } finally {
      database.close();
    }
  });
});