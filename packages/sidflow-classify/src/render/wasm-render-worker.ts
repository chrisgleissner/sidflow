import { parentPort } from "node:worker_threads";
import { createEngine } from "./engine-factory.js";
import { renderWavWithEngine, type RenderWavOptions } from "./wav-renderer.js";

if (!parentPort) {
  throw new Error("WASM renderer worker must be started as a worker thread");
}

type WorkerMessage =
  | { type: "render"; jobId: number; options: RenderWavOptions }
  | { type: "terminate" };

interface WorkerResponse {
  type: "result" | "error";
  jobId: number;
  error?: { message: string; stack?: string };
}

let enginePromise: Promise<import("@sidflow/libsidplayfp-wasm").SidAudioEngine> | null = null;

async function getEngine() {
  if (!enginePromise) {
    enginePromise = createEngine();
  }
  return await enginePromise;
}

async function handleRender(jobId: number, options: RenderWavOptions): Promise<void> {
  try {
    const engine = await getEngine();
    await renderWavWithEngine(engine, options);
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
