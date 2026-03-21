/// <reference types="bun-types" />

import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "bun:test";

import { safeReadJsonFile, resolveLatestFeaturesJsonl, resolveStationDataset } from "../src/station/dataset.js";
import type { StationRuntime } from "../src/station/types.js";
import type { SidflowConfig } from "@sidflow/common";

async function makeTmpDir(): Promise<string> {
  const dir = path.join(tmpdir(), `station-dataset-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("safeReadJsonFile", () => {
  it("returns undefined when file does not exist", async () => {
    const result = await safeReadJsonFile("/nonexistent/path/file.json");
    expect(result).toBeUndefined();
  });

  it("parses a valid JSON file", async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, "data.json");
    await writeFile(file, JSON.stringify({ key: "value", num: 42 }));
    const result = await safeReadJsonFile<{ key: string; num: number }>(file);
    expect(result).toEqual({ key: "value", num: 42 });
  });

  it("returns undefined for invalid JSON", async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, "bad.json");
    await writeFile(file, "not json at all {");
    const result = await safeReadJsonFile(file);
    expect(result).toBeUndefined();
  });

  it("parses an array JSON file", async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, "arr.json");
    await writeFile(file, JSON.stringify([1, 2, 3]));
    const result = await safeReadJsonFile<number[]>(file);
    expect(result).toEqual([1, 2, 3]);
  });

  it("parses a nested JSON object", async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, "nested.json");
    await writeFile(file, JSON.stringify({ a: { b: { c: true } } }));
    const result = await safeReadJsonFile<{ a: { b: { c: boolean } } }>(file);
    expect(result?.a.b.c).toBe(true);
  });
});

describe("resolveLatestFeaturesJsonl", () => {
  it("returns undefined when classifiedPath does not exist", async () => {
    const result = await resolveLatestFeaturesJsonl("/nonexistent/classified");
    expect(result).toBeUndefined();
  });

  it("returns undefined when no features files are present", async () => {
    const dir = await makeTmpDir();
    await writeFile(path.join(dir, "other.txt"), "");
    const result = await resolveLatestFeaturesJsonl(dir);
    expect(result).toBeUndefined();
  });

  it("returns the single features file when only one exists", async () => {
    const dir = await makeTmpDir();
    const name = "features_2024-01-01.jsonl";
    await writeFile(path.join(dir, name), "");
    const result = await resolveLatestFeaturesJsonl(dir);
    expect(result).toBe(path.join(dir, name));
  });

  it("returns the alphabetically last features file when multiple exist", async () => {
    const dir = await makeTmpDir();
    await writeFile(path.join(dir, "features_2024-01-01.jsonl"), "");
    await writeFile(path.join(dir, "features_2024-06-15.jsonl"), "");
    await writeFile(path.join(dir, "features_2024-12-31.jsonl"), "");
    const result = await resolveLatestFeaturesJsonl(dir);
    expect(result).toBe(path.join(dir, "features_2024-12-31.jsonl"));
  });

  it("ignores non-features files", async () => {
    const dir = await makeTmpDir();
    await writeFile(path.join(dir, "features_2024-05-01.jsonl"), "");
    await writeFile(path.join(dir, "classified.jsonl"), "");
    await writeFile(path.join(dir, "sample.jsonl"), "");
    const result = await resolveLatestFeaturesJsonl(dir);
    expect(result).toBe(path.join(dir, "features_2024-05-01.jsonl"));
  });

  it("ignores files that start with features_ but don't end with .jsonl", async () => {
    const dir = await makeTmpDir();
    await writeFile(path.join(dir, "features_2024-05-01.txt"), "");
    const result = await resolveLatestFeaturesJsonl(dir);
    expect(result).toBeUndefined();
  });
});

function makeStubRuntime(cwd: string): StationRuntime {
  return {
    cwd: () => cwd,
    now: () => new Date(),
    fetchImpl: fetch as any,
    loadConfig: async () => { throw new Error("not needed"); },
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    random: () => Math.random(),
    parseSidFile: async () => { throw new Error("not needed"); },
    lookupSongDurationMs: async () => undefined,
  } as unknown as StationRuntime;
}

const baseConfig: SidflowConfig = {
  sidPath: "/hvsc",
  audioCachePath: "/cache",
  tagsPath: "/tags",
  threads: 1,
  classificationDepth: 1,
} as SidflowConfig;

describe("resolveStationDataset — explicit local DB", () => {
  it("returns explicit localDb path when options.localDb is set", async () => {
    const dir = await makeTmpDir();
    const runtime = makeStubRuntime(dir);
    const result = await resolveStationDataset(
      runtime,
      { localDb: "my-local.sqlite" },
      baseConfig,
    );
    expect(result.dbPath).toBe(path.resolve(dir, "my-local.sqlite"));
    expect(result.dataSource).toContain("local SQLite override");
    expect(result.featuresJsonl).toBeUndefined();
  });

  it("returns explicit db path when options.db is set", async () => {
    const dir = await makeTmpDir();
    const runtime = makeStubRuntime(dir);
    const result = await resolveStationDataset(
      runtime,
      { db: "other.sqlite" },
      baseConfig,
    );
    expect(result.dbPath).toBe(path.resolve(dir, "other.sqlite"));
    expect(result.dataSource).toContain("local SQLite override");
  });

  it("includes featuresJsonl when options.featuresJsonl is set alongside localDb", async () => {
    const dir = await makeTmpDir();
    const runtime = makeStubRuntime(dir);
    const result = await resolveStationDataset(
      runtime,
      { localDb: "my-local.sqlite", featuresJsonl: "features.jsonl" },
      baseConfig,
    );
    expect(result.featuresJsonl).toBe(path.resolve(dir, "features.jsonl"));
  });

  it("resolves absolute localDb path unchanged", async () => {
    const dir = await makeTmpDir();
    const runtime = makeStubRuntime(dir);
    const absPath = path.join(dir, "absolute.sqlite");
    const result = await resolveStationDataset(
      runtime,
      { localDb: absPath },
      baseConfig,
    );
    expect(result.dbPath).toBe(absPath);
  });
});

describe("resolveStationDataset — forceLocalDb", () => {
  it("throws when forceLocalDb is true but no sqlite files exist", async () => {
    const dir = await makeTmpDir();
    const runtime = makeStubRuntime(dir);
    await expect(
      resolveStationDataset(runtime, { forceLocalDb: true }, baseConfig)
    ).rejects.toThrow("No local similarity export .sqlite files");
  });

  it("returns the sqlite file when forceLocalDb is true and file exists", async () => {
    const dir = await makeTmpDir();
    const exportsDir = path.join(dir, "data", "exports");
    await mkdir(exportsDir, { recursive: true });
    const sqliteFile = path.join(exportsDir, "similarity-2024-01.sqlite");
    await writeFile(sqliteFile, "sqlite header");
    const runtime = makeStubRuntime(dir);
    const result = await resolveStationDataset(
      runtime,
      { forceLocalDb: true },
      baseConfig,
    );
    expect(result.dbPath).toBe(sqliteFile);
    expect(result.dataSource).toContain("latest local export");
  });

  it("picks the most recently modified sqlite when multiple exist", async () => {
    const dir = await makeTmpDir();
    const exportsDir = path.join(dir, "data", "exports");
    await mkdir(exportsDir, { recursive: true });
    const older = path.join(exportsDir, "alpha.sqlite");
    const newer = path.join(exportsDir, "beta.sqlite");
    await writeFile(older, "old data");
    // Write newer after a tiny pause to ensure different mtime
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(newer, "new data");
    const runtime = makeStubRuntime(dir);
    const result = await resolveStationDataset(runtime, { forceLocalDb: true }, baseConfig);
    // Should pick the most recently modified file
    expect(result.dbPath).toBe(newer);
  });

  it("uses explicit featuresJsonl when forceLocalDb is true and featuresJsonl is set", async () => {
    const dir = await makeTmpDir();
    const exportsDir = path.join(dir, "data", "exports");
    await mkdir(exportsDir, { recursive: true });
    await writeFile(path.join(exportsDir, "sim.sqlite"), "header");
    const runtime = makeStubRuntime(dir);
    const result = await resolveStationDataset(
      runtime,
      { forceLocalDb: true, featuresJsonl: "custom-features.jsonl" },
      baseConfig,
    );
    expect(result.featuresJsonl).toBe(path.resolve(dir, "custom-features.jsonl"));
  });
});
