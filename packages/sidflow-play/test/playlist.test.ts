/**
 * Tests for playlist builder.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { connect } from "vectordb";
import { createPlaylistBuilder } from "../src/playlist.js";
import type { Recommendation } from "@sidflow/common";

const TEST_DB_PATH = "/tmp/sidflow-play-test-db";
const TEST_DATA_PATH = join(TEST_DB_PATH, "test-data");

// Setup test database
beforeAll(async () => {
  await rm(TEST_DB_PATH, { recursive: true, force: true });
  await mkdir(TEST_DATA_PATH, { recursive: true });

  const sampleRecords: Array<Recommendation & { vector: number[] }> = [
    {
      sid_path: "Test/Song1.sid",
      score: 0.9,
      similarity: 0.95,
      songFeedback: 0.8,
      userAffinity: 0.7,
      ratings: { e: 5, m: 5, c: 4, p: 5 },
      feedback: { likes: 10, dislikes: 1, skips: 2, plays: 20 },
      vector: [5, 5, 4, 5]
    },
    {
      sid_path: "Test/Song2.sid",
      score: 0.7,
      similarity: 0.85,
      songFeedback: 0.6,
      userAffinity: 0.5,
      ratings: { e: 1, m: 2, c: 1, p: 3 },
      feedback: { likes: 5, dislikes: 2, skips: 3, plays: 15 },
      vector: [1, 2, 1, 3]
    },
    {
      sid_path: "Test/Song3.sid",
      score: 0.8,
      similarity: 0.9,
      songFeedback: 0.7,
      userAffinity: 0.6,
      ratings: { e: 3, m: 3, c: 3, p: 4 },
      feedback: { likes: 8, dislikes: 1, skips: 1, plays: 18 },
      vector: [3, 3, 3, 4]
    }
  ];

  const db = await connect(TEST_DB_PATH);
  await db.createTable(
    "sidflow",
    sampleRecords.map((record) => ({
      sid_path: record.sid_path,
      vector: record.vector,
      e: record.ratings.e,
      m: record.ratings.m,
      c: record.ratings.c,
      p: record.ratings.p,
      likes: record.feedback.likes,
      dislikes: record.feedback.dislikes,
      skips: record.feedback.skips,
      plays: record.feedback.plays,
      features_json: JSON.stringify({ bpm: 120, energy: 0.5 })
    }))
  );
});

afterAll(async () => {
  await rm(TEST_DB_PATH, { recursive: true, force: true });
});

describe("PlaylistBuilder", () => {
  test("creates playlist builder instance", () => {
    const builder = createPlaylistBuilder({ dbPath: TEST_DB_PATH });
    expect(builder).toBeDefined();
  });

  test("getMoodPresets returns available presets", () => {
    const builder = createPlaylistBuilder({ dbPath: TEST_DB_PATH });
    const presets = builder.getMoodPresets();
    
    expect(presets).toHaveProperty("quiet");
    expect(presets).toHaveProperty("energetic");
    expect(presets).toHaveProperty("dark");
    expect(presets.energetic).toEqual({ e: 5, m: 5, c: 4 });
  });

  test("throws when build is called before connect", async () => {
    const builder = createPlaylistBuilder({ dbPath: TEST_DB_PATH });
    await expect(builder.build({ seed: "quiet" })).rejects.toThrow("not connected");
  });

  test("connects, builds, and disconnects", async () => {
    const builder = createPlaylistBuilder({ dbPath: TEST_DB_PATH });
    await builder.connect();

    const playlist = await builder.build({ seed: "energetic", limit: 2 });
    expect(playlist.songs.length).toBeGreaterThan(0);
    expect(playlist.metadata.count).toBe(playlist.songs.length);
    expect(playlist.metadata.seed).toBe("energetic");

    await builder.disconnect();
  });

  test("supports custom seed and filters", async () => {
    const builder = createPlaylistBuilder({ dbPath: TEST_DB_PATH });
    await builder.connect();

    const playlist = await builder.build({
      seed: { e: 4, m: 4, c: 4 },
      filters: { energyRange: [2, 5] },
      explorationFactor: 0.3,
      diversityThreshold: 0.4
    });

    expect(playlist.metadata.filters?.energyRange).toEqual([2, 5]);
    expect(playlist.metadata.count).toBe(playlist.songs.length);

    await builder.disconnect();
  });

  // Note: Full database integration tests require LanceDB setup
  // which is skipped in unit tests. Integration tests should cover
  // actual playlist generation with a real database.
});
