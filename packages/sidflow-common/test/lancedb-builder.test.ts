import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDatabase, generateManifest, type DatabaseManifest } from "../src/lancedb-builder.js";
import type { ClassificationRecord, FeedbackRecord } from "../src/jsonl-schema.js";

describe("buildDatabase", () => {
  let testDir: string;
  let classifiedPath: string;
  let feedbackPath: string;
  let dbPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "sidflow-lancedb-test-"));
    classifiedPath = path.join(testDir, "classified");
    feedbackPath = path.join(testDir, "feedback");
    dbPath = path.join(testDir, "sidflow.lance");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("builds database from empty directories", async () => {
    const result = await buildDatabase({
      classifiedPath,
      feedbackPath,
      dbPath,
      forceRebuild: false
    });

    expect(result.recordCount).toBe(0);
    expect(result.classificationFiles).toBe(0);
    expect(result.feedbackEvents).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("builds database from classification records", async () => {
    // Create classified directory with sample JSONL
    const { mkdir } = await import("node:fs/promises");
    await mkdir(classifiedPath, { recursive: true });

    const classificationRecords: ClassificationRecord[] = [
      {
        sid_path: "Artist1/Song1.sid",
        ratings: { e: 3, m: 4, c: 5, p: 4 },
        features: { energy: 0.42, rms: 0.15, bpm: 128 }
      },
      {
        sid_path: "Artist2/Song2.sid",
        ratings: { e: 2, m: 3, c: 4 }
      }
    ];

    const jsonl = classificationRecords
      .map(record => JSON.stringify(record))
      .join("\n");

    await writeFile(
      path.join(classifiedPath, "classification.jsonl"),
      jsonl,
      "utf8"
    );

    const result = await buildDatabase({
      classifiedPath,
      feedbackPath,
      dbPath,
      forceRebuild: false
    });

    expect(result.recordCount).toBe(2);
    expect(result.classificationFiles).toBeGreaterThan(0);
    expect(result.feedbackEvents).toBe(0);
  });

  test("aggregates feedback events by SID path", async () => {
    // Create classified and feedback directories
    const { mkdir } = await import("node:fs/promises");
    await mkdir(classifiedPath, { recursive: true });
    await mkdir(path.join(feedbackPath, "2025/11/03"), { recursive: true });

    // Create classification record
    const classificationRecords: ClassificationRecord[] = [
      {
        sid_path: "Artist1/Song1.sid",
        ratings: { e: 3, m: 4, c: 5 }
      }
    ];

    await writeFile(
      path.join(classifiedPath, "classification.jsonl"),
      classificationRecords.map(r => JSON.stringify(r)).join("\n"),
      "utf8"
    );

    // Create feedback events
    const feedbackEvents: FeedbackRecord[] = [
      {
        ts: "2025-11-03T12:10:05Z",
        sid_path: "Artist1/Song1.sid",
        action: "play"
      },
      {
        ts: "2025-11-03T12:11:10Z",
        sid_path: "Artist1/Song1.sid",
        action: "like"
      },
      {
        ts: "2025-11-03T12:12:22Z",
        sid_path: "Artist1/Song1.sid",
        action: "skip"
      }
    ];

    await writeFile(
      path.join(feedbackPath, "2025/11/03/events.jsonl"),
      feedbackEvents.map(e => JSON.stringify(e)).join("\n"),
      "utf8"
    );

    const result = await buildDatabase({
      classifiedPath,
      feedbackPath,
      dbPath,
      forceRebuild: false
    });

    expect(result.recordCount).toBe(1);
    expect(result.feedbackEvents).toBe(3);
  });

  test("creates rating vectors with default preference value", async () => {
    // Create classified directory
    const { mkdir } = await import("node:fs/promises");
    await mkdir(classifiedPath, { recursive: true });

    // Record without preference rating
    const recordWithoutP: ClassificationRecord = {
      sid_path: "Artist1/Song1.sid",
      ratings: { e: 3, m: 4, c: 5 }
    };

    // Record with preference rating
    const recordWithP: ClassificationRecord = {
      sid_path: "Artist2/Song2.sid",
      ratings: { e: 2, m: 3, c: 4, p: 5 }
    };

    await writeFile(
      path.join(classifiedPath, "classification.jsonl"),
      [recordWithoutP, recordWithP].map(r => JSON.stringify(r)).join("\n"),
      "utf8"
    );

    const result = await buildDatabase({
      classifiedPath,
      feedbackPath,
      dbPath,
      forceRebuild: false
    });

    expect(result.recordCount).toBe(2);
  });
});

describe("generateManifest", () => {
  let testDir: string;
  let classifiedPath: string;
  let feedbackPath: string;
  let dbPath: string;
  let manifestPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "sidflow-manifest-test-"));
    classifiedPath = path.join(testDir, "classified");
    feedbackPath = path.join(testDir, "feedback");
    dbPath = path.join(testDir, "sidflow.lance");
    manifestPath = path.join(testDir, "sidflow.lance.manifest.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("generates manifest with checksums and statistics", async () => {
    const mockResult = {
      recordCount: 10,
      classificationFiles: 2,
      feedbackEvents: 5,
      durationMs: 123
    };

    const manifest = await generateManifest({
      classifiedPath,
      feedbackPath,
      dbPath,
      manifestPath,
      result: mockResult
    });

    expect(manifest.version).toBe("1.0");
    expect(manifest.schema_version).toBe("1.0");
    expect(manifest.record_count).toBe(10);
    expect(manifest.stats.total_classifications).toBe(10);
    expect(manifest.stats.total_feedback_events).toBe(5);
    expect(manifest.stats.unique_songs).toBe(10);
    expect(manifest.created_at).toBeTruthy();
    expect(manifest.source_checksums.classified).toBeTruthy();
    expect(manifest.source_checksums.feedback).toBeTruthy();

    // Verify manifest was written to file
    const content = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(content) as DatabaseManifest;
    expect(parsed.version).toBe("1.0");
  });

  test("computes checksums for empty directories", async () => {
    const mockResult = {
      recordCount: 0,
      classificationFiles: 0,
      feedbackEvents: 0,
      durationMs: 50
    };

    const manifest = await generateManifest({
      classifiedPath,
      feedbackPath,
      dbPath,
      manifestPath,
      result: mockResult
    });

    expect(manifest.source_checksums.classified).toBe("empty");
    expect(manifest.source_checksums.feedback).toBe("empty");
  });

  test("computes deterministic checksums", async () => {
    // Create test files
    const { mkdir } = await import("node:fs/promises");
    await mkdir(classifiedPath, { recursive: true });

    await writeFile(
      path.join(classifiedPath, "test.jsonl"),
      '{"test": "data"}\n',
      "utf8"
    );

    const mockResult = {
      recordCount: 1,
      classificationFiles: 1,
      feedbackEvents: 0,
      durationMs: 50
    };

    // Generate manifest twice
    const manifest1 = await generateManifest({
      classifiedPath,
      feedbackPath,
      dbPath,
      manifestPath: path.join(testDir, "manifest1.json"),
      result: mockResult
    });

    const manifest2 = await generateManifest({
      classifiedPath,
      feedbackPath,
      dbPath,
      manifestPath: path.join(testDir, "manifest2.json"),
      result: mockResult
    });

    // Checksums should be identical
    expect(manifest1.source_checksums.classified).toBe(
      manifest2.source_checksums.classified
    );
  });
});
