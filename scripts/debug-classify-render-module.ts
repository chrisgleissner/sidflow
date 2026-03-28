import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  defaultRenderWav,
  type RenderExecutionSummary,
  type RenderProgress,
  type RenderWav,
  type RenderWavOptions,
} from "../packages/sidflow-classify/src/index.js";

interface DebugRenderEvent {
  event: string;
  timestamp: string;
  sidFile: string;
  songIndex?: number;
  renderProfile?: string;
  maxRenderSeconds?: number;
  renderSampleRate?: number;
  maxRenderWallTimeMs?: number;
  targetDurationMs?: number;
  captureTrace?: boolean;
  collectedSamples?: number;
  targetSamples?: number;
  percentComplete?: number;
  elapsedMs?: number;
  sampleRate?: number;
  channels?: number;
  truncated?: boolean;
  stopReason?: string;
  error?: string;
}

function resolveDebugLogPath(): string {
  const configured = process.env.SIDFLOW_DEBUG_RENDER_LOG;
  if (configured && configured.trim().length > 0) {
    return path.resolve(configured);
  }
  return path.resolve("tmp/classify-render-debug.jsonl");
}

function resolveCaptureTraceOverride(current: boolean | undefined): boolean | undefined {
  const configured = process.env.SIDFLOW_DEBUG_CAPTURE_TRACE;
  if (configured === "0" || configured === "false") {
    return false;
  }
  if (configured === "1" || configured === "true") {
    return true;
  }
  return current;
}

function resolveSongIndexOverride(current: number | undefined): number | undefined {
  const configured = process.env.SIDFLOW_DEBUG_SUPPRESS_SONG_INDEX;
  if (configured === "1" || configured === "true") {
    return undefined;
  }
  return current;
}

async function writeEvent(event: DebugRenderEvent): Promise<void> {
  const logPath = resolveDebugLogPath();
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
}

function baseEvent(options: RenderWavOptions): Omit<DebugRenderEvent, "event" | "timestamp"> {
  return {
    sidFile: options.sidFile,
    songIndex: options.songIndex,
    renderProfile: options.renderProfile,
    maxRenderSeconds: options.maxRenderSeconds,
    renderSampleRate: options.renderSampleRate,
    maxRenderWallTimeMs: options.maxRenderWallTimeMs,
    targetDurationMs: options.targetDurationMs,
    captureTrace: options.captureTrace,
  };
}

function progressEvent(options: RenderWavOptions, progress: RenderProgress): DebugRenderEvent {
  return {
    event: "render_progress",
    timestamp: new Date().toISOString(),
    ...baseEvent(options),
    collectedSamples: progress.collectedSamples,
    targetSamples: progress.targetSamples,
    percentComplete: progress.percentComplete,
    elapsedMs: progress.elapsedMs,
  };
}

function summaryEvent(options: RenderWavOptions, summary: RenderExecutionSummary): DebugRenderEvent {
  return {
    event: "render_summary",
    timestamp: new Date().toISOString(),
    ...baseEvent(options),
    collectedSamples: summary.collectedSamples,
    targetSamples: summary.targetSamples,
    percentComplete: summary.percentComplete,
    elapsedMs: summary.elapsedMs,
    sampleRate: summary.sampleRate,
    channels: summary.channels,
    truncated: summary.truncated,
    stopReason: summary.stopReason,
  };
}

export const renderWav: RenderWav = async (options) => {
  const captureTrace = resolveCaptureTraceOverride(options.captureTrace);
  const songIndex = resolveSongIndexOverride(options.songIndex);
  const pendingWrites: Array<Promise<void>> = [];
  const enqueueWrite = (event: DebugRenderEvent): void => {
    pendingWrites.push(writeEvent(event));
  };
  const debugOptions: RenderWavOptions = {
    ...options,
    songIndex,
    captureTrace,
    onProgress: (progress) => {
      enqueueWrite(progressEvent({ ...options, songIndex, captureTrace }, progress));
      options.onProgress?.(progress);
    },
    onSummary: (summary) => {
      enqueueWrite(summaryEvent({ ...options, songIndex, captureTrace }, summary));
      options.onSummary?.(summary);
    },
  };

  await writeEvent({
    event: "render_start",
    timestamp: new Date().toISOString(),
    ...baseEvent(debugOptions),
  });

  try {
    await defaultRenderWav(debugOptions);
    await writeEvent({
      event: "render_complete",
      timestamp: new Date().toISOString(),
      ...baseEvent(debugOptions),
    });
    await Promise.allSettled(pendingWrites);
  } catch (error) {
    await writeEvent({
      event: "render_error",
      timestamp: new Date().toISOString(),
      ...baseEvent(debugOptions),
      error: error instanceof Error ? error.message : String(error),
    });
    await Promise.allSettled(pendingWrites);
    throw error;
  }
};

export default renderWav;