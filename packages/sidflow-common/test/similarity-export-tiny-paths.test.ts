/**
 * The tiny profile must interoperate with a real HVSC directory layout.
 *
 * Every other fixture in this repo uses a FLAT corpus ("A.sid", "B.sid"), which is
 * why this went unnoticed. Real HVSC nests everything under `C64Music/`, and where
 * an operator points `sidPath` decides whether the SQLite and lite exports record
 * "C64Music/DEMOS/x.sid" or "DEMOS/x.sid". The tiny bundle stores files by a 48-bit
 * MD5 prefix rather than by path and reconstructs ids relative to the MUSIC root, so
 * it always produces the unprefixed form.
 *
 * When those disagree nothing fails loudly: the bundle builds, reports correct track
 * and file counts, and resolves nothing at all. Measured on an 11,284-track corpus
 * before the fix, every lookup returned null and every station came back empty.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildLiteSimilarityExport,
  buildSimilarityExport,
  buildTinySimilarityExport,
  openTinySimilarityDataset,
} from "../src/index.js";

const TRACKS = [
  "DEMOS/0-9/First.sid",
  "DEMOS/A-F/Second.sid",
  "MUSICIANS/H/Hubbard_Rob/Third.sid",
  "MUSICIANS/H/Hubbard_Rob/Fourth.sid",
  "GAMES/A-F/Fifth.sid",
  "GAMES/G-L/Sixth.sid",
];

describe("tiny profile with a nested C64Music layout", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-tiny-paths-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  /**
   * `prefix` mirrors the operator's choice: pointing sidPath at the HVSC root gives
   * "C64Music/..." paths, pointing it at the music root gives bare ones.
   */
  async function build(prefix: "C64Music/" | "") {
    const root = path.join(tempRoot, prefix ? "prefixed" : "bare");
    const classifiedPath = path.join(root, "classified");
    const hvscRoot = path.join(root, "hvsc");
    const sqlitePath = path.join(root, "exports", "full.sqlite");
    const litePath = path.join(root, "exports", "lite.sidcorr");
    const tinyPath = path.join(root, "exports", "tiny.sidcorr");
    await mkdir(classifiedPath, { recursive: true });

    const lines: string[] = [];
    for (const [index, relative] of TRACKS.entries()) {
      // Real HVSC nests under C64Music/ regardless of what the export records.
      const onDisk = path.join(hvscRoot, "C64Music", relative);
      await mkdir(path.dirname(onDisk), { recursive: true });
      await writeFile(onDisk, Buffer.from(`PSID-${relative}`, "utf8"));

      lines.push(
        JSON.stringify({
          sid_path: `${prefix}${relative}`,
          song_index: 1,
          ratings: { e: 1 + (index % 5), m: 1 + (index % 5), c: 1 + (index % 5), p: 3 },
          features: { bpm: 100 + index },
          vector: Array.from({ length: 12 }, (_, d) => ((index * 7 + d * 3) % 20) / 20),
          classified_at: "2026-03-13T10:00:00.000Z",
          source: "auto",
          render_engine: "wasm",
        }),
      );
    }
    await writeFile(path.join(classifiedPath, "classification_tracks.jsonl"), `${lines.join("\n")}\n`, "utf8");

    const full = await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(root, "feedback"),
      outputPath: sqlitePath,
      manifestPath: path.join(root, "exports", "full.manifest.json"),
      corpusVersion: "paths",
      neighbors: 3,
    });
    await buildLiteSimilarityExport({ sourceSqlitePath: sqlitePath, outputPath: litePath, corpusVersion: "paths" });
    await buildTinySimilarityExport({
      sourceLitePath: litePath,
      hvscRoot,
      outputPath: tinyPath,
      neighborSqlitePath: sqlitePath,
      corpusVersion: "paths",
    });

    return { tinyPath, hvscRoot, full, seedTrackId: `${prefix}${TRACKS[0]!}#1` };
  }

  for (const prefix of ["C64Music/", ""] as const) {
    const label = prefix ? "C64Music-prefixed" : "music-root-relative";

    test(`resolves ${label} track ids`, async () => {
      const built = await build(prefix);
      const dataset = await openTinySimilarityDataset(built.tinyPath, { hvscRoot: built.hvscRoot });
      expect(dataset.info.trackCount).toBe(TRACKS.length);

      const resolved = dataset.resolveTrack(built.seedTrackId);
      expect(resolved).not.toBeNull();
      expect(resolved!.song_index).toBe(1);
    });

    test(`recommends from a ${label} seed`, async () => {
      const built = await build(prefix);
      const dataset = await openTinySimilarityDataset(built.tinyPath, { hvscRoot: built.hvscRoot });
      const recommendations = dataset.recommendFromFavorites({
        favoriteTrackIds: [built.seedTrackId],
        limit: 4,
      });
      expect(recommendations.length).toBeGreaterThan(0);
    });

    test(`never recommends the ${label} seed back to itself`, async () => {
      // The mismatch that survives a lookup-only fix: exclusion compares the
      // caller's id against the row's id, so a prefixed favourite is never
      // recognised and comes back as its own top recommendation at similarity 1.0.
      const built = await build(prefix);
      const dataset = await openTinySimilarityDataset(built.tinyPath, { hvscRoot: built.hvscRoot });
      const recommendations = dataset.recommendFromFavorites({
        favoriteTrackIds: [built.seedTrackId],
        limit: 6,
      });
      const seedSuffix = TRACKS[0]!;
      for (const recommendation of recommendations) {
        expect(recommendation.track_id.endsWith(`${seedSuffix}#1`)).toBe(false);
      }
    });
  }

  test("both conventions resolve against the same bundle", async () => {
    // Whichever way the export was written, a consumer holding the other form must
    // still work — that is what makes the three profiles interchangeable.
    const built = await build("C64Music/");
    const dataset = await openTinySimilarityDataset(built.tinyPath, { hvscRoot: built.hvscRoot });
    expect(dataset.resolveTrack(`C64Music/${TRACKS[0]!}#1`)).not.toBeNull();
    expect(dataset.resolveTrack(`${TRACKS[0]!}#1`)).not.toBeNull();
  });
});
