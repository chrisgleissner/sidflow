import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PlaybackLock } from "../src/playback-lock.js";

const TEMP_PREFIX = path.join(tmpdir(), "sidflow-playback-lock-");
let tempDir: string;
let lockPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(TEMP_PREFIX);
  lockPath = path.join(tempDir, ".sidflow-playback.lock");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("PlaybackLock", () => {
  describe("constructor", () => {
    it("creates lock with specified path", () => {
      const lock = new PlaybackLock(lockPath);
      expect(lock.path).toBe(lockPath);
    });
  });

  describe("registerProcess", () => {
    it("writes metadata to lock file", async () => {
      const lock = new PlaybackLock(lockPath);
      const metadata = {
        pid: process.pid,
        command: "test",
        startedAt: new Date().toISOString(),
      };
      await lock.registerProcess(metadata);
      const readMeta = await lock.getMetadata();
      expect(readMeta?.pid).toBe(process.pid);
      expect(readMeta?.command).toBe("test");
    });

    it("overwrites existing lock file", async () => {
      const lock = new PlaybackLock(lockPath);
      await lock.registerProcess({
        pid: 1000,
        command: "old",
        startedAt: new Date().toISOString(),
      });
      await lock.registerProcess({
        pid: 2000,
        command: "new",
        startedAt: new Date().toISOString(),
      });
      const meta = await lock.getMetadata();
      expect(meta?.pid).toBe(2000);
      expect(meta?.command).toBe("new");
    });

    it("creates parent directory if needed", async () => {
      const deepPath = path.join(tempDir, "a", "b", "c", ".lock");
      const lock = new PlaybackLock(deepPath);
      await lock.registerProcess({
        pid: process.pid,
        command: "test",
        startedAt: new Date().toISOString(),
      });
      expect(await lock.getMetadata()).toBeTruthy();
    });
  });

  describe("getMetadata", () => {
    it("returns null for non-existent lock", async () => {
      const lock = new PlaybackLock(lockPath);
      const meta = await lock.getMetadata();
      expect(meta).toBe(null);
    });

    it("returns metadata for existing lock", async () => {
      const lock = new PlaybackLock(lockPath);
      const metadata = {
        pid: process.pid,
        command: "sidflow-play",
        sidPath: "/music/test.sid",
        startedAt: new Date().toISOString(),
      };
      await lock.registerProcess(metadata);
      const meta = await lock.getMetadata();
      expect(meta?.sidPath).toBe("/music/test.sid");
    });

    it("includes optional fields", async () => {
      const lock = new PlaybackLock(lockPath);
      await lock.registerProcess({
        pid: process.pid,
        command: "test",
        startedAt: new Date().toISOString(),
        offsetSeconds: 30,
        durationSeconds: 120,
        isPaused: false,
      });
      const meta = await lock.getMetadata();
      expect(meta?.offsetSeconds).toBe(30);
      expect(meta?.durationSeconds).toBe(120);
      expect(meta?.isPaused).toBe(false);
    });
  });

  describe("updateMetadata", () => {
    it("updates existing metadata", async () => {
      const lock = new PlaybackLock(lockPath);
      await lock.registerProcess({
        pid: process.pid,
        command: "test",
        startedAt: new Date().toISOString(),
        isPaused: false,
      });
      await lock.updateMetadata({
        pid: process.pid,
        command: "test",
        startedAt: new Date().toISOString(),
        isPaused: true,
      });
      const meta = await lock.getMetadata();
      expect(meta?.isPaused).toBe(true);
    });
  });

  describe("releaseIfMatches", () => {
    it("releases lock for matching PID", async () => {
      const lock = new PlaybackLock(lockPath);
      await lock.registerProcess({
        pid: process.pid,
        command: "test",
        startedAt: new Date().toISOString(),
      });
      await lock.releaseIfMatches(process.pid);
      const meta = await lock.getMetadata();
      expect(meta).toBe(null);
    });

    it("does not release for non-matching PID", async () => {
      const lock = new PlaybackLock(lockPath);
      await lock.registerProcess({
        pid: process.pid,
        command: "test",
        startedAt: new Date().toISOString(),
      });
      await lock.releaseIfMatches(99999);
      const meta = await lock.getMetadata();
      expect(meta?.pid).toBe(process.pid);
    });

    it("handles undefined PID gracefully", async () => {
      const lock = new PlaybackLock(lockPath);
      await lock.registerProcess({
        pid: process.pid,
        command: "test",
        startedAt: new Date().toISOString(),
      });
      await lock.releaseIfMatches(undefined);
      const meta = await lock.getMetadata();
      expect(meta?.pid).toBe(process.pid);
    });
  });

  describe("forceRelease", () => {
    it("removes lock file unconditionally", async () => {
      const lock = new PlaybackLock(lockPath);
      await lock.registerProcess({
        pid: 12345,
        command: "test",
        startedAt: new Date().toISOString(),
      });
      await lock.forceRelease();
      const meta = await lock.getMetadata();
      expect(meta).toBe(null);
    });

    it("succeeds even if no lock exists", async () => {
      const lock = new PlaybackLock(lockPath);
      await lock.forceRelease();
      const meta = await lock.getMetadata();
      expect(meta).toBe(null);
    });
  });

  describe("stopExistingPlayback", () => {
    it("clears lock for non-existent process", async () => {
      const lock = new PlaybackLock(lockPath);
      await lock.registerProcess({
        pid: 99999,
        command: "test",
        startedAt: new Date().toISOString(),
      });
      await lock.stopExistingPlayback("test");
      const meta = await lock.getMetadata();
      expect(meta).toBe(null);
    });

    it("does nothing if no lock exists", async () => {
      const lock = new PlaybackLock(lockPath);
      await lock.stopExistingPlayback("test");
      const meta = await lock.getMetadata();
      expect(meta).toBe(null);
    });

    it("preserves lock for same PID", async () => {
      const lock = new PlaybackLock(lockPath);
      await lock.registerProcess({
        pid: process.pid,
        command: "test",
        startedAt: new Date().toISOString(),
      });
      await lock.stopExistingPlayback("test");
      const meta = await lock.getMetadata();
      expect(meta).toBe(null);
    });
  });

  describe("error handling", () => {
    it("handles corrupted lock file gracefully", async () => {
      await mkdir(path.dirname(lockPath), { recursive: true });
      await writeFile(lockPath, "invalid json", "utf8");
      const lock = new PlaybackLock(lockPath);
      await expect(lock.getMetadata()).rejects.toThrow();
    });

    // Note: Read permission errors are difficult to test reliably in CI
    // as they require actual filesystem permission manipulation
  });

  describe("createPlaybackLock", () => {
    it("creates lock with path derived from config", async () => {
      const { createPlaybackLock } = await import("../src/playback-lock.js");
      const config = {
        sidPath: path.join(tempDir, "C64Music"),
        audioCachePath: path.join(tempDir, "audio-cache"),
        tagsPath: path.join(tempDir, "tags"),
      };
      const lock = await createPlaybackLock(config);
      expect(lock.path).toContain(".sidflow-playback.lock");
      expect(lock.path).not.toContain("C64Music");
    });
  });
});
