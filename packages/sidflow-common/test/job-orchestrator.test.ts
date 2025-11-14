import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { JobOrchestrator } from "../src/job-orchestrator";
import type { FetchJobParams, ClassifyJobParams } from "../src/job-types";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

const testManifestPath = "/tmp/test-job-manifest.json";

describe("JobOrchestrator", () => {
  let orchestrator: JobOrchestrator;

  beforeEach(async () => {
    orchestrator = new JobOrchestrator({
      manifestPath: testManifestPath,
    });
    await orchestrator.load();
  });

  afterEach(async () => {
    if (existsSync(testManifestPath)) {
      await unlink(testManifestPath);
    }
  });

  test("creates a new job", async () => {
    const params: FetchJobParams = { force: true };
    const job = await orchestrator.createJob("fetch", params);

    expect(job.id).toBeDefined();
    expect(job.type).toBe("fetch");
    expect(job.status).toBe("pending");
    expect(job.params).toEqual(params);
    expect(job.metadata.createdAt).toBeDefined();
  });

  test("saves and loads manifest", async () => {
    const params: ClassifyJobParams = { sidPaths: ["/test.sid"] };
    const job = await orchestrator.createJob("classify", params);

    // Create new orchestrator and load
    const orchestrator2 = new JobOrchestrator({
      manifestPath: testManifestPath,
    });
    await orchestrator2.load();

    const loadedJob = orchestrator2.getJob(job.id);
    expect(loadedJob).toBeDefined();
    expect(loadedJob?.id).toBe(job.id);
    expect(loadedJob?.type).toBe("classify");
  });

  test("updates job status", async () => {
    const job = await orchestrator.createJob("train", {});

    await orchestrator.updateJobStatus(job.id, "running");
    let updated = orchestrator.getJob(job.id);
    expect(updated?.status).toBe("running");
    expect(updated?.metadata.startedAt).toBeDefined();

    await orchestrator.updateJobStatus(job.id, "completed");
    updated = orchestrator.getJob(job.id);
    expect(updated?.status).toBe("completed");
    expect(updated?.metadata.completedAt).toBeDefined();
  });

  test("updates job progress", async () => {
    const job = await orchestrator.createJob("render", {
      sidPaths: ["/test.sid"],
      engine: "wasm",
      formats: ["wav"],
    });

    await orchestrator.updateJobProgress(job.id, 50, 100, "Processing...");

    const updated = orchestrator.getJob(job.id);
    expect(updated?.metadata.progress).toBeDefined();
    expect(updated?.metadata.progress?.current).toBe(50);
    expect(updated?.metadata.progress?.total).toBe(100);
    expect(updated?.metadata.progress?.message).toBe("Processing...");
  });

  test("fails a job with error message", async () => {
    const job = await orchestrator.createJob("fetch", {});

    await orchestrator.failJob(job.id, "Network error");

    const updated = orchestrator.getJob(job.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.metadata.error).toBe("Network error");
    expect(updated?.metadata.failedAt).toBeDefined();
  });

  test("lists jobs with filters", async () => {
    await orchestrator.createJob("fetch", {});
    await orchestrator.createJob("classify", { sidPaths: [] });
    await orchestrator.createJob("train", {});

    const job1 = await orchestrator.createJob("render", {
      sidPaths: [],
      engine: "wasm",
      formats: ["wav"],
    });
    await orchestrator.updateJobStatus(job1.id, "running");

    // Filter by type
    const fetchJobs = orchestrator.listJobs({ type: "fetch" });
    expect(fetchJobs.length).toBe(1);
    expect(fetchJobs[0].type).toBe("fetch");

    // Filter by status
    const runningJobs = orchestrator.listJobs({ status: "running" });
    expect(runningJobs.length).toBe(1);
    expect(runningJobs[0].id).toBe(job1.id);

    // No filter
    const allJobs = orchestrator.listJobs();
    expect(allJobs.length).toBe(4);
  });

  test("deletes a job", async () => {
    const job = await orchestrator.createJob("fetch", {});

    expect(orchestrator.getJob(job.id)).toBeDefined();

    await orchestrator.deleteJob(job.id);

    expect(orchestrator.getJob(job.id)).toBeNull();
  });

  test("generates unique job IDs", async () => {
    const job1 = await orchestrator.createJob("fetch", {});
    const job2 = await orchestrator.createJob("fetch", {});

    expect(job1.id).not.toBe(job2.id);
    expect(job1.id).toContain("fetch-");
    expect(job2.id).toContain("fetch-");
  });

  test("gets statistics", async () => {
    await orchestrator.createJob("fetch", {});
    const job2 = await orchestrator.createJob("classify", { sidPaths: [] });
    const job3 = await orchestrator.createJob("train", {});

    await orchestrator.updateJobStatus(job2.id, "running");
    await orchestrator.updateJobStatus(job3.id, "completed");

    const stats = orchestrator.getStatistics();

    expect(stats.total).toBe(3);
    expect(stats.pending).toBe(1);
    expect(stats.running).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(0);
  });

  test("throws error for non-existent job update", async () => {
    expect(
      orchestrator.updateJobStatus("nonexistent", "running")
    ).rejects.toThrow("Job nonexistent not found");
  });
});
