import { createLogger } from "@sidflow/common";
import { Worker } from "node:worker_threads";
import type { WorkerOptions } from "node:worker_threads";

import type {
  RenderExecutionSummary,
  RenderProgress,
  RenderWavOptions,
} from "./wav-renderer.js";

interface WorkerMessage {
  type: "result" | "error" | "progress";
  jobId: number;
  summary?: RenderExecutionSummary;
  error?: { message?: string; stack?: string };
  progress?: RenderProgress;
}

export interface RenderPoolOptions extends RenderWavOptions {
  onProgress?: (progress: RenderProgress) => void;
}

export interface RenderPoolLifecycleEvent {
  type:
    | "worker_spawned"
    | "worker_recycled"
    | "worker_fault"
    | "job_started"
    | "job_completed"
    | "job_failed";
  workerId: number;
  activeWorkers: number;
  busyWorkers: number;
  queueDepth: number;
  jobsCompleted: number;
  totalRecycles: number;
  sidFile?: string;
  reason?: string;
  summary?: RenderExecutionSummary;
}

export interface WasmRendererPoolOptions {
  maxJobsPerWorker?: number;
  /** Override the per-job safety-net timeout in ms. Defaults to 120 s. */
  jobTimeoutMs?: number;
  onEvent?: (event: RenderPoolLifecycleEvent) => void;
}

interface Job {
  id: number;
  options: RenderPoolOptions;
  resolve: (summary: RenderExecutionSummary | null) => void;
  reject: (error: Error) => void;
}

interface WorkerState {
  workerId: number;
  worker: Worker;
  busy: boolean;
  job: Job | null;
  exiting: boolean;
  replaceOnExit: boolean;
  jobsCompleted: number;
  gracefulExitTimer: ReturnType<typeof setTimeout> | null;
  /** Safety-net timer that fires when a WASM call never returns. */
  jobTimeoutTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_MAX_JOBS_PER_WORKER = 32;
const GRACEFUL_RECYCLE_TIMEOUT_MS = 2_000;
const FORCE_REPLACE_TIMEOUT_MS = 1_000;
/**
 * Safety-net timeout for a single pool job. Cooperative render bounding
 * (wall-clock budget in renderWavWithEngine) handles normal long renders.
 * This timeout only fires when a WASM call never returns (e.g. a SID init
 * routine that loops waiting for a hardware interrupt).
 */
const DEFAULT_JOB_TIMEOUT_MS = 120_000;
const workerScriptUrl = new URL("./wasm-render-worker.js", import.meta.url);
const poolLogger = createLogger("wasmRenderPool");

export class WasmRendererPool {
  private readonly workers: WorkerState[] = [];
  private readonly queue: Job[] = [];
  private readonly maxJobsPerWorker: number;
  private readonly jobTimeoutMs: number;
  private readonly onEvent?: (event: RenderPoolLifecycleEvent) => void;
  private nextJobId = 1;
  private nextWorkerId = 1;
  private totalRecycles = 0;
  private destroyed = false;

  constructor(size: number, options: WasmRendererPoolOptions = {}) {
    if (!Number.isInteger(size) || size <= 0) {
      throw new Error(`Renderer pool size must be a positive integer (received ${size})`);
    }

    this.maxJobsPerWorker =
      typeof options.maxJobsPerWorker === "number" && Number.isFinite(options.maxJobsPerWorker) && options.maxJobsPerWorker > 0
        ? Math.floor(options.maxJobsPerWorker)
        : DEFAULT_MAX_JOBS_PER_WORKER;
    this.jobTimeoutMs =
      typeof options.jobTimeoutMs === "number" && Number.isFinite(options.jobTimeoutMs) && options.jobTimeoutMs > 0
        ? Math.floor(options.jobTimeoutMs)
        : DEFAULT_JOB_TIMEOUT_MS;
    this.onEvent = options.onEvent;

    poolLogger.debug(`Creating ${size} workers`);
    for (let index = 0; index < size; index += 1) {
      this.workers.push(this.createWorkerState());
    }
    poolLogger.debug(`${this.workers.length} workers created`);
  }

  async render(options: RenderPoolOptions): Promise<RenderExecutionSummary | null> {
    if (this.destroyed) {
      throw new Error("Renderer pool has been destroyed");
    }

    return await new Promise<RenderExecutionSummary | null>((resolve, reject) => {
      const job: Job = {
        id: this.nextJobId++,
        options,
        resolve,
        reject,
      };
      this.queue.push(job);
      this.dispatch();
    });
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      job?.reject(new Error("Renderer pool destroyed"));
    }

    await Promise.all(
      this.workers.map(async (state) => {
        state.exiting = true;
        state.replaceOnExit = false;
        this.clearGracefulExitTimer(state);
        this.failJob(state, new Error("Renderer pool destroyed"));
        try {
          await state.worker.terminate();
        } catch {
          // Ignore termination errors during shutdown.
        }
      })
    );
  }

  private createWorkerState(): WorkerState {
    const worker = new Worker(
      workerScriptUrl,
      { type: "module" } as WorkerOptions & { type: "module" }
    );
    const state: WorkerState = {
      workerId: this.nextWorkerId++,
      worker,
      busy: false,
      job: null,
      exiting: false,
      replaceOnExit: false,
      jobsCompleted: 0,
      gracefulExitTimer: null,
      jobTimeoutTimer: null,
    };

    worker.on("message", (message: WorkerMessage) => {
      this.handleWorkerMessage(state, message);
    });

    worker.on("error", (error) => {
      poolLogger.error(`Worker ${state.workerId} error`, error);
      if (this.destroyed) {
        return;
      }
      state.exiting = true;
      state.replaceOnExit = true;
      this.failJob(state, error instanceof Error ? error : new Error(String(error)));
      this.emitEvent("worker_fault", state, {
        reason: error instanceof Error ? error.message : String(error),
      });
      this.terminateAndReplaceWorker(state, "worker_error");
    });

    worker.on("exit", (code) => {
      poolLogger.debug(`Worker ${state.workerId} exited with code ${code}`);
      if (this.destroyed) {
        return;
      }

      const shouldReplace = state.replaceOnExit || !state.exiting;
      if (!state.exiting) {
        const error = code === 0
          ? new Error("Renderer worker exited unexpectedly")
          : new Error(`Renderer worker exited with code ${code}`);
        this.failJob(state, error);
        this.emitEvent("worker_fault", state, { reason: error.message });
      }

      this.clearGracefulExitTimer(state);
      state.busy = false;
      state.job = null;

      if (shouldReplace) {
        this.replaceWorker(state, code === 0 ? "recycle" : `exit:${code}`);
      }
    });

    this.emitEvent("worker_spawned", state);
    return state;
  }

  private replaceWorker(state: WorkerState, reason: string): void {
    if (this.destroyed) {
      return;
    }
    const index = this.workers.indexOf(state);
    if (index === -1) {
      return;
    }

    this.totalRecycles += 1;
    const replacement = this.createWorkerState();
    this.workers[index] = replacement;
    this.emitEvent("worker_recycled", replacement, { reason });
    this.dispatch();
  }

  private scheduleRecycle(state: WorkerState, reason: string): void {
    if (this.destroyed || state.exiting) {
      return;
    }
    state.exiting = true;
    state.replaceOnExit = true;
    state.gracefulExitTimer = setTimeout(() => {
      if (!this.destroyed && state.replaceOnExit) {
        void state.worker.terminate().catch(() => {});
      }
    }, GRACEFUL_RECYCLE_TIMEOUT_MS);
    state.worker.postMessage({ type: "terminate" });
    this.emitEvent("worker_recycled", state, { reason });
  }

  private clearGracefulExitTimer(state: WorkerState): void {
    if (state.gracefulExitTimer !== null) {
      clearTimeout(state.gracefulExitTimer);
      state.gracefulExitTimer = null;
    }
  }

  private terminateAndReplaceWorker(state: WorkerState, reason: string): void {
    if (this.destroyed) {
      return;
    }

    let replacementRequested = false;
    const requestReplacement = (): void => {
      if (replacementRequested || this.destroyed) {
        return;
      }
      replacementRequested = true;
      this.replaceWorker(state, reason);
    };

    void state.worker.terminate()
      .then(() => {
        requestReplacement();
      })
      .catch(() => {
        requestReplacement();
      });

    setTimeout(() => {
      requestReplacement();
    }, FORCE_REPLACE_TIMEOUT_MS);
  }

  private handleWorkerMessage(state: WorkerState, message: WorkerMessage): void {
    if (message.type === "progress") {
      if (state.job && state.job.id === message.jobId && state.job.options.onProgress && message.progress) {
        state.job.options.onProgress(message.progress);
      }
      return;
    }

    if (!state.job || state.job.id !== message.jobId) {
      if (!state.exiting && !this.destroyed) {
        poolLogger.warn(`Worker ${state.workerId} received message for unexpected job ${message.jobId}`);
      }
      state.busy = false;
      state.job = null;
      this.dispatch();
      return;
    }

    const job = state.job;
    state.job = null;
    state.busy = false;
    state.jobsCompleted += 1;      this.clearJobTimeoutTimer(state);
    if (message.type === "result") {
      job.resolve(message.summary ?? null);
      this.emitEvent("job_completed", state, {
        sidFile: job.options.sidFile,
        summary: message.summary,
      });
    } else {
      const error = new Error(message.error?.message ?? "Renderer worker failed");
      if (message.error?.stack) {
        error.stack = message.error.stack;
      }
      job.reject(error);
      this.emitEvent("job_failed", state, {
        sidFile: job.options.sidFile,
        reason: error.message,
        summary: message.summary,
      });
    }

    if (state.jobsCompleted >= this.maxJobsPerWorker) {
      this.scheduleRecycle(state, `max_jobs:${this.maxJobsPerWorker}`);
      return;
    }

    this.dispatch();
  }

  private clearJobTimeoutTimer(state: WorkerState): void {
    if (state.jobTimeoutTimer !== null) {
      clearTimeout(state.jobTimeoutTimer);
      state.jobTimeoutTimer = null;
    }
  }

  private startJobTimeoutTimer(state: WorkerState, job: Job): void {
    this.clearJobTimeoutTimer(state);
    const timeoutMs = this.jobTimeoutMs;
    state.jobTimeoutTimer = setTimeout(() => {
      state.jobTimeoutTimer = null;
      if (this.destroyed || state.job?.id !== job.id) {
        return;
      }
      const sidFile = job.options.sidFile ?? "unknown";
      poolLogger.warn(
        `Worker ${state.workerId} job timeout after ${timeoutMs}ms: ${sidFile} — terminating worker`
      );
      // Mark exiting before failJob and terminateAndReplaceWorker so the
      // worker.on("exit") handler does not emit a spurious worker_fault event
      // or attempt a second job failure.
      state.exiting = true;
      state.replaceOnExit = true;
      this.failJob(
        state,
        new Error(`Render attempt timed out after ${timeoutMs}ms in WASM render pool (worker terminated): ${sidFile}`)
      );
      this.emitEvent("job_failed", state, {
        sidFile: job.options.sidFile,
        reason: `job_timeout:${timeoutMs}ms`,
      });
      this.terminateAndReplaceWorker(state, `job_timeout:${timeoutMs}ms`);
    }, timeoutMs);
  }

  private failJob(state: WorkerState, error: Error): void {
    this.clearJobTimeoutTimer(state);
    if (state.job) {
      const job = state.job;
      state.job = null;
      state.busy = false;
      job.reject(error);
    } else {
      state.busy = false;
    }
  }

  private dispatch(): void {
    if (this.destroyed || this.queue.length === 0) {
      return;
    }

    for (const state of this.workers) {
      if (state.busy || state.exiting) {
        continue;
      }
      const job = this.queue.shift();
      if (!job) {
        break;
      }

      state.busy = true;
      state.job = job;
      this.emitEvent("job_started", state, { sidFile: job.options.sidFile });
      state.worker.postMessage({ type: "render", jobId: job.id, options: job.options });
      this.startJobTimeoutTimer(state, job);
    }
  }

  private emitEvent(
    type: RenderPoolLifecycleEvent["type"],
    state: WorkerState,
    extra: Partial<Omit<RenderPoolLifecycleEvent, "type" | "workerId" | "activeWorkers" | "busyWorkers" | "queueDepth" | "jobsCompleted" | "totalRecycles">> = {}
  ): void {
    this.onEvent?.({
      type,
      workerId: state.workerId,
      activeWorkers: this.workers.length,
      busyWorkers: this.workers.filter((workerState) => workerState.busy).length,
      queueDepth: this.queue.length,
      jobsCompleted: state.jobsCompleted,
      totalRecycles: this.totalRecycles,
      sidFile: extra.sidFile,
      reason: extra.reason,
      summary: extra.summary,
    });
  }
}
