import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { GET } from "../../app/api/admin/metrics/route";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { resetServerEnvCacheForTests } = await import("@/lib/server-env");

describe("Admin Metrics API", () => {
  it("returns metrics with all required fields", async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);

    expect(data).toHaveProperty("timestamp");
    expect(data).toHaveProperty("jobs");
    expect(data).toHaveProperty("cache");
    expect(data).toHaveProperty("sync");
  });

  it("includes job metrics", async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.jobs).toHaveProperty("pending");
    expect(data.jobs).toHaveProperty("running");
    expect(data.jobs).toHaveProperty("paused");
    expect(data.jobs).toHaveProperty("completed");
    expect(data.jobs).toHaveProperty("failed");
    expect(data.jobs).toHaveProperty("totalDurationMs");
    expect(data.jobs).toHaveProperty("avgDurationMs");
    expect(data.jobs).toHaveProperty("oldestActiveAgeMs");

    expect(typeof data.jobs.pending).toBe("number");
    expect(typeof data.jobs.running).toBe("number");
    expect(typeof data.jobs.paused).toBe("number");
    expect(typeof data.jobs.completed).toBe("number");
    expect(typeof data.jobs.failed).toBe("number");
  });

  it("includes cache metrics", async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.cache).toHaveProperty("audioCacheCount");
    expect(data.cache).toHaveProperty("audioCacheSizeBytes");
    expect(data.cache).toHaveProperty("classifiedCount");
    expect(data.cache).toHaveProperty("oldestCacheFileAge");
    expect(data.cache).toHaveProperty("newestCacheFileAge");

    expect(typeof data.cache.audioCacheCount).toBe("number");
    expect(typeof data.cache.audioCacheSizeBytes).toBe("number");
    expect(typeof data.cache.classifiedCount).toBe("number");
  });

  it("includes sync metrics", async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.sync).toHaveProperty("hvscSidCount");
    expect(typeof data.sync.hvscSidCount).toBe("number");
    expect(data.sync.hvscSidCount).toBeGreaterThanOrEqual(0);
  });

  it("returns cache-control headers", async () => {
    const response = await GET();
    const cacheControl = response.headers.get("Cache-Control");

    expect(cacheControl).toBeTruthy();
    expect(cacheControl).toContain("no-store");
  });

  it("returns timestamp within reasonable range", async () => {
    const before = Date.now();
    const response = await GET();
    const after = Date.now();
    const data = await response.json();

    expect(data.timestamp).toBeGreaterThanOrEqual(before - 1000);
    expect(data.timestamp).toBeLessThanOrEqual(after + 1000);
  });

  it("handles missing directories gracefully", async () => {
    const response = await GET();
    const data = await response.json();

    // Should not throw, should return zeros for missing data
    expect(response.status).toBe(200);
    expect(typeof data.jobs.pending).toBe("number");
    expect(typeof data.cache.audioCacheCount).toBe("number");
    expect(typeof data.sync.hvscSidCount).toBe("number");
  });
});

describe("Admin Metrics API error and coverage paths", () => {
  let tempRoot: string;
  let origRoot: string | undefined;
  let origConfig: string | undefined;

  function makeMinimalConfig(tempRoot: string) {
    return JSON.stringify({
      sidPath: path.join(tempRoot, "sids"),
      audioCachePath: path.join(tempRoot, "audio"),
      tagsPath: path.join(tempRoot, "tags"),
      threads: 2,
      classificationDepth: 3,
    });
  }

  function makeManifest(jobs: Record<string, unknown>) {
    return JSON.stringify({
      version: "1",
      lastUpdated: new Date().toISOString(),
      jobs,
    });
  }

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-metrics-cov-"));
    origRoot = process.env.SIDFLOW_ROOT;
    origConfig = process.env.SIDFLOW_CONFIG;
  });

  afterEach(async () => {
    if (origRoot === undefined) delete process.env.SIDFLOW_ROOT;
    else process.env.SIDFLOW_ROOT = origRoot;
    if (origConfig === undefined) delete process.env.SIDFLOW_CONFIG;
    else process.env.SIDFLOW_CONFIG = origConfig;
    resetServerEnvCacheForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns 500 when config file is missing", async () => {
    process.env.SIDFLOW_CONFIG = path.join(tempRoot, "nonexistent.json");
    delete process.env.SIDFLOW_ROOT;
    resetServerEnvCacheForTests();
    const response = await GET();
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBeTruthy();
  });

  it("returns job metrics with various statuses from manifest", async () => {
    // Create directory structure
    await mkdir(path.join(tempRoot, "sids"), { recursive: true });
    await mkdir(path.join(tempRoot, "audio"), { recursive: true });
    await mkdir(path.join(tempRoot, "tags"), { recursive: true });
    await mkdir(path.join(tempRoot, "data", "jobs"), { recursive: true });

    await writeFile(path.join(tempRoot, ".sidflow.json"), makeMinimalConfig(tempRoot));

    const now = new Date();
    const earlier = new Date(Date.now() - 10000);
    const manifest = makeManifest({
      "job-pending": { id: "job-pending", type: "classify", status: "pending", params: {}, metadata: { id: "job-pending", type: "classify", status: "pending", createdAt: now.toISOString() } },
      "job-running": { id: "job-running", type: "classify", status: "running", params: {}, metadata: { id: "job-running", type: "classify", status: "running", createdAt: earlier.toISOString(), startedAt: earlier.toISOString() } },
      "job-paused": { id: "job-paused", type: "classify", status: "paused", params: {}, metadata: { id: "job-paused", type: "classify", status: "paused", createdAt: earlier.toISOString(), startedAt: earlier.toISOString() } },
      "job-completed": { id: "job-completed", type: "classify", status: "completed", params: {}, metadata: { id: "job-completed", type: "classify", status: "completed", createdAt: earlier.toISOString(), startedAt: earlier.toISOString(), completedAt: now.toISOString() } },
      "job-failed": { id: "job-failed", type: "classify", status: "failed", params: {}, metadata: { id: "job-failed", type: "classify", status: "failed", createdAt: earlier.toISOString() } },
    });
    await writeFile(path.join(tempRoot, "data", "jobs", "manifest.json"), manifest);

    process.env.SIDFLOW_ROOT = tempRoot;
    process.env.SIDFLOW_CONFIG = path.join(tempRoot, ".sidflow.json");
    resetServerEnvCacheForTests();

    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.jobs.pending).toBeGreaterThanOrEqual(1);
    expect(data.jobs.running).toBeGreaterThanOrEqual(1);
    expect(data.jobs.paused).toBeGreaterThanOrEqual(1);
    expect(data.jobs.completed).toBeGreaterThanOrEqual(1);
    expect(data.jobs.failed).toBeGreaterThanOrEqual(1);
    expect(data.jobs.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(data.jobs.avgDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns sync age when hvsc-version.json exists with timestamp", async () => {
    await mkdir(path.join(tempRoot, "sids"), { recursive: true });
    await mkdir(path.join(tempRoot, "audio"), { recursive: true });
    await mkdir(path.join(tempRoot, "tags"), { recursive: true });
    await mkdir(path.join(tempRoot, "workspace"), { recursive: true });

    await writeFile(path.join(tempRoot, ".sidflow.json"), makeMinimalConfig(tempRoot));

    const fiveSecondsAgo = Date.now() - 5000;
    await writeFile(
      path.join(tempRoot, "workspace", "hvsc-version.json"),
      JSON.stringify({ version: "82", timestamp: fiveSecondsAgo }),
    );

    process.env.SIDFLOW_ROOT = tempRoot;
    process.env.SIDFLOW_CONFIG = path.join(tempRoot, ".sidflow.json");
    resetServerEnvCacheForTests();

    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.sync.hvscVersion).toBe("82");
    expect(data.sync.lastSyncTimestamp).toBe(fiveSecondsAgo);
    expect(data.sync.syncAgeMs).toBeGreaterThanOrEqual(0);
  });
});
