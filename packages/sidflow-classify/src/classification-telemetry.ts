import { execSync } from "node:child_process";
import process from "node:process";

import type { JsonValue } from "@sidflow/common";

import { flushWriterQueue, queueJsonlWrite } from "./jsonl-writer-queue.js";

export interface ClassificationRunContext {
  command: string;
  cwd: string;
  mode?: string;
  fullRerun?: boolean;
  runtime?: string;
}

function parseBooleanString(value: string | undefined): boolean | undefined {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

export function resolveClassificationRunContext(): ClassificationRunContext {
  const fallbackCommand = process.argv.join(" ").trim() || "sidflow-classify";
  const runtime = (process.env.SIDFLOW_CLI_RUNTIME ?? process.release?.name ?? "unknown").trim();
  return {
    command: (process.env.SIDFLOW_CLASSIFY_RUN_COMMAND ?? fallbackCommand).trim(),
    cwd: (process.env.SIDFLOW_CLASSIFY_RUN_CWD ?? process.cwd()).trim(),
    mode: process.env.SIDFLOW_CLASSIFY_RUN_MODE?.trim() || undefined,
    fullRerun: parseBooleanString(process.env.SIDFLOW_CLASSIFY_RUN_FULL_RERUN),
    runtime,
  };
}

/**
 * Buffered telemetry writer for classification lifecycle events.
 *
 * Call `emit()` with small JSON-serializable records during classification, then
 * call `flush()` exactly once before returning so the queued JSONL writes are
 * persisted in order.
 */
export class ClassificationTelemetryLogger {
  private pending: Promise<void> = Promise.resolve();

  private firstError: Error | null = null;

  constructor(readonly filePath: string) {}

  emit(record: Record<string, JsonValue>): void {
    this.pending = this.pending
      .catch(() => undefined)
      .then(async () => {
        try {
          await queueJsonlWrite(this.filePath, [record]);
        } catch (error) {
          this.firstError ??= error instanceof Error ? error : new Error(String(error));
        }
      });
  }

  async flush(): Promise<void> {
    await this.pending;
    await flushWriterQueue(this.filePath);
    if (this.firstError) {
      throw this.firstError;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers for SongLifecycleLogger
// ---------------------------------------------------------------------------

/** Resolve the short git commit hash for the current working tree. */
function resolveGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 2000,
    }).trim();
  } catch {
    return "unknown";
  }
}

/** Current process heap usage in whole megabytes. Returns -1 if unavailable. */
function captureMemoryMB(): number {
  try {
    return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  } catch {
    return -1;
  }
}

let _lastCpuSnapshot: { user: number; system: number; time: number } | null = null;

/**
 * Approximate process-wide CPU utilisation (%) since the last call.
 * Returns 0 on the first call (no prior sample to diff against).
 * This is a lightweight process.cpuUsage() delta — not per-worker.
 */
export function captureCpuPercent(): number {
  try {
    const now = Date.now();
    const cpu = process.cpuUsage();
    if (_lastCpuSnapshot === null) {
      _lastCpuSnapshot = { user: cpu.user, system: cpu.system, time: now };
      return 0;
    }
    const elapsedUs = (now - _lastCpuSnapshot.time) * 1000; // ms → µs
    if (elapsedUs <= 0) return 0;
    const userDelta = cpu.user - _lastCpuSnapshot.user;
    const systemDelta = cpu.system - _lastCpuSnapshot.system;
    _lastCpuSnapshot = { user: cpu.user, system: cpu.system, time: now };
    return Math.min(100, Math.round(((userDelta + systemDelta) / elapsedUs) * 100));
  } catch {
    return -1;
  }
}

function computeMedian(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

// ---------------------------------------------------------------------------
// Stage lifecycle types
// ---------------------------------------------------------------------------

/**
 * Ordered classification stages — maps directly to the processing pipeline.
 *
 * QUEUED      — job placed in the pending work queue
 * STARTED     — a worker thread has picked up the job
 * RENDERING   — WAV render is in progress (cached songs skip this pair)
 * RENDERED    — WAV render complete / cache hit confirmed
 * EXTRACTING  — audio feature extraction running
 * EXTRACTED   — features available in the intermediate buffer
 * ANALYZING   — intermediate record flushed; now awaiting deferred rating pass
 * ANALYZED    — deferred pass has started for this song
 * TAGGING     — auto-tags and classification JSONL record are being written
 * TAGGED      — all file writes committed
 * COMPLETED   — song fully classified; total lifecycle duration recorded
 */
export type ClassificationStage =
  | "QUEUED"
  | "STARTED"
  | "RENDERING"
  | "RENDERED"
  | "EXTRACTING"
  | "EXTRACTED"
  | "ANALYZING"
  | "ANALYZED"
  | "TAGGING"
  | "TAGGED"
  | "COMPLETED";

/** JSONL event discriminator. */
export type StageEventType = "start" | "end" | "progress" | "error" | "stall";

export interface StageEventParams {
  songIndex: number;
  songPath: string;
  songId: string;
  stage: ClassificationStage;
  durationMs?: number | null;
  workerId?: number;
  threadId?: string | null;
  extra?: Record<string, JsonValue>;
}

// ---------------------------------------------------------------------------
// SongLifecycleLogger
// ---------------------------------------------------------------------------

/**
 * Detailed per-song lifecycle logger (strict JSONL format).
 *
 * Each event record includes:
 *   ts, songIndex, totalSongs, songPath, songId, stage, event,
 *   durationMs, workerId, pid, threadId, memoryMB, cpuPercent, extra
 *
 * Stage durations are tracked to feed a rolling median used for stall
 * detection. The background watchdog fires every 30 s and emits a "stall"
 * event for any active stage whose age exceeds 10× its median duration
 * (or 5 minutes if fewer than 5 samples are available).
 *
 * All writes are fire-and-forget via queueJsonlWrite to avoid blocking the
 * classification pipeline. Telemetry errors are swallowed so they cannot
 * mask real classification failures.
 */
export class SongLifecycleLogger {
  readonly primaryPath: string;

  private readonly pid = process.pid;
  private readonly gitCommit: string;
  private readonly runStartMs: number;

  // stage name → recent durations (capped at 200 for memory)
  private readonly stageDurations = new Map<string, number[]>();
  // `${songIndex}:${stage}` → { startMs, songIndex, stage }
  private readonly activeStages = new Map<string, { startMs: number; songIndex: number; stage: string }>();

  private stallTimer: ReturnType<typeof setInterval> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    primaryPath: string,
    readonly totalSongs: number,
  ) {
    this.primaryPath = primaryPath;
    this.gitCommit = resolveGitCommit();
    this.runStartMs = Date.now();
  }

  /** Emit run_start with command context and git commit, then start stall watchdog. */
  emitRunStart(context: ClassificationRunContext): void {
    this.enqueue({
      ts: new Date().toISOString(),
      event: "run_start",
      command: context.command,
      mode: context.mode ?? "unknown",
      runtime: context.runtime ?? (process.release?.name ?? "unknown"),
      fullRerun: context.fullRerun ?? false,
      cwd: context.cwd,
      gitCommit: this.gitCommit,
      pid: this.pid,
      totalSongs: this.totalSongs,
      memoryMB: captureMemoryMB(),
    });
    this.startStallWatchdog();
  }

  /** Emit run_end with total elapsed duration and stop stall watchdog. */
  emitRunEnd(): void {
    this.stopStallWatchdog();
    this.enqueue({
      ts: new Date().toISOString(),
      event: "run_end",
      totalDurationMs: Date.now() - this.runStartMs,
    });
  }

  /**
   * Emit a stage-start event and register the stage as active for stall detection.
   * Returns a stageKey that MUST be passed to stageEnd / stageError.
   */
  stageStart(params: StageEventParams): string {
    const key = `${params.songIndex}:${params.stage}`;
    this.activeStages.set(key, {
      startMs: Date.now(),
      songIndex: params.songIndex,
      stage: params.stage,
    });
    this.enqueue(this.buildRecord(params, "start", null));
    return key;
  }

  /**
   * Emit a stage-end event, record duration, and update stall-detection median.
   */
  stageEnd(key: string, params: StageEventParams): void {
    const active = this.activeStages.get(key);
    this.activeStages.delete(key);
    const durationMs = active !== undefined ? Date.now() - active.startMs : null;

    if (durationMs !== null) {
      const durations = this.stageDurations.get(params.stage) ?? [];
      durations.push(durationMs);
      if (durations.length > 200) durations.splice(0, 1);
      this.stageDurations.set(params.stage, durations);
    }

    this.enqueue(this.buildRecord({ ...params, durationMs }, "end", durationMs));
  }

  /** Emit a stage-error event, cleaning up stall tracking state. */
  stageError(key: string, params: StageEventParams & { error: string }): void {
    const active = this.activeStages.get(key);
    this.activeStages.delete(key);
    const durationMs = active !== undefined ? Date.now() - active.startMs : null;
    const extra = { ...(params.extra ?? {}), error: params.error };
    this.enqueue(this.buildRecord({ ...params, extra, durationMs }, "error", durationMs));
  }

  // ---- private ----

  private buildRecord(
    params: StageEventParams,
    ev: StageEventType,
    durationMs: number | null,
  ): Record<string, JsonValue> {
    return {
      ts: new Date().toISOString(),
      songIndex: params.songIndex,
      totalSongs: this.totalSongs,
      songPath: params.songPath,
      songId: params.songId,
      stage: params.stage,
      event: ev,
      durationMs,
      workerId: params.workerId ?? 0,
      pid: this.pid,
      threadId: params.threadId ?? null,
      memoryMB: captureMemoryMB(),
      cpuPercent: captureCpuPercent(),
      extra: (params.extra ?? {}) as JsonValue,
    };
  }

  private startStallWatchdog(): void {
    this.stallTimer = setInterval(() => { this.detectStalls(); }, 30_000);
    const timer = this.stallTimer as NodeJS.Timeout;
    if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
      (timer as unknown as { unref: () => void }).unref();
    }
  }

  private stopStallWatchdog(): void {
    if (this.stallTimer !== null) {
      clearInterval(this.stallTimer);
      this.stallTimer = null;
    }
  }

  private detectStalls(): void {
    const now = Date.now();
    for (const [key, active] of this.activeStages.entries()) {
      const age = now - active.startMs;
      const durations = this.stageDurations.get(active.stage);

      let isStall: boolean;
      if (durations !== undefined && durations.length >= 5) {
        const median = computeMedian(durations);
        isStall = median > 0 && age > median * 10;
      } else {
        isStall = age > 300_000; // 5-minute default when no median is available
      }

      if (isStall) {
        this.enqueue({
          ts: new Date().toISOString(),
          songIndex: active.songIndex,
          totalSongs: this.totalSongs,
          stage: active.stage,
          event: "stall",
          durationMs: age,
          pid: this.pid,
          memoryMB: captureMemoryMB(),
          cpuPercent: captureCpuPercent(),
          extra: { stageKey: key } as JsonValue,
        });
      }
    }
  }

  private enqueue(record: Record<string, JsonValue>): void {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        try {
          await queueJsonlWrite(this.primaryPath, [record]);
        } catch {
          // Best-effort: never let telemetry I/O errors surface to the caller.
        }
      });
  }

  async flush(): Promise<void> {
    await this.writeChain;
    await flushWriterQueue(this.primaryPath);
  }
}
