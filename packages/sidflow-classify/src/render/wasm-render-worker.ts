import { parentPort } from "node:worker_threads";
import { createEngine } from "./engine-factory.js";
import { renderWavWithEngine, type RenderWavOptions, type RenderProgress } from "./wav-renderer.js";

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

// DO NOT cache engine - create fresh instance for each render to ensure complete WASM isolation
async function getEngine() {
  return await createEngine();
}

async function handleRender(jobId: number, options: RenderWavOptions): Promise<void> {
  try {
    const engine = await getEngine();
    
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
    // Gracefully exit when instructed; Node will terminate the worker.
    process.exit(0);
  }
});
