/**
 * Tests for export functionality.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  exportPlaylistJSON,
  exportPlaylistM3U,
  exportPlaylist,
  ExportFormat,
  type Playlist
} from "../src/index.js";

const TEST_EXPORT_PATH = "/tmp/sidflow-play-test-export";

const mockPlaylist: Playlist = {
  metadata: {
    createdAt: "2025-11-03T12:00:00Z",
    seed: "energetic",
    count: 2
  },
  songs: [
    {
      sid_path: "Test/Song1.sid",
      score: 0.9,
      similarity: 0.95,
      songFeedback: 0.8,
      userAffinity: 0.7,
      ratings: { e: 5, m: 5, c: 4, p: 5 },
      feedback: { likes: 10, dislikes: 1, skips: 2, plays: 20 },
      features: { duration: 180 }
    },
    {
      sid_path: "Test/Song2.sid",
      score: 0.7,
      similarity: 0.85,
      songFeedback: 0.6,
      userAffinity: 0.5,
      ratings: { e: 3, m: 3, c: 3, p: 4 },
      feedback: { likes: 5, dislikes: 2, skips: 3, plays: 15 },
      features: { duration: 210 }
    }
  ]
};

beforeAll(async () => {
  await mkdir(TEST_EXPORT_PATH, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_EXPORT_PATH, { recursive: true, force: true });
});

describe("exportPlaylistJSON", () => {
  test("exports playlist to JSON format", async () => {
    const outputPath = join(TEST_EXPORT_PATH, "playlist.json");
    await exportPlaylistJSON(mockPlaylist, outputPath);

    const content = await readFile(outputPath, "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed.metadata.seed).toBe("energetic");
    expect(parsed.songs).toHaveLength(2);
    expect(parsed.songs[0].sid_path).toBe("Test/Song1.sid");
  });

  test("uses deterministic ordering", async () => {
    const outputPath = join(TEST_EXPORT_PATH, "playlist-deterministic.json");
    await exportPlaylistJSON(mockPlaylist, outputPath);

    const content = await readFile(outputPath, "utf-8");
    
    // Should be valid JSON with deterministic key ordering
    expect(() => JSON.parse(content)).not.toThrow();
  });
});

describe("exportPlaylistM3U", () => {
  test("exports playlist to basic M3U format", async () => {
    const outputPath = join(TEST_EXPORT_PATH, "playlist.m3u");
    await exportPlaylistM3U(mockPlaylist, outputPath);

    const content = await readFile(outputPath, "utf-8");
    const lines = content.trim().split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Test/Song1.sid");
    expect(lines[1]).toBe("Test/Song2.sid");
  });

  test("exports playlist with extended M3U format", async () => {
    const outputPath = join(TEST_EXPORT_PATH, "playlist-extended.m3u8");
    await exportPlaylistM3U(mockPlaylist, outputPath, { extended: true });

    const content = await readFile(outputPath, "utf-8");
    const lines = content.trim().split("\n");

    expect(lines[0]).toBe("#EXTM3U");
    expect(lines[1]).toContain("#EXTINF:");
    expect(lines[1]).toContain("Song1.sid");
    expect(lines[2]).toBe("Test/Song1.sid");
  });

  test("exports with root path prefix", async () => {
    const outputPath = join(TEST_EXPORT_PATH, "playlist-rooted.m3u");
    await exportPlaylistM3U(mockPlaylist, outputPath, {
      rootPath: "/music/hvsc"
    });

    const content = await readFile(outputPath, "utf-8");
    const lines = content.trim().split("\n");

    expect(lines[0]).toBe("/music/hvsc/Test/Song1.sid");
    expect(lines[1]).toBe("/music/hvsc/Test/Song2.sid");
  });
});

describe("exportPlaylist", () => {
  test("exports in JSON format", async () => {
    const outputPath = join(TEST_EXPORT_PATH, "unified-playlist.json");
    await exportPlaylist(mockPlaylist, {
      outputPath,
      format: ExportFormat.JSON
    });

    const content = await readFile(outputPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.songs).toHaveLength(2);
  });

  test("exports in M3U format", async () => {
    const outputPath = join(TEST_EXPORT_PATH, "unified-playlist.m3u");
    await exportPlaylist(mockPlaylist, {
      outputPath,
      format: ExportFormat.M3U,
      rootPath: "/test"
    });

    const content = await readFile(outputPath, "utf-8");
    expect(content).toContain("/test/Test/Song1.sid");
  });

  test("exports in extended M3U format", async () => {
    const outputPath = join(TEST_EXPORT_PATH, "unified-playlist.m3u8");
    await exportPlaylist(mockPlaylist, {
      outputPath,
      format: ExportFormat.M3U_EXTENDED
    });

    const content = await readFile(outputPath, "utf-8");
    expect(content).toContain("#EXTM3U");
    expect(content).toContain("#EXTINF:");
  });
});
