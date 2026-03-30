import { createLogger, ensureDir, pathExists, stringifyDeterministic, type JsonValue } from "@sidflow/common";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { appendFile, open, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import path from "node:path";
import type { SidAudioEngine, SidWriteTrace } from "@sidflow/libsidplayfp-wasm";
import type { RenderEngine } from "./render-orchestrator.js";

export interface RenderWavOptions {
  sidFile: string;
  wavFile: string;
  renderEngine?: RenderEngine;
  songIndex?: number;
  maxRenderSeconds?: number;
  targetDurationMs?: number;
  renderSampleRate?: number;
  maxRenderWallTimeMs?: number;
  renderProfile?: string;
  /** Optional progress callback - called periodically during rendering to support heartbeat */
  onProgress?: (progress: RenderProgress) => void;
  /** Optional callback with the final render summary. */
  onSummary?: (summary: RenderExecutionSummary) => void;
  /** Interval in ms between progress callbacks (default: 1000ms) */
  progressIntervalMs?: number;
  /**
   * If true, capture SID register-write traces during rendering and write a
    * .trace.jsonl sidecar alongside the WAV. The sidecar can be reused by the
   * SID-native feature extractor to avoid a second full WASM render pass.
   */
  captureTrace?: boolean;
  /** Clock standard to store in the trace sidecar (default "PAL"). */
  traceClock?: string;
  /** Intro-skip seconds stored in the trace sidecar (should match introSkipSec config). */
  traceIntroSkipSec?: number;
  /** Analysis-window seconds stored in the trace sidecar (should match maxClassifySec config). */
  traceAnalysisSec?: number;
}

export interface RenderProgress {
  collectedSamples: number;
  targetSamples: number;
  percentComplete: number;
  elapsedMs: number;
}

export interface RenderExecutionSummary {
  collectedSamples: number;
  targetSamples: number;
  percentComplete: number;
  elapsedMs: number;
  sampleRate: number;
  channels: number;
  truncated: boolean;
  stopReason: "complete" | "wall_time" | "silent_limit" | "max_iterations" | "null_chunk";
}

function isNaturalRenderStopReason(stopReason: RenderExecutionSummary["stopReason"]): boolean {
  return stopReason === "complete" || stopReason === "silent_limit" || stopReason === "null_chunk";
}

export const RENDER_CYCLES_PER_CHUNK = 20_000;
/** Hard fallback render cap: 15s intro-skip + 15s analysis window = 30s. */
export const MAX_RENDER_SECONDS = 30;
export const MAX_SILENT_ITERATIONS = 32;
export const WAV_HASH_EXTENSION = ".sha256";
/** Extension for the SID register-write trace sidecar captured during WAV rendering. */
export const SID_TRACE_EXTENSION = ".trace.jsonl";
export const SID_TRACE_SIDECAR_VERSION = 1;
const TRACE_RECORD_BATCH_SIZE = 25_000;

/**
 * SID register-write trace sidecar written alongside the WAV.
 * Allows the SID-native feature extractor to reuse the trace from the WAV render
 * instead of performing a second full WASM render pass.
 */
export interface SidTraceSidecar {
  v: typeof SID_TRACE_SIDECAR_VERSION;
  traces: SidWriteTrace[];
  /** Clock standard used during rendering ("PAL" | "NTSC"). */
  clock: string;
  /** Seconds to skip from the start (matches introSkipSec). */
  skipSeconds: number;
  /** Seconds of analysis window (matches maxClassifySec). */
  analysisSeconds: number;
}

type SidTraceTuple = [sidNumber: number, address: number, value: number, cyclePhi1: number];

interface SidTraceSidecarHeader {
  kind: "header";
  v: typeof SID_TRACE_SIDECAR_VERSION;
  format: "sid-trace-jsonl";
  clock: string;
  skipSeconds: number;
  analysisSeconds: number;
}

interface SidTraceSidecarBatch {
  kind: "batch";
  records: SidTraceTuple[];
}

interface SidTraceSidecarFooter {
  kind: "footer";
  eventCount: number;
  batchCount: number;
}

const renderLogger = createLogger("renderWav");

interface RenderDebugEvent {
  source: "wav-renderer";
  event: string;
  timestamp: string;
  elapsedMs: number;
  sidFile: string;
  wavFile: string;
  songIndex?: number;
  renderProfile?: string;
  captureTrace?: boolean;
  iteration?: number;
  collectedSamples?: number;
  targetSamples?: number;
  chunkSamples?: number | null;
  traceEventCount?: number;
  traceBatchCount?: number;
  maxRenderSeconds?: number;
  maxRenderWallTimeMs?: number;
  targetDurationMs?: number;
  error?: string;
}

function resolveRenderDebugLogPath(): string | null {
  const configured = process.env.SIDFLOW_DEBUG_RENDER_LOG;
  if (!configured || configured.trim().length === 0) {
    return null;
  }
  return path.resolve(configured);
}

async function appendRenderDebugEvent(event: RenderDebugEvent): Promise<void> {
  const debugLogPath = resolveRenderDebugLogPath();
  if (!debugLogPath) {
    return;
  }
  await ensureDir(path.dirname(debugLogPath));
  await appendFile(debugLogPath, `${JSON.stringify(event)}\n`, "utf8");
}

export function getSidTraceSidecarPath(wavFile: string): string {
  return `${wavFile}${SID_TRACE_EXTENSION}`;
}

function stringifySidTraceLine(value: JsonValue): string {
  return `${stringifyDeterministic(value, 0).trimEnd()}\n`;
}

function traceToTuple(trace: SidWriteTrace): SidTraceTuple {
  return [trace.sidNumber, trace.address, trace.value, trace.cyclePhi1];
}

function tupleToTrace(tuple: SidTraceTuple): SidWriteTrace {
  return {
    sidNumber: tuple[0],
    address: tuple[1],
    value: tuple[2],
    cyclePhi1: tuple[3],
  };
}

async function initializeSidTraceSidecar(
  wavFile: string,
  header: Omit<SidTraceSidecarHeader, "kind" | "v" | "format">
): Promise<void> {
  const payload: SidTraceSidecarHeader = {
    kind: "header",
    v: SID_TRACE_SIDECAR_VERSION,
    format: "sid-trace-jsonl",
    clock: header.clock,
    skipSeconds: header.skipSeconds,
    analysisSeconds: header.analysisSeconds,
  };
  await writeFile(getSidTraceSidecarPath(wavFile), stringifySidTraceLine(payload as unknown as JsonValue), "utf8");
}

async function appendSidTraceBatch(wavFile: string, traces: readonly SidWriteTrace[]): Promise<void> {
  if (traces.length === 0) {
    return;
  }
  const payload: SidTraceSidecarBatch = {
    kind: "batch",
    records: traces.map(traceToTuple),
  };
  await appendFile(getSidTraceSidecarPath(wavFile), stringifySidTraceLine(payload as unknown as JsonValue), "utf8");
}

async function finalizeSidTraceSidecar(
  wavFile: string,
  footer: SidTraceSidecarFooter
): Promise<void> {
  await appendFile(getSidTraceSidecarPath(wavFile), stringifySidTraceLine(footer as unknown as JsonValue), "utf8");
}

export async function writeSidTraceSidecar(
  wavFile: string,
  sidecar: Omit<SidTraceSidecar, "v">
): Promise<void> {
  // Write header + single batch + footer in one writeFile call to minimise
  // syscall overhead when called from parallel render workers.
  const header: SidTraceSidecarHeader = {
    kind: "header",
    v: SID_TRACE_SIDECAR_VERSION,
    format: "sid-trace-jsonl",
    clock: sidecar.clock,
    skipSeconds: sidecar.skipSeconds,
    analysisSeconds: sidecar.analysisSeconds,
  };
  const batch: SidTraceSidecarBatch = {
    kind: "batch",
    records: sidecar.traces.map(traceToTuple),
  };
  const footer: SidTraceSidecarFooter = {
    kind: "footer",
    eventCount: sidecar.traces.length,
    batchCount: sidecar.traces.length > 0 ? 1 : 0,
  };
  const content =
    stringifySidTraceLine(header as unknown as JsonValue) +
    stringifySidTraceLine(batch as unknown as JsonValue) +
    stringifySidTraceLine(footer as unknown as JsonValue);
  await writeFile(getSidTraceSidecarPath(wavFile), content, "utf8");
}

export async function readSidTraceSidecar(wavFile: string): Promise<SidTraceSidecar | null> {
  const sidecarPath = getSidTraceSidecarPath(wavFile);
  if (!(await pathExists(sidecarPath))) {
    return null;
  }

  try {
    const stream = createReadStream(sidecarPath, { encoding: "utf8" });
    const lineReader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let header: SidTraceSidecarHeader | null = null;
    const traces: SidWriteTrace[] = [];

    for await (const rawLine of lineReader) {
      const line = rawLine.trim();
      if (line.length === 0) {
        continue;
      }
      const parsed = JSON.parse(line) as Record<string, unknown>;

      if (Array.isArray(parsed.traces)) {
        if (
          typeof parsed.clock !== "string" ||
          typeof parsed.skipSeconds !== "number" ||
          typeof parsed.analysisSeconds !== "number" ||
          (parsed.v !== undefined && parsed.v !== SID_TRACE_SIDECAR_VERSION)
        ) {
          return null;
        }
        return {
          v: SID_TRACE_SIDECAR_VERSION,
          traces: parsed.traces as SidWriteTrace[],
          clock: parsed.clock,
          skipSeconds: parsed.skipSeconds,
          analysisSeconds: parsed.analysisSeconds,
        };
      }

      if (parsed.kind === "header") {
        if (
          parsed.v !== SID_TRACE_SIDECAR_VERSION ||
          parsed.format !== "sid-trace-jsonl" ||
          typeof parsed.clock !== "string" ||
          typeof parsed.skipSeconds !== "number" ||
          typeof parsed.analysisSeconds !== "number"
        ) {
          return null;
        }
        header = parsed as unknown as SidTraceSidecarHeader;
        continue;
      }

      if (parsed.kind === "batch") {
        if (!header || !Array.isArray(parsed.records)) {
          return null;
        }
        for (const record of parsed.records) {
          if (!Array.isArray(record) || record.length !== 4) {
            return null;
          }
          traces.push(tupleToTrace(record as SidTraceTuple));
        }
        continue;
      }

      if (parsed.kind === "footer") {
        continue;
      }

      return null;
    }

    if (!header) {
      return null;
    }

    return {
      v: SID_TRACE_SIDECAR_VERSION,
      traces,
      clock: header.clock,
      skipSeconds: header.skipSeconds,
      analysisSeconds: header.analysisSeconds,
    };
  } catch (error) {
    renderLogger.debug(`Failed to read trace sidecar for ${sidecarPath}`, error instanceof Error ? error : undefined);
    return null;
  }
}

export function resolveMaxRenderSeconds(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return override;
  }
  const envValue = process.env.SIDFLOW_MAX_RENDER_SECONDS;
  if (envValue) {
    const parsed = Number.parseFloat(envValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return MAX_RENDER_SECONDS;
}

export function resolveTimeLimitSeconds(
  targetDurationMs?: number,
  override?: number
): number {
  const fallbackSeconds = resolveMaxRenderSeconds(override);

  if (
    typeof targetDurationMs === "number" &&
    Number.isFinite(targetDurationMs) &&
    targetDurationMs > 0
  ) {
    const targetSeconds = targetDurationMs / 1000;
    const clamped = Math.max(0.001, targetSeconds);
    return Math.min(clamped, fallbackSeconds);
  }

  return fallbackSeconds;
}

export async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

export function encodePcmToWav(samples: Int16Array, sampleRate: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = samples.length * 2;
  const buffer = Buffer.allocUnsafe(44 + dataSize);
  let offset = 0;

  buffer.write("RIFF", offset); offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buffer.write("WAVE", offset); offset += 4;
  buffer.write("fmt ", offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt16LE(channels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;
  buffer.write("data", offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  const pcmBytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  pcmBytes.copy(buffer, offset);

  return buffer;
}

export async function renderWavWithEngine(
  engine: SidAudioEngine,
  options: RenderWavOptions
): Promise<void> {
  const { sidFile, wavFile, songIndex } = options;
  const debugStart = Date.now();
  const emitDebugEvent = async (
    event: string,
    extra: Omit<RenderDebugEvent, "source" | "event" | "timestamp" | "elapsedMs" | "sidFile" | "wavFile" | "songIndex" | "renderProfile" | "captureTrace"> = {}
  ): Promise<void> => {
    await appendRenderDebugEvent({
      source: "wav-renderer",
      event,
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - debugStart,
      sidFile,
      wavFile,
      songIndex,
      renderProfile: options.renderProfile,
      captureTrace: options.captureTrace,
      ...extra,
    });
  };

  await ensureDir(path.dirname(wavFile));
  await emitDebugEvent("render_function_enter", {
    maxRenderSeconds: options.maxRenderSeconds,
    maxRenderWallTimeMs: options.maxRenderWallTimeMs,
    targetDurationMs: options.targetDurationMs,
  });

  // Enable trace capture BEFORE loading the buffer so the context is configured with
  // tracing on from the first cycle. getAndClearSidWriteTraces() is called after rendering.
  if (options.captureTrace) {
    await emitDebugEvent("trace_enable_start");
    engine.setSidWriteTraceEnabled(true);
    await emitDebugEvent("trace_enable_complete");
  }

  const requestedSongIndex = typeof songIndex === "number" ? Math.max(0, songIndex - 1) : 0;

  await emitDebugEvent("sid_file_read_start");
  const sidBuffer = new Uint8Array(await readFile(sidFile));
  await emitDebugEvent("sid_file_read_complete");

  await emitDebugEvent("sid_load_start");
  await engine.loadSidBuffer(sidBuffer, requestedSongIndex);
  await emitDebugEvent("sid_load_complete");

  if (typeof songIndex === "number") {
    await emitDebugEvent("song_select_inlined", {
      collectedSamples: 0,
      targetSamples: 0,
    });
  }

  const sampleRate = engine.getSampleRate();
  const channels = engine.getChannels();
  const fallbackSeconds = resolveMaxRenderSeconds(options.maxRenderSeconds);
  const maxSeconds = resolveTimeLimitSeconds(
    options.targetDurationMs,
    options.maxRenderSeconds
  );
  const maxRenderWallTimeMs =
    typeof options.maxRenderWallTimeMs === "number" && Number.isFinite(options.maxRenderWallTimeMs) && options.maxRenderWallTimeMs > 0
      ? Math.max(1000, Math.floor(options.maxRenderWallTimeMs))
      : undefined;

  if (
    typeof options.targetDurationMs === "number" &&
    Number.isFinite(options.targetDurationMs) &&
    options.targetDurationMs > 0
  ) {
    const targetSeconds = Math.max(1, options.targetDurationMs / 1000);
    if (targetSeconds > fallbackSeconds) {
      renderLogger.debug(
        `Songlength ${targetSeconds.toFixed(3)}s clamped to ${fallbackSeconds.toFixed(3)}s for ${path.basename(
          wavFile
        )}`
      );
    } else {
      renderLogger.debug(
        `Songlength target ${targetSeconds.toFixed(3)}s for ${path.basename(
          wavFile
        )}`
      );
    }
  } else {
    renderLogger.debug(
      `Using fallback render limit ${fallbackSeconds.toFixed(3)}s for ${path.basename(
        wavFile
      )}`
    );
  }

  const maxSamples = Math.max(1, Math.floor(sampleRate * channels * maxSeconds));
  const initialSamples = Math.max(
    1,
    Math.min(maxSamples, Math.floor(sampleRate * channels * Math.min(maxSeconds, 10)))
  );
  let pcm = new Int16Array(initialSamples);
  let collectedSamples = 0;
  let silentIterations = 0;
  let iterations = 0;
  let stopReason: RenderExecutionSummary["stopReason"] = "complete";
  // Calculate max iterations based on expected samples per cycle
  // At PAL clock (~985kHz) and 44.1kHz sample rate, ~20,000 cycles produces ~1,800 samples
  // Use a conservative estimate: aim for 2x the iterations needed to ensure we don't stop early
  const estimatedSamplesPerChunk = (RENDER_CYCLES_PER_CHUNK / 985_000) * sampleRate * channels;
  const maxIterations = Math.max(64, Math.ceil(maxSamples / estimatedSamplesPerChunk) * 2);

  // Progress callback support for heartbeat mechanism
  const progressIntervalMs = options.progressIntervalMs ?? 1000;
  const startTime = Date.now();
  let lastProgressTime = startTime;
  const traceSidecarPath = getSidTraceSidecarPath(wavFile);
  let traceCaptureActive = options.captureTrace === true;
  let traceHandle: Awaited<ReturnType<typeof open>> | null = null;
  let traceBatchBuffer: SidTraceTuple[] = [];
  let traceEventCount = 0;
  let traceBatchCount = 0;

  const ensurePcmCapacity = (requiredSamples: number): void => {
    if (requiredSamples <= pcm.length) {
      return;
    }

    let nextCapacity = pcm.length;
    while (nextCapacity < requiredSamples) {
      const growthTarget = nextCapacity < 65_536 ? nextCapacity * 2 : Math.ceil(nextCapacity * 1.5);
      nextCapacity = Math.min(maxSamples, Math.max(requiredSamples, growthTarget));
      if (nextCapacity === pcm.length) {
        break;
      }
    }

    const expanded = new Int16Array(nextCapacity);
    expanded.set(pcm.subarray(0, collectedSamples));
    pcm = expanded;
  };

  const closeTraceHandle = async (): Promise<void> => {
    if (!traceHandle) {
      return;
    }

    const handle = traceHandle;
    traceHandle = null;
    try {
      await handle.close();
    } catch (error) {
      renderLogger.debug(`Failed to close trace handle for ${path.basename(wavFile)}`, error instanceof Error ? error : undefined);
    }
  };

  const disableTraceCapture = async (stage: string, error: unknown): Promise<void> => {
    if (!traceCaptureActive && !traceHandle) {
      return;
    }

    const reason = error instanceof Error ? error.message : String(error);
    renderLogger.warn(
      `Trace capture disabled for ${path.basename(wavFile)} during ${stage}: ${reason}`,
      error instanceof Error ? error : undefined
    );
    traceCaptureActive = false;
    traceBatchBuffer = [];
    traceEventCount = 0;
    traceBatchCount = 0;

    try {
      engine.setSidWriteTraceEnabled(false);
    } catch (error) {
      renderLogger.debug(`Failed to disable trace engine for ${path.basename(wavFile)}`, error instanceof Error ? error : undefined);
    }

    try {
      engine.getAndClearSidWriteTraces();
    } catch (error) {
      renderLogger.debug(`Failed to drain trace buffer for ${path.basename(wavFile)}`, error instanceof Error ? error : undefined);
    }

    await closeTraceHandle();
    try {
      await rm(traceSidecarPath, { force: true });
    } catch (error) {
      renderLogger.debug(`Failed to remove partial trace sidecar for ${path.basename(wavFile)}`, error instanceof Error ? error : undefined);
    }
  };

  await emitDebugEvent("render_loop_ready", {
    collectedSamples,
    targetSamples: maxSamples,
    traceEventCount,
    traceBatchCount,
  });

  const flushTraceBatch = async (): Promise<void> => {
    if (!traceCaptureActive || !traceHandle || traceBatchBuffer.length === 0) {
      return;
    }
    const payload: SidTraceSidecarBatch = {
      kind: "batch",
      records: traceBatchBuffer,
    };
    try {
      await traceHandle.writeFile(stringifySidTraceLine(payload as unknown as JsonValue), "utf8");
      traceEventCount += traceBatchBuffer.length;
      traceBatchCount += 1;
      traceBatchBuffer = [];
    } catch (error) {
      await disableTraceCapture("batch_write", error);
    }
  };

  if (traceCaptureActive) {
    const header: SidTraceSidecarHeader = {
      kind: "header",
      v: SID_TRACE_SIDECAR_VERSION,
      format: "sid-trace-jsonl",
      clock: options.traceClock ?? "PAL",
      skipSeconds: options.traceIntroSkipSec ?? 15,
      analysisSeconds: options.traceAnalysisSec ?? 15,
    };
    try {
      traceHandle = await open(traceSidecarPath, "w");
      await traceHandle.writeFile(stringifySidTraceLine(header as unknown as JsonValue), "utf8");
    } catch (error) {
      await disableTraceCapture("initialization", error);
    }
  }
  let renderSucceeded = false;
  try {
    while (collectedSamples < maxSamples && iterations < maxIterations) {
      iterations += 1;
      if (iterations <= 3) {
        await emitDebugEvent("render_cycles_start", {
          iteration: iterations,
          collectedSamples,
          targetSamples: maxSamples,
          traceEventCount,
          traceBatchCount,
        });
      }
      const chunk = engine.renderCycles(RENDER_CYCLES_PER_CHUNK);
      if (iterations <= 3) {
        await emitDebugEvent("render_cycles_complete", {
          iteration: iterations,
          collectedSamples,
          targetSamples: maxSamples,
          chunkSamples: chunk?.length ?? null,
          traceEventCount,
          traceBatchCount,
        });
      }

      if (traceCaptureActive) {
        const traceBatch = engine.getAndClearSidWriteTraces();
        for (const trace of traceBatch) {
          traceBatchBuffer.push(traceToTuple(trace));
          if (traceCaptureActive && traceBatchBuffer.length >= TRACE_RECORD_BATCH_SIZE) {
            await flushTraceBatch();
          }
        }
      }

      if (chunk === null) {
        renderLogger.debug("Renderer returned null chunk; stopping early");
        stopReason = "null_chunk";
        break;
      }

      if (chunk.length === 0) {
        silentIterations += 1;
        if (silentIterations >= MAX_SILENT_ITERATIONS) {
          renderLogger.debug("Silent iteration limit reached; stopping");
          stopReason = "silent_limit";
          break;
        }
        continue;
      }

      silentIterations = 0;
      const allowed = Math.min(chunk.length, maxSamples - collectedSamples);
      if (allowed <= 0) {
        break;
      }

      // SidAudioEngine.renderCycles() already copies data out of the WASM
      // typed_memory_view, so the returned chunk is JS-heap-owned and stable.
      // We only need subarray() when truncating to the sample limit.
      const slice = allowed === chunk.length ? chunk : chunk.subarray(0, allowed);
      ensurePcmCapacity(collectedSamples + slice.length);
      pcm.set(slice, collectedSamples);
      collectedSamples += slice.length;

      // Call progress callback at specified intervals to support heartbeat
      const now = Date.now();
      if (options.onProgress && (now - lastProgressTime >= progressIntervalMs)) {
        lastProgressTime = now;
        options.onProgress({
          collectedSamples,
          targetSamples: maxSamples,
          percentComplete: Math.min(100, (collectedSamples / maxSamples) * 100),
          elapsedMs: now - startTime
        });
      }

      if (maxRenderWallTimeMs !== undefined && now - startTime >= maxRenderWallTimeMs) {
        stopReason = "wall_time";
        break;
      }
    }

    if (collectedSamples < maxSamples && stopReason === "complete") {
      stopReason = "max_iterations";
    }

    if (collectedSamples === 0) {
      throw new Error(`WASM renderer produced no audio for ${sidFile}`);
    }

    renderLogger.debug(`Encoding to WAV for ${path.basename(wavFile)}`);
    const wavBuffer = encodePcmToWav(
      collectedSamples === pcm.length ? pcm : pcm.subarray(0, collectedSamples),
      sampleRate,
      channels
    );
    renderLogger.debug(
      `Writing WAV file ${path.basename(wavFile)} (${wavBuffer.length} bytes)`
    );
    await writeFile(wavFile, wavBuffer);

    renderLogger.debug(`Computing hash for ${path.basename(wavFile)}`);
    const hashFile = `${wavFile}${WAV_HASH_EXTENSION}`;
    try {
      const hash = await computeFileHash(wavFile);
      await writeFile(hashFile, hash, "utf8");
    } catch (err) {
      renderLogger.warn(`Hash write failed for ${path.basename(wavFile)}`, err);
    }

    renderLogger.debug(`✓ COMPLETE for ${path.basename(wavFile)}`);
    await emitDebugEvent("wav_write_complete", {
      collectedSamples,
      targetSamples: maxSamples,
      traceEventCount,
      traceBatchCount,
    });

    // Write trace sidecar so the SID-native feature extractor can reuse these traces
    // instead of performing a second full WASM render pass for the same song.
    if (traceCaptureActive && traceHandle) {
      try {
        // Drain any events buffered after the last chunk.
        const tailBatch = engine.getAndClearSidWriteTraces();
        for (const trace of tailBatch) {
          traceBatchBuffer.push(traceToTuple(trace));
        }
        await flushTraceBatch();
        if (traceCaptureActive && traceHandle) {
          const footer: SidTraceSidecarFooter = {
            kind: "footer",
            eventCount: traceEventCount,
            batchCount: traceBatchCount,
          };
          await traceHandle.writeFile(stringifySidTraceLine(footer as unknown as JsonValue), "utf8");
        }
      } catch (error) {
        await disableTraceCapture("finalization", error);
      }
    }

    const elapsedMs = Date.now() - startTime;
    const finalStopReason = collectedSamples >= maxSamples ? "complete" : stopReason;
    await emitDebugEvent("render_function_complete", {
      collectedSamples,
      targetSamples: maxSamples,
      traceEventCount,
      traceBatchCount,
    });
    options.onSummary?.({
      collectedSamples,
      targetSamples: maxSamples,
      percentComplete: Math.min(100, (collectedSamples / maxSamples) * 100),
      elapsedMs,
      sampleRate,
      channels,
      truncated: !isNaturalRenderStopReason(finalStopReason),
      stopReason: finalStopReason,
    });
    renderSucceeded = true;
  } finally {
    await closeTraceHandle();
    if (!renderSucceeded && options.captureTrace) {
      try {
        await rm(traceSidecarPath, { force: true });
      } catch (error) {
        renderLogger.debug(`Failed to remove trace sidecar on error path for ${path.basename(wavFile)}`, error instanceof Error ? error : undefined);
      }
    }
  }
}
