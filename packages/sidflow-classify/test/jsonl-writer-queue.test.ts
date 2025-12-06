/**
 * Unit tests for JSONL Writer Queue
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { 
  queueJsonlWrite, 
  getWriterQueueStats, 
  getAllWriterQueueStats,
  flushWriterQueue,
  clearWriterQueues,
  logJsonlPathOnce,
  clearLoggedPaths
} from "../src/jsonl-writer-queue.js";

const TEST_DIR = join(tmpdir(), "sidflow-jsonl-queue-test");

describe("JSONL Writer Queue", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    clearWriterQueues();
    clearLoggedPaths();
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("writes single record to JSONL", async () => {
    const filePath = join(TEST_DIR, "test1.jsonl");
    
    await queueJsonlWrite(filePath, [{ id: 1, name: "test" }]);
    
    const content = await readFile(filePath, "utf8");
    const lines = content.trim().split("\n");
    
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0])).toEqual({ id: 1, name: "test" });
  });

  test("writes multiple records in order", async () => {
    const filePath = join(TEST_DIR, "test2.jsonl");
    
    await queueJsonlWrite(filePath, [{ id: 1 }]);
    await queueJsonlWrite(filePath, [{ id: 2 }]);
    await queueJsonlWrite(filePath, [{ id: 3 }]);
    
    const content = await readFile(filePath, "utf8");
    const lines = content.trim().split("\n");
    
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[0])).toEqual({ id: 1 });
    expect(JSON.parse(lines[1])).toEqual({ id: 2 });
    expect(JSON.parse(lines[2])).toEqual({ id: 3 });
  });

  test("handles concurrent writes to same file in order", async () => {
    const filePath = join(TEST_DIR, "test3.jsonl");
    
    // Queue multiple writes concurrently
    const writes = [
      queueJsonlWrite(filePath, [{ id: 1 }]),
      queueJsonlWrite(filePath, [{ id: 2 }]),
      queueJsonlWrite(filePath, [{ id: 3 }]),
      queueJsonlWrite(filePath, [{ id: 4 }]),
      queueJsonlWrite(filePath, [{ id: 5 }]),
    ];
    
    await Promise.all(writes);
    
    const content = await readFile(filePath, "utf8");
    const lines = content.trim().split("\n");
    
    expect(lines.length).toBe(5);
    
    // Verify order is preserved
    for (let i = 0; i < 5; i++) {
      expect(JSON.parse(lines[i])).toEqual({ id: i + 1 });
    }
  });

  test("handles concurrent writes to different files", async () => {
    const file1 = join(TEST_DIR, "test4a.jsonl");
    const file2 = join(TEST_DIR, "test4b.jsonl");
    
    const writes = [
      queueJsonlWrite(file1, [{ file: 1, id: 1 }]),
      queueJsonlWrite(file2, [{ file: 2, id: 1 }]),
      queueJsonlWrite(file1, [{ file: 1, id: 2 }]),
      queueJsonlWrite(file2, [{ file: 2, id: 2 }]),
    ];
    
    await Promise.all(writes);
    
    const content1 = await readFile(file1, "utf8");
    const content2 = await readFile(file2, "utf8");
    
    const lines1 = content1.trim().split("\n");
    const lines2 = content2.trim().split("\n");
    
    expect(lines1.length).toBe(2);
    expect(lines2.length).toBe(2);
    
    expect(JSON.parse(lines1[0])).toEqual({ file: 1, id: 1 });
    expect(JSON.parse(lines1[1])).toEqual({ file: 1, id: 2 });
    expect(JSON.parse(lines2[0])).toEqual({ file: 2, id: 1 });
    expect(JSON.parse(lines2[1])).toEqual({ file: 2, id: 2 });
  });

  test("tracks write statistics", async () => {
    const filePath = join(TEST_DIR, "test5.jsonl");
    
    await queueJsonlWrite(filePath, [{ id: 1 }]);
    await queueJsonlWrite(filePath, [{ id: 2 }, { id: 3 }]);
    
    const stats = getWriterQueueStats(filePath);
    
    expect(stats).not.toBeNull();
    expect(stats!.recordCount).toBe(3);
    expect(stats!.errorCount).toBe(0);
    expect(stats!.pending).toBe(0);
  });

  test("returns null for unknown file path", () => {
    const stats = getWriterQueueStats("/nonexistent/path.jsonl");
    expect(stats).toBeNull();
  });

  test("getAllWriterQueueStats returns all queues", async () => {
    const file1 = join(TEST_DIR, "test6a.jsonl");
    const file2 = join(TEST_DIR, "test6b.jsonl");
    
    await queueJsonlWrite(file1, [{ id: 1 }]);
    await queueJsonlWrite(file2, [{ id: 1 }, { id: 2 }]);
    
    const allStats = getAllWriterQueueStats();
    
    expect(allStats.size).toBe(2);
    expect(allStats.get(file1)?.recordCount).toBe(1);
    expect(allStats.get(file2)?.recordCount).toBe(2);
  });

  test("flushWriterQueue waits for pending writes", async () => {
    const filePath = join(TEST_DIR, "test7.jsonl");
    
    // Queue multiple writes without awaiting
    void queueJsonlWrite(filePath, [{ id: 1 }]);
    void queueJsonlWrite(filePath, [{ id: 2 }]);
    void queueJsonlWrite(filePath, [{ id: 3 }]);
    
    // Flush should wait for all writes
    await flushWriterQueue(filePath);
    
    const content = await readFile(filePath, "utf8");
    const lines = content.trim().split("\n");
    
    expect(lines.length).toBe(3);
  });

  test("flushWriterQueue returns immediately for unknown file", async () => {
    // Should not throw or hang
    await flushWriterQueue("/nonexistent/path.jsonl");
  });

  test("logJsonlPathOnce only logs once per path", () => {
    // These should not throw
    logJsonlPathOnce("/path/to/file.jsonl");
    logJsonlPathOnce("/path/to/file.jsonl"); // Should be silent
    logJsonlPathOnce("/path/to/other.jsonl");
  });

  test("clearWriterQueues resets all state", async () => {
    const filePath = join(TEST_DIR, "test8.jsonl");
    
    await queueJsonlWrite(filePath, [{ id: 1 }]);
    
    expect(getWriterQueueStats(filePath)).not.toBeNull();
    
    clearWriterQueues();
    
    expect(getWriterQueueStats(filePath)).toBeNull();
  });

  test("writes batch of records atomically", async () => {
    const filePath = join(TEST_DIR, "test9.jsonl");
    
    const batch = [
      { id: 1, name: "first" },
      { id: 2, name: "second" },
      { id: 3, name: "third" },
    ];
    
    await queueJsonlWrite(filePath, batch);
    
    const content = await readFile(filePath, "utf8");
    const lines = content.trim().split("\n");
    
    expect(lines.length).toBe(3);
    
    for (let i = 0; i < batch.length; i++) {
      expect(JSON.parse(lines[i])).toEqual(batch[i]);
    }
  });
});
