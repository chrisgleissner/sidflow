import { describe, expect, test, mock } from "bun:test";
import { createPlaybackController, PlaybackState } from "../src/index.js";
import type { Recommendation } from "@sidflow/common";
import type { PlaybackEvent } from "../src/playback.js";

class StubHarness {
  public state: "idle" | "playing" | "paused" = "idle";
  public positionSeconds = 0;
  private startedListeners = new Set<(payload: unknown) => void>();
  private finishedListeners = new Set<() => void>();
  private errorListeners = new Set<(error: Error) => void>();

  public start = mock(async () => {
    this.state = "playing";
    const result = {
      pid: 123,
      command: "stub-player",
      startedAt: new Date("2025-01-01T00:00:00.000Z"),
      offsetSeconds: 0,
      durationSeconds: undefined
    };
    for (const listener of this.startedListeners) {
      listener(result);
    }
    return result;
  });

  public stop = mock(async () => {
    this.state = "idle";
  });

  public pause = mock(async () => {
    this.state = "paused";
  });

  public resume = mock(async () => {
    this.state = "playing";
  });

  public getState(): "idle" | "playing" | "paused" {
    return this.state;
  }

  public getPositionSeconds = mock(() => this.positionSeconds);

  public on(event: "started" | "finished" | "error", listener: ((...args: unknown[]) => void)): void {
    if (event === "finished") {
      this.finishedListeners.add(listener as () => void);
      return;
    }
    if (event === "error") {
      this.errorListeners.add(listener as (error: Error) => void);
      return;
    }
    this.startedListeners.add(listener);
  }

  public off(event: "started" | "finished" | "error", listener: ((...args: unknown[]) => void)): void {
    if (event === "finished") {
      this.finishedListeners.delete(listener as () => void);
      return;
    }
    if (event === "error") {
      this.errorListeners.delete(listener as (error: Error) => void);
      return;
    }
    this.startedListeners.delete(listener);
  }

  public emitFinished(): void {
    for (const listener of this.finishedListeners) {
      listener();
    }
  }

  public emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }
}

type HarnessContract = Pick<
  StubHarness,
  "start" | "stop" | "pause" | "resume" | "getPositionSeconds" | "getState" | "on" | "off"
>;

function setupController(overrides: Partial<Parameters<typeof createPlaybackController>[0]> = {}) {
  const harness = new StubHarness();
  const recordedEvents: PlaybackEvent[] = [];
  const { onEvent, ...rest } = overrides;
  const controller = createPlaybackController({
    rootPath: "/tmp/test",
    createHarness: () => harness as unknown as HarnessContract,
    onEvent: (event) => {
      recordedEvents.push(event);
      onEvent?.(event);
    },
    ...rest
  });
  return { controller, harness, events: recordedEvents };
}

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
    const { controller } = setupController();
    expect(controller).toBeDefined();
  });

  test("initial state is IDLE", () => {
    const { controller } = setupController();
    expect(controller.getState()).toBe(PlaybackState.IDLE);
  });

  test("loadQueue loads songs into queue", () => {
    const { controller } = setupController();
    controller.loadQueue(mockSongs);

    const queue = controller.getQueue();
    expect(queue.songs).toHaveLength(2);
    expect(queue.currentIndex).toBe(-1);
    expect(queue.remaining).toBe(2);
  });

  test("getCurrentSong returns undefined when queue not started", () => {
    const { controller } = setupController();
    controller.loadQueue(mockSongs);

    expect(controller.getCurrentSong()).toBeUndefined();
  });

  test("getQueue returns queue information", () => {
    const { controller } = setupController();
    controller.loadQueue(mockSongs);

    const queue = controller.getQueue();
    expect(queue.songs).toEqual(mockSongs);
    expect(queue.currentIndex).toBe(-1);
    expect(queue.remaining).toBe(2);
  });

  test("throws error when playing empty queue", async () => {
    const { controller } = setupController();

    expect(controller.play()).rejects.toThrow("Queue is empty");
  });

  test("stop resets state", async () => {
    const { controller, harness } = setupController();
    controller.loadQueue(mockSongs);
    await controller.play();
    await controller.stop();
    expect(controller.getState()).toBe(PlaybackState.STOPPED);
    expect(harness.stop).toHaveBeenCalled();
    expect(controller.getQueue().currentIndex).toBe(-1);
  });

  test("emits started event when playback begins", async () => {
    const { controller, events } = setupController();
    controller.loadQueue(mockSongs);
    await controller.play();
    expect(events.some((event) => event.type === "started")).toBeTrue();
  });

  test("respects minDuration setting", () => {
    const { controller } = setupController({ minDuration: 30 });
    expect(controller).toBeDefined();
    expect(controller.getState()).toBe(PlaybackState.IDLE);
  });

  test("skips songs shorter than minDuration", async () => {
    const shortSong: Recommendation = {
      sid_path: "Test/ShortSong.sid",
      score: 0.9,
      similarity: 0.95,
      songFeedback: 0.8,
      userAffinity: 0.7,
      ratings: { e: 5, m: 5, c: 4, p: 5 },
      feedback: { likes: 10, dislikes: 1, skips: 2, plays: 20 },
      features: { duration: 10 }
    };
    const { controller, harness, events } = setupController({
      minDuration: 15
    });
    controller.loadQueue([shortSong]);
    await controller.play();
    expect(events.map((event) => event.type)).toContain("skipped");
    expect(harness.start).not.toHaveBeenCalled();
    expect(controller.getState()).toBe(PlaybackState.IDLE);
  });

  test("pause emits paused event when playing", async () => {
    const { controller, harness, events } = setupController();
    controller.loadQueue(mockSongs);
    await controller.play();
    await controller.pause();
    expect(harness.pause).toHaveBeenCalled();
    expect(events.map((event) => event.type)).toContain("paused");
    expect(controller.getState()).toBe(PlaybackState.PAUSED);
  });

  test("resume emits resumed event when paused", async () => {
    const { controller, harness, events } = setupController();
    controller.loadQueue(mockSongs);
    await controller.play();
    await controller.pause();
    await controller.resume();
    expect(harness.resume).toHaveBeenCalled();
    expect(events.map((event) => event.type)).toContain("resumed");
    expect(controller.getState()).toBe(PlaybackState.PLAYING);
  });

  test("play resumes from paused state", async () => {
    const { controller, harness } = setupController();
    controller.loadQueue(mockSongs);
    await controller.play();
    await controller.pause();
    await controller.play();
    expect(harness.resume).toHaveBeenCalled();
    expect(controller.getState()).toBe(PlaybackState.PLAYING);
  });

  test("skip emits skipped event and advances queue", async () => {
    const { controller, harness, events } = setupController();
    controller.loadQueue(mockSongs);
    await controller.play();
    await controller.skip();
    expect(harness.stop).toHaveBeenCalled();
    expect(events.map((event) => event.type)).toContain("skipped");
    expect(harness.start).toHaveBeenCalledTimes(2);
  });

  test("finished event advances to next song", async () => {
    const { controller, harness, events } = setupController();
    controller.loadQueue(mockSongs);
    await controller.play();
    harness.emitFinished();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events.map((event) => event.type)).toContain("finished");
    expect(harness.start).toHaveBeenCalledTimes(2);
  });
});
