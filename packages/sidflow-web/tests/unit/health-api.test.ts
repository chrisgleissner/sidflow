import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { GET } from "../../app/api/health/route";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

describe("Health Check API", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = path.join(tmpdir(), `sidflow-health-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("returns health status with all checks", async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(600);

    expect(data).toHaveProperty("overall");
    expect(data).toHaveProperty("timestamp");
    expect(data).toHaveProperty("checks");

    expect(data.checks).toHaveProperty("wasm");
    expect(data.checks).toHaveProperty("sidplayfpCli");
    expect(data.checks).toHaveProperty("streamingAssets");

    // Validate check structure
    const checks = ["wasm", "sidplayfpCli", "streamingAssets"];
    for (const checkName of checks) {
      const check = data.checks[checkName];
      expect(check).toHaveProperty("status");
      expect(["healthy", "degraded", "unhealthy"]).toContain(check.status);
    }
  });

  it("returns proper status code based on overall health", async () => {
    const response = await GET();
    const data = await response.json();

    if (data.overall === "healthy" || data.overall === "degraded") {
      expect(response.status).toBe(200);
    } else if (data.overall === "unhealthy") {
      expect(response.status).toBe(503);
    }
  });

  it("includes cache-control headers", async () => {
    const response = await GET();
    const cacheControl = response.headers.get("Cache-Control");

    expect(cacheControl).toBeTruthy();
    expect(cacheControl).toContain("no-store");
  });

  it("checks include status and optional message/details", async () => {
    const response = await GET();
    const data = await response.json();

    for (const check of Object.values(data.checks) as Array<{ status: string; message?: string }>) {
      expect(check).toHaveProperty("status");

      // If degraded or unhealthy, should have a message
      if (check.status !== "healthy") {
        expect(typeof check.message).toBe("string");
      }
    }
  });

  it("returns timestamp within reasonable range", async () => {
    const before = Date.now();
    const response = await GET();
    const after = Date.now();
    const data = await response.json();

    expect(data.timestamp).toBeGreaterThanOrEqual(before - 1000);
    expect(data.timestamp).toBeLessThanOrEqual(after + 1000);
  });
});
