import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditTrail, type AuditAction } from "../src/audit-trail.js";

const TEMP_PREFIX = path.join(tmpdir(), "sidflow-audit-");
let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("AuditTrail", () => {
  describe("log", () => {
    it("writes audit entry to file", async () => {
      tempDir = await mkdtemp(TEMP_PREFIX);
      const logPath = path.join(tempDir, "audit.jsonl");
      const trail = new AuditTrail({ logPath });
      await trail.log({
        action: "job:create",
        actor: "test-user",
        success: true,
      });
      const content = await readFile(logPath, "utf-8");
      expect(content).toContain("job:create");
      expect(content).toContain("test-user");
    });
    it("creates parent directory if needed", async () => {
      tempDir = await mkdtemp(TEMP_PREFIX);
      const logPath = path.join(tempDir, "a", "b", "audit.jsonl");
      const trail = new AuditTrail({ logPath });
      await trail.log({
        action: "config:update",
        actor: "admin",
        success: true,
      });
      const content = await readFile(logPath, "utf-8");
      expect(content).toContain("config:update");
    });
    it("appends multiple entries", async () => {
      tempDir = await mkdtemp(TEMP_PREFIX);
      const logPath = path.join(tempDir, "audit.jsonl");
      const trail = new AuditTrail({ logPath });
      await trail.log({
        action: "job:create",
        actor: "user1",
        success: true,
      });
      await trail.log({
        action: "job:update",
        actor: "user2",
        success: false,
      });
      const content = await readFile(logPath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(2);
      expect(lines[0]).toContain("user1");
      expect(lines[1]).toContain("user2");
    });
    it("includes timestamp", async () => {
      tempDir = await mkdtemp(TEMP_PREFIX);
      const logPath = path.join(tempDir, "audit.jsonl");
      const trail = new AuditTrail({ logPath });
      await trail.log({
        action: "model:publish",
        actor: "system",
        success: true,
      });
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.timestamp).toBeDefined();
      expect(new Date(entry.timestamp).getTime()).toBeGreaterThan(0);
    });
    it("includes optional resource", async () => {
      tempDir = await mkdtemp(TEMP_PREFIX);
      const logPath = path.join(tempDir, "audit.jsonl");
      const trail = new AuditTrail({ logPath });
      await trail.log({
        action: "data:modify",
        actor: "admin",
        resource: "/path/to/resource",
        success: true,
      });
      const content = await readFile(logPath, "utf-8");
      expect(content).toContain("/path/to/resource");
    });
    it("includes optional details", async () => {
      tempDir = await mkdtemp(TEMP_PREFIX);
      const logPath = path.join(tempDir, "audit.jsonl");
      const trail = new AuditTrail({ logPath });
      await trail.log({
        action: "cache:invalidate",
        actor: "system",
        details: { reason: "manual", count: 42 },
        success: true,
      });
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.details.reason).toBe("manual");
      expect(entry.details.count).toBe(42);
    });
    it("respects disabled flag", async () => {
      tempDir = await mkdtemp(TEMP_PREFIX);
      const logPath = path.join(tempDir, "audit.jsonl");
      const trail = new AuditTrail({ logPath, enabled: false });
      await trail.log({
        action: "job:delete",
        actor: "user",
        success: true,
      });
      await expect(readFile(logPath, "utf-8")).rejects.toThrow();
    });
  });

  describe("logSuccess", () => {
    it("logs successful action", async () => {
      tempDir = await mkdtemp(TEMP_PREFIX);
      const logPath = path.join(tempDir, "audit.jsonl");
      const trail = new AuditTrail({ logPath });
      await trail.logSuccess("model:publish", "admin", "/model/v1");
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.success).toBe(true);
      expect(entry.action).toBe("model:publish");
      expect(entry.resource).toBe("/model/v1");
    });
    it("includes details", async () => {
      tempDir = await mkdtemp(TEMP_PREFIX);
      const logPath = path.join(tempDir, "audit.jsonl");
      const trail = new AuditTrail({ logPath });
      await trail.logSuccess("config:update", "admin", undefined, { key: "value" });
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.details.key).toBe("value");
    });
  });

  describe("logFailure", () => {
    it("logs failed action with error", async () => {
      tempDir = await mkdtemp(TEMP_PREFIX);
      const logPath = path.join(tempDir, "audit.jsonl");
      const trail = new AuditTrail({ logPath });
      await trail.logFailure("job:create", "user", "Invalid input", "/job/123");
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.success).toBe(false);
      expect(entry.error).toBe("Invalid input");
      expect(entry.resource).toBe("/job/123");
    });
  });

  describe("action types", () => {
    it("accepts all defined action types", async () => {
      tempDir = await mkdtemp(TEMP_PREFIX);
      const logPath = path.join(tempDir, "audit.jsonl");
      const trail = new AuditTrail({ logPath });
      const actions: AuditAction[] = [
        "job:create",
        "job:update",
        "job:delete",
        "model:publish",
        "model:rollback",
        "cache:invalidate",
        "config:update",
        "data:modify",
      ];
      for (const action of actions) {
        await trail.log({ action, actor: "test", success: true });
      }
      const content = await readFile(logPath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(actions.length);
    });
  });
});
