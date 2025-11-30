import { createLogger } from "@sidflow/common";
import { Worker } from "node:worker_threads";
import type { WorkerOptions } from "node:worker_threads";
import type { RenderWavOptions, RenderProgress } from "./wav-renderer.js";

interface WorkerMessage {
  type: "result" | "error" | "progress";
  jobId: number;
  error?: { message?: string; stack?: string };
  progress?: RenderProgress;
}

export interface RenderPoolOptions extends RenderWavOptions {
  /** Optional callback for render progress updates (heartbeat support) */
  onProgress?: (progress: RenderProgress) => void;
}

interface Job {
  id: number;
  options: RenderPoolOptions;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface WorkerState {
  worker: Worker;
  busy: boolean;
  job: Job | null;
  exiting: boolean;
}

const workerScriptUrl = new URL("./wasm-render-worker.js", import.meta.url);
const poolLogger = createLogger("wasmRenderPool");

export class WasmRendererPool {
  private readonly workers: WorkerState[] = [];
  private readonly queue: Job[] = [];
  private nextJobId = 1;
  private destroyed = false;

  constructor(size: number) {
    if (!Number.isInteger(size) || size <= 0) {
      throw new Error(`Renderer pool size must be a positive integer (received ${size})`);
    }
    poolLogger.debug(`Creating ${size} workers`);
    for (let index = 0; index < size; index += 1) {
      this.workers.push(this.createWorkerState());
    }
    poolLogger.debug(`${this.workers.length} workers created`);
  }

  async render(options: RenderPoolOptions): Promise<void> {
    if (this.destroyed) {
      throw new Error("Renderer pool has been destroyed");
    }
    const jobId = this.nextJobId;
    if (jobId <= 3) {
      poolLogger.debug(`Queueing job ${jobId} for ${options.wavFile}`);
    }
    return await new Promise<void>((resolve, reject) => {
      const job: Job = {
        id: this.nextJobId++,
        options,
        resolve,
        reject
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

    // Reject queued jobs immediately
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (job) {
        job.reject(new Error("Renderer pool destroyed"));
      }
    }

    await Promise.all(
      this.workers.map(async (state) => {
        state.exiting = true;
        this.failJob(state, new Error("Renderer pool destroyed"));
        try {
          await state.worker.terminate();
        } catch {
          // Ignore termination errors
        }
      })
    );
  }

  private createWorkerState(): WorkerState {
    const worker = new Worker(
      workerScriptUrl,
      // Node's WorkerOptions typing omits module support, so cast to preserve runtime behaviour.
      { type: "module" } as WorkerOptions & { type: "module" }
    );
    const state: WorkerState = {
      worker,
      busy: false,
      job: null,
      exiting: false
    };

    worker.on("message", (message: WorkerMessage) => {
      this.handleWorkerMessage(state, message);
    });

    worker.on("error", (error) => {
      poolLogger.error("Worker error", error);
      if (state.exiting || this.destroyed) {
        return;
      }
      state.exiting = true;
  this.failJob(state, error instanceof Error ? error : new Error(String(error)));
  void worker.terminate().catch(() => {});
      this.restartWorker(state);
    });

    worker.on("exit", (code) => {
      poolLogger.warn(`Worker exited with code: ${code}`);
      if (state.exiting || this.destroyed) {
        return;
      }
      state.exiting = true;
      const error = code === 0
        ? new Error("Renderer worker exited unexpectedly")
        : new Error(`Renderer worker exited with code ${code}`);
      this.failJob(state, error);
      this.restartWorker(state);
    });

    return state;
  }

  private restartWorker(state: WorkerState): void {
    if (this.destroyed) {
      return;
    }
    const index = this.workers.indexOf(state);
    if (index === -1) {
      return;
    }
    const replacement = this.createWorkerState();
    this.workers[index] = replacement;
    this.dispatch();
  }

  private handleWorkerMessage(state: WorkerState, message: WorkerMessage): void {
    if (message.type === "progress") {
      // Forward progress message to job's onProgress callback (heartbeat support)
      if (state.job && state.job.id === message.jobId && state.job.options.onProgress && message.progress) {
        state.job.options.onProgress(message.progress);
      }
      return; // Don't dispatch - job still in progress
    }
    if (message.type === "result") {
      if (state.job && state.job.id === message.jobId) {
        const job = state.job;
        if (job.id <= 3) {
          poolLogger.debug(`Worker completed job ${job.id}`);
        }
        state.job = null;
        state.busy = false;
        job.resolve();
      } else if (!state.exiting && !this.destroyed) {
        // Received result for unexpected job; reset state
        poolLogger.warn(`Worker received result for unexpected job ${message.jobId}`);
        state.busy = false;
        state.job = null;
      }
    } else if (message.type === "error") {
      state.exiting = true;
      const error = new Error(message.error?.message ?? "Renderer worker failed");
      if (message.error?.stack) {
        error.stack = message.error.stack;
      }
      this.failJob(state, error);
      void state.worker.terminate().catch(() => {});
      this.restartWorker(state);
    }
    this.dispatch();
  }

  private failJob(state: WorkerState, error: Error): void {
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

    let dispatched = 0;
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
      state.worker.postMessage({ type: "render", jobId: job.id, options: job.options });
      dispatched++;
    }
    if (dispatched > 0 && this.queue.length > 0) {
      poolLogger.debug(`Dispatched ${dispatched} jobs, ${this.queue.length} jobs still in queue`);
    }
  }
}
