import { describe, expect, it } from "bun:test";
import { Writable } from "node:stream";
import path from "node:path";

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
});
