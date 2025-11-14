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
