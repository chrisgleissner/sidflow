import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildLiteSimilarityExport,
  buildSimilarityExport,
  buildSimilarityTrackId,
  buildTinySimilarityExport,
  openLiteSimilarityDataset,
  openSqliteSimilarityDataset,
  openTinySimilarityDataset,
  type SimilarityDataset,
} from "../src/index.js";

interface FixturePaths {
  tempRoot: string;
  classifiedPath: string;
  feedbackRoot: string;
  feedbackPath: string;
  hvscRoot: string;
  sqlitePath: string;
  litePath: string;
  tinyPath: string;
}

function buildFixtureRecords(): Array<{ sidPath: string; record: Record<string, unknown> }> {
  const records: Array<{ sidPath: string; record: Record<string, unknown> }> = [];
  const clusters = [
    { prefix: "melodic", count: 24, base: { e: 2, m: 5, c: 5, p: 4 } },
    { prefix: "fast", count: 24, base: { e: 5, m: 2, c: 4, p: 5 } },
    { prefix: "ambient", count: 24, base: { e: 1, m: 4, c: 2, p: 3 } },
  ];

  for (const cluster of clusters) {
    for (let index = 0; index < cluster.count; index += 1) {
      const sidPath = `${cluster.prefix}/${cluster.prefix}-${String(index + 1).padStart(3, "0")}.sid`;
      records.push({
        sidPath,
        record: {
          sid_path: sidPath,
          song_index: 1,
          ratings: {
            e: Math.max(1, Math.min(5, cluster.base.e + ((index % 3) - 1))),
            m: Math.max(1, Math.min(5, cluster.base.m + (((index + 1) % 3) - 1))),
            c: Math.max(1, Math.min(5, cluster.base.c + (((index + 2) % 3) - 1))),
            p: Math.max(1, Math.min(5, cluster.base.p + ((index % 2) === 0 ? 0 : -1))),
          },
          features: { bpm: 80 + index },
          classified_at: `2026-04-07T12:${String(index).padStart(2, "0")}:00.000Z`,
          source: "auto",
          render_engine: "wasm",
        },
      });
    }
  }

  return records.sort((left, right) => left.sidPath.localeCompare(right.sidPath));
}

async function buildFixture(): Promise<FixturePaths> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-similarity-dataset-"));
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
    `${records.slice(0, 12).map(({ sidPath }, index) => JSON.stringify({
      ts: `2026-04-07T13:${String(index).padStart(2, "0")}:00.000Z`,
      sid_path: sidPath,
      song_index: 1,
      action: index % 2 === 0 ? "play" : "like",
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
    neighbors: 8,
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
    feedbackPath,
    hvscRoot,
    sqlitePath,
    litePath,
    tinyPath,
  };
}

function reachableCount(dataset: SimilarityDataset, seedTrackId: string, depth: number): number {
  const visited = new Set<string>([seedTrackId]);
  const queue = [{ trackId: seedTrackId, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= depth) {
      continue;
    }
    for (const neighbor of dataset.getNeighbors(current.trackId, 3)) {
      if (visited.has(neighbor.track_id)) {
        continue;
      }
      visited.add(neighbor.track_id);
      queue.push({ trackId: neighbor.track_id, depth: current.depth + 1 });
    }
  }
  return visited.size;
}

describe("similarity dataset backends", () => {
  let fixture: FixturePaths;

  beforeEach(async () => {
    fixture = await buildFixture();
  });

  afterEach(async () => {
    await rm(fixture.tempRoot, { recursive: true, force: true });
  });

  test("preserves track identity and ratings across sqlite, lite, and tiny datasets", async () => {
    const sqlite = openSqliteSimilarityDataset(fixture.sqlitePath);
    const lite = await openLiteSimilarityDataset(fixture.litePath);
    const tiny = await openTinySimilarityDataset(fixture.tinyPath, { hvscRoot: fixture.hvscRoot });
    const trackId = buildSimilarityTrackId("melodic/melodic-001.sid", 1);

    const sqliteRow = sqlite.resolveTrack(trackId);
    const liteRow = lite.resolveTrack(trackId);
    const tinyRow = tiny.resolveTrack(trackId);

    expect(sqliteRow).not.toBeNull();
    expect(liteRow).toEqual(sqliteRow);
    expect(tinyRow).toEqual({
      ...sqliteRow!,
      likes: 0,
      dislikes: 0,
      skips: 0,
      plays: 0,
      decayed_likes: 0,
      decayed_dislikes: 0,
      decayed_skips: 0,
      decayed_plays: 0,
      last_played: null,
    });
  });

  test("keeps style masks consistent across all formats", async () => {
    const sqlite = openSqliteSimilarityDataset(fixture.sqlitePath);
    const lite = await openLiteSimilarityDataset(fixture.litePath);
    const tiny = await openTinySimilarityDataset(fixture.tinyPath, { hvscRoot: fixture.hvscRoot });
    const trackIds = buildFixtureRecords().map(({ sidPath }) => buildSimilarityTrackId(sidPath, 1));

    for (const trackId of trackIds) {
      expect(lite.getStyleMask(trackId)).toBe(sqlite.getStyleMask(trackId));
      expect(tiny.getStyleMask(trackId)).toBe(sqlite.getStyleMask(trackId));
    }
  });

  test("tiny keeps neighbor ranking and reachability close to sqlite", async () => {
    const sqlite = openSqliteSimilarityDataset(fixture.sqlitePath);
    const tiny = await openTinySimilarityDataset(fixture.tinyPath, { hvscRoot: fixture.hvscRoot });
    const seedTrackId = buildSimilarityTrackId("fast/fast-001.sid", 1);

    const sqliteNeighbors = sqlite.getNeighbors(seedTrackId, 5).map((entry) => entry.track_id);
    const tinyNeighbors = tiny.getNeighbors(seedTrackId, 5).map((entry) => entry.track_id);
    const overlap = tinyNeighbors.filter((trackId) => sqliteNeighbors.includes(trackId));

    expect(overlap.length).toBeGreaterThanOrEqual(3);

    const sqliteReachable = reachableCount(sqlite, seedTrackId, 3);
    const tinyReachable = reachableCount(tiny, seedTrackId, 3);

    expect(tinyReachable).toBeGreaterThanOrEqual(Math.floor(sqliteReachable * 0.7));
    expect(tinyReachable).toBeGreaterThanOrEqual(14);
  });
});