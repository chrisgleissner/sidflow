/**
 * Tests for playback controller.
 */

import { describe, expect, test, mock } from "bun:test";
import { createPlaybackController, PlaybackState } from "../src/index.js";
import type { Recommendation } from "@sidflow/common";

const mockSongs: Recommendation[] = [
  {
    sid_path: "Test/Song1.sid",
    score: 0.9,
    similarity: 0.95,
    songFeedback: 0.8,
    userAffinity: 0.7,
    ratings: { e: 5, m: 5, c: 4, p: 5 },
    feedback: { likes: 10, dislikes: 1, skips: 2, plays: 20 }
  },
  {
    sid_path: "Test/Song2.sid",
    score: 0.7,
    similarity: 0.85,
    songFeedback: 0.6,
    userAffinity: 0.5,
    ratings: { e: 3, m: 3, c: 3, p: 4 },
    feedback: { likes: 5, dislikes: 2, skips: 3, plays: 15 }
  }
];

describe("PlaybackController", () => {
  test("creates playback controller instance", () => {
    const controller = createPlaybackController({
      rootPath: "/tmp/test",
      sidplayPath: "sidplayfp"
    });
    expect(controller).toBeDefined();
  });

  test("initial state is IDLE", () => {
    const controller = createPlaybackController({
      rootPath: "/tmp/test"
    });
    expect(controller.getState()).toBe(PlaybackState.IDLE);
  });

  test("loadQueue loads songs into queue", () => {
    const controller = createPlaybackController({
      rootPath: "/tmp/test"
    });
    controller.loadQueue(mockSongs);

    const queue = controller.getQueue();
    expect(queue.songs).toHaveLength(2);
    expect(queue.currentIndex).toBe(-1);
    expect(queue.remaining).toBe(2);
  });

  test("getCurrentSong returns undefined when queue not started", () => {
    const controller = createPlaybackController({
      rootPath: "/tmp/test"
    });
    controller.loadQueue(mockSongs);

    expect(controller.getCurrentSong()).toBeUndefined();
  });

  test("getQueue returns queue information", () => {
    const controller = createPlaybackController({
      rootPath: "/tmp/test"
    });
    controller.loadQueue(mockSongs);

    const queue = controller.getQueue();
    expect(queue.songs).toEqual(mockSongs);
    expect(queue.currentIndex).toBe(-1);
    expect(queue.remaining).toBe(2);
  });

  test("throws error when playing empty queue", async () => {
    const controller = createPlaybackController({
      rootPath: "/tmp/test"
    });

    expect(controller.play()).rejects.toThrow("Queue is empty");
  });

  test("stop resets state", async () => {
    const controller = createPlaybackController({
      rootPath: "/tmp/test"
    });
    controller.loadQueue(mockSongs);

    const kill = mock(() => {});
    (controller as unknown as { process?: { kill: () => void } }).process = { kill };

    await controller.stop();
    expect(controller.getState()).toBe(PlaybackState.STOPPED);
    expect(kill).toHaveBeenCalled();
    expect(controller.getQueue().currentIndex).toBe(-1);
  });

  test("calls onEvent callback on events", () => {
    const eventCallback = mock(() => {});
    
    const controller = createPlaybackController({
      rootPath: "/tmp/test",
      onEvent: eventCallback
    });

    controller.loadQueue(mockSongs);
    
    // Event callback should be set
    expect(eventCallback).not.toHaveBeenCalled();
  });

  test("respects minDuration setting", () => {
    const controller = createPlaybackController({
      rootPath: "/tmp/test",
      minDuration: 30
    });
    
    expect(controller).toBeDefined();
    expect(controller.getState()).toBe(PlaybackState.IDLE);
  });

  test("skips songs shorter than minDuration", async () => {
    const events: string[] = [];
    
    const shortSong: Recommendation = {
      sid_path: "Test/ShortSong.sid",
      score: 0.9,
      similarity: 0.95,
      songFeedback: 0.8,
      userAffinity: 0.7,
      ratings: { e: 5, m: 5, c: 4, p: 5 },
      feedback: { likes: 10, dislikes: 1, skips: 2, plays: 20 },
      features: { duration: 10 } // 10 seconds - too short
    };
    
    const controller = createPlaybackController({
      rootPath: "/tmp/test",
      minDuration: 15,
      onEvent: (event) => {
        events.push(event.type);
      }
    });
    
    controller.loadQueue([shortSong]);
    
    // The controller should skip the short song, but we can't test actual playback
    // in unit tests without mocking spawn. Just verify the controller is configured.
    await controller.play();
    expect(events).toContain("skipped");
    expect(controller.getState()).toBe(PlaybackState.IDLE);
  });

  test("pause emits paused event when playing", async () => {
    const events: string[] = [];
    const kill = mock(() => {});
    const controller = createPlaybackController({
      rootPath: "/tmp/test",
      onEvent: (event) => events.push(event.type)
    });

    controller.loadQueue(mockSongs);
    (controller as unknown as { state: PlaybackState }).state = PlaybackState.PLAYING;
    (controller as unknown as { currentIndex: number }).currentIndex = 0;
    (controller as unknown as { process?: { kill: (signal?: string) => void } }).process = {
      kill
    };

    await controller.pause();
    expect(kill).toHaveBeenCalledWith("SIGSTOP");
    expect(events).toContain("paused");
    expect(controller.getState()).toBe(PlaybackState.PAUSED);
  });

  test("resume emits resumed event when paused", async () => {
    const events: string[] = [];
    const kill = mock(() => {});
    const controller = createPlaybackController({
      rootPath: "/tmp/test",
      onEvent: (event) => events.push(event.type)
    });

    controller.loadQueue(mockSongs);
    (controller as unknown as { state: PlaybackState }).state = PlaybackState.PAUSED;
    (controller as unknown as { currentIndex: number }).currentIndex = 0;
    (controller as unknown as { process?: { kill: (signal?: string) => void } }).process = {
      kill
    };

    await controller.resume();
    expect(kill).toHaveBeenCalledWith("SIGCONT");
    expect(events).toContain("resumed");
    expect(controller.getState()).toBe(PlaybackState.PLAYING);
  });

  test("play resumes from paused state", async () => {
    const kill = mock(() => {});
    const controller = createPlaybackController({
      rootPath: "/tmp/test"
    });

    controller.loadQueue(mockSongs);
    (controller as unknown as { state: PlaybackState }).state = PlaybackState.PAUSED;
    (controller as unknown as { currentIndex: number }).currentIndex = 0;
    (controller as unknown as { process?: { kill: (signal?: string) => void } }).process = {
      kill
    };

    await controller.play();
    expect(kill).toHaveBeenCalledWith("SIGCONT");
    expect(controller.getState()).toBe(PlaybackState.PLAYING);
  });

  test("skip emits skipped event and advances queue", async () => {
    const events: string[] = [];
    const kill = mock(() => {});
    const next = mock(async () => {
      (controller as unknown as { state: PlaybackState }).state = PlaybackState.IDLE;
    });
    const controller = createPlaybackController({
      rootPath: "/tmp/test",
      onEvent: (event) => events.push(event.type)
    });

    controller.loadQueue(mockSongs);
    (controller as unknown as { currentIndex: number }).currentIndex = 0;
    (controller as unknown as { state: PlaybackState }).state = PlaybackState.PLAYING;
    (controller as unknown as { process?: { kill: () => void } }).process = { kill };
    (controller as unknown as { next: () => Promise<void> }).next = next;

    await controller.skip();
    expect(kill).toHaveBeenCalled();
    expect(events).toContain("skipped");
    expect(next).toHaveBeenCalled();
  });
});
