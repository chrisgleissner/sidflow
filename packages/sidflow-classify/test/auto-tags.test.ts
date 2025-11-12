import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  generateAutoTags,
  resolveWavPath,
  type ClassificationPlan,
  type ExtractFeaturesOptions,
  type ExtractMetadataOptions,
  type PredictRatingsOptions,
  type SidMetadata
} from "@sidflow/classify";
import {
  ensureDir,
  resolveManualTagPath,
  resolveMetadataPath,
  stringifyDeterministic
} from "@sidflow/common";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-classify-auto-tags-");

function createPlan(hvscPath: string, wavCachePath: string, tagsPath: string): ClassificationPlan {
  return {
    config: {} as ClassificationPlan["config"],
    forceRebuild: false,
    classificationDepth: 3,
    hvscPath,
    wavCachePath,
    tagsPath
  } as unknown as ClassificationPlan;
}

describe("generateAutoTags", () => {
  it("merges manual and auto tags respecting precedence", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const hvscPath = path.join(root, "hvsc");
    const wavCachePath = path.join(root, "wav");
    const tagsPath = path.join(root, "tags");
    await Promise.all([
      mkdir(path.join(hvscPath, "C64Music", "MUSICIANS", "A"), { recursive: true }),
      mkdir(path.join(hvscPath, "C64Music", "MUSICIANS", "B"), { recursive: true }),
      mkdir(wavCachePath, { recursive: true }),
      mkdir(tagsPath, { recursive: true })
    ]);

    const plan = createPlan(hvscPath, wavCachePath, tagsPath);
    const manualSid = path.join(hvscPath, "C64Music", "MUSICIANS", "A", "Manual.sid");
    const autoSid = path.join(hvscPath, "C64Music", "MUSICIANS", "B", "Auto.sid");
    await Promise.all([writeFile(manualSid, "manual"), writeFile(autoSid, "auto")]);

    const manualTagPath = resolveManualTagPath(hvscPath, tagsPath, manualSid);
    await ensureDir(path.dirname(manualTagPath));
    await writeFile(
      manualTagPath,
      stringifyDeterministic({
        e: 2,
        m: 5,
        c: 3,
        source: "manual",
        timestamp: "2025-01-01T00:00:00.000Z"
      })
    );

    const autoWav = resolveWavPath(plan, autoSid);
    await ensureDir(path.dirname(autoWav));
    await writeFile(autoWav, "auto-wav");

    const manualWav = resolveWavPath(plan, manualSid);
    await ensureDir(path.dirname(manualWav));
    await writeFile(manualWav, "manual-wav");

    const metadataByFile: Record<string, SidMetadata> = {
      [manualSid]: { title: "Manual Song", author: "Composer", released: "1987" },
      [autoSid]: { title: "Auto Song" }
    };

    const result = await generateAutoTags(plan, {
      extractMetadata: async ({ sidFile }: ExtractMetadataOptions) =>
        metadataByFile[sidFile] ?? {},
      featureExtractor: async ({ wavFile }: ExtractFeaturesOptions) => {
        expect(wavFile).toBe(autoWav);
        return { energy: 0.5 };
      },
      predictRatings: async (_options: PredictRatingsOptions) => ({ e: 4, m: 2, c: 5 })
    });

    expect(result.manualEntries).toEqual(["C64Music/MUSICIANS/A/Manual.sid"]);
    expect(result.autoTagged).toEqual(["C64Music/MUSICIANS/B/Auto.sid"]);
    expect(result.mixedEntries).toHaveLength(0);
    expect(result.metrics).toBeDefined();
    expect(result.metrics.totalFiles).toBe(2);
    expect(result.metrics.autoTaggedCount).toBe(1);
    expect(result.metrics.manualOnlyCount).toBe(1);
    expect(result.metrics.mixedCount).toBe(0);
    expect(result.metrics.predictionsGenerated).toBe(1);
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);

    const manualMetadataPath = resolveMetadataPath(hvscPath, tagsPath, manualSid);
    const manualMetadata = JSON.parse(await readFile(manualMetadataPath, "utf8")) as Record<string, unknown>;
    expect(manualMetadata).toEqual(metadataByFile[manualSid] as Record<string, unknown>);

    const autoMetadataPath = resolveMetadataPath(hvscPath, tagsPath, autoSid);
    const autoMetadata = JSON.parse(await readFile(autoMetadataPath, "utf8")) as Record<string, unknown>;
    expect(autoMetadata).toEqual(metadataByFile[autoSid] as Record<string, unknown>);

    const manualAggregatedPath = path.join(tagsPath, "C64Music", "MUSICIANS", "A", "auto-tags.json");
    const manualAggregated = JSON.parse(await readFile(manualAggregatedPath, "utf8")) as Record<string, unknown>;
    expect(manualAggregated).toEqual({
      "Manual.sid": { e: 2, m: 5, c: 3, source: "manual" }
    });

    const autoAggregatedPath = path.join(tagsPath, "C64Music", "MUSICIANS", "B", "auto-tags.json");
    const autoAggregated = JSON.parse(await readFile(autoAggregatedPath, "utf8")) as Record<string, unknown>;
    expect(autoAggregated).toEqual({
      "Auto.sid": { e: 4, m: 2, c: 5, source: "auto" }
    });

    await rm(root, { recursive: true, force: true });
  });

  it("fills missing manual fields using predictions", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const hvscPath = path.join(root, "hvsc");
    const wavCachePath = path.join(root, "wav");
    const tagsPath = path.join(root, "tags");
    await Promise.all([
      mkdir(path.join(hvscPath, "C64Music", "MUSICIANS", "C"), { recursive: true }),
      mkdir(wavCachePath, { recursive: true }),
      mkdir(tagsPath, { recursive: true })
    ]);

    const plan = createPlan(hvscPath, wavCachePath, tagsPath);
    const sidFile = path.join(hvscPath, "C64Music", "MUSICIANS", "C", "Mixed.sid");
    await writeFile(sidFile, "mixed");

    const tagPath = resolveManualTagPath(hvscPath, tagsPath, sidFile);
    await ensureDir(path.dirname(tagPath));
    await writeFile(
      tagPath,
      stringifyDeterministic({
        e: 5,
        source: "manual",
        timestamp: "2025-01-02T00:00:00.000Z"
      })
    );

    const wavPath = resolveWavPath(plan, sidFile);
    await ensureDir(path.dirname(wavPath));
    await writeFile(wavPath, "mixed-wav");

    const result = await generateAutoTags(plan, {
      extractMetadata: async (_options: ExtractMetadataOptions) => ({ title: "Mixed" }),
      featureExtractor: async (_options: ExtractFeaturesOptions) => ({ tempo: 123 }),
      predictRatings: async (_options: PredictRatingsOptions) => ({ e: 2, m: 4, c: 1 })
    });

    expect(result.mixedEntries).toEqual(["C64Music/MUSICIANS/C/Mixed.sid"]);
    expect(result.autoTagged).toHaveLength(0);
    expect(result.manualEntries).toHaveLength(0);
    expect(result.metrics).toBeDefined();
    expect(result.metrics.totalFiles).toBe(1);
    expect(result.metrics.mixedCount).toBe(1);
    expect(result.metrics.predictionsGenerated).toBe(1);

    const aggregatedPath = path.join(tagsPath, "C64Music", "MUSICIANS", "C", "auto-tags.json");
    const aggregated = JSON.parse(await readFile(aggregatedPath, "utf8")) as Record<string, { [key: string]: unknown }>;
    expect(aggregated).toEqual({
      "Mixed.sid": { e: 5, m: 4, c: 1, source: "mixed" }
    });

    await rm(root, { recursive: true, force: true });
  });
});
