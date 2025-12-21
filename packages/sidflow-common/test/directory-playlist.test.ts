import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { updateDirectoryPlaylist } from "../src/directory-playlist.js";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-playlist-");

describe("updateDirectoryPlaylist", () => {
  it("writes a playlist when multiple WAV files exist", async () => {
    const dir = await mkdtemp(TEMP_PREFIX);
    try {
      await writeFile(path.join(dir, "b-track.wav"), "b");
      await writeFile(path.join(dir, "a-track.wav"), "a");
      await writeFile(path.join(dir, "notes.txt"), "ignore me");

      const playlistPath = await updateDirectoryPlaylist(dir);
      expect(playlistPath).toBe(path.join(dir, "playlist.m3u8"));

      const content = await readFile(playlistPath!, "utf8");
      const lines = content.trim().split("\n");
      expect(lines[0]).toBe("#EXTM3U");
      expect(lines).toContain("#EXTINF:-1,a-track");
      expect(lines).toContain("a-track.wav");
      expect(lines).toContain("#EXTINF:-1,b-track");
      expect(lines.indexOf("a-track.wav")).toBeLessThan(lines.indexOf("b-track.wav"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("removes the playlist when there are fewer than two WAV files", async () => {
    const dir = await mkdtemp(TEMP_PREFIX);
    try {
      await writeFile(path.join(dir, "only.wav"), "solo");
      const playlistPath = path.join(dir, "playlist.m3u8");
      await writeFile(playlistPath, "stale");

      const result = await updateDirectoryPlaylist(dir);
      expect(result).toBeNull();
      await expect(stat(playlistPath)).rejects.toThrow(/ENOENT/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
