import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ensureDir } from "@sidflow/common";

import { WasmRendererPool } from "../src/render/wasm-render-pool.js";
import {
  fallbackMetadataFromPath,
  generateAutoTags,
  heuristicFeatureExtractor,
  heuristicPredictRatings,
  planClassification,
} from "../src/index.js";

function silentWavBuffer(): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(44_100, 24);
  header.writeUInt32LE(88_200, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(0, 40);
  return header;
}

async function createTestPlan(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const sidPath = join(root, "hvsc", "C64Music", "TEST");
  const audioCachePath = join(root, "audio-cache");
  const tagsPath = join(root, "tags");
  const classifiedPath = join(root, "classified");

  await mkdir(sidPath, { recursive: true });
  await mkdir(audioCachePath, { recursive: true });
  await mkdir(tagsPath, { recursive: true });
  await mkdir(classifiedPath, { recursive: true });
  await writeFile(join(sidPath, "test.sid"), "test-sid-content");

  const configPath = join(root, "test.sidflow.json");
  await writeFile(
    configPath,
    JSON.stringify({
      sidPath: join(root, "hvsc"),
      audioCachePath,
      tagsPath,
      classifiedPath,
      threads: 1,
      classificationDepth: 2,
    })
  );

  return {
    root,
    plan: await planClassification({ configPath, forceRebuild: false }),
  };
}

describe("WasmRendererPool lifecycle", () => {
  let pool: WasmRendererPool | null = null;

  afterEach(async () => {
    if (pool) {
      await pool.destroy();
      pool = null;
    }
  });

  test("pool can be destroyed without errors", async () => {
    pool = new WasmRendererPool(2);
    await pool.destroy();
    pool = null;
  });
});

describe("Render timeout error classification", () => {
  test("render timeout errors are non-recoverable", async () => {
    const { isRecoverableError } = await import("../src/types/state-machine.js");

    const timeoutError = new Error("Render timeout: /test/foo.sid exceeded 55s limit");
    expect(isRecoverableError(timeoutError)).toBe(false);

    const circuitError = new Error("Render skipped: /test/foo.sid timed out (circuit breaker)");
    expect(isRecoverableError(circuitError)).toBe(false);
  });

  test("regular IO errors are still recoverable", async () => {
    const { isRecoverableError } = await import("../src/types/state-machine.js");

    const ioError = new Error("ENOENT: file not found");
    expect(isRecoverableError(ioError)).toBe(true);
  });
});

describe("generateAutoTags resilience", () => {
  test("reports fallback metrics on the happy path", async () => {
    const { root, plan } = await createTestPlan("sidflow-fallback-metrics-");
    try {
      const result = await generateAutoTags(plan, {
        extractMetadata: async ({ relativePath }) => fallbackMetadataFromPath(relativePath),
        featureExtractor: heuristicFeatureExtractor,
        predictRatings: heuristicPredictRatings,
        render: async ({ wavFile }) => {
          await ensureDir(dirname(wavFile));
          await writeFile(wavFile, silentWavBuffer());
        },
      });

      expect(result.metrics.renderedFallbackCount).toBe(0);
      expect(result.metrics.metadataOnlyCount).toBe(0);
      expect(result.metrics.peakRssMb).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("completes classification with metadata-only fallback when rendering and extraction fail", async () => {
    const { root, plan } = await createTestPlan("sidflow-metadata-fallback-");
    try {
      const result = await generateAutoTags(plan, {
        extractMetadata: async ({ relativePath }) => fallbackMetadataFromPath(relativePath),
        featureExtractor: async () => {
          throw new Error("forced extraction failure");
        },
        predictRatings: heuristicPredictRatings,
        render: async () => {
          throw new Error("forced render failure");
        },
      });

      expect(result.jsonlRecordCount).toBe(1);
      expect(result.metrics.renderedFallbackCount).toBe(1);
      expect(result.metrics.metadataOnlyCount).toBe(1);
      expect(result.autoTagged.length + result.manualEntries.length + result.mixedEntries.length).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
