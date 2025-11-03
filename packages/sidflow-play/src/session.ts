/**
 * Session history and persistence.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { stringifyDeterministic } from "@sidflow/common";
import type { PlaybackEvent } from "./playback.js";

/**
 * Session history entry.
 */
export interface SessionEntry {
  /** SID path */
  sid_path: string;
  /** Timestamp when played */
  timestamp: string;
  /** Event type */
  event: "started" | "finished" | "skipped" | "error";
  /** Duration in seconds (if available) */
  duration?: number;
  /** Error message (if applicable) */
  error?: string;
}

/**
 * Session state with history.
 */
export interface SessionState {
  /** Session ID */
  sessionId: string;
  /** Session start time */
  startedAt: string;
  /** Session end time (if ended) */
  endedAt?: string;
  /** Playlist seed used */
  seed?: string | { e: number; m: number; c: number; p?: number };
  /** History of played songs */
  history: SessionEntry[];
  /** Session statistics */
  stats: {
    totalPlayed: number;
    totalSkipped: number;
    totalErrors: number;
  };
}

/**
 * Session manager for tracking playback history.
 */
export class SessionManager {
  private sessionPath: string;
  private currentSession?: SessionState;

  constructor(sessionPath: string) {
    this.sessionPath = sessionPath;
  }

  /**
   * Start a new session.
   */
  async startSession(seed?: string | { e: number; m: number; c: number; p?: number }): Promise<void> {
    this.currentSession = {
      sessionId: this.generateSessionId(),
      startedAt: new Date().toISOString(),
      seed,
      history: [],
      stats: {
        totalPlayed: 0,
        totalSkipped: 0,
        totalErrors: 0
      }
    };
  }

  /**
   * Record a playback event in the session.
   */
  recordEvent(event: PlaybackEvent): void {
    if (!this.currentSession) {
      return;
    }

    const entry: SessionEntry = {
      sid_path: event.song?.sid_path || "",
      timestamp: event.timestamp,
      event: event.type as SessionEntry["event"],
      error: event.error?.message
    };

    this.currentSession.history.push(entry);

    // Update statistics
    switch (event.type) {
      case "finished":
        this.currentSession.stats.totalPlayed += 1;
        break;
      case "skipped":
        this.currentSession.stats.totalSkipped += 1;
        break;
      case "error":
        this.currentSession.stats.totalErrors += 1;
        break;
    }
  }

  /**
   * Get current session state.
   */
  getSession(): SessionState | undefined {
    return this.currentSession;
  }

  /**
   * End the current session and persist it.
   */
  async endSession(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    this.currentSession.endedAt = new Date().toISOString();
    await this.saveSession(this.currentSession);
    this.currentSession = undefined;
  }

  /**
   * Load a previous session from disk.
   */
  async loadSession(sessionId: string): Promise<SessionState | undefined> {
    try {
      const path = `${this.sessionPath}/${sessionId}.json`;
      const content = await readFile(path, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Save session to disk.
   */
  private async saveSession(session: SessionState): Promise<void> {
    const path = `${this.sessionPath}/${session.sessionId}.json`;
    
    // Ensure directory exists
    await mkdir(dirname(path), { recursive: true });
    
    // Write deterministic JSON
    const content = stringifyDeterministic(session);
    await writeFile(path, content, "utf-8");
  }

  /**
   * Generate a unique session ID.
   */
  private generateSessionId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `session-${timestamp}`;
  }

  /**
   * List all session IDs.
   */
  async listSessions(): Promise<string[]> {
    try {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(this.sessionPath);
      return files
        .filter(f => f.endsWith(".json"))
        .map(f => f.replace(".json", ""));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

/**
 * Create a session manager instance.
 */
export function createSessionManager(sessionPath: string): SessionManager {
  return new SessionManager(sessionPath);
}
