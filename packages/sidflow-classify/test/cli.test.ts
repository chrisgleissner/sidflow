/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { parseClassifyArgs, runClassifyCli } from "../src/cli.js";
import type { RenderWav } from "../src/index.js";

interface TestSidflowConfig {
  sidPath: string;
  audioCachePath: string;
  tagsPath: string;
  threads: number;
  classificationDepth: number;
}

interface TestClassificationPlan {
  config: TestSidflowConfig;
  forceRebuild: boolean;
  classificationDepth: number;
  sidPath: string;
  audioCachePath: string;
  tagsPath: string;
}

interface TestBuildAudioCacheMetrics {
  startTime: number;
  endTime: number;
  durationMs: number;
  totalFiles: number;
  rendered: number;
  skipped: number;
  cacheHitRate: number;
}

interface TestBuildAudioCacheResult {
  rendered: string[];
  skipped: string[];
  metrics: TestBuildAudioCacheMetrics;
}

interface TestGenerateAutoTagsMetrics {
  startTime: number;
  endTime: number;
  durationMs: number;
  totalFiles: number;
  autoTaggedCount: number;
  manualOnlyCount: number;
  mixedCount: number;
  predictionsGenerated: number;
}

interface TestGenerateAutoTagsResult {
  autoTagged: string[];
  manualEntries: string[];
  mixedEntries: string[];
  metadataFiles: string[];
  tagFiles: string[];
  jsonlFile: string;
  jsonlRecordCount: number;
  telemetryFile: string;
  metrics: TestGenerateAutoTagsMetrics;
}

async function spawnAndCapture(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: path.join(import.meta.dir, "../../.."),
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function createPlan(): TestClassificationPlan {
  return {
    config: {
      sidPath: "/workspace/hvsc",
      audioCachePath: "/workspace/wav",
      tagsPath: "/workspace/tags",
      threads: 0,
      classificationDepth: 2
    },
    forceRebuild: false,
    classificationDepth: 2,
    sidPath: "/workspace/hvsc",
    audioCachePath: "/workspace/wav",
    tagsPath: "/workspace/tags"
  } satisfies TestClassificationPlan;
}

describe("parseClassifyArgs", () => {
  it("parses recognised options", () => {
    const argv = [
      "--config",
      "./config.json",
      "--force-rebuild",
      "--feature-module",
      "./feature.js",
      "--predictor-module",
      "./predictor.js",
      "--metadata-module",
      "./metadata.js",
      "--render-module",
      "./render.js"
    ];
    const result = parseClassifyArgs(argv);
    expect(result.errors).toHaveLength(0);
    expect(result.helpRequested).toBeFalse();
    expect(result.options).toEqual({
      configPath: "./config.json",
      forceRebuild: true,
      featureModule: "./feature.js",
      predictorModule: "./predictor.js",
      metadataModule: "./metadata.js",
      renderModule: "./render.js"
    });
  });

  it("parses skip-already-classified and delete-wav-after-classification flags", () => {
    const argv = [
      "--skip-already-classified",
      "--delete-wav-after-classification"
    ];
    const result = parseClassifyArgs(argv);
    expect(result.errors).toHaveLength(0);
    expect(result.helpRequested).toBeFalse();
    expect(result.options.skipAlreadyClassified).toBeTrue();
    expect(result.options.deleteWavAfterClassification).toBeTrue();
  });

  it("flags unknown options", () => {
    const result = parseClassifyArgs(["--unknown"]);
    expect(result.errors).toEqual(["Unknown option: --unknown"]);
  });

  it("parses --allow-degraded flag", () => {
    const result = parseClassifyArgs(["--allow-degraded"]);
    expect(result.errors).toHaveLength(0);
    expect(result.options.allowDegraded).toBeTrue();
  });

  it("parses --limit with a valid positive integer", () => {
    const result = parseClassifyArgs(["--limit", "10"]);
    expect(result.errors).toHaveLength(0);
    expect(result.options.limit).toBe(10);
  });

  it("flags --limit with a non-positive integer", () => {
    const resultNeg = parseClassifyArgs(["--limit", "-1"]);
    expect(resultNeg.errors).toHaveLength(1);
    expect(resultNeg.errors[0]).toContain("--limit must be a positive integer");

    const resultZero = parseClassifyArgs(["--limit", "0"]);
    expect(resultZero.errors).toHaveLength(1);
  });

  it("flags --limit with a non-integer value", () => {
    const result = parseClassifyArgs(["--limit", "foo"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("--limit must be a positive integer");
  });

  it("parses --sid-path-prefix", () => {
    const result = parseClassifyArgs(["--sid-path-prefix", "./music"]);
    expect(result.errors).toHaveLength(0);
    expect(result.options.sidPathPrefix).toBe("./music");
  });

  it("flags unexpected positional argument", () => {
    const result = parseClassifyArgs(["positional-arg"]);
    expect(result.errors).toEqual(["Unexpected argument: positional-arg"]);
  });

  it("flags flag missing value when next token starts with --", () => {
    const result = parseClassifyArgs(["--config", "--other-flag"]);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain("--config requires a value");
  });
});

describe("runClassifyCli", () => {
  it("executes workflow and prints summary", async () => {
    const captured: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        captured.stdout.push(chunk.toString());
        callback();
      }
    });

    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        captured.stderr.push(chunk.toString());
        callback();
      }
    });

    const plan = createPlan();

    const exitCode = await runClassifyCli([], {
      stdout,
      stderr,
      planClassification: (async (_options: unknown) => plan) as any,
      buildAudioCache: (async () => ({
        rendered: ["a"],
        skipped: ["b"],
        metrics: {
          startTime: 0,
          endTime: 100,
          durationMs: 100,
          totalFiles: 2,
          rendered: 1,
          skipped: 1,
          cacheHitRate: 0.5
        }
      } satisfies TestBuildAudioCacheResult)) as any,
      generateAutoTags: (async () => ({
        autoTagged: ["auto"],
        manualEntries: ["manual"],
        mixedEntries: [],
        metadataFiles: ["meta.json"],
        tagFiles: [path.join(plan.tagsPath, "auto-tags.json")],
        jsonlFile: path.join(plan.tagsPath, "classified", "classification_2024-01-01_00-00-00-000.jsonl"),
        jsonlRecordCount: 2,
        telemetryFile: path.join(plan.tagsPath, "classified", "classification_2024-01-01_00-00-00-000.events.jsonl"),
        metrics: {
          startTime: 100,
          endTime: 200,
          durationMs: 100,
          totalFiles: 2,
          autoTaggedCount: 1,
          manualOnlyCount: 1,
          mixedCount: 0,
          predictionsGenerated: 1
        }
      } satisfies TestGenerateAutoTagsResult)) as any
    });

    expect(exitCode).toBe(0);
    expect(captured.stderr).toHaveLength(0);
    const output = captured.stdout.join("\n");
    expect(output).toContain("Classification complete.");
    expect(output).toContain("Auto-tagged: 1");
    expect(output).toContain("Telemetry file:");
  });

  it("reports failures", async () => {
    const captured: { stderr: string[] } = { stderr: [] };
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        captured.stderr.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runClassifyCli([], {
      stderr,
      planClassification: (async (_options: unknown) => {
        throw new Error("boom");
      }) as any
    });

    expect(exitCode).toBe(1);
    expect(captured.stderr.join(" ")).toContain("Classification failed: boom");
  });

  it("prints help when requested", async () => {
    const captured: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout.write as any) = (chunk: string | Uint8Array) => {
      captured.push(chunk.toString());
      return true;
    };

    try {
      const exitCode = await runClassifyCli(["--help"]);
      expect(exitCode).toBe(0);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(captured.join("")).toContain("Usage: sidflow-classify");
  });

  it("reports argument parsing errors", async () => {
    const captured: { stderr: string[] } = { stderr: [] };
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        captured.stderr.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runClassifyCli(["--config"], { stderr });

    expect(exitCode).toBe(1);
    const output = captured.stderr.join("\n");
    expect(output).toContain("--config requires a value");
    expect(output).toContain("Use --help to list supported options.");
  });

  it("passes --allow-degraded to runtime by setting SIDFLOW_ALLOW_DEGRADED env", async () => {
    const originalEnv = process.env.SIDFLOW_ALLOW_DEGRADED;

    const captured: { stdout: string[] } = { stdout: [] };
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        captured.stdout.push(chunk.toString());
        callback();
      }
    });

    const plan = createPlan();
    const exitCode = await runClassifyCli(["--allow-degraded"], {
      stdout,
      planClassification: (async () => plan) as any,
      buildAudioCache: (async () => ({
        rendered: [],
        skipped: [],
        metrics: { startTime: 0, endTime: 10, durationMs: 10, totalFiles: 0, rendered: 0, skipped: 0, cacheHitRate: 0 }
      })) as any,
      generateAutoTags: (async () => ({
        autoTagged: [],
        manualEntries: [],
        mixedEntries: [],
        metadataFiles: [],
        tagFiles: [],
        jsonlFile: "/tmp/test.jsonl",
        jsonlRecordCount: 0,
        metrics: { startTime: 0, endTime: 10, durationMs: 10, totalFiles: 0, autoTaggedCount: 0, manualOnlyCount: 0, mixedCount: 0, predictionsGenerated: 0 }
      })) as any
    });

    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.SIDFLOW_ALLOW_DEGRADED;
    } else {
      process.env.SIDFLOW_ALLOW_DEGRADED = originalEnv;
    }

    expect(exitCode).toBe(0);
    expect(captured.stdout.join("")).toContain("Classification complete.");
  });

  it("loads override modules through default runtime", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "sidflow-classify-cli-"));

    const featureModulePath = path.join(tempDir, "feature.mjs");
    const predictorModulePath = path.join(tempDir, "predictor.mjs");
    const metadataModulePath = path.join(tempDir, "metadata.mjs");
    const renderModulePath = path.join(tempDir, "render.mjs");

    await writeFile(
      featureModulePath,
      "export default async function featureExtractor() { return { energy: 0.25, rms: 0.3, spectralCentroid: 2100, spectralRolloff: 4300, zeroCrossingRate: 0.11, bpm: 128, confidence: 0.6, duration: 180 }; }",
      "utf8"
    );

    await writeFile(
      predictorModulePath,
      "export async function predictRatings({ features }) { return { e: Math.round((features.energy ?? 0) * 40), m: 3, c: 2 }; }",
      "utf8"
    );

    await writeFile(
      metadataModulePath,
      "export const metadata = async ({ relativePath }) => ({ title: relativePath, author: 'Module Author' });",
      "utf8"
    );

    await writeFile(
      renderModulePath,
      "export async function renderWav({ wavFile }) { globalThis.__classifyRenderTarget = wavFile; }",
      "utf8"
    );

    const captured: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        captured.stdout.push(chunk.toString());
        callback();
      }
    });
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        captured.stderr.push(chunk.toString());
        callback();
      }
    });

    const plan = createPlan();

    const exitCode = await runClassifyCli(
      [
        "--feature-module",
        featureModulePath,
        "--predictor-module",
        predictorModulePath,
        "--metadata-module",
        metadataModulePath,
        "--render-module",
        renderModulePath
      ],
      {
        stdout,
        stderr,
        planClassification: (async (_options: unknown) => plan) as any,
        buildAudioCache: (async (_plan: unknown, options: unknown) => {
          const params = options as {
            onProgress?: (progress: TestProgressEvent) => void;
            render?: (input: { sidFile: string; wavFile: string; songIndex: number }) => Promise<void>;
          };

          params.onProgress?.({
            phase: "analyzing",
            totalFiles: 2,
            processedFiles: 1,
            renderedFiles: 0,
            skippedFiles: 0,
            percentComplete: 50,
            elapsedMs: 500,
            currentFile: "test.sid"
          });

          params.onProgress?.({
            phase: "building",
            totalFiles: 2,
            processedFiles: 2,
            renderedFiles: 1,
            skippedFiles: 1,
            percentComplete: 100,
            elapsedMs: 65000,
            currentFile: "test.sid [1]"
          });

          await params.render?.({
            sidFile: "test.sid",
            wavFile: "/tmp/test.wav",
            songIndex: 1
          });

          return {
            rendered: ["/tmp/test.wav"],
            skipped: [],
            metrics: {
              startTime: 0,
              endTime: 65000,
              durationMs: 65000,
              totalFiles: 2,
              rendered: 1,
              skipped: 1,
              cacheHitRate: 0.5
            }
          } satisfies TestBuildAudioCacheResult;
        }) as any,
        generateAutoTags: (async (_plan: unknown, options: unknown) => {
          const params = options as {
            extractMetadata: (input: { sidFile: string; relativePath: string }) => Promise<unknown>;
            featureExtractor: (input: { sidFile: string; relativePath: string; metadata: unknown }) => Promise<Record<string, number>>;
            predictRatings: (input: { features: Record<string, number> }) => Promise<{ e: number; m: number; c: number }>;
            onProgress?: (progress: TestAutoProgressEvent) => void;
          };

          const metadata = await params.extractMetadata({
            sidFile: "test.sid",
            relativePath: "relative/test.sid"
          });

          const render = (options as { render?: RenderWav }).render;
          if (render) {
            await render({
              sidFile: "test.sid",
              wavFile: "/tmp/test.wav",
              songIndex: 1
            });
          }

          const features = await params.featureExtractor({
            sidFile: "test.sid",
            relativePath: "relative/test.sid",
            metadata
          });

          const ratings = await params.predictRatings({ features });

          params.onProgress?.({
            phase: "metadata",
            totalFiles: 2,
            processedFiles: 2,
            renderedFiles: 0,
            cachedFiles: 0,
            extractedFiles: 0,
            percentComplete: 50,
            elapsedMs: 500,
            currentFile: "metadata.sid",
            featureHealthCheckedFiles: 0,
            completeFeatureFiles: 0,
            completeFeaturePercent: null,
          });

          params.onProgress?.({
            phase: "tagging",
            totalFiles: 2,
            processedFiles: 2,
            renderedFiles: 1,
            cachedFiles: 1,
            extractedFiles: 2,
            percentComplete: 100,
            elapsedMs: 65000,
            currentFile: "metadata.sid",
            featureHealthCheckedFiles: 2,
            completeFeatureFiles: 2,
            completeFeaturePercent: 100,
          });

          return {
            autoTagged: ["relative/test.sid"],
            manualEntries: [],
            mixedEntries: [],
            metadataFiles: ["meta.json"],
            tagFiles: ["tags.json"],
            jsonlFile: path.join(plan.tagsPath, "classified", "classification_2024-01-01_00-00-00-000.jsonl"),
            jsonlRecordCount: 1,
            metrics: {
              startTime: 0,
              endTime: 65000,
              durationMs: 65000,
              totalFiles: 2,
              autoTaggedCount: 1,
              manualOnlyCount: 0,
              mixedCount: 0,
              predictionsGenerated: ratings.e + ratings.m + ratings.c
            }
          } satisfies TestGenerateAutoTagsResult;
        }) as any
      }
    );

    try {
      expect(exitCode).toBe(0);
      const output = captured.stdout.join("\n");
      expect(captured.stdout.some((chunk) => chunk.includes("[Reading Metadata]"))).toBe(true);
      expect(captured.stdout.some((chunk) => chunk.includes("[Extracting Features]"))).toBe(true);
      const state = globalThis as typeof globalThis & { __classifyRenderTarget?: string };
      expect(state.__classifyRenderTarget).toBe("/tmp/test.wav");
    } finally {
      const state = globalThis as typeof globalThis & { __classifyRenderTarget?: string };
      delete state.__classifyRenderTarget;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses undefined for featureExtractor when --feature-module not specified", async () => {
    // This test verifies that when no --feature-module is specified,
    // the CLI passes undefined for featureExtractor, allowing generateAutoTags
    // to use its default (essentiaFeatureExtractor)
    let capturedFeatureExtractor: unknown = "NOT_CAPTURED";
    let capturedPredictRatings: unknown = "NOT_CAPTURED";

    const captured: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        captured.stdout.push(chunk.toString());
        callback();
      }
    });
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        captured.stderr.push(chunk.toString());
        callback();
      }
    });

    const plan = createPlan();

    const exitCode = await runClassifyCli([], {
      stdout,
      stderr,
      planClassification: (async (_options: unknown) => plan) as any,
      buildAudioCache: (async () => ({
        rendered: [],
        skipped: [],
        metrics: {
          startTime: 0,
          endTime: 10,
          durationMs: 10,
          totalFiles: 0,
          rendered: 0,
          skipped: 0,
          cacheHitRate: 0
        }
      })) as any,
      generateAutoTags: (async (_plan: unknown, options: unknown) => {
        // Capture what the CLI passed for featureExtractor and predictRatings
        const params = options as { featureExtractor?: unknown; predictRatings?: unknown };
        capturedFeatureExtractor = params.featureExtractor;
        capturedPredictRatings = params.predictRatings;
        return {
          autoTagged: [],
          manualEntries: [],
          mixedEntries: [],
          metadataFiles: [],
          tagFiles: [],
          jsonlFile: "/tmp/test.jsonl",
          jsonlRecordCount: 0,
          metrics: {
            startTime: 0,
            endTime: 10,
            durationMs: 10,
            totalFiles: 0,
            autoTaggedCount: 0,
            manualOnlyCount: 0,
            mixedCount: 0,
            predictionsGenerated: 0
          }
        } satisfies TestGenerateAutoTagsResult;
      }) as any
    });

    expect(exitCode).toBe(0);
    // When no --feature-module is specified, CLI should pass undefined
    // so that generateAutoTags uses its default (essentiaFeatureExtractor)
    expect(capturedFeatureExtractor).toBeUndefined();
    // When no --predictor-module is specified, CLI should pass undefined
    // so that generateAutoTags uses its default (defaultPredictRatings)
    expect(capturedPredictRatings).toBeUndefined();
  });

  it("fails when override module does not export a function", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "sidflow-classify-cli-invalid-"));
    const invalidModulePath = path.join(tempDir, "invalid.mjs");
    await writeFile(invalidModulePath, "export const value = 42;", "utf8");

    const captured: { stderr: string[] } = { stderr: [] };
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        captured.stderr.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runClassifyCli(["--feature-module", invalidModulePath], {
      stderr,
      planClassification: (async (_options: unknown) => createPlan()) as any
    });

    try {
      expect(exitCode).toBe(1);
      expect(captured.stderr.join("\n")).toContain("does not export a compatible function");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("bash wrapper can run the classify CLI under node", async () => {
    const result = await spawnAndCapture("bash", ["scripts/sidflow-classify", "--help"], {
      SIDFLOW_CLI_RUNTIME: "node",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: sidflow-classify");
    expect(result.stderr).not.toContain("Error:");
  });

  it("bash play wrapper rejects node runtime with a clear message", async () => {
    const result = await spawnAndCapture("bash", ["scripts/sidflow-play", "export-similarity", "--help"], {
      SIDFLOW_CLI_RUNTIME: "node",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("sidflow-play currently requires Bun runtime");
  });
});

interface TestProgressEvent {
  phase: "analyzing" | "building";
  totalFiles: number;
  processedFiles: number;
  renderedFiles: number;
  skippedFiles: number;
  percentComplete: number;
  elapsedMs: number;
  currentFile?: string;
}

interface TestAutoProgressEvent {
  phase: "metadata" | "tagging";
  totalFiles: number;
  processedFiles: number;
  renderedFiles: number;
  cachedFiles: number;
  extractedFiles: number;
  percentComplete: number;
  elapsedMs: number;
  currentFile?: string;
  featureHealthCheckedFiles: number;
  completeFeatureFiles: number;
  completeFeaturePercent: number | null;
}
