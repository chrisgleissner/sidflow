import { parentPort } from "node:worker_threads";
import { createEngine } from "./engine-factory.js";
import {
  renderWavWithEngine,
  type RenderExecutionSummary,
  type RenderProgress,
  type RenderWavOptions,
} from "./wav-renderer.js";

if (!parentPort) {
  throw new Error("WASM renderer worker must be started as a worker thread");
}

type WorkerMessage =
  | { type: "render"; jobId: number; options: RenderWavOptions }
  | { type: "terminate" };

interface WorkerResponse {
  type: "result" | "error" | "progress";
  jobId: number;
  summary?: RenderExecutionSummary;
  error?: { message: string; stack?: string };
  progress?: RenderProgress;
  /**
   * Reported back on every completed job because this is where the corpus-scale failure
   * lives and the main process cannot see it. A fresh engine is created and disposed PER
   * JOB, each instantiating a WASM linear memory of roughly 64-128 MB, so a full HVSC
   * pass performs about 88,000 instantiations inside these workers. When one of them
   * eventually fails with "Out of memory" the whole run dies, and until now the only
   * evidence was a post-mortem crash report from a process that no longer existed.
   */
  resources?: WorkerResourceReport;
}

interface WorkerResourceReport {
  enginesCreated: number;
  enginesDisposed: number;
  /**
   * Process-wide, NOT per worker. Worker threads share one address space, so
   * process.memoryUsage().rss reports the same figure in every thread. Kept only so the
   * pool can confirm it agrees with the main process; it carries no per-worker signal.
   */
  processRssBytes: number;
  /**
   * Per-isolate, so these DO differ between workers, and they are the interesting pair:
   * WASM linear memory is allocated outside the JS heap and lands here rather than in
   * heapUsed.
   */
  externalBytes: number;
  arrayBuffersBytes: number;
}

let enginesCreated = 0;
let enginesDisposed = 0;

function resourceReport(): WorkerResourceReport {
  const usage = process.memoryUsage();
  return {
    enginesCreated,
    enginesDisposed,
    processRssBytes: usage.rss,
    externalBytes: usage.external ?? 0,
    arrayBuffersBytes: usage.arrayBuffers ?? 0,
  };
}

/**
 * The engine is kept between jobs instead of built for each one.
 *
 * Building one per job costs about 22.8 KiB of retained process memory per instantiation --
 * measured over 34,002 instantiations, RSS rose 739 MiB with engine live-count pinned at
 * zero and worker WASM memory flat, so the linear memory IS released and something small
 * and per-instantiation is not. A full HVSC pass performs roughly 88,000 instantiations,
 * which extrapolates from a ~1,500 MiB baseline to ~3,500 MiB: exactly the peak RSS at
 * which the run died with "RangeError: Out of memory" while instantiating another one.
 *
 * Reuse cuts instantiations by the worker's job budget (32), which removes the growth
 * rather than merely slowing it. It is safe because `loadSidBuffer` re-initialises the
 * tune and resets the cache and pending-chunk state, and because the pool already replaces
 * each worker after a fixed number of jobs, giving a hard reset boundary regardless.
 *
 * SIDFLOW_RENDER_ENGINE_PER_JOB=1 restores the old behaviour, which is how the A/B check
 * that the features are byte-identical was run.
 */
const REUSE_ENGINE = process.env.SIDFLOW_RENDER_ENGINE_PER_JOB !== "1";
let pooledEngine: Awaited<ReturnType<typeof createEngine>> | null = null;
let pooledSampleRate: number | undefined;

async function acquireEngine(sampleRate: number | undefined): Promise<Awaited<ReturnType<typeof createEngine>>> {
  // A sample-rate change means a differently configured engine; rebuild rather than reuse.
  if (REUSE_ENGINE && pooledEngine && pooledSampleRate === sampleRate) {
    // Reset so no register or filter state carries from the previous tune. loadSidBuffer
    // re-initialises as well; this is the belt to that brace, and it is cheap.
    pooledEngine.reset();
    return pooledEngine;
  }
  if (pooledEngine) {
    pooledEngine.dispose();
    enginesDisposed += 1;
    pooledEngine = null;
  }
  const engine = await createEngine({ sampleRate });
  enginesCreated += 1;
  if (REUSE_ENGINE) {
    pooledEngine = engine;
    pooledSampleRate = sampleRate;
  }
  return engine;
}

async function handleRender(jobId: number, options: RenderWavOptions): Promise<void> {
  let engine: Awaited<ReturnType<typeof createEngine>> | null = null;
  let renderSummary: RenderExecutionSummary | undefined;
  try {
    engine = await acquireEngine(options.renderSampleRate);

    // Add progress callback to send heartbeat messages back to main thread
    const optionsWithProgress: RenderWavOptions = {
      ...options,
      progressIntervalMs: options.progressIntervalMs ?? 1000,
      onSummary: (summary) => {
        renderSummary = summary;
      },
      onProgress: (progress: RenderProgress) => {
        const response: WorkerResponse = { type: "progress", jobId, progress };
        parentPort!.postMessage(response);
      }
    };

    await renderWavWithEngine(engine, optionsWithProgress);

    // Disposed here rather than left to `finally`, so the report below is taken AFTER the
    // engine is released. Reporting first made enginesDisposed permanently one behind per
    // worker, which showed up as "6 engines live" on a 6-worker pool that was leaking
    // nothing -- and would have hidden a real leak behind an expected-looking number.
    if (!REUSE_ENGINE) {
      engine.dispose();
      enginesDisposed += 1;
    }
    engine = null;

    const response: WorkerResponse = { type: "result", jobId, summary: renderSummary, resources: resourceReport() };
    parentPort!.postMessage(response);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const response: WorkerResponse = {
      type: "error",
      jobId,
      summary: renderSummary,
      error: {
        message: err.message,
        stack: err.stack
      },
      resources: resourceReport(),
    };
    parentPort!.postMessage(response);
  } finally {
    // dispose() nulls this.module and this.modulePromise so the ~64-128 MB WASM
    // linear-memory ArrayBuffer becomes GC-eligible immediately rather than
    // waiting for the engine wrapper object to be collected.
    // On the error path the engine is always discarded, reuse or not: a tune that failed
    // mid-render may have left the chip in a state the next tune would inherit.
    if (engine) {
      engine.dispose();
      enginesDisposed += 1;
      if (pooledEngine === engine) {
        pooledEngine = null;
      }
    }
    engine = null;
  }
}

parentPort.on("message", (message: WorkerMessage) => {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "render") {
    void handleRender(message.jobId, message.options);
  } else if (message.type === "terminate") {
    // Gracefully exit when instructed; Node will terminate the worker.
    process.exit(0);
  }
});


