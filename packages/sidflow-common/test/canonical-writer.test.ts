import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendCanonicalJsonLines,
  writeCanonicalJsonFile,
  writeCanonicalJsonLines
} from "../src/canonical-writer.js";
import type { AuditTrail } from "../src/audit-trail.js";
import type { JsonValue } from "../src/json.js";

interface AuditSpy {
  auditTrail: AuditTrail;
  success: ReturnType<typeof mock>;
  failure: ReturnType<typeof mock>;
}

function createAuditSpy(): AuditSpy {
  const success = mock(async () => {});
  const failure = mock(async () => {});

  const auditTrail = {
    logSuccess: success,
    logFailure: failure
  } as unknown as AuditTrail;

  return { auditTrail, success, failure };
}

describe("canonical writer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "sidflow-canonical-writer-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("writeCanonicalJsonFile produces deterministic JSON and logs success", async () => {
    const filePath = path.join(tempDir, "feature-stats.json");
    const { auditTrail, success, failure } = createAuditSpy();

    await writeCanonicalJsonFile(
      filePath,
      { b: 2, a: 1 } as unknown as JsonValue,
      { auditTrail, actor: "test" }
    );

    const content = await readFile(filePath, "utf8");
    expect(JSON.parse(content)).toEqual({ a: 1, b: 2 });
    expect(content.endsWith("\n")).toBe(true);
    expect(success).toHaveBeenCalledTimes(1);
    expect(failure).not.toHaveBeenCalled();
  });

  test("writeCanonicalJsonLines writes newline-delimited records", async () => {
    const filePath = path.join(tempDir, "training.jsonl");
    const { auditTrail, success } = createAuditSpy();

    await writeCanonicalJsonLines(
      filePath,
      [
        { sid: "A", rating: 5 } as unknown as JsonValue,
        { sid: "B", rating: 3 } as unknown as JsonValue
      ],
      { auditTrail }
    );

    const content = await readFile(filePath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ rating: 5, sid: "A" });
    expect(JSON.parse(lines[1])).toEqual({ rating: 3, sid: "B" });
    expect(success).toHaveBeenCalledTimes(1);
  });

  test("appendCanonicalJsonLines appends records and logs failures", async () => {
    const filePath = path.join(tempDir, "feedback/2025/11/03/events.jsonl");
    const { auditTrail, success, failure } = createAuditSpy();

    await appendCanonicalJsonLines(
      filePath,
      [{ sid_path: "Song1", action: "play" }] as unknown as JsonValue[],
      { auditTrail }
    );

    await appendCanonicalJsonLines(
      filePath,
      [{ sid_path: "Song2", action: "like" }] as unknown as JsonValue[],
      { auditTrail }
    );

  const content = await readFile(filePath, "utf8");
  const lines = content.trim().split("\n");
  expect(lines).toHaveLength(2);
  expect(JSON.parse(lines[0])).toEqual({ action: "play", sid_path: "Song1" });
  expect(JSON.parse(lines[1])).toEqual({ action: "like", sid_path: "Song2" });
    expect(success).toHaveBeenCalledTimes(2);

    // Force a failure by making parent path a file
    const invalidDir = path.join(tempDir, "locked");
    await writeFile(invalidDir, "not-a-dir", "utf8");
    await expect(
      appendCanonicalJsonLines(
        path.join(invalidDir, "events.jsonl"),
        [{ sid_path: "Song3", action: "skip" }] as unknown as JsonValue[],
        { auditTrail }
      )
    ).rejects.toThrow();
    expect(failure).toHaveBeenCalledTimes(1);
  });
});
