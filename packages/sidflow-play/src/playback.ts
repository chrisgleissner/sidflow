import path from "node:path";
import {
  SidPlaybackHarness,
  type PlaybackLock,
  type PlaybackLockMetadata,
  type Recommendation
} from "@sidflow/common";

export enum PlaybackState {
  IDLE = "idle",
  PLAYING = "playing",
  PAUSED = "paused",
  STOPPED = "stopped"
}

export interface PlaybackEvent {
  type: "started" | "finished" | "error" | "skipped" | "paused" | "resumed";
  song?: Recommendation;
  error?: Error;
  timestamp: string;
}

export interface PlaybackOptions {
  rootPath: string;
  minDuration?: number;
  onEvent?: (event: PlaybackEvent) => void;
  playbackLock?: PlaybackLock;
  playbackSource?: string;
  createHarness?: () => SidPlaybackHarness;
}

interface PlaybackSession {
  pid?: number;
  command: string;
  sidPath: string;
  startedAt: Date;
  offsetSeconds: number;
  durationSeconds?: number;
  track: Recommendation;
}

function resolveDurationSeconds(song: Recommendation | undefined): number | undefined {
  if (!song || !song.features) {
    return undefined;
  }
  const featureValues = song.features as Record<string, unknown>;
  const keys = [
    "duration",
    "durationSeconds",
    "duration_seconds",
    "lengthSeconds",
    "length_seconds"
  ];
  for (const key of keys) {
    const value = featureValues[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return undefined;
}

function buildTrackMetadata(song: Recommendation): Record<string, unknown> {
  return {
    sid_path: song.sid_path,
    score: song.score,
    similarity: song.similarity,
    songFeedback: song.songFeedback,
    userAffinity: song.userAffinity,
    ratings: song.ratings,
    feedback: song.feedback,
    features: song.features
  };
}

export class PlaybackController {
  private readonly rootPath: string;
  private readonly minDuration: number;
  private readonly onEvent?: (event: PlaybackEvent) => void;
  private readonly playbackLock?: PlaybackLock;
  private readonly playbackSource: string;
  private readonly harness: SidPlaybackHarness;

  private queue: Recommendation[] = [];
  private currentIndex = -1;
  private state: PlaybackState = PlaybackState.IDLE;
  private currentSession: PlaybackSession | null = null;
  private currentLockMetadata: PlaybackLockMetadata | null = null;

  constructor(options: PlaybackOptions) {
    this.rootPath = options.rootPath;
    this.minDuration = options.minDuration ?? 15;
    this.onEvent = options.onEvent;
    this.playbackLock = options.playbackLock;
    this.playbackSource = options.playbackSource ?? "sidflow-play";
    this.harness = options.createHarness ? options.createHarness() : new SidPlaybackHarness();

    this.harness.on("finished", this.handleHarnessFinished);
    this.harness.on("error", this.handleHarnessError);
  }

  loadQueue(songs: Recommendation[]): void {
    this.queue = [...songs];
    this.currentIndex = -1;
    this.state = PlaybackState.IDLE;
    this.currentSession = null;
    this.currentLockMetadata = null;
  }

  getQueue(): { songs: Recommendation[]; currentIndex: number; remaining: number } {
    return {
      songs: [...this.queue],
      currentIndex: this.currentIndex,
      remaining: Math.max(0, this.queue.length - this.currentIndex - 1)
    };
  }

  getCurrentSong(): Recommendation | undefined {
    if (this.currentIndex < 0 || this.currentIndex >= this.queue.length) {
      return undefined;
    }
    return this.queue[this.currentIndex];
  }

  getState(): PlaybackState {
    return this.state;
  }

  async play(): Promise<void> {
    if (this.state === PlaybackState.PAUSED) {
      await this.resume();
      return;
    }

    if (this.queue.length === 0) {
      throw new Error("Queue is empty. Load songs first.");
    }

    if (this.currentIndex === -1) {
      this.currentIndex = 0;
    }

    await this.playCurrentSong();
  }

  async stop(): Promise<void> {
    if (this.state === PlaybackState.IDLE) {
      return;
    }
    await this.harness.stop();
    await this.releasePlaybackLock();
    this.state = PlaybackState.STOPPED;
    this.currentIndex = -1;
  }

  async skip(): Promise<void> {
    const currentSong = this.getCurrentSong();
    if (!currentSong) {
      return;
    }
    await this.harness.stop();
    await this.releasePlaybackLock();
    this.state = PlaybackState.IDLE;
    this.emitEvent({ type: "skipped", song: currentSong, timestamp: new Date().toISOString() });
    this.currentIndex += 1;
    await this.playCurrentSong();
  }

  async pause(): Promise<void> {
    if (this.state !== PlaybackState.PLAYING) {
      return;
    }
    await this.harness.pause();
    const timestamp = new Date();
    const position = this.harness.getPositionSeconds();
    if (this.currentSession) {
      this.currentSession.offsetSeconds = position;
      this.currentSession.startedAt = timestamp;
    }
    await this.updatePlaybackLock({
      offsetSeconds: position,
      startedAt: timestamp.toISOString(),
      isPaused: true
    });
    this.state = PlaybackState.PAUSED;
    const song = this.getCurrentSong();
    this.emitEvent({ type: "paused", song, timestamp: timestamp.toISOString() });
  }

  async resume(): Promise<void> {
    if (this.state !== PlaybackState.PAUSED) {
      return;
    }
    await this.harness.resume();
    const timestamp = new Date();
    if (this.currentSession) {
      this.currentSession.startedAt = timestamp;
    }
    await this.updatePlaybackLock({
      startedAt: timestamp.toISOString(),
      isPaused: false
    });
    this.state = PlaybackState.PLAYING;
    const song = this.getCurrentSong();
    this.emitEvent({ type: "resumed", song, timestamp: timestamp.toISOString() });
  }

  private emitEvent(event: PlaybackEvent): void {
    this.onEvent?.(event);
  }

  private async playCurrentSong(): Promise<void> {
    const song = this.advanceToPlayableSong();
    if (!song) {
      this.state = PlaybackState.IDLE;
      return;
    }

    const sidPath = path.resolve(this.rootPath, song.sid_path);
    const durationSeconds = resolveDurationSeconds(song);

    await this.playbackLock?.stopExistingPlayback(this.playbackSource);

    try {
      const startResult = await this.harness.start({
        sidPath,
        durationSeconds
      });

      const session: PlaybackSession = {
        pid: startResult.pid,
        command: startResult.command,
        sidPath,
        startedAt: startResult.startedAt,
        offsetSeconds: startResult.offsetSeconds,
        durationSeconds,
        track: song
      };
      this.currentSession = session;
      await this.registerPlayback(session);
      this.state = PlaybackState.PLAYING;
      this.emitEvent({
        type: "started",
        song,
        timestamp: startResult.startedAt.toISOString()
      });
    } catch (error) {
      try {
        await this.harness.stop();
      } catch {
        // ignore cleanup failure during error handling
      }
      try {
        await this.releasePlaybackLock();
      } catch {
        // ignore cleanup failure during error handling
      }
      this.state = PlaybackState.STOPPED;
      this.emitEvent({
        type: "error",
        song,
        error: error instanceof Error ? error : new Error(String(error)),
        timestamp: new Date().toISOString()
      });
    }
  }

  private advanceToPlayableSong(): Recommendation | null {
    while (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      const song = this.queue[this.currentIndex];
      const durationSeconds = resolveDurationSeconds(song);
      if (durationSeconds === undefined || durationSeconds >= this.minDuration) {
        return song;
      }
      this.emitEvent({
        type: "skipped",
        song,
        timestamp: new Date().toISOString()
      });
      this.currentIndex += 1;
    }
    return null;
  }

  private async playNext(): Promise<void> {
    this.currentIndex += 1;
    if (this.currentIndex >= this.queue.length) {
      this.state = PlaybackState.IDLE;
      this.currentSession = null;
      this.currentLockMetadata = null;
      return;
    }
    await this.playCurrentSong();
  }

  private async registerPlayback(session: PlaybackSession): Promise<void> {
    if (!this.playbackLock || session.pid === undefined) {
      this.currentLockMetadata = null;
      return;
    }

    const metadata: PlaybackLockMetadata = {
      pid: session.pid,
      command: session.command,
      sidPath: session.sidPath,
      source: this.playbackSource,
      startedAt: session.startedAt.toISOString(),
      offsetSeconds: session.offsetSeconds,
      durationSeconds: session.durationSeconds,
      isPaused: false,
      track: buildTrackMetadata(session.track)
    };

    await this.playbackLock.registerProcess(metadata);
    this.currentLockMetadata = metadata;
  }

  private async updatePlaybackLock(update: Partial<PlaybackLockMetadata>): Promise<void> {
    if (!this.playbackLock || !this.currentLockMetadata) {
      return;
    }
    const nextMetadata = { ...this.currentLockMetadata, ...update } as PlaybackLockMetadata;
    this.currentLockMetadata = nextMetadata;
    await this.playbackLock.updateMetadata(nextMetadata);
  }

  private async releasePlaybackLock(): Promise<void> {
    const metadata = this.currentLockMetadata;
    this.currentLockMetadata = null;
    this.currentSession = null;
    if (this.playbackLock && metadata?.pid) {
      await this.playbackLock.releaseIfMatches(metadata.pid);
    }
  }

  private handleHarnessFinished = (): void => {
    const song = this.getCurrentSong();
    if (song) {
      this.emitEvent({ type: "finished", song, timestamp: new Date().toISOString() });
    }
    void this.releasePlaybackLock();
    this.state = PlaybackState.IDLE;
    void this.playNext();
  };

  private handleHarnessError = (error: Error): void => {
    const song = this.getCurrentSong();
    this.state = PlaybackState.STOPPED;
    this.emitEvent({ type: "error", song, error, timestamp: new Date().toISOString() });
    void this.releasePlaybackLock();
  };
}

export function createPlaybackController(options: PlaybackOptions): PlaybackController {
  return new PlaybackController(options);
}
