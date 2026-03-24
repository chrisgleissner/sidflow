/**
 * Regression tests for WasmRendererPool circuit breaker behavior and
 * render-timeout error classification.
 *
 * These tests simulate a prior timeout by mutating the internal
 * `timedOutSids` set rather than exercising the real per-job timeout
 * watchdog in the WASM worker.
 *
 * Validates:
 * - Circuit breaker rejects jobs for SIDs marked as previously timed out
 * - Jobs for other SIDs are not rejected with a circuit breaker error
 * - Render timeout and circuit breaker errors are classified as non-recoverable
 * - Regular IO errors remain classified as recoverable
 * - generateAutoTags reports timeout metrics consistently
 */

import { describe, test, expect, afterEach } from "bun:test";
import { WasmRendererPool } from "../src/render/wasm-render-pool.js";

// Since we cannot easily mock the WASM worker, test the circuit breaker
// at the pool level by checking that timedOutSids set is respected.

describe("WasmRendererPool circuit breaker", () => {
  let pool: WasmRendererPool | null = null;

  afterEach(async () => {
    if (pool) {
      await pool.destroy();
      pool = null;
    }
  });

  test("rejects jobs for previously timed-out SID files immediately", async () => {
    pool = new WasmRendererPool(1);

    const poolAny = pool as unknown as { timedOutSids: Set<string> };
    poolAny.timedOutSids.add("/test/pathological.sid");

    // A job for the timed-out SID should be rejected immediately
    await expect(
      pool.render({
        sidFile: "/test/pathological.sid",
        wavFile: "/test/output.wav",
        maxRenderSeconds: 10,
      })
    ).rejects.toThrow("circuit breaker");
  });

  test("does not reject other SID files with a circuit breaker error", async () => {
    pool = new WasmRendererPool(1);

    const poolAny = pool as unknown as { timedOutSids: Set<string> };
    poolAny.timedOutSids.add("/test/pathological.sid");

    const renderResultPromise = pool
      .render({
        sidFile: "/test/normal.sid",
        wavFile: "/test/normal-output.wav",
        maxRenderSeconds: 1,
      })
      .then(
        () => null,
        (error: unknown) => error as Error
      );

    await Promise.resolve();
    await pool.destroy();
    pool = null;

    const renderError = await renderResultPromise;
    expect(renderError).toBeInstanceOf(Error);
    expect(renderError?.message).not.toContain("circuit breaker");
  });

  test("clamps invalid timeout values to a safe watchdog window", () => {
    pool = new WasmRendererPool(1);

    const poolAny = pool as unknown as {
      computeJobTimeoutMs: (options: {
        sidFile: string;
        wavFile: string;
        maxRenderSeconds: number;
      }) => number;
    };

    const negativeTimeoutMs = poolAny.computeJobTimeoutMs({
      sidFile: "/test/negative.sid",
      wavFile: "/test/negative.wav",
      maxRenderSeconds: -5,
    });
    const nanTimeoutMs = poolAny.computeJobTimeoutMs({
      sidFile: "/test/nan.sid",
      wavFile: "/test/nan.wav",
      maxRenderSeconds: Number.NaN,
    });

    expect(negativeTimeoutMs).toBeGreaterThan(0);
    expect(nanTimeoutMs).toBeGreaterThan(0);
    expect(Number.isFinite(negativeTimeoutMs)).toBe(true);
    expect(Number.isFinite(nanTimeoutMs)).toBe(true);
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
  test("metrics include renderTimeouts and circuitBreakerSids fields", async () => {
    const { mkdtemp, rm, mkdir, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { dirname, join } = await import("node:path");
    const { generateAutoTags, heuristicFeatureExtractor, heuristicPredictRatings, fallbackMetadataFromPath, planClassification } = await import("../src/index.js");
    const { ensureDir } = await import("@sidflow/common");

    const root = await mkdtemp(join(tmpdir(), "sidflow-timeout-test-"));
    try {
      // Create minimal test structure
      const sidPath = join(root, "hvsc", "C64Music", "TEST");
      const audioCachePath = join(root, "audio-cache");
      const tagsPath = join(root, "tags");
      const classifiedPath = join(root, "classified");

      await mkdir(sidPath, { recursive: true });
      await mkdir(audioCachePath, { recursive: true });
      await mkdir(tagsPath, { recursive: true });
      await mkdir(classifiedPath, { recursive: true });

      // Create a test SID file
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

      const plan = await planClassification({ configPath, forceRebuild: false });

      const result = await generateAutoTags(plan, {
        extractMetadata: async ({ relativePath }) => fallbackMetadataFromPath(relativePath),
        featureExtractor: heuristicFeatureExtractor,
        predictRatings: heuristicPredictRatings,
        render: async ({ wavFile }) => {
          await ensureDir(dirname(wavFile));
          // Create a valid silent WAV
          const header = Buffer.alloc(44);
          header.write("RIFF", 0);
          header.writeUInt32LE(36, 4);
          header.write("WAVE", 8);
          header.write("fmt ", 12);
          header.writeUInt32LE(16, 16);
          header.writeUInt16LE(1, 20); // PCM
          header.writeUInt16LE(1, 22); // mono
          header.writeUInt32LE(44100, 24);
          header.writeUInt32LE(88200, 28);
          header.writeUInt16LE(2, 32);
          header.writeUInt16LE(16, 34);
          header.write("data", 36);
          header.writeUInt32LE(0, 40);
          await writeFile(wavFile, header);
        },
      });

      // Verify metrics include new fields
      expect(result.metrics).toHaveProperty("renderTimeouts");
      expect(result.metrics).toHaveProperty("circuitBreakerSids");
      expect(result.metrics.renderTimeouts).toBe(0);
      expect(result.metrics.circuitBreakerSids).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
