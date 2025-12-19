import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildAudioCache,
  generateAutoTags,
  resolveWavPath,
  type ClassificationPlan,
  type ExtractFeaturesOptions,
  type ExtractMetadataOptions,
  type PredictRatingsOptions
} from "@sidflow/classify";
import { ensureDir, resolveManualTagPath, stringifyDeterministic } from "@sidflow/common";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-classify-metrics-");

function createPlan(sidPath: string, audioCachePath: string, tagsPath: string): ClassificationPlan {
  return {
    config: {} as ClassificationPlan["config"],
    forceRebuild: false,
    classificationDepth: 3,
    sidPath,
    audioCachePath,
    tagsPath
  } as unknown as ClassificationPlan;
}

describe("performance metrics", () => {
  it("tracks buildAudioCache metrics accurately", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const sidPath = path.join(root, "hvsc");
    const audioCachePath = path.join(root, "wav");
    const tagsPath = path.join(root, "tags");
    await mkdir(sidPath, { recursive: true });

    const plan = createPlan(sidPath, audioCachePath, tagsPath);

    // Create 5 SID files
    await Promise.all(
      [1, 2, 3, 4, 5].map(async (i) => {
        const sidFile = path.join(sidPath, `song${i}.sid`);
        await writeFile(sidFile, `content${i}`);
      })
    );

    const startTime = Date.now();
    const result = await buildAudioCache(plan, {
      render: async ({ wavFile }: { wavFile: string }) => {
        await mkdir(path.dirname(wavFile), { recursive: true });
        await writeFile(wavFile, "wav");
      }
    });
    const endTime = Date.now();

    // Verify metrics
    expect(result.metrics).toBeDefined();
    expect(result.metrics.totalFiles).toBe(5);
    expect(result.metrics.rendered).toBe(5);
    expect(result.metrics.skipped).toBe(0);
    expect(result.metrics.cacheHitRate).toBe(0);
    expect(result.metrics.startTime).toBeGreaterThanOrEqual(startTime);
    expect(result.metrics.endTime).toBeLessThanOrEqual(endTime);
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.durationMs).toBe(result.metrics.endTime - result.metrics.startTime);

    // Run again to test cache hit rate
    const secondResult = await buildAudioCache(plan, {
      render: async ({ wavFile }: { wavFile: string }) => {
        await mkdir(path.dirname(wavFile), { recursive: true });
        await writeFile(wavFile, "wav");
      }
    });

    expect(secondResult.metrics.totalFiles).toBe(5);
    expect(secondResult.metrics.rendered).toBe(0);
    expect(secondResult.metrics.skipped).toBe(5);
    expect(secondResult.metrics.cacheHitRate).toBe(1); // 100% cache hit

    await rm(root, { recursive: true, force: true });
  });

  it("tracks generateAutoTags metrics with mixed sources", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const sidPath = path.join(root, "hvsc");
    const audioCachePath = path.join(root, "wav");
    const tagsPath = path.join(root, "tags");
    await mkdir(path.join(sidPath, "Music"), { recursive: true });

    const plan = createPlan(sidPath, audioCachePath, tagsPath);

    // Create 3 SID files: 1 manual, 1 auto, 1 mixed
    const manualSid = path.join(sidPath, "Music", "manual.sid");
    const autoSid = path.join(sidPath, "Music", "auto.sid");
    const mixedSid = path.join(sidPath, "Music", "mixed.sid");

    await Promise.all([
      writeFile(manualSid, "manual"),
      writeFile(autoSid, "auto"),
      writeFile(mixedSid, "mixed")
    ]);

    // Add manual tag for first file (complete)
    const manualTagPath = resolveManualTagPath(sidPath, tagsPath, manualSid);
    await ensureDir(path.dirname(manualTagPath));
    await writeFile(
      manualTagPath,
      stringifyDeterministic({
        e: 3,
        m: 4,
        c: 5,
        source: "manual",
        timestamp: "2025-01-01T00:00:00.000Z"
      })
    );

    // Add partial manual tag for mixed file
    const mixedTagPath = resolveManualTagPath(sidPath, tagsPath, mixedSid);
    await ensureDir(path.dirname(mixedTagPath));
    await writeFile(
      mixedTagPath,
      stringifyDeterministic({
        e: 2,
        source: "manual",
        timestamp: "2025-01-02T00:00:00.000Z"
      })
    );

    // Create WAV cache for all files
    for (const sid of [manualSid, autoSid, mixedSid]) {
      const wavPath = resolveWavPath(plan, sid);
      await ensureDir(path.dirname(wavPath));
      await writeFile(wavPath, "wav");
    }

    const startTime = Date.now();
    const result = await generateAutoTags(plan, {
      extractMetadata: async (_options: ExtractMetadataOptions) => ({ title: "Test" }),
      featureExtractor: async (_options: ExtractFeaturesOptions) => ({ energy: 0.5 }),
      predictRatings: async (_options: PredictRatingsOptions) => ({ e: 3, m: 3, c: 3 })
    });
    const endTime = Date.now();

    // Verify metrics
    expect(result.metrics).toBeDefined();
    expect(result.metrics.totalFiles).toBe(3);
    expect(result.metrics.autoTaggedCount).toBe(1); // Only autoSid
    expect(result.metrics.manualOnlyCount).toBe(1); // Only manualSid
    expect(result.metrics.mixedCount).toBe(1); // Only mixedSid
    expect(result.metrics.predictionsGenerated).toBe(2); // autoSid and mixedSid need predictions
    expect(result.metrics.startTime).toBeGreaterThanOrEqual(startTime);
    expect(result.metrics.endTime).toBeLessThanOrEqual(endTime);
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.durationMs).toBe(result.metrics.endTime - result.metrics.startTime);

    await rm(root, { recursive: true, force: true });
  });

  it("tracks zero predictions when all files have complete manual tags", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const sidPath = path.join(root, "hvsc");
    const audioCachePath = path.join(root, "wav");
    const tagsPath = path.join(root, "tags");
    await mkdir(path.join(sidPath, "Music"), { recursive: true });

    const plan = createPlan(sidPath, audioCachePath, tagsPath);

    const sidFile = path.join(sidPath, "Music", "complete.sid");
    await writeFile(sidFile, "content");

    // Add complete manual tag
    const tagPath = resolveManualTagPath(sidPath, tagsPath, sidFile);
    await ensureDir(path.dirname(tagPath));
    await writeFile(
      tagPath,
      stringifyDeterministic({
        e: 1,
        m: 2,
        c: 3,
        source: "manual",
        timestamp: "2025-01-01T00:00:00.000Z"
      })
    );

    // Create WAV cache
    const wavPath = resolveWavPath(plan, sidFile);
    await ensureDir(path.dirname(wavPath));
    await writeFile(wavPath, "wav");

    const result = await generateAutoTags(plan, {
      extractMetadata: async (_options: ExtractMetadataOptions) => ({ title: "Test" }),
      // generateAutoTags extracts features for stations even when tags are manual-only.
      featureExtractor: async (_options: ExtractFeaturesOptions) => ({ energy: 0.1 }),
      predictRatings: async (_options: PredictRatingsOptions) => {
        throw new Error("Should not be called");
      }
    });

    // Verify metrics
    expect(result.metrics.totalFiles).toBe(1);
    expect(result.metrics.manualOnlyCount).toBe(1);
    expect(result.metrics.autoTaggedCount).toBe(0);
    expect(result.metrics.mixedCount).toBe(0);
    expect(result.metrics.predictionsGenerated).toBe(0); // No predictions needed

    await rm(root, { recursive: true, force: true });
  });

  it("records timing even for empty file sets", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const sidPath = path.join(root, "hvsc");
    const audioCachePath = path.join(root, "wav");
    const tagsPath = path.join(root, "tags");
    await mkdir(sidPath, { recursive: true });

    const plan = createPlan(sidPath, audioCachePath, tagsPath);

    const wavResult = await buildAudioCache(plan, {
      render: async ({ wavFile }: { wavFile: string }) => {
        await mkdir(path.dirname(wavFile), { recursive: true });
        await writeFile(wavFile, "wav");
      }
    });

    expect(wavResult.metrics.totalFiles).toBe(0);
    expect(wavResult.metrics.rendered).toBe(0);
    expect(wavResult.metrics.skipped).toBe(0);
    expect(wavResult.metrics.cacheHitRate).toBe(0);
    expect(wavResult.metrics.durationMs).toBeGreaterThanOrEqual(0);

    const autoTagResult = await generateAutoTags(plan, {
      extractMetadata: async (_options: ExtractMetadataOptions) => ({}),
      featureExtractor: async (_options: ExtractFeaturesOptions) => ({}),
      predictRatings: async (_options: PredictRatingsOptions) => ({ e: 3, m: 3, c: 3 })
    });

    expect(autoTagResult.metrics.totalFiles).toBe(0);
    expect(autoTagResult.metrics.autoTaggedCount).toBe(0);
    expect(autoTagResult.metrics.manualOnlyCount).toBe(0);
    expect(autoTagResult.metrics.mixedCount).toBe(0);
    expect(autoTagResult.metrics.predictionsGenerated).toBe(0);
    expect(autoTagResult.metrics.durationMs).toBeGreaterThanOrEqual(0);

    await rm(root, { recursive: true, force: true });
  });
});
