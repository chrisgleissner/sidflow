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
      path.join(classifiedPath, "tracks.jsonl"),
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
});