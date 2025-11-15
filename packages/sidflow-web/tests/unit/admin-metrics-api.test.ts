import { describe, it, expect } from "bun:test";
import { GET } from "../../app/api/admin/metrics/route";

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
    expect(data.jobs).toHaveProperty("completed");
    expect(data.jobs).toHaveProperty("failed");
    expect(data.jobs).toHaveProperty("totalDurationMs");
    expect(data.jobs).toHaveProperty("avgDurationMs");

    expect(typeof data.jobs.pending).toBe("number");
    expect(typeof data.jobs.running).toBe("number");
    expect(typeof data.jobs.completed).toBe("number");
    expect(typeof data.jobs.failed).toBe("number");
  });

  it("includes cache metrics", async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.cache).toHaveProperty("wavCacheCount");
    expect(data.cache).toHaveProperty("wavCacheSizeBytes");
    expect(data.cache).toHaveProperty("classifiedCount");
    expect(data.cache).toHaveProperty("oldestCacheFileAge");
    expect(data.cache).toHaveProperty("newestCacheFileAge");

    expect(typeof data.cache.wavCacheCount).toBe("number");
    expect(typeof data.cache.wavCacheSizeBytes).toBe("number");
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
    expect(typeof data.cache.wavCacheCount).toBe("number");
    expect(typeof data.sync.hvscSidCount).toBe("number");
  });
});
