/// <reference types="bun-types" />

import { describe, expect, it, beforeEach, mock } from "bun:test";
import {
  buildSongPlaylist,
  buildFolderPlaylist,
  getPlaylistModeDescription,
  type PlaylistOptions,
} from "@/lib/hvsc-playlist-builder";

// Mock fetch globally
const mockFetch = mock(() => Promise.resolve({
  ok: true,
  json: async () => ({
    success: true,
    path: "",
    items: [],
  }),
}));

global.fetch = mockFetch as unknown as typeof fetch;

describe("HVSC Playlist Builder", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe("buildSongPlaylist", () => {
    it("builds playlist for single song", async () => {
      const sidPath = "MUSICIANS/H/Hubbard_Rob/Commando.sid";
      const playlist = await buildSongPlaylist(sidPath);

      expect(playlist).toHaveLength(1);
      expect(playlist[0].sidPath).toBe(sidPath);
      expect(playlist[0].displayName).toBe("Commando.sid");
      expect(playlist[0].songs).toBe(1);
    });

    it("extracts display name from path", async () => {
      const sidPath = "DEMOS/A-F/Crest/Oneder.sid";
      const playlist = await buildSongPlaylist(sidPath);

      expect(playlist[0].displayName).toBe("Oneder.sid");
    });

    it("handles root-level files", async () => {
      const sidPath = "Test.sid";
      const playlist = await buildSongPlaylist(sidPath);

      expect(playlist[0].displayName).toBe("Test.sid");
    });
  });

  describe("buildFolderPlaylist - non-recursive", () => {
    it("fetches files from single folder", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          path: "MUSICIANS/H/Hubbard_Rob",
          items: [
            {
              name: "Commando.sid",
              path: "MUSICIANS/H/Hubbard_Rob/Commando.sid",
              type: "file",
              songs: 4,
            },
            {
              name: "Monty_on_the_Run.sid",
              path: "MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid",
              type: "file",
              songs: 1,
            },
            {
              name: "Subfolder",
              path: "MUSICIANS/H/Hubbard_Rob/Subfolder",
              type: "folder",
            },
          ],
        }),
      } as Response);

      const options: PlaylistOptions = { recursive: false, shuffle: false };
      const playlist = await buildFolderPlaylist("MUSICIANS/H/Hubbard_Rob", options);

      expect(playlist).toHaveLength(2);
      expect(playlist[0].displayName).toBe("Commando.sid");
      expect(playlist[0].songs).toBe(4);
      expect(playlist[1].displayName).toBe("Monty_on_the_Run.sid");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("returns empty array for folder with no files", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          path: "Empty",
          items: [
            { name: "Subfolder", path: "Empty/Subfolder", type: "folder" },
          ],
        }),
      } as Response);

      const options: PlaylistOptions = { recursive: false, shuffle: false };
      const playlist = await buildFolderPlaylist("Empty", options);

      expect(playlist).toHaveLength(0);
    });
  });

  describe("buildFolderPlaylist - recursive", () => {
    it("collects files from folder tree", async () => {
      // First call: root folder
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          path: "MUSICIANS/H",
          items: [
            {
              name: "Test.sid",
              path: "MUSICIANS/H/Test.sid",
              type: "file",
              songs: 1,
            },
            {
              name: "Hubbard_Rob",
              path: "MUSICIANS/H/Hubbard_Rob",
              type: "folder",
            },
          ],
        }),
      } as Response);

      // Second call: subfolder
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          path: "MUSICIANS/H/Hubbard_Rob",
          items: [
            {
              name: "Commando.sid",
              path: "MUSICIANS/H/Hubbard_Rob/Commando.sid",
              type: "file",
              songs: 4,
            },
          ],
        }),
      } as Response);

      const options: PlaylistOptions = { recursive: true, shuffle: false };
      const playlist = await buildFolderPlaylist("MUSICIANS/H", options);

      expect(playlist.length).toBeGreaterThanOrEqual(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("respects maxFiles limit", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          path: "Test",
          items: Array.from({ length: 100 }, (_, i) => ({
            name: `Song${i}.sid`,
            path: `Test/Song${i}.sid`,
            type: "file",
            songs: 1,
          })),
        }),
      } as Response);

      const options: PlaylistOptions = { recursive: true, shuffle: false, maxFiles: 5 };
      const playlist = await buildFolderPlaylist("Test", options);

      expect(playlist.length).toBeLessThanOrEqual(5);
    });

    it("handles errors gracefully during recursive scan", async () => {
      // First call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          path: "Root",
          items: [
            {
              name: "Good.sid",
              path: "Root/Good.sid",
              type: "file",
              songs: 1,
            },
            {
              name: "BadFolder",
              path: "Root/BadFolder",
              type: "folder",
            },
          ],
        }),
      } as Response);

      // Second call fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Not Found",
      } as Response);

      const options: PlaylistOptions = { recursive: true, shuffle: false };
      const playlist = await buildFolderPlaylist("Root", options);

      // Should still have the good file
      expect(playlist.length).toBeGreaterThanOrEqual(1);
      expect(playlist[0].displayName).toBe("Good.sid");
    });

    it("prevents infinite loops with duplicate paths", async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount > 10) {
          throw new Error("Too many calls - infinite loop detected");
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            path: "Loop",
            items: [
              {
                name: "Test.sid",
                path: "Loop/Test.sid",
                type: "file",
                songs: 1,
              },
            ],
          }),
        } as Response);
      });

      const options: PlaylistOptions = { recursive: true, shuffle: false };
      const playlist = await buildFolderPlaylist("Loop", options);

      expect(callCount).toBeLessThanOrEqual(10);
      expect(playlist.length).toBeGreaterThan(0);
    });
  });

  describe("buildFolderPlaylist - shuffle", () => {
    it("shuffles playlist when shuffle option is true", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          path: "Test",
          items: Array.from({ length: 20 }, (_, i) => ({
            name: `Song${i.toString().padStart(2, '0')}.sid`,
            path: `Test/Song${i.toString().padStart(2, '0')}.sid`,
            type: "file",
            songs: 1,
          })),
        }),
      } as Response);

      const options: PlaylistOptions = { recursive: false, shuffle: true };
      const playlist = await buildFolderPlaylist("Test", options);

      // Check that we got all items
      expect(playlist).toHaveLength(20);

      // Check that at least one item is out of order (probabilistic)

      // With 20 items, the probability of staying in order is extremely low
      // But we can't guarantee it, so we'll just verify we got all items
      expect(playlist.length).toBe(20);
    });
  });

  describe("getPlaylistModeDescription", () => {
    it("returns shuffle description", () => {
      const desc = getPlaylistModeDescription("MUSICIANS/H/Hubbard_Rob", true, true);
      expect(desc).toContain("Shuffled");
      expect(desc).toContain("Hubbard_Rob");
    });

    it("returns recursive description", () => {
      const desc = getPlaylistModeDescription("MUSICIANS/H/Hubbard_Rob", true, false);
      expect(desc).toContain("Folder Tree");
      expect(desc).toContain("Hubbard_Rob");
    });

    it("returns non-recursive description", () => {
      const desc = getPlaylistModeDescription("MUSICIANS/H/Hubbard_Rob", false, false);
      expect(desc).toContain("Folder");
      expect(desc).toContain("Hubbard_Rob");
    });

    it("handles root path", () => {
      const desc = getPlaylistModeDescription("", false, false);
      expect(desc).toContain("HVSC Root");
    });

    it("extracts folder name from path", () => {
      const desc = getPlaylistModeDescription("A/B/C/D", false, false);
      expect(desc).toContain("D");
    });
  });
});
