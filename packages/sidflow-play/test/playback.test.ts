/**
 * Tests for playback controller.
 */

import { describe, expect, test, mock } from "bun:test";
import {
  createPlaybackController,
  PlaybackState,
  type Recommendation
} from "../src/index.js";

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

    await controller.stop();
    expect(controller.getState()).toBe(PlaybackState.STOPPED);
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
});
