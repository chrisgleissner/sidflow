import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  clearSonglengthCaches,
  lookupSongDurationsMs,
  lookupSongDurationMs,
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
    } finally {
      await rm(hvscRoot, { recursive: true, force: true });
    }
  });
});
