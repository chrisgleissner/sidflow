import { parentPort } from "node:worker_threads";
import { createEngine } from "./engine-factory.js";
import { renderWavWithEngine, type RenderWavOptions, type RenderProgress } from "./wav-renderer.js";
import type { SidAudioEngine } from "@sidflow/libsidplayfp-wasm";

if (!parentPort) {
  throw new Error("WASM renderer worker must be started as a worker thread");
}

type WorkerMessage =
  | { type: "render"; jobId: number; options: RenderWavOptions }
  | { type: "terminate" };

interface WorkerResponse {
  type: "result" | "error" | "progress";
  jobId: number;
  error?: { message: string; stack?: string };
  progress?: RenderProgress;
}

// Reuse a single engine across render jobs within this worker thread.
// SidAudioEngine.loadSidBuffer() (called by renderWavWithEngine) fully resets
// the emulation context for each song, so no state leaks between renders.
// Caching the engine avoids repeated WASM module compilation + engine setup.
let cachedEngine: SidAudioEngine | null = null;

async function getEngine(): Promise<SidAudioEngine> {
  if (cachedEngine) {
    return cachedEngine;
  }
  cachedEngine = await createEngine();
  return cachedEngine;
}

async function handleRender(jobId: number, options: RenderWavOptions): Promise<void> {
  let engine: SidAudioEngine;
  try {
    engine = await getEngine();
  } catch (initError) {
    // Engine creation failed — clear cache and propagate
    cachedEngine = null;
    throw initError;
  }
  try {
    // Add progress callback to send heartbeat messages back to main thread
    const optionsWithProgress: RenderWavOptions = {
      ...options,
      progressIntervalMs: options.progressIntervalMs ?? 1000,
      onProgress: (progress: RenderProgress) => {
        const response: WorkerResponse = { type: "progress", jobId, progress };
        parentPort!.postMessage(response);
      }
    };

    await renderWavWithEngine(engine, optionsWithProgress);
    const response: WorkerResponse = { type: "result", jobId };
    parentPort!.postMessage(response);
  } catch (error) {
    // Discard the engine on render failure to ensure isolation for subsequent jobs
    cachedEngine = null;
    try { engine.dispose(); } catch { /* ignore disposal errors */ }
    const err = error instanceof Error ? error : new Error(String(error));
    const response: WorkerResponse = {
      type: "error",
      jobId,
      error: {
        message: err.message,
        stack: err.stack
      }
    };
    parentPort!.postMessage(response);
  }
}

parentPort.on("message", (message: WorkerMessage) => {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "render") {
    void handleRender(message.jobId, message.options);
  } else if (message.type === "terminate") {
    // Dispose cached engine before exiting
    if (cachedEngine) {
      try { cachedEngine.dispose(); } catch { /* ignore */ }
      cachedEngine = null;
    }
    process.exit(0);
  }
});
