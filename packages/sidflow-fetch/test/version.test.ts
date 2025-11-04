import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadHvscVersion, saveHvscVersion } from "../src/version.js";
import type { HvscVersionRecord } from "../src/types.js";

describe("HVSC version persistence", () => {
  let testDir: string;
  let versionFile: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "sidflow-version-test-"));
    versionFile = path.join(testDir, "hvsc-version.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("saveHvscVersion writes deterministic JSON", async () => {
    const record: HvscVersionRecord = {
      version: 83,
      baseUrl: "https://hvsc.brona.dk/HVSC/",
      baseArchive: "HVSC_83-all-of-them.7z",
      baseChecksum: "abc123",
      downloadedAt: "2025-11-03T12:00:00.000Z",
      appliedDeltas: ["HVSC_Update_83.7z", "HVSC_Update_84.7z"],
      deltaChecksums: {
        "HVSC_Update_83.7z": "def456",
        "HVSC_Update_84.7z": "ghi789"
      }
    };

    await saveHvscVersion(versionFile, record);

    const content = await Bun.file(versionFile).text();
    const parsed = JSON.parse(content);

    expect(parsed).toEqual(record);
  });

  test("loadHvscVersion reads existing file", async () => {
    const record: HvscVersionRecord = {
      version: 83,
      baseUrl: "https://hvsc.brona.dk/HVSC/",
      baseArchive: "HVSC_83-all-of-them.7z",
      baseChecksum: "abc123",
      downloadedAt: "2025-11-03T12:00:00.000Z",
      appliedDeltas: [],
      deltaChecksums: {}
    };

    await writeFile(versionFile, JSON.stringify(record), "utf8");

    const loaded = await loadHvscVersion(versionFile);

    expect(loaded).toEqual(record);
  });

  test("loadHvscVersion returns null for non-existent file", async () => {
    const nonExistentPath = path.join(testDir, "non-existent.json");
    const result = await loadHvscVersion(nonExistentPath);

    expect(result).toBeNull();
  });

  test("loadHvscVersion throws for invalid JSON", async () => {
    await writeFile(versionFile, "not valid json{", "utf8");

    await expect(loadHvscVersion(versionFile)).rejects.toThrow();
  });
});
