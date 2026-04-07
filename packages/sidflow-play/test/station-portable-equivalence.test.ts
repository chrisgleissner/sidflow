import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildLiteSimilarityExport,
  buildSimilarityExport,
  buildSimilarityTrackId,
  buildTinySimilarityExport,
  type SidFileMetadata,
} from "@sidflow/common";
import { buildStationQueue, openStationSimilarityDataset } from "../src/station/queue.js";
import type { StationRuntime } from "../src/station/types.js";

describe("portable station equivalence", () => {
  let tempRoot: string;
  let classifiedPath: string;
  let feedbackPath: string;
  let hvscRoot: string;
  let sqlitePath: string;
  let litePath: string;
  let tinyPath: string;
  let runtime: StationRuntime;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-portable-station-"));
    classifiedPath = path.join(tempRoot, "classified");
    feedbackPath = path.join(tempRoot, "feedback", "2026", "03", "13");
    hvscRoot = path.join(tempRoot, "hvsc");
    sqlitePath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-1.sqlite");
    litePath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-lite-1.sidcorr");
    tinyPath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-tiny-1.sidcorr");

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
      ].join("\n") + "\n",
      "utf8",
    );

    for (const sidName of ["A.sid", "B.sid", "C.sid", "D.sid"]) {
      await writeFile(path.join(hvscRoot, sidName), Buffer.from(`PSID-${sidName}`, "utf8"));
    }

    await buildSimilarityExport({
      classifiedPath,
      feedbackPath: path.join(tempRoot, "feedback"),
      outputPath: sqlitePath,
      neighbors: 3,
      corpusVersion: "TEST-1",
    });
    await buildLiteSimilarityExport({
      sourceSqlitePath: sqlitePath,
      outputPath: litePath,
      corpusVersion: "TEST-1",
    });
    await buildTinySimilarityExport({
      sourceSqlitePath: sqlitePath,
      hvscRoot,
      outputPath: tinyPath,
      corpusVersion: "TEST-1",
    });

    runtime = {
      loadConfig: async () => ({
        sidPath: hvscRoot,
        audioCachePath: tempRoot,
        tagsPath: tempRoot,
        classifiedPath,
        sidplayPath: "/usr/bin/sidplayfp",
        threads: 1,
        classificationDepth: 1,
      }),
      parseSidFile: async (filePath: string): Promise<SidFileMetadata> => ({
        type: "PSID",
        version: 2,
        title: path.basename(filePath),
        author: "Test Composer",
        released: "1990 Test Release",
        songs: 2,
        startSong: 1,
        clock: "PAL",
        sidModel1: "MOS6581",
        loadAddress: 0,
        initAddress: 0,
        playAddress: 0,
      }),
      lookupSongDurationMs: async () => 120_000,
      fetchImpl: globalThis.fetch,
      stdout: process.stdout,
      stderr: process.stderr,
      stdin: process.stdin,
      cwd: () => tempRoot,
      now: () => new Date("2026-03-13T12:00:00.000Z"),
      random: () => 0,
      onSignal: () => undefined,
      offSignal: () => undefined,
    };
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("builds broadly equivalent station queues from sqlite, lite, and tiny exports", async () => {
    const ratings = new Map<string, number>([
      [buildSimilarityTrackId("A.sid", 1), 5],
    ]);
    const sqliteHandle = await openStationSimilarityDataset(sqlitePath, "sqlite", hvscRoot);
    const liteHandle = await openStationSimilarityDataset(litePath, "lite", hvscRoot);
    const tinyHandle = await openStationSimilarityDataset(tinyPath, "tiny", hvscRoot);

    const sqliteQueue = await buildStationQueue(sqliteHandle, hvscRoot, ratings, 1, 5, 15, runtime, new Map());
    const liteQueue = await buildStationQueue(liteHandle, hvscRoot, ratings, 1, 5, 15, runtime, new Map());
    const tinyQueue = await buildStationQueue(tinyHandle, hvscRoot, ratings, 1, 5, 15, runtime, new Map());

    const sqliteIds = sqliteQueue.map((track) => track.track_id);
    const liteIds = liteQueue.map((track) => track.track_id);
    const tinyIds = tinyQueue.map((track) => track.track_id);

    expect(sqliteIds.length).toBeGreaterThan(0);
    expect(liteIds.length).toBeGreaterThan(0);
    expect(tinyIds.length).toBeGreaterThan(0);
    expect(sqliteIds[0]).toBe(liteIds[0]);
    expect(tinyIds.filter((trackId) => sqliteIds.includes(trackId)).length).toBeGreaterThanOrEqual(1);
    expect(tinyIds.filter((trackId) => liteIds.includes(trackId)).length).toBeGreaterThanOrEqual(1);
  });
});