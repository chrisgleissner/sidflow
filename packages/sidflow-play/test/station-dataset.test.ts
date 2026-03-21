/// <reference types="bun-types" />

import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "bun:test";

import { safeReadJsonFile, resolveLatestFeaturesJsonl } from "../src/station/dataset.js";

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
