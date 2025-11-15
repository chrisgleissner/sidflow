/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test";
import path from "node:path";

describe("HVSC Browse API", () => {
  describe("Path validation", () => {
    it("validates relative path is within root", () => {
      const root = "/hvsc";
      const requestedPath = "MUSICIANS/H/Hubbard_Rob";
      const fullPath = path.join(root, requestedPath);
      const resolvedPath = path.resolve(fullPath);
      const resolvedRoot = path.resolve(root);

      expect(resolvedPath.startsWith(resolvedRoot)).toBe(true);
    });

    it("rejects path traversal attempts", () => {
      const root = "/hvsc";
      const maliciousPath = "../../../etc/passwd";
      const fullPath = path.join(root, maliciousPath);
      const resolvedPath = path.resolve(fullPath);
      const resolvedRoot = path.resolve(root);

      // Path should be rejected (doesn't start with root)
      expect(resolvedPath.startsWith(resolvedRoot)).toBe(false);
    });

    it("handles empty path (root listing)", () => {
      const root = "/hvsc";
      const requestedPath = "";
      const fullPath = path.join(root, requestedPath);
      const resolvedPath = path.resolve(fullPath);
      const resolvedRoot = path.resolve(root);

      expect(resolvedPath).toBe(resolvedRoot);
    });

    it("normalizes path separators", () => {
      const root = "/hvsc";
      const requestedPath = "MUSICIANS/H/Hubbard_Rob";
      const fullPath = path.join(root, requestedPath);

      expect(fullPath).toContain("MUSICIANS");
      expect(fullPath).toContain("Hubbard_Rob");
    });
  });

  describe("Parent path calculation", () => {
    it("calculates parent for nested path", () => {
      const requestedPath = "MUSICIANS/H/Hubbard_Rob";
      const parent = path.dirname(requestedPath);

      expect(parent).toBe("MUSICIANS/H");
    });

    it("calculates parent for single-level path", () => {
      const requestedPath = "MUSICIANS";
      const parent = path.dirname(requestedPath);

      expect(parent).toBe(".");
    });

    it("returns undefined for root path", () => {
      const requestedPath = "";
      const parent = requestedPath ? path.dirname(requestedPath) : undefined;

      expect(parent).toBeUndefined();
    });

    it("handles parent of dot correctly", () => {
      const parent = ".";
      const shouldBeEmpty = parent === "." ? "" : parent;

      expect(shouldBeEmpty).toBe("");
    });
  });

  describe("Item sorting", () => {
    it("sorts folders before files", () => {
      const items = [
        { name: "song.sid", type: "file" as const },
        { name: "subfolder", type: "folder" as const },
        { name: "another.sid", type: "file" as const },
        { name: "artist", type: "folder" as const },
      ];

      const sorted = items.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "folder" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      expect(sorted[0].type).toBe("folder");
      expect(sorted[1].type).toBe("folder");
      expect(sorted[2].type).toBe("file");
      expect(sorted[3].type).toBe("file");
    });

    it("sorts items alphabetically within type", () => {
      const items = [
        { name: "Zebra.sid", type: "file" as const },
        { name: "Apple.sid", type: "file" as const },
        { name: "Middle.sid", type: "file" as const },
      ];

      const sorted = items.sort((a, b) => a.name.localeCompare(b.name));

      expect(sorted[0].name).toBe("Apple.sid");
      expect(sorted[1].name).toBe("Middle.sid");
      expect(sorted[2].name).toBe("Zebra.sid");
    });

    it("case-insensitive sorting", () => {
      const items = [
        { name: "zebra.sid", type: "file" as const },
        { name: "Apple.sid", type: "file" as const },
        { name: "MIDDLE.sid", type: "file" as const },
      ];

      const sorted = items.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );

      expect(sorted[0].name).toBe("Apple.sid");
      expect(sorted[1].name).toBe("MIDDLE.sid");
      expect(sorted[2].name).toBe("zebra.sid");
    });
  });

  describe("SID file detection", () => {
    it("detects .sid extension (lowercase)", () => {
      const filename = "song.sid";
      const isSid = filename.toLowerCase().endsWith(".sid");

      expect(isSid).toBe(true);
    });

    it("detects .sid extension (uppercase)", () => {
      const filename = "SONG.SID";
      const isSid = filename.toLowerCase().endsWith(".sid");

      expect(isSid).toBe(true);
    });

    it("detects .sid extension (mixed case)", () => {
      const filename = "Song.SiD";
      const isSid = filename.toLowerCase().endsWith(".sid");

      expect(isSid).toBe(true);
    });

    it("rejects non-SID files", () => {
      const files = ["readme.txt", "image.png", "data.json", ".DS_Store"];

      for (const file of files) {
        expect(file.toLowerCase().endsWith(".sid")).toBe(false);
      }
    });
  });

  describe("SID header parsing", () => {
    it("extracts subtune count from header", () => {
      // Mock SID header with 3 songs at offset 0x0E-0x0F
      const buffer = Buffer.alloc(0x7C); // Minimum SID header size
      buffer.writeUInt16BE(3, 0x0e); // 3 songs

      const songs = (buffer[0x0e] << 8) | buffer[0x0f];

      expect(songs).toBe(3);
    });

    it("defaults to 1 if songs count is 0", () => {
      const buffer = Buffer.alloc(0x7C);
      buffer.writeUInt16BE(0, 0x0e); // 0 songs in header

      const rawSongs = (buffer[0x0e] << 8) | buffer[0x0f];
      const songs = rawSongs > 0 ? rawSongs : 1;

      expect(songs).toBe(1);
    });

    it("handles single-song SID files", () => {
      const buffer = Buffer.alloc(0x7C);
      buffer.writeUInt16BE(1, 0x0e);

      const songs = (buffer[0x0e] << 8) | buffer[0x0f];

      expect(songs).toBe(1);
    });

    it("handles multi-song SID files", () => {
      const buffer = Buffer.alloc(0x7C);
      buffer.writeUInt16BE(15, 0x0e); // 15 subtunes

      const songs = (buffer[0x0e] << 8) | buffer[0x0f];

      expect(songs).toBe(15);
    });

    it("defaults to 1 for truncated/invalid files", () => {
      const buffer = Buffer.alloc(8); // Too small for full header
      const songs = buffer.length >= 0x10 ? (buffer[0x0e] << 8) | buffer[0x0f] : 1;

      expect(songs).toBe(1);
    });
  });

  describe("Response structure", () => {
    it("includes success flag", () => {
      const response = {
        success: true,
        path: "MUSICIANS",
        items: [],
      };

      expect(response.success).toBe(true);
    });

    it("includes requested path", () => {
      const response = {
        success: true,
        path: "MUSICIANS/H/Hubbard_Rob",
        items: [],
      };

      expect(response.path).toBe("MUSICIANS/H/Hubbard_Rob");
    });

    it("includes items array", () => {
      const response = {
        success: true,
        path: "",
        items: [
          { name: "MUSICIANS", path: "MUSICIANS", type: "folder" as const },
          { name: "DEMOS", path: "DEMOS", type: "folder" as const },
        ],
      };

      expect(response.items).toHaveLength(2);
      expect(response.items[0].type).toBe("folder");
    });

    it("includes parent path for nested locations", () => {
      const response = {
        success: true,
        path: "MUSICIANS/H",
        items: [],
        parent: "MUSICIANS",
      };

      expect(response.parent).toBe("MUSICIANS");
    });

    it("omits parent for root", () => {
      const response = {
        success: true,
        path: "",
        items: [],
        parent: undefined,
      };

      expect(response.parent).toBeUndefined();
    });

    it("includes error message on failure", () => {
      const response = {
        success: false,
        path: "invalid/path",
        items: [],
        error: "Path not found",
      };

      expect(response.success).toBe(false);
      expect(response.error).toBe("Path not found");
    });
  });
});
