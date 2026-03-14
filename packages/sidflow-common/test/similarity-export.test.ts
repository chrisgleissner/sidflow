import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildSimilarityExport,
  readSimilarityExportManifest,
  readSimilarityExportManifestFromDatabase,
  recommendFromFavorites,
  recommendFromSeedTrack,
} from "../src/similarity-export.js";

describe("similarity-export", () => {
  let tempRoot: string;
  let classifiedPath: string;
  let feedbackPath: string;
  let outputPath: string;
  let manifestPath: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-similarity-export-"));
    classifiedPath = path.join(tempRoot, "classified");
    feedbackPath = path.join(tempRoot, "feedback", "2026", "03", "13");
    outputPath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-1.sqlite");
    manifestPath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-1.manifest.json");

    await mkdir(classifiedPath, { recursive: true });
    await mkdir(feedbackPath, { recursive: true });

    await writeFile(
      path.join(classifiedPath, "classification_tracks.jsonl"),
      [
        JSON.stringify({ sid_path: "A.sid", ratings: { e: 1, m: 1, c: 1, p: 3 }, features: { bpm: 90 }, classified_at: "2026-03-13T10:00:00.000Z", source: "auto", render_engine: "wasm" }),
        JSON.stringify({ sid_path: "B.sid", ratings: { e: 1, m: 1, c: 2, p: 3 }, features: { bpm: 92 }, classified_at: "2026-03-13T10:01:00.000Z", source: "auto", render_engine: "wasm" }),
        JSON.stringify({ sid_path: "C.sid", ratings: { e: 5, m: 5, c: 5, p: 3 }, features: { bpm: 140 }, classified_at: "2026-03-13T10:02:00.000Z", source: "auto", render_engine: "wasm" }),
        JSON.stringify({ sid_path: "D.sid", ratings: { e: 1, m: 2, c: 1, p: 4 }, features: { bpm: 88 }, classified_at: "2026-03-13T10:03:00.000Z", source: "manual", render_engine: "sidplayfp-cli" }),
      ].join("\n") + "\n",
      "utf8",
    );

    await writeFile(
      path.join(feedbackPath, "events.jsonl"),
      [
        JSON.stringify({ ts: "2026-03-13T11:00:00.000Z", sid_path: "A.sid", action: "play" }),
        JSON.stringify({ ts: "2026-03-13T11:01:00.000Z", sid_path: "A.sid", action: "like" }),
        JSON.stringify({ ts: "2026-03-13T11:02:00.000Z", sid_path: "B.sid", action: "play" }),
        JSON.stringify({ ts: "2026-03-13T11:03:00.000Z", sid_path: "D.sid", action: "like" }),
      ].join("\n") + "\n",
      "utf8",
    );
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

    expect(result.manifest.track_count).toBe(4);
    expect(result.manifest.neighbor_row_count).toBe(8);
    expect(result.manifest.file_checksums.sqlite_sha256).toHaveLength(64);

    const manifestFromFile = await readSimilarityExportManifest(manifestPath);
    const manifestFromDatabase = readSimilarityExportManifestFromDatabase(outputPath);
    expect(manifestFromFile.schema_version).toBe("sidcorr-1");
    expect(manifestFromDatabase.track_count).toBe(4);
    expect(manifestFromDatabase.corpus_version).toBe("TEST-1");
  });

  test("recommends similar tracks from a seed SID path", async () => {
    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath,
      manifestPath,
      neighbors: 2,
    });

    const recommendations = recommendFromSeedTrack(outputPath, {
      seedSidPath: "A.sid",
      limit: 2,
    });

    expect(recommendations.map((entry) => entry.sid_path)).toEqual(["D.sid", "B.sid"]);
    expect(recommendations[0].score).toBeGreaterThan(recommendations[1].score);
  });

  test("recommends a centroid-based playlist from favorites", async () => {
    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath,
      manifestPath,
      neighbors: 0,
    });

    const recommendations = recommendFromFavorites(outputPath, {
      favoriteSidPaths: ["A.sid", "D.sid"],
      limit: 2,
    });

    expect(recommendations.map((entry) => entry.sid_path)).toEqual(["B.sid", "C.sid"]);
    expect(recommendations[0].rank).toBe(1);
  });

  test("deduplicates repeated sid_path records by keeping the newest classification", async () => {
    await writeFile(
      path.join(classifiedPath, "classification_dupe.jsonl"),
      [
        JSON.stringify({ sid_path: "A.sid", ratings: { e: 4, m: 4, c: 4, p: 2 }, features: { bpm: 110 }, classified_at: "2026-03-13T12:00:00.000Z", source: "auto", render_engine: "sidplayfp-cli" }),
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
      seedSidPath: "A.sid",
      limit: 1,
    });

    expect(recommendations[0]?.sid_path).toBe("C.sid");
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

    expect(result.manifest.track_count).toBe(4);
  });

  test("recovers exportable tracks from orphaned feature-phase JSONL files", async () => {
    await writeFile(
      path.join(classifiedPath, "features_2026-03-13_18-02-43-329.jsonl"),
      [
        JSON.stringify({
          sid_path: "E.sid",
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

    expect(result.manifest.track_count).toBe(6);

    const recommendations = recommendFromFavorites(outputPath, {
      favoriteSidPaths: ["E.sid"],
      limit: 2,
    });

    expect(recommendations.length).toBe(2);
  });
});