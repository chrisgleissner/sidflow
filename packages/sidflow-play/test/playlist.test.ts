/**
 * Tests for playlist builder.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { stringifyDeterministic } from "@sidflow/common";
import { createPlaylistBuilder } from "../src/playlist.js";

const TEST_DB_PATH = "/tmp/sidflow-play-test-db";
const TEST_DATA_PATH = join(TEST_DB_PATH, "test-data");

// Setup test database
beforeAll(async () => {
  await mkdir(TEST_DATA_PATH, { recursive: true });
  
  // Create sample classification data
  const classifiedData = [
    {
      sid_path: "Test/Song1.sid",
      ratings: { e: 5, m: 5, c: 4, p: 5 },
      features: { energy: 0.8, rms: 0.2, bpm: 140 }
    },
    {
      sid_path: "Test/Song2.sid",
      ratings: { e: 1, m: 2, c: 1, p: 3 },
      features: { energy: 0.1, rms: 0.05, bpm: 80 }
    },
    {
      sid_path: "Test/Song3.sid",
      ratings: { e: 3, m: 3, c: 3, p: 4 },
      features: { energy: 0.5, rms: 0.15, bpm: 120 }
    }
  ];

  const jsonlContent = classifiedData
    .map(record => JSON.stringify(record))
    .join("\n");

  await writeFile(
    join(TEST_DATA_PATH, "classified.jsonl"),
    jsonlContent,
    "utf-8"
  );

  // Build test database (this would normally use build-db script)
  // For now, we'll skip actual LanceDB creation in tests
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

  // Note: Full database integration tests require LanceDB setup
  // which is skipped in unit tests. Integration tests should cover
  // actual playlist generation with a real database.
});
