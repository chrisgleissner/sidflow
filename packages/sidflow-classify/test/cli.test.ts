/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { parseClassifyArgs, runClassifyCli } from "../src/cli.js";

interface TestSidflowConfig {
  hvscPath: string;
  wavCachePath: string;
  tagsPath: string;
  sidplayPath: string;
  threads: number;
  classificationDepth: number;
}

interface TestClassificationPlan {
  config: TestSidflowConfig;
  forceRebuild: boolean;
  classificationDepth: number;
  hvscPath: string;
  wavCachePath: string;
  tagsPath: string;
  sidplayPath: string;
}

interface TestBuildWavCacheMetrics {
  startTime: number;
  endTime: number;
  durationMs: number;
  totalFiles: number;
  rendered: number;
  skipped: number;
  cacheHitRate: number;
}

interface TestBuildWavCacheResult {
  rendered: string[];
  skipped: string[];
  metrics: TestBuildWavCacheMetrics;
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
  metrics: TestGenerateAutoTagsMetrics;
}

function createPlan(): TestClassificationPlan {
  return {
    config: {
      hvscPath: "/workspace/hvsc",
      wavCachePath: "/workspace/wav",
      tagsPath: "/workspace/tags",
      sidplayPath: "sidplayfp",
      threads: 0,
      classificationDepth: 2
    },
    forceRebuild: false,
    classificationDepth: 2,
    hvscPath: "/workspace/hvsc",
    wavCachePath: "/workspace/wav",
    tagsPath: "/workspace/tags",
    sidplayPath: "sidplayfp"
  } satisfies TestClassificationPlan;
}

describe("parseClassifyArgs", () => {
  it("parses recognised options", () => {
    const argv = [
      "--config",
      "./config.json",
      "--force-rebuild",
      "--sidplay",
      "./sidplayfp",
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
      sidplayPath: "./sidplayfp",
      featureModule: "./feature.js",
      predictorModule: "./predictor.js",
      metadataModule: "./metadata.js",
      renderModule: "./render.js"
    });
  });

  it("flags unknown options", () => {
    const result = parseClassifyArgs(["--unknown"]);
    expect(result.errors).toEqual(["Unknown option: --unknown"]);
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
      buildWavCache: (async () => ({ 
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
      } satisfies TestBuildWavCacheResult)) as any,
      generateAutoTags: (async () => ({
        autoTagged: ["auto"],
        manualEntries: ["manual"],
        mixedEntries: [],
        metadataFiles: ["meta.json"],
        tagFiles: [path.join(plan.tagsPath, "auto-tags.json")],
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
    expect(output).toContain("Rendered: 1");
    expect(output).toContain("Auto-tagged: 1");
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

    expect(captured.join("")).toContain("Usage: sidflow classify");
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
        renderModulePath,
        "--sidplay",
        "/custom/sidplay"
      ],
      {
        stdout,
        stderr,
        planClassification: (async (_options: unknown) => plan) as any,
        buildWavCache: (async (_plan: unknown, options: unknown) => {
          const params = options as {
            onProgress?: (progress: TestProgressEvent) => void;
            render?: (input: { sidFile: string; wavFile: string; sidplayPath: string; songIndex: number }) => Promise<void>;
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
            sidplayPath: "/tmp/sidplay",
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
          } satisfies TestBuildWavCacheResult;
        }) as any,
        generateAutoTags: (async (_plan: unknown, options: unknown) => {
          const params = options as {
            extractMetadata: (input: { sidFile: string; relativePath: string; sidplayPath: string }) => Promise<unknown>;
            featureExtractor: (input: { sidFile: string; relativePath: string; metadata: unknown }) => Promise<Record<string, number>>;
            predictRatings: (input: { features: Record<string, number> }) => Promise<{ e: number; m: number; c: number }>;
            onProgress?: (progress: TestAutoProgressEvent) => void;
          };

          const metadata = await params.extractMetadata({
            sidFile: "test.sid",
            relativePath: "relative/test.sid",
            sidplayPath: "/custom/sidplay"
          });

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
            percentComplete: 50,
            elapsedMs: 500,
            currentFile: "metadata.sid"
          });

          params.onProgress?.({
            phase: "tagging",
            totalFiles: 2,
            processedFiles: 2,
            percentComplete: 100,
            elapsedMs: 65000,
            currentFile: "metadata.sid"
          });

          return {
            autoTagged: ["relative/test.sid"],
            manualEntries: [],
            mixedEntries: [],
            metadataFiles: ["meta.json"],
            tagFiles: ["tags.json"],
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
      expect(captured.stderr).toHaveLength(0);
      const output = captured.stdout.join("\n");
  expect(captured.stdout.some((chunk) => chunk.includes("[Analyzing]"))).toBe(true);
  expect(captured.stdout.some((chunk) => chunk.includes("[Converting]"))).toBe(true);
  expect(captured.stdout.some((chunk) => chunk.includes("[Metadata]"))).toBe(true);
  expect(captured.stdout.some((chunk) => chunk.includes("[Tagging]"))).toBe(true);
      const state = globalThis as typeof globalThis & { __classifyRenderTarget?: string };
      expect(state.__classifyRenderTarget).toBe("/tmp/test.wav");
    } finally {
      const state = globalThis as typeof globalThis & { __classifyRenderTarget?: string };
      delete state.__classifyRenderTarget;
      await rm(tempDir, { recursive: true, force: true });
    }
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
  percentComplete: number;
  elapsedMs: number;
  currentFile?: string;
}
