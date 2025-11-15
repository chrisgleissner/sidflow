/// <reference types="bun-types" />
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { JobOrchestrator } from "../src/job-orchestrator";
import { JobQueueWorker } from "../src/job-queue";
import type { JobExecutionPlan } from "../src/job-runner";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

const manifestPath = "/tmp/job-queue-manifest.json";

function createPlan(): JobExecutionPlan {
  return {
    stages: [
      {
        key: "fetch",
        type: "fetch",
        command: {
          command: process.execPath,
          args: ["-e", "process.exit(0);"]
        },
      },
    ],
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("JobQueueWorker", () => {
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

  test("processes pending jobs", async () => {
    await orchestrator.createJob("fetch", {});

    const worker = new JobQueueWorker({
      orchestrator,
      commandFactory: () => createPlan(),
      pollIntervalMs: 10,
    });

    worker.start();
    await delay(200);
    await worker.stop();

    const jobs = orchestrator.listJobs();
    expect(jobs[0]?.status).toBe("completed");
  });
});
