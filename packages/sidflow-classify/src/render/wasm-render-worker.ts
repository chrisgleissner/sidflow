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
}

async function handleRender(jobId: number, options: RenderWavOptions): Promise<void> {
  let engine: Awaited<ReturnType<typeof createEngine>> | null = null;
  let renderSummary: RenderExecutionSummary | undefined;
  try {
    engine = await createEngine({ sampleRate: options.renderSampleRate });

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
    const response: WorkerResponse = { type: "result", jobId, summary: renderSummary };
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
      }
    };
    parentPort!.postMessage(response);
  } finally {
    engine?.dispose();
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
