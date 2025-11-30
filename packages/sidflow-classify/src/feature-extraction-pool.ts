/**
 * Feature Extraction Worker Pool
 * 
 * Manages a pool of worker threads for parallel feature extraction.
 * Each worker has its own isolated Essentia WASM instance for thread safety.
 * 
 * Key design points:
 * 1. Workers are created once and reused for multiple extractions
 * 2. Transferable arrays are used when possible to avoid data copying
 * 3. Tasks are dispatched without blocking the main thread
 * 4. Heartbeat callbacks can fire freely since extraction is off-main-thread
 */

import { createLogger } from "@sidflow/common";
import { Worker } from "node:worker_threads";
import type { WorkerOptions } from "node:worker_threads";
import type { FeatureVector } from "./index.js";

interface WorkerMessage {
  type: "result" | "error";
  jobId: number;
  features?: FeatureVector;
  error?: { message?: string; stack?: string };
}

interface Job {
  id: number;
  wavFile: string;
  sidFile: string;
  resolve: (features: FeatureVector) => void;
  reject: (error: Error) => void;
}

interface WorkerState {
  worker: Worker;
  busy: boolean;
  job: Job | null;
  exiting: boolean;
}

const workerScriptUrl = new URL("./feature-extraction-worker.js", import.meta.url);
const poolLogger = createLogger("featurePool");

export class FeatureExtractionPool {
  private readonly workers: WorkerState[] = [];
  private readonly queue: Job[] = [];
  private nextJobId = 1;
  private destroyed = false;

  constructor(size: number) {
    if (!Number.isInteger(size) || size <= 0) {
      throw new Error(`Feature extraction pool size must be a positive integer (received ${size})`);
    }
    poolLogger.debug(`Creating ${size} feature extraction workers`);
    for (let index = 0; index < size; index += 1) {
      this.workers.push(this.createWorkerState());
    }
    poolLogger.debug(`${this.workers.length} feature extraction workers created`);
  }

  /**
   * Extract features from a WAV file asynchronously.
   * The extraction runs in a worker thread, preventing main thread blocking.
   */
  async extract(wavFile: string, sidFile: string): Promise<FeatureVector> {
    if (this.destroyed) {
      throw new Error("Feature extraction pool has been destroyed");
    }
    
    return new Promise<FeatureVector>((resolve, reject) => {
      const job: Job = {
        id: this.nextJobId++,
        wavFile,
        sidFile,
        resolve,
        reject
      };
      this.queue.push(job);
      this.dispatch();
    });
  }

  /**
   * Destroy the pool and terminate all workers.
   */
  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    // Reject queued jobs
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (job) {
        job.reject(new Error("Feature extraction pool destroyed"));
      }
    }

    await Promise.all(
      this.workers.map(async (state) => {
        state.exiting = true;
        this.failJob(state, new Error("Feature extraction pool destroyed"));
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
      poolLogger.error("Feature worker error", error);
      if (state.exiting || this.destroyed) {
        return;
      }
      state.exiting = true;
      this.failJob(state, error instanceof Error ? error : new Error(String(error)));
      void worker.terminate().catch(() => {});
      this.restartWorker(state);
    });

    worker.on("exit", (code) => {
      poolLogger.warn(`Feature worker exited with code: ${code}`);
      if (state.exiting || this.destroyed) {
        return;
      }
      state.exiting = true;
      const error = code === 0
        ? new Error("Feature worker exited unexpectedly")
        : new Error(`Feature worker exited with code ${code}`);
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
    if (message.type === "result") {
      if (state.job && state.job.id === message.jobId) {
        const job = state.job;
        state.job = null;
        state.busy = false;
        job.resolve(message.features ?? {});
      } else if (!state.exiting && !this.destroyed) {
        poolLogger.warn(`Worker received result for unexpected job ${message.jobId}`);
        state.busy = false;
        state.job = null;
      }
    } else if (message.type === "error") {
      state.exiting = true;
      const error = new Error(message.error?.message ?? "Feature extraction failed");
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
      state.worker.postMessage({ 
        type: "extract", 
        jobId: job.id, 
        wavFile: job.wavFile,
        sidFile: job.sidFile
      });
    }
  }
}

// Singleton pool instance
let globalPool: FeatureExtractionPool | null = null;

/**
 * Get or create the global feature extraction pool.
 * Uses the number of CPU cores as the default pool size.
 */
export function getFeatureExtractionPool(size?: number): FeatureExtractionPool {
  if (!globalPool) {
    const poolSize = size ?? Math.max(1, require("os").cpus().length);
    globalPool = new FeatureExtractionPool(poolSize);
  }
  return globalPool;
}

/**
 * Destroy the global pool (for cleanup in tests).
 */
export async function destroyFeatureExtractionPool(): Promise<void> {
  if (globalPool) {
    await globalPool.destroy();
    globalPool = null;
  }
}
