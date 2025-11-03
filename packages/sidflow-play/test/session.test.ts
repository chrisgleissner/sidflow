/**
 * Tests for session management.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createSessionManager, type PlaybackEvent } from "../src/index.js";

const TEST_SESSION_PATH = "/tmp/sidflow-play-test-sessions";

beforeAll(async () => {
  await mkdir(TEST_SESSION_PATH, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_SESSION_PATH, { recursive: true, force: true });
});

describe("SessionManager", () => {
  test("creates session manager instance", () => {
    const manager = createSessionManager(TEST_SESSION_PATH);
    expect(manager).toBeDefined();
  });

  test("getSession returns undefined before starting", () => {
    const manager = createSessionManager(TEST_SESSION_PATH);
    expect(manager.getSession()).toBeUndefined();
  });

  test("startSession creates new session", async () => {
    const manager = createSessionManager(TEST_SESSION_PATH);
    await manager.startSession("energetic");

    const session = manager.getSession();
    expect(session).toBeDefined();
    expect(session?.seed).toBe("energetic");
    expect(session?.history).toEqual([]);
    expect(session?.stats.totalPlayed).toBe(0);
  });

  test("recordEvent adds event to history", async () => {
    const manager = createSessionManager(TEST_SESSION_PATH);
    await manager.startSession();

    const event: PlaybackEvent = {
      type: "started",
      song: {
        sid_path: "Test/Song1.sid",
        score: 0.9,
        similarity: 0.95,
        songFeedback: 0.8,
        userAffinity: 0.7,
        ratings: { e: 5, m: 5, c: 4, p: 5 },
        feedback: { likes: 10, dislikes: 1, skips: 2, plays: 20 }
      },
      timestamp: new Date().toISOString()
    };

    manager.recordEvent(event);

    const session = manager.getSession();
    expect(session?.history).toHaveLength(1);
    expect(session?.history[0].sid_path).toBe("Test/Song1.sid");
  });

  test("recordEvent updates statistics", async () => {
    const manager = createSessionManager(TEST_SESSION_PATH);
    await manager.startSession();

    const finishedEvent: PlaybackEvent = {
      type: "finished",
      song: {
        sid_path: "Test/Song1.sid",
        score: 0.9,
        similarity: 0.95,
        songFeedback: 0.8,
        userAffinity: 0.7,
        ratings: { e: 5, m: 5, c: 4, p: 5 },
        feedback: { likes: 10, dislikes: 1, skips: 2, plays: 20 }
      },
      timestamp: new Date().toISOString()
    };

    manager.recordEvent(finishedEvent);

    const session = manager.getSession();
    expect(session?.stats.totalPlayed).toBe(1);
  });

  test("endSession persists session to disk", async () => {
    const manager = createSessionManager(TEST_SESSION_PATH);
    await manager.startSession("quiet");

    const event: PlaybackEvent = {
      type: "finished",
      song: {
        sid_path: "Test/Song1.sid",
        score: 0.9,
        similarity: 0.95,
        songFeedback: 0.8,
        userAffinity: 0.7,
        ratings: { e: 1, m: 2, c: 1, p: 3 },
        feedback: { likes: 5, dislikes: 0, skips: 1, plays: 10 }
      },
      timestamp: new Date().toISOString()
    };

    manager.recordEvent(event);

    const sessionId = manager.getSession()?.sessionId;
    await manager.endSession();

    // Session should be persisted
    expect(manager.getSession()).toBeUndefined();

    // Load the session back
    if (sessionId) {
      const loaded = await manager.loadSession(sessionId);
      expect(loaded).toBeDefined();
      expect(loaded?.seed).toBe("quiet");
      expect(loaded?.history).toHaveLength(1);
      expect(loaded?.endedAt).toBeDefined();
    }
  });

  test("listSessions returns session IDs", async () => {
    const manager = createSessionManager(TEST_SESSION_PATH);
    
    await manager.startSession();
    await manager.endSession();

    const sessions = await manager.listSessions();
    expect(sessions.length).toBeGreaterThan(0);
  });

  test("loadSession returns undefined for non-existent session", async () => {
    const manager = createSessionManager(TEST_SESSION_PATH);
    const session = await manager.loadSession("non-existent-id");
    expect(session).toBeUndefined();
  });
});
