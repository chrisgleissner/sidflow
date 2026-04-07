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
import type { StationRuntime, StationTrackDetails } from "../src/station/types.js";

interface FixturePaths {
  tempRoot: string;
  classifiedPath: string;
  feedbackRoot: string;
  hvscRoot: string;
  sqlitePath: string;
  litePath: string;
  tinyPath: string;
}

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function buildFixtureRecords(): Array<{ sidPath: string; record: Record<string, unknown> }> {
  const records: Array<{ sidPath: string; record: Record<string, unknown> }> = [];
  const clusters = [
    { prefix: "melodic", count: 132, base: { e: 3, m: 5, c: 5, p: 4 } },
    { prefix: "fast", count: 24, base: { e: 5, m: 2, c: 4, p: 5 } },
    { prefix: "ambient", count: 20, base: { e: 1, m: 4, c: 2, p: 3 } },
  ];

  for (const cluster of clusters) {
    for (let index = 0; index < cluster.count; index += 1) {
      const sidPath = `${cluster.prefix}/${cluster.prefix}-${String(index + 1).padStart(3, "0")}.sid`;
      const melodicTier = Math.floor(index / 22);
      const energyDelta = cluster.prefix === "melodic"
        ? (melodicTier >= 4 ? -1 : 0)
        : ((index % 5) === 0 ? -1 : (index % 5) === 1 ? 1 : 0);
      const moodDelta = cluster.prefix === "melodic"
        ? -Math.min(1, Math.floor(index / 66))
        : ((index % 4) === 0 ? -1 : 0);
      const complexityDelta = cluster.prefix === "melodic"
        ? -Math.min(1, Math.floor(index / 66))
        : ((index % 3) - 1);
      const preferenceDelta = cluster.prefix === "melodic"
        ? -Math.min(1, Math.floor(index / 66))
        : ((index % 2) === 0 ? 0 : -1);
      const ratings = {
        e: Math.max(1, Math.min(5, cluster.base.e + energyDelta)),
        m: Math.max(1, Math.min(5, cluster.base.m + moodDelta)),
        c: Math.max(1, Math.min(5, cluster.base.c + complexityDelta)),
        p: Math.max(1, Math.min(5, cluster.base.p + preferenceDelta)),
      };
      records.push({
        sidPath,
        record: {
          sid_path: sidPath,
          song_index: 1,
          ratings,
          vector: [ratings.e, ratings.m, ratings.c, ratings.p],
          features: { bpm: 72 + index },
          classified_at: `2026-04-07T12:${String(index % 60).padStart(2, "0")}:00.000Z`,
          source: "auto",
          render_engine: "wasm",
        },
      });
    }
  }

  return records.sort((left, right) => left.sidPath.localeCompare(right.sidPath));
}

async function buildFixture(): Promise<FixturePaths> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-portable-station-"));
  const classifiedPath = path.join(tempRoot, "classified");
  const feedbackRoot = path.join(tempRoot, "feedback");
  const feedbackPath = path.join(feedbackRoot, "2026", "04", "07");
  const hvscRoot = path.join(tempRoot, "hvsc");
  const sqlitePath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-1.sqlite");
  const litePath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-lite-1.sidcorr");
  const tinyPath = path.join(tempRoot, "exports", "sidcorr-test-full-sidcorr-tiny-1.sidcorr");

  await mkdir(classifiedPath, { recursive: true });
  await mkdir(feedbackPath, { recursive: true });
  await mkdir(hvscRoot, { recursive: true });

  const records = buildFixtureRecords();
  await writeFile(
    path.join(classifiedPath, "classification_tracks.jsonl"),
    `${records.map(({ record }) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );

  await writeFile(
    path.join(feedbackPath, "events.jsonl"),
    `${records.slice(0, 24).map(({ sidPath }, index) => JSON.stringify({
      ts: `2026-04-07T13:${String(index).padStart(2, "0")}:00.000Z`,
      sid_path: sidPath,
      song_index: 1,
      action: index % 3 === 0 ? "like" : "play",
    })).join("\n")}\n`,
    "utf8",
  );

  for (const { sidPath } of records) {
    const absolutePath = path.join(hvscRoot, sidPath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(`PSID-${sidPath}`, "utf8"));
  }

  await buildSimilarityExport({
    classifiedPath,
    feedbackPath: feedbackRoot,
    outputPath: sqlitePath,
    neighbors: 12,
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

  return {
    tempRoot,
    classifiedPath,
    feedbackRoot,
    hvscRoot,
    sqlitePath,
    litePath,
    tinyPath,
  };
}

function createRuntime(tempRoot: string, classifiedPath: string, hvscRoot: string, seed: number): StationRuntime {
  return {
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
      released: "1991 Test Release",
      songs: 1,
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
    now: () => new Date("2026-04-07T14:00:00.000Z"),
    random: createDeterministicRandom(seed),
    onSignal: () => undefined,
    offSignal: () => undefined,
  };
}

function overlapAt(reference: string[], candidate: string[], limit: number): number {
  const referenceSet = new Set(reference.slice(0, limit));
  const candidateSet = new Set(candidate.slice(0, limit));
  let overlap = 0;
  for (const trackId of candidateSet) {
    if (referenceSet.has(trackId)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(1, limit);
}

function jaccardAt(reference: string[], candidate: string[], limit: number): number {
  const referenceSet = new Set(reference.slice(0, limit));
  const candidateSet = new Set(candidate.slice(0, limit));
  let intersection = 0;
  for (const trackId of referenceSet) {
    if (candidateSet.has(trackId)) {
      intersection += 1;
    }
  }
  const union = new Set([...referenceSet, ...candidateSet]).size;
  return intersection / Math.max(1, union);
}

function spearmanAt(reference: string[], candidate: string[], limit: number): number {
  const referenceRanks = new Map(reference.slice(0, limit).map((trackId, index) => [trackId, index + 1]));
  const candidateRanks = new Map(candidate.slice(0, limit).map((trackId, index) => [trackId, index + 1]));
  const common = [...referenceRanks.keys()].filter((trackId) => candidateRanks.has(trackId));
  if (common.length < 2) {
    return 0;
  }
  const sumSquared = common.reduce((total, trackId) => {
    const delta = referenceRanks.get(trackId)! - candidateRanks.get(trackId)!;
    return total + (delta * delta);
  }, 0);
  const count = common.length;
  return 1 - ((6 * sumSquared) / (count * ((count * count) - 1)));
}

function styleDistribution(handle: Awaited<ReturnType<typeof openStationSimilarityDataset>>, queue: StationTrackDetails[], limit: number): number[] {
  const counts = new Array(9).fill(0);
  for (const track of queue.slice(0, limit)) {
    const mask = handle.getStyleMask(track.track_id) ?? 0;
    for (let bit = 0; bit < counts.length; bit += 1) {
      if ((mask & (1 << bit)) !== 0) {
        counts[bit] += 1;
      }
    }
  }
  return counts.map((count) => count / Math.max(1, limit));
}

function maxDistributionDelta(left: number[], right: number[]): number {
  return left.reduce((max, value, index) => Math.max(max, Math.abs(value - (right[index] ?? 0))), 0);
}

describe("portable station equivalence", () => {
  let fixture: FixturePaths;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  afterEach(async () => {
    await rm(fixture.tempRoot, { recursive: true, force: true });
  });

  test("keeps sqlite, lite, and tiny stations equivalent enough for production thresholds", async () => {
    const ratings = new Map<string, number>([
      [buildSimilarityTrackId("melodic/melodic-001.sid", 1), 5],
      [buildSimilarityTrackId("melodic/melodic-002.sid", 1), 5],
      [buildSimilarityTrackId("melodic/melodic-003.sid", 1), 4],
      [buildSimilarityTrackId("melodic/melodic-004.sid", 1), 5],
      [buildSimilarityTrackId("melodic/melodic-005.sid", 1), 4],
      [buildSimilarityTrackId("melodic/melodic-006.sid", 1), 4],
      [buildSimilarityTrackId("ambient/ambient-001.sid", 1), 2],
      [buildSimilarityTrackId("ambient/ambient-002.sid", 1), 2],
    ]);

    const sqliteHandle = await openStationSimilarityDataset(fixture.sqlitePath, "sqlite", fixture.hvscRoot);
    const liteHandle = await openStationSimilarityDataset(fixture.litePath, "lite", fixture.hvscRoot);
    const tinyHandle = await openStationSimilarityDataset(fixture.tinyPath, "tiny", fixture.hvscRoot);

    const sqliteQueue = await buildStationQueue(
      sqliteHandle,
      fixture.hvscRoot,
      ratings,
      100,
      5,
      15,
      createRuntime(fixture.tempRoot, fixture.classifiedPath, fixture.hvscRoot, 17),
      new Map(),
    );
    const liteQueue = await buildStationQueue(
      liteHandle,
      fixture.hvscRoot,
      ratings,
      100,
      5,
      15,
      createRuntime(fixture.tempRoot, fixture.classifiedPath, fixture.hvscRoot, 17),
      new Map(),
    );
    const tinyQueue = await buildStationQueue(
      tinyHandle,
      fixture.hvscRoot,
      ratings,
      100,
      5,
      15,
      createRuntime(fixture.tempRoot, fixture.classifiedPath, fixture.hvscRoot, 17),
      new Map(),
    );

    expect(sqliteQueue.length).toBe(100);
    expect(liteQueue.length).toBe(100);
    expect(tinyQueue.length).toBe(100);

    const sqliteIds = sqliteQueue.map((track) => track.track_id);
    const liteIds = liteQueue.map((track) => track.track_id);
    const tinyIds = tinyQueue.map((track) => track.track_id);

    expect(overlapAt(sqliteIds, liteIds, 50)).toBeGreaterThanOrEqual(0.95);
    expect(overlapAt(sqliteIds, liteIds, 100)).toBeGreaterThanOrEqual(0.95);
    expect(jaccardAt(sqliteIds, liteIds, 100)).toBeGreaterThanOrEqual(0.90);
    expect(spearmanAt(sqliteIds, liteIds, 100)).toBeGreaterThanOrEqual(0.90);

    expect(overlapAt(sqliteIds, tinyIds, 50)).toBeGreaterThanOrEqual(0.80);
    expect(overlapAt(sqliteIds, tinyIds, 100)).toBeGreaterThanOrEqual(0.85);
    expect(jaccardAt(sqliteIds, tinyIds, 100)).toBeGreaterThanOrEqual(0.70);
    expect(spearmanAt(sqliteIds, tinyIds, 100)).toBeGreaterThanOrEqual(0.65);

    const sqliteStyle = styleDistribution(sqliteHandle, sqliteQueue, 100);
    const liteStyle = styleDistribution(liteHandle, liteQueue, 100);
    const tinyStyle = styleDistribution(tinyHandle, tinyQueue, 100);

    expect(maxDistributionDelta(sqliteStyle, liteStyle)).toBeLessThanOrEqual(0.05);
    expect(maxDistributionDelta(sqliteStyle, tinyStyle)).toBeLessThanOrEqual(0.18);

    for (const track of tinyQueue.slice(0, 10)) {
      expect(tinyHandle.getNeighbors(track.track_id, 3).length).toBeGreaterThan(0);
    }
  });
});