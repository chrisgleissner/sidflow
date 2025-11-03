import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  logFeedback,
  logFeedbackBatch,
  generateEventId,
  validateFeedbackLogs,
  type FeedbackRecord
} from "../src/feedback.js";

describe("feedback logging", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "sidflow-feedback-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("logFeedback creates date-partitioned JSONL files", async () => {
    const feedbackPath = path.join(testDir, "feedback");
    const timestamp = new Date("2025-11-03T12:00:00Z");

    const logFile = await logFeedback({
      feedbackPath,
      sidPath: "Rob_Hubbard/Delta.sid",
      action: "play",
      timestamp
    });

    expect(logFile).toContain("2025/11/03/events.jsonl");

    // Read and verify content
    const content = await readFile(logFile, "utf8");
    const record: FeedbackRecord = JSON.parse(content.trim());

    expect(record.ts).toBe("2025-11-03T12:00:00.000Z");
    expect(record.sid_path).toBe("Rob_Hubbard/Delta.sid");
    expect(record.action).toBe("play");
    expect(record.uuid).toBeUndefined();
  });

  test("logFeedback includes UUID when provided", async () => {
    const feedbackPath = path.join(testDir, "feedback");
    const uuid = generateEventId();

    const logFile = await logFeedback({
      feedbackPath,
      sidPath: "Martin_Galway/Parallax.sid",
      action: "like",
      uuid
    });

    const content = await readFile(logFile, "utf8");
    const record: FeedbackRecord = JSON.parse(content.trim());

    expect(record.uuid).toBe(uuid);
  });

  test("logFeedback appends to existing files", async () => {
    const feedbackPath = path.join(testDir, "feedback");
    const timestamp = new Date("2025-11-03T12:00:00Z");

    // Log first event
    await logFeedback({
      feedbackPath,
      sidPath: "Artist1/Song1.sid",
      action: "play",
      timestamp
    });

    // Log second event to same day
    await logFeedback({
      feedbackPath,
      sidPath: "Artist2/Song2.sid",
      action: "like",
      timestamp: new Date("2025-11-03T14:00:00Z")
    });

    // Read and verify both events are in file
    const logFile = path.join(feedbackPath, "2025/11/03/events.jsonl");
    const content = await readFile(logFile, "utf8");
    const lines = content.trim().split("\n");

    expect(lines.length).toBe(2);

    const record1: FeedbackRecord = JSON.parse(lines[0]);
    const record2: FeedbackRecord = JSON.parse(lines[1]);

    expect(record1.action).toBe("play");
    expect(record2.action).toBe("like");
  });

  test("logFeedback supports all action types", async () => {
    const feedbackPath = path.join(testDir, "feedback");
    const actions: Array<"play" | "like" | "dislike" | "skip"> = ["play", "like", "dislike", "skip"];

    for (const action of actions) {
      await logFeedback({
        feedbackPath,
        sidPath: "Test/Song.sid",
        action
      });
    }

    // Verify all actions were logged (they should be in today's date partition)
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");

    const logFile = path.join(feedbackPath, String(year), month, day, "events.jsonl");
    const content = await readFile(logFile, "utf8");
    const lines = content.trim().split("\n");

    expect(lines.length).toBe(4);
  });

  test("logFeedbackBatch logs multiple events", async () => {
    const feedbackPath = path.join(testDir, "feedback");

    const events = [
      { sidPath: "Song1.sid", action: "play" as const },
      { sidPath: "Song2.sid", action: "like" as const },
      { sidPath: "Song3.sid", action: "skip" as const }
    ];

    const logFiles = await logFeedbackBatch(feedbackPath, events);

    expect(logFiles.length).toBe(3);
  });

  test("generateEventId creates unique UUIDs", () => {
    const id1 = generateEventId();
    const id2 = generateEventId();

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("validateFeedbackLogs validates correct logs", async () => {
    const feedbackPath = path.join(testDir, "feedback");

    // Log some valid events
    await logFeedback({
      feedbackPath,
      sidPath: "Song1.sid",
      action: "play",
      timestamp: new Date("2025-11-03T12:00:00Z")
    });

    await logFeedback({
      feedbackPath,
      sidPath: "Song2.sid",
      action: "like",
      timestamp: new Date("2025-11-03T13:00:00Z")
    });

    const result = await validateFeedbackLogs({ feedbackPath });

    expect(result.totalEvents).toBe(2);
    expect(result.duplicates).toBe(0);
    expect(result.invalidRecords).toBe(0);
    expect(result.errorsByDate.size).toBe(0);
  });

  test("validateFeedbackLogs detects duplicate UUIDs", async () => {
    const feedbackPath = path.join(testDir, "feedback");
    const uuid = generateEventId();

    // Log two events with same UUID
    await logFeedback({
      feedbackPath,
      sidPath: "Song1.sid",
      action: "play",
      timestamp: new Date("2025-11-03T12:00:00Z"),
      uuid
    });

    await logFeedback({
      feedbackPath,
      sidPath: "Song2.sid",
      action: "like",
      timestamp: new Date("2025-11-03T13:00:00Z"),
      uuid
    });

    const result = await validateFeedbackLogs({ feedbackPath });

    expect(result.totalEvents).toBe(2);
    expect(result.duplicates).toBe(1);
  });

  test("validateFeedbackLogs detects invalid records", async () => {
    const feedbackPath = path.join(testDir, "feedback");

    // Create a log file with invalid JSON
    const logDir = path.join(feedbackPath, "2025/11/03");
    await import("node:fs/promises").then(fs => fs.mkdir(logDir, { recursive: true }));

    const logFile = path.join(logDir, "events.jsonl");
    await import("node:fs/promises").then(fs => 
      fs.writeFile(logFile, '{"ts":"2025-11-03T12:00:00Z","sid_path":"Song.sid","action":"play"}\n' +
                             '{"invalid json\n' +
                             '{"ts":"2025-11-03T13:00:00Z","sid_path":"Song2.sid","action":"invalid_action"}\n',
                    "utf8")
    );

    const result = await validateFeedbackLogs({ feedbackPath });

    expect(result.totalEvents).toBe(3);
    expect(result.invalidRecords).toBe(2); // Invalid JSON + invalid action
    expect(result.errorsByDate.size).toBeGreaterThan(0);
  });

  test("validateFeedbackLogs handles empty directories", async () => {
    const feedbackPath = path.join(testDir, "feedback");

    const result = await validateFeedbackLogs({ feedbackPath });

    expect(result.totalEvents).toBe(0);
    expect(result.duplicates).toBe(0);
    expect(result.invalidRecords).toBe(0);
  });
});
