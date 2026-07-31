import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { generateAutoTags, type ClassificationPlan } from "../src/index.js";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-resume-features-");

function createPlan(root: string): ClassificationPlan {
  const sidPath = path.join(root, "sids");
  const tagsPath = path.join(root, "tags");
  const classifiedPath = path.join(root, "classified");
  return {
    config: {
      sidPath,
      audioCachePath: path.join(root, "audio-cache"),
      tagsPath,
      classifiedPath,
      threads: 1,
      classificationDepth: 3,
      render: { preferredEngines: ["wasm"] },
    },
    sidPath,
    audioCachePath: path.join(root, "audio-cache"),
    tagsPath,
    forceRebuild: false,
    classificationDepth: 3,
  } as ClassificationPlan;
}

function intermediateRecord(plan: ClassificationPlan): Record<string, unknown> {
  return {
    sid_path: "C64Music/Test.sid",
    song_count: 1,
    queue_index: 0,
    metadata: { title: "Test" },
    manual_ratings: null,
    features: { energy: 0.5, featureVariant: "test" },
    render_engine: "wasm",
    sid_engine: "sidlite",
    degraded: false,
    classification_depth: plan.classificationDepth,
    auto_file_path: path.join(plan.tagsPath, "auto-tags.json"),
    auto_key: "Test.sid",
  };
}

describe("resume-from-features JSONL recovery", () => {
  let root: string;

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps complete records and discards only a truncated final record", async () => {
    root = await mkdtemp(TEMP_PREFIX);
    const plan = createPlan(root);
    await mkdir(plan.config.classifiedPath!, { recursive: true });
    const featuresFile = path.join(root, "intermediate.jsonl");
    const complete = JSON.stringify(intermediateRecord(plan));
    await writeFile(featuresFile, complete + "\n{\"sid_path\":", "utf8");

    const result = await generateAutoTags(plan, {
      resumeFromFeaturesFile: featuresFile,
      lifecycleLogPath: path.join(root, "lifecycle.jsonl"),
      predictRatings: async () => ({ e: 3, m: 3, c: 3 }),
    });

    expect(result.jsonlRecordCount).toBe(1);
    const records = (await readFile(result.jsonlFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toHaveLength(1);
    expect(records[0]?.sid_path).toBe("C64Music/Test.sid");
  });

  test("fails clearly for malformed complete records", async () => {
    root = await mkdtemp(TEMP_PREFIX);
    const plan = createPlan(root);
    await mkdir(plan.config.classifiedPath!, { recursive: true });
    const featuresFile = path.join(root, "intermediate.jsonl");
    await writeFile(featuresFile, JSON.stringify(intermediateRecord(plan)) + "\n{not-json}\n", "utf8");

    await expect(generateAutoTags(plan, {
      resumeFromFeaturesFile: featuresFile,
      lifecycleLogPath: path.join(root, "lifecycle.jsonl"),
    })).rejects.toThrow("Invalid complete features JSONL record");
  });
});

describe("non-finite feature rejection", () => {
  let root: string;

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  });

  /**
   * NaN and Infinity serialise to JSON null, which downstream readers take for a feature
   * that was never measured rather than one that came out broken. The record must not be
   * written — but rejecting it is a per-song failure, not a run failure. On the full
   * corpus a run failure would throw away hours of rendering because of one tune, and the
   * corpus-wide integrity threshold already covers a defect producing them in bulk.
   */
  test("drops the song, records the failure, and lets the run finish", async () => {
    root = await mkdtemp(TEMP_PREFIX);
    const plan = createPlan(root);
    await mkdir(plan.sidPath, { recursive: true });
    await writeFile(path.join(plan.sidPath, "Good.sid"), "not-a-sid");
    await writeFile(path.join(plan.sidPath, "Bad.sid"), "not-a-sid");

    const result = await generateAutoTags(plan, {
      lifecycleLogPath: path.join(root, "lifecycle.jsonl"),
      render: async ({ wavFile }) => {
        await mkdir(path.dirname(wavFile), { recursive: true });
        await writeFile(wavFile, "wav");
      },
      featureExtractor: async ({ sidFile }) => (
        path.basename(sidFile) === "Bad.sid" ? { energy: Number.NaN } : { energy: 0.5 }
      ),
      predictRatings: async () => ({ e: 3, m: 3, c: 3 }),
    });

    expect(result.metrics.failedCount).toBe(1);
    expect(result.jsonlRecordCount).toBe(1);

    const classified = (await readFile(result.jsonlFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { sid_path: string });
    expect(classified.map((record) => record.sid_path)).toEqual(["Good.sid"]);

    const featureFiles = (await readdir(plan.config.classifiedPath!))
      .filter((name) => name.startsWith("features_"));
    expect(featureFiles).toHaveLength(1);
    const featureRecords = (await readFile(path.join(plan.config.classifiedPath!, featureFiles[0]!), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { sid_path: string });
    expect(featureRecords.map((record) => record.sid_path)).toEqual(["Good.sid"]);

    const failures = (await readFile(result.failureFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { sid_path: string; error: string });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.sid_path).toBe("Bad.sid");
    expect(failures[0]!.error).toContain("non-finite feature");
  });
});
