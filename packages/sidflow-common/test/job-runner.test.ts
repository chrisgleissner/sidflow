/// <reference types="bun-types" />
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { JobOrchestrator } from "../src/job-orchestrator";
import { JobRunner, type JobExecutionPlan } from "../src/job-runner";
import type { JobDescriptor } from "../src/job-types";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { writeFileSync } from "node:fs";

const manifestPath = "/tmp/job-runner-manifest.json";

function createCommand(exitCode: number): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: ["-e", `process.exit(${exitCode});`],
  };
}

function createPlan(type: "fetch" | "classify" | "train" | "render", exitCode = 0): JobExecutionPlan {
  return {
    stages: [
      {
        key: `${type} stage`,
        type,
        command: createCommand(exitCode),
      },
    ],
  };
}

import { createDefaultJobCommandFactory } from "../src/job-runner";

describe("JobRunner", () => {
  let orchestrator: JobOrchestrator;

  beforeEach(async () => {
    orchestrator = new JobOrchestrator({ manifestPath });
    await orchestrator.load();
  });

  afterEach(async () => {
    if (existsSync(manifestPath)) {
      await unlink(manifestPath);
    }
  });

  test("completes a pending job successfully", async () => {
    const job = await orchestrator.createJob("fetch", {});

    const runner = new JobRunner({
      orchestrator,
      commandFactory: (descriptor) => {
        expect(descriptor.id).toBe(job.id);
        return createPlan("fetch");
      },
    });

    const result = await runner.processNextJob();
    expect(result).not.toBeNull();
    expect(result?.status).toBe("completed");
    expect(result?.metadata.resumeData).toBeUndefined();
    expect(result?.metadata.error).toBeUndefined();
  });

  test("marks job as failed when command exits non-zero", async () => {
    const job = await orchestrator.createJob("fetch", {});
    const runner = new JobRunner({
      orchestrator,
      commandFactory: () => createPlan("fetch", 1),
    });

    const result = await runner.processNextJob();
    expect(result?.status).toBe("failed");
    expect(result?.metadata.error).toContain("exited with code 1");
  });

  test("processes paused jobs and clears resume data", async () => {
    const job = await orchestrator.createJob("fetch", {});
    await orchestrator.updateJobStatus(job.id, "paused", {
      resumeData: { previous: "test" },
    });

    const runner = new JobRunner({
      orchestrator,
      commandFactory: () => createPlan("fetch"),
    });

    const result = await runner.processNextJob();
    expect(result?.status).toBe("completed");
    expect(result?.metadata.resumeData).toBeUndefined();
  });

  test("returns null when no work available", async () => {
    const runner = new JobRunner({
      orchestrator,
      commandFactory: () => createPlan("fetch"),
    });

    const result = await runner.processNextJob();
    expect(result).toBeNull();
  });

  test("resumes pipeline jobs from failed stage", async () => {
    const statePath = `/tmp/job-runner-flaky-${Date.now()}.txt`;
    writeFileSync(statePath, "fail", "utf-8");

    const job = await orchestrator.createJob("pipeline", {
      allowResume: true,
      stages: [
        { type: "fetch", label: "fetch" },
        { type: "classify", label: "classify" },
        { type: "train", label: "train" },
      ],
    });

    const flakyPlan: JobExecutionPlan = {
      stages: [
        { key: "fetch", type: "fetch", command: createCommand(0) },
        {
          key: "classify",
          type: "classify",
          command: {
            command: process.execPath,
            args: [
              "-e",
              `const fs = require('node:fs');
const path = ${JSON.stringify(statePath)};
const value = fs.readFileSync(path, 'utf-8').trim();
if (value === 'fail') {
  fs.writeFileSync(path, 'ok');
  process.exit(1);
}
process.exit(0);
`,
            ],
          },
        },
        { key: "train", type: "train", command: createCommand(0) },
      ],
    };

    const runner = new JobRunner({
      orchestrator,
      commandFactory: (descriptor: JobDescriptor) => {
        if (descriptor.type === "pipeline") {
          return flakyPlan;
        }
        return createPlan("fetch");
      },
    });

    const firstAttempt = await runner.processNextJob();
    expect(firstAttempt?.status).toBe("failed");
    expect(firstAttempt?.metadata.resumeData).toEqual(
      expect.objectContaining({ stageIndex: 1 })
    );

    const secondAttempt = await runner.processNextJob();
    expect(secondAttempt?.status).toBe("completed");
    expect(secondAttempt?.metadata.resumeData).toBeUndefined();
  });
});

describe("createDefaultJobCommandFactory", () => {
  test("creates factory for fetch job with minimal params", () => {
    const factory = createDefaultJobCommandFactory({ repoRoot: "/repo" });
    const job: JobDescriptor = {
      id: "test",
      type: "fetch",
      status: "pending",
      params: {},
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const plan = factory(job);
    expect(plan).not.toBeNull();
    expect(plan!.stages.length).toBe(1);
    expect(plan!.stages[0].type).toBe("fetch");
    expect(plan!.stages[0].command.command).toBe("/repo/scripts/sidflow-fetch");
  });

  test("creates factory for fetch job with all params", () => {
    const factory = createDefaultJobCommandFactory({ repoRoot: "/repo" });
    const job: JobDescriptor = {
      id: "test",
      type: "fetch",
      status: "pending",
      params: {
        configPath: "/config.json",
        remoteBaseUrl: "https://example.com",
        hvscVersionPath: "/version.txt",
      },
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const plan = factory(job);
    expect(plan!.stages[0].command.args).toContain("--config");
    expect(plan!.stages[0].command.args).toContain("/config.json");
    expect(plan!.stages[0].command.args).toContain("--remote");
    expect(plan!.stages[0].command.args).toContain("https://example.com");
    expect(plan!.stages[0].command.args).toContain("--version-file");
    expect(plan!.stages[0].command.args).toContain("/version.txt");
  });

  test("creates factory for classify job with params", () => {
    const factory = createDefaultJobCommandFactory({ repoRoot: "/repo" });
    const job: JobDescriptor = {
      id: "test",
      type: "classify",
      status: "pending",
      params: {
        configPath: "/config.json",
        forceRebuild: true,
      },
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const plan = factory(job);
    expect(plan!.stages[0].type).toBe("classify");
    expect(plan!.stages[0].command.args).toContain("--config");
    expect(plan!.stages[0].command.args).toContain("--force-rebuild");
  });

  test("creates factory for train job with all params", () => {
    const factory = createDefaultJobCommandFactory({ repoRoot: "/repo" });
    const job: JobDescriptor = {
      id: "test",
      type: "train",
      status: "pending",
      params: {
        configPath: "/config.json",
        epochs: 100,
        batchSize: 32,
        learningRate: 0.001,
        evaluate: false,
        force: true,
      },
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const plan = factory(job);
    expect(plan!.stages[0].type).toBe("train");
    expect(plan!.stages[0].command.args).toContain("--epochs");
    expect(plan!.stages[0].command.args).toContain("100");
    expect(plan!.stages[0].command.args).toContain("--batch-size");
    expect(plan!.stages[0].command.args).toContain("32");
    expect(plan!.stages[0].command.args).toContain("--learning-rate");
    expect(plan!.stages[0].command.args).toContain("0.001");
    expect(plan!.stages[0].command.args).toContain("--no-evaluate");
    expect(plan!.stages[0].command.args).toContain("--force");
  });

  test("creates factory for render job with params", () => {
    const factory = createDefaultJobCommandFactory({ repoRoot: "/repo" });
    const job: JobDescriptor = {
      id: "test",
      type: "render",
      status: "pending",
      params: {
        configPath: "/config.json",
        engine: "wasm",
        preferredEngines: ["wasm", "native"],
        formats: ["wav", "m4a"],
        chip: "6581",
        outputPath: "/output",
        targetDurationMs: 5000,
        maxLossRate: 0.1,
        sidPaths: ["/path1.sid", "/path2.sid"],
        sidListFile: "/list.txt",
      },
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const plan = factory(job);
    expect(plan!.stages[0].type).toBe("render");
    expect(plan!.stages[0].command.args).toContain("--engine");
    expect(plan!.stages[0].command.args).toContain("wasm");
    expect(plan!.stages[0].command.args).toContain("--prefer");
    expect(plan!.stages[0].command.args).toContain("wasm,native");
    expect(plan!.stages[0].command.args).toContain("--formats");
    expect(plan!.stages[0].command.args).toContain("wav,m4a");
    expect(plan!.stages[0].command.args).toContain("--chip");
    expect(plan!.stages[0].command.args).toContain("6581");
    expect(plan!.stages[0].command.args).toContain("--output");
    expect(plan!.stages[0].command.args).toContain("/output");
    expect(plan!.stages[0].command.args).toContain("--target-duration");
    expect(plan!.stages[0].command.args).toContain("5");
    expect(plan!.stages[0].command.args).toContain("--max-loss");
    expect(plan!.stages[0].command.args).toContain("0.1");
    expect(plan!.stages[0].command.args).toContain("--sid");
    expect(plan!.stages[0].command.args).toContain("/path1.sid");
    expect(plan!.stages[0].command.args).toContain("/path2.sid");
    expect(plan!.stages[0].command.args).toContain("--sid-file");
    expect(plan!.stages[0].command.args).toContain("/list.txt");
  });

  test("creates factory for pipeline job", () => {
    const factory = createDefaultJobCommandFactory({ repoRoot: "/repo" });
    const job: JobDescriptor = {
      id: "test",
      type: "pipeline",
      status: "pending",
      params: {
        stages: [
          { type: "fetch", label: "fetch" },
          { type: "classify", label: "classify" },
          { type: "train", label: "train" },
        ],
      },
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const plan = factory(job);
    expect(plan).not.toBeNull();
    expect(plan!.stages.length).toBe(3);
    expect(plan!.stages[0].type).toBe("fetch");
    expect(plan!.stages[1].type).toBe("classify");
    expect(plan!.stages[2].type).toBe("train");
  });

  test("returns null for unknown job type", () => {
    const factory = createDefaultJobCommandFactory({ repoRoot: "/repo" });
    const job: JobDescriptor = {
      id: "test",
      type: "unknown" as any,
      status: "pending",
      params: {},
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const plan = factory(job);
    expect(plan).toBeNull();
  });
});
