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

// Create a fresh engine per render job.  The WASM *module* (compiled code) is
// cached inside engine-factory.ts, so we skip re-compilation.  However, the
// SidAudioEngine (which holds a SidPlayerContext on the WASM heap) is created
// fresh and disposed after each render to guarantee clean emulation state.
async function getEngine() {
  return await createEngine();
}

async function handleRender(jobId: number, options: RenderWavOptions): Promise<void> {
  const engine = await getEngine();
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
  } finally {
    engine.dispose();
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
