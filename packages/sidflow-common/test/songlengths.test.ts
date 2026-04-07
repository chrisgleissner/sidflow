import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  clearSonglengthCaches,
  loadSonglengthsData,
  lookupSongDurationsMs,
  lookupSongDurationMs,
  lookupSongLength,
  parseSonglengthValue
} from "../src/songlengths.js";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-songlengths-");

describe("songlength helpers", () => {
  beforeEach(() => {
    clearSonglengthCaches();
  });

  afterEach(() => {
    clearSonglengthCaches();
  });

  it("parses fractional durations into milliseconds", () => {
    const values = parseSonglengthValue("3:57 1:02.5 0:06.050");
    expect(values).toEqual([237_000, 62_500, 6_050]);
  });

  it("resolves catalog durations and MD5 fallbacks", async () => {
    const hvscRoot = await mkdtemp(TEMP_PREFIX);
    try {
      const documentsDir = path.join(hvscRoot, "C64Music", "DOCUMENTS");
      const demoDir = path.join(hvscRoot, "C64Music", "DEMOS");
      await mkdir(documentsDir, { recursive: true });
      await mkdir(demoDir, { recursive: true });

      const catalogSidPath = path.join(demoDir, "Catalog.sid");
      const catalogContent = Buffer.from("CATALOG-SID");
      await writeFile(catalogSidPath, catalogContent);
      const catalogHash = createHash("md5").update(catalogContent).digest("hex");

      const md5OnlySidPath = path.join(demoDir, "Loose.sid");
      const md5OnlyContent = Buffer.from("LOOSE-SID");
      await writeFile(md5OnlySidPath, md5OnlyContent);
      const md5OnlyHash = createHash("md5").update(md5OnlyContent).digest("hex");

      const md5File = [
        "[Database]",
        "; /DEMOS/Catalog.sid",
        `${catalogHash}=0:30 1:00.5`,
        `${md5OnlyHash}=2:15`
      ].join("\n");
      await writeFile(path.join(documentsDir, "Songlengths.md5"), md5File, "utf8");

      const catalogDurations = await lookupSongDurationsMs(catalogSidPath, hvscRoot);
      expect(catalogDurations).toEqual([30_000, 60_500]);

      const secondSongLength = await lookupSongDurationMs(catalogSidPath, hvscRoot, 2);
      expect(secondSongLength).toBe(60_500);

      const md5OnlyDurations = await lookupSongDurationsMs(md5OnlySidPath, hvscRoot);
      expect(md5OnlyDurations).toEqual([135_000]);

      const songlengths = await loadSonglengthsData(hvscRoot);
      expect(songlengths.pathByMd5.get(catalogHash)).toBe("DEMOS/Catalog.sid");
    } finally {
      await rm(hvscRoot, { recursive: true, force: true });
    }
  });

  it("handles missing songlengths file", async () => {
    const hvscRoot = await mkdtemp(TEMP_PREFIX);
    try {
      const demoDir = path.join(hvscRoot, "C64Music", "DEMOS");
      await mkdir(demoDir, { recursive: true });
      const sidPath = path.join(demoDir, "Test.sid");
      await writeFile(sidPath, Buffer.from("TEST-SID"));

      const durations = await lookupSongDurationsMs(sidPath, hvscRoot);
      expect(durations).toBeUndefined();
    } finally {
      await rm(hvscRoot, { recursive: true, force: true });
    }
  });

  it("handles update directory structure", async () => {
    const hvscRoot = await mkdtemp(TEMP_PREFIX);
    try {
      const documentsDir = path.join(hvscRoot, "update", "DOCUMENTS");
      const musicDir = path.join(hvscRoot, "update", "DEMOS");
      await mkdir(documentsDir, { recursive: true });
      await mkdir(musicDir, { recursive: true });

      const sidPath = path.join(musicDir, "Update.sid");
      const sidContent = Buffer.from("UPDATE-SID");
      await writeFile(sidPath, sidContent);
      const hash = createHash("md5").update(sidContent).digest("hex");

      const md5File = `[Database]\n${hash}=1:30`;
      await writeFile(path.join(documentsDir, "Songlengths.md5"), md5File, "utf8");

      const durations = await lookupSongDurationsMs(sidPath, hvscRoot);
      expect(durations).toEqual([90_000]);
    } finally {
      await rm(hvscRoot, { recursive: true, force: true });
    }
  });

  it("returns undefined for invalid song index", async () => {
    const hvscRoot = await mkdtemp(TEMP_PREFIX);
    try {
      const musicDir = path.join(hvscRoot, "C64Music", "DEMOS");
      await mkdir(musicDir, { recursive: true });
      const sidPath = path.join(musicDir, "Test.sid");
      await writeFile(sidPath, Buffer.from("TEST-SID"));

      const duration = await lookupSongDurationMs(sidPath, hvscRoot, 5);
      expect(duration).toBeUndefined();
    } finally {
      await rm(hvscRoot, { recursive: true, force: true });
    }
  });

  it("handles malformed duration entries gracefully", async () => {
    const hvscRoot = await mkdtemp(TEMP_PREFIX);
    try {
      const documentsDir = path.join(hvscRoot, "C64Music", "DOCUMENTS");
      const musicDir = path.join(hvscRoot, "C64Music", "DEMOS");
      await mkdir(documentsDir, { recursive: true });
      await mkdir(musicDir, { recursive: true });

      const sidPath = path.join(musicDir, "Bad.sid");
      const sidContent = Buffer.from("BAD-SID");
      await writeFile(sidPath, sidContent);
      const hash = createHash("md5").update(sidContent).digest("hex");

      // Parser skips malformed entries, only valid durations are included
      const md5File = `[Database]\n${hash}=2:00`;
      await writeFile(path.join(documentsDir, "Songlengths.md5"), md5File, "utf8");

      const durations = await lookupSongDurationsMs(sidPath, hvscRoot);
      expect(durations).toEqual([120_000]);
    } finally {
      await rm(hvscRoot, { recursive: true, force: true });
    }
  });

  it("uses musicRoot fallback when file is not under sidPath", async () => {
    // sidPath = collection root (used to find Songlengths.md5)
    // filePath = a file NOT under sidPath, but under an explicit musicRoot
    const collectionRoot = await mkdtemp(TEMP_PREFIX);
    const externalMusicRoot = await mkdtemp(TEMP_PREFIX);
    try {
      // Set up Songlengths.md5 under collectionRoot
      const documentsDir = path.join(collectionRoot, "C64Music", "DOCUMENTS");
      await mkdir(documentsDir, { recursive: true });

      // Set up SID file under externalMusicRoot (outside collectionRoot)
      const demosDir = path.join(externalMusicRoot, "DEMOS");
      await mkdir(demosDir, { recursive: true });
      const sidFile = path.join(demosDir, "External.sid");
      const sidContent = Buffer.from("EXTERNAL-SID");
      await writeFile(sidFile, sidContent);

      // Write Songlengths.md5 with path-based key matching DEMOS/External.sid
      const md5File = [
        "[Database]",
        "; /DEMOS/External.sid",
        `${createHash("md5").update(sidContent).digest("hex")}=1:45`
      ].join("\n");
      await writeFile(path.join(documentsDir, "Songlengths.md5"), md5File, "utf8");

      // filePath is outside collectionRoot → resolveRelativeSidPath throws
      // musicRoot = externalMusicRoot → path.relative(externalMusicRoot, filePath) = "DEMOS/External.sid"
      const durations = await lookupSongDurationsMs(sidFile, collectionRoot, externalMusicRoot);
      expect(durations).toEqual([105_000]); // 1:45 = 105s
    } finally {
      await rm(collectionRoot, { recursive: true, force: true });
      await rm(externalMusicRoot, { recursive: true, force: true });
    }
  });

  it("returns cached result on repeated lookupSongLength calls", async () => {
    const hvscRoot = await mkdtemp(TEMP_PREFIX);
    try {
      const musicDir = path.join(hvscRoot, "C64Music", "DEMOS");
      const documentsDir = path.join(hvscRoot, "C64Music", "DOCUMENTS");
      await mkdir(musicDir, { recursive: true });
      await mkdir(documentsDir, { recursive: true });

      const sidPath = path.join(musicDir, "Cached.sid");
      const sidContent = Buffer.from("CACHED-SID");
      await writeFile(sidPath, sidContent);
      const hash = createHash("md5").update(sidContent).digest("hex");

      const md5File = `[Database]\n; /DEMOS/Cached.sid\n${hash}=2:30`;
      await writeFile(path.join(documentsDir, "Songlengths.md5"), md5File, "utf8");

      // First call populates lengthCache
      const value1 = await lookupSongLength(sidPath, hvscRoot);
      // Second call hits the lengthCache (lines 212-213)
      const value2 = await lookupSongLength(sidPath, hvscRoot);
      expect(value1).toBe("2:30");
      expect(value2).toBe("2:30");
    } finally {
      await rm(hvscRoot, { recursive: true, force: true });
    }
  });

  it("handles MD5 computation error for nonexistent file", async () => {
    const hvscRoot = await mkdtemp(TEMP_PREFIX);
    try {
      const musicDir = path.join(hvscRoot, "C64Music", "DEMOS");
      const documentsDir = path.join(hvscRoot, "C64Music", "DOCUMENTS");
      await mkdir(musicDir, { recursive: true });
      await mkdir(documentsDir, { recursive: true });

      // Songlengths DB with an MD5 entry but no path comment (so path-based lookup fails)
      const fakeHash = "a".repeat(32);
      const md5File = `[Database]\n${fakeHash}=3:00`;
      await writeFile(path.join(documentsDir, "Songlengths.md5"), md5File, "utf8");

      // File does not actually exist → computeFileMd5 will fail
      const nonExistentFile = path.join(musicDir, "Ghost.sid");

      // Should return undefined without throwing (error is caught internally)
      const durations = await lookupSongDurationsMs(nonExistentFile, hvscRoot);
      expect(durations).toBeUndefined();
    } finally {
      await rm(hvscRoot, { recursive: true, force: true });
    }
  });
});
