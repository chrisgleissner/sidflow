/**
 * Playback orchestration with sidplayfp.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { Recommendation } from "@sidflow/common";

/**
 * Playback state enum.
 */
export enum PlaybackState {
  IDLE = "idle",
  PLAYING = "playing",
  PAUSED = "paused",
  STOPPED = "stopped"
}

/**
 * Playback event types.
 */
export interface PlaybackEvent {
  type: "started" | "finished" | "error" | "skipped" | "paused" | "resumed";
  song?: Recommendation;
  error?: Error;
  timestamp: string;
}

/**
 * Playback options.
 */
export interface PlaybackOptions {
  /** Path to sidplayfp executable */
  sidplayPath?: string;
  /** Root path for resolving SID files */
  rootPath: string;
  /** Callback for playback events */
  onEvent?: (event: PlaybackEvent) => void;
}

/**
 * Queue-based playback controller.
 */
export class PlaybackController {
  private queue: Recommendation[] = [];
  private currentIndex: number = -1;
  private state: PlaybackState = PlaybackState.IDLE;
  private process?: ChildProcess;
  private sidplayPath: string;
  private rootPath: string;
  private onEvent?: (event: PlaybackEvent) => void;

  constructor(options: PlaybackOptions) {
    this.sidplayPath = options.sidplayPath || "sidplayfp";
    this.rootPath = options.rootPath;
    this.onEvent = options.onEvent;
  }

  /**
   * Load songs into the queue.
   */
  loadQueue(songs: Recommendation[]): void {
    this.queue = [...songs];
    this.currentIndex = -1;
  }

  /**
   * Get current playback state.
   */
  getState(): PlaybackState {
    return this.state;
  }

  /**
   * Get queue information.
   */
  getQueue(): {
    songs: Recommendation[];
    currentIndex: number;
    remaining: number;
  } {
    return {
      songs: [...this.queue],
      currentIndex: this.currentIndex,
      remaining: Math.max(0, this.queue.length - this.currentIndex - 1)
    };
  }

  /**
   * Get currently playing song.
   */
  getCurrentSong(): Recommendation | undefined {
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      return this.queue[this.currentIndex];
    }
    return undefined;
  }

  /**
   * Start playback from the beginning or resume from current position.
   */
  async play(): Promise<void> {
    if (this.state === PlaybackState.PAUSED) {
      await this.resume();
      return;
    }

    if (this.queue.length === 0) {
      throw new Error("Queue is empty. Load songs first.");
    }

    // Start from beginning if idle
    if (this.currentIndex === -1) {
      this.currentIndex = 0;
    }

    await this.playCurrentSong();
  }

  /**
   * Play the current song in the queue.
   */
  private async playCurrentSong(): Promise<void> {
    const song = this.getCurrentSong();
    if (!song) {
      this.state = PlaybackState.IDLE;
      return;
    }

    const sidPath = `${this.rootPath}/${song.sid_path}`;
    
    try {
      this.state = PlaybackState.PLAYING;
      this.emitEvent({ type: "started", song, timestamp: new Date().toISOString() });

      // Spawn sidplayfp process
      this.process = spawn(this.sidplayPath, [sidPath], {
        stdio: ["ignore", "pipe", "pipe"]
      });

      // Handle process completion
      this.process.on("close", (code) => {
        if (this.state === PlaybackState.PLAYING) {
          if (code === 0) {
            this.emitEvent({ type: "finished", song, timestamp: new Date().toISOString() });
            this.next();
          } else {
            const error = new Error(`sidplayfp exited with code ${code}`);
            this.emitEvent({ type: "error", song, error, timestamp: new Date().toISOString() });
            this.state = PlaybackState.STOPPED;
          }
        }
      });

      // Handle process errors
      this.process.on("error", (error) => {
        this.emitEvent({ type: "error", song, error, timestamp: new Date().toISOString() });
        this.state = PlaybackState.STOPPED;
      });
    } catch (error) {
      this.emitEvent({
        type: "error",
        song,
        error: error instanceof Error ? error : new Error(String(error)),
        timestamp: new Date().toISOString()
      });
      this.state = PlaybackState.STOPPED;
    }
  }

  /**
   * Skip to the next song.
   */
  async skip(): Promise<void> {
    const currentSong = this.getCurrentSong();
    
    // Stop current playback
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }

    if (currentSong) {
      this.emitEvent({ type: "skipped", song: currentSong, timestamp: new Date().toISOString() });
    }

    await this.next();
  }

  /**
   * Move to the next song and play it.
   */
  private async next(): Promise<void> {
    this.currentIndex += 1;
    
    if (this.currentIndex < this.queue.length) {
      await this.playCurrentSong();
    } else {
      this.state = PlaybackState.IDLE;
    }
  }

  /**
   * Pause playback.
   */
  async pause(): Promise<void> {
    if (this.state !== PlaybackState.PLAYING) {
      return;
    }

    if (this.process) {
      this.process.kill("SIGSTOP");
      this.state = PlaybackState.PAUSED;
      
      const song = this.getCurrentSong();
      this.emitEvent({ type: "paused", song, timestamp: new Date().toISOString() });
    }
  }

  /**
   * Resume playback.
   */
  async resume(): Promise<void> {
    if (this.state !== PlaybackState.PAUSED) {
      return;
    }

    if (this.process) {
      this.process.kill("SIGCONT");
      this.state = PlaybackState.PLAYING;
      
      const song = this.getCurrentSong();
      this.emitEvent({ type: "resumed", song, timestamp: new Date().toISOString() });
    }
  }

  /**
   * Stop playback and clear queue.
   */
  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }

    this.state = PlaybackState.STOPPED;
    this.currentIndex = -1;
  }

  /**
   * Emit playback event.
   */
  private emitEvent(event: PlaybackEvent): void {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }
}

/**
 * Create a playback controller instance.
 */
export function createPlaybackController(
  options: PlaybackOptions
): PlaybackController {
  return new PlaybackController(options);
}
