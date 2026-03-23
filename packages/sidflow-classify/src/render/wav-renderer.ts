import { createLogger, ensureDir, pathExists, stringifyDeterministic, type JsonValue } from "@sidflow/common";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import path from "node:path";
import type { SidAudioEngine, SidWriteTrace } from "@sidflow/libsidplayfp-wasm";

export interface RenderWavOptions {
  sidFile: string;
  wavFile: string;
  songIndex?: number;
  maxRenderSeconds?: number;
  targetDurationMs?: number;
  /** Optional progress callback - called periodically during rendering to support heartbeat */
  onProgress?: (progress: RenderProgress) => void;
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

export const RENDER_CYCLES_PER_CHUNK = 20_000;
export const MAX_RENDER_SECONDS = 600;
export const MAX_SILENT_ITERATIONS = 32;
export const WAV_HASH_EXTENSION = ".sha256";
/** Extension for the SID register-write trace sidecar captured during WAV rendering. */
export const SID_TRACE_EXTENSION = ".trace.jsonl";
export const SID_TRACE_SIDECAR_VERSION = 1;

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
  await initializeSidTraceSidecar(wavFile, {
    clock: sidecar.clock,
    skipSeconds: sidecar.skipSeconds,
    analysisSeconds: sidecar.analysisSeconds,
  });
  await appendSidTraceBatch(wavFile, sidecar.traces);
  await finalizeSidTraceSidecar(wavFile, {
    kind: "footer",
    eventCount: sidecar.traces.length,
    batchCount: sidecar.traces.length > 0 ? 1 : 0,
  });
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
  } catch {
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

  await ensureDir(path.dirname(wavFile));

  // Enable trace capture BEFORE loading the buffer so the context is configured with
  // tracing on from the first cycle. getAndClearSidWriteTraces() is called after rendering.
  if (options.captureTrace) {
    engine.setSidWriteTraceEnabled(true);
  }

  const sidBuffer = new Uint8Array(await readFile(sidFile));
  await engine.loadSidBuffer(sidBuffer);

  if (typeof songIndex === "number") {
    const zeroBased = Math.max(0, songIndex - 1);
    renderLogger.debug(
      `Selecting song index ${zeroBased} for ${path.basename(sidFile)}`
    );
    await engine.selectSong(zeroBased);
  }

  const sampleRate = engine.getSampleRate();
  const channels = engine.getChannels();
  const fallbackSeconds = resolveMaxRenderSeconds(options.maxRenderSeconds);
  const maxSeconds = resolveTimeLimitSeconds(
    options.targetDurationMs,
    options.maxRenderSeconds
  );

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
  const chunks: Int16Array[] = [];
  let collectedSamples = 0;
  let silentIterations = 0;
  let iterations = 0;
  // Calculate max iterations based on expected samples per cycle
  // At PAL clock (~985kHz) and 44.1kHz sample rate, ~20,000 cycles produces ~1,800 samples
  // Use a conservative estimate: aim for 2x the iterations needed to ensure we don't stop early
  const estimatedSamplesPerChunk = (RENDER_CYCLES_PER_CHUNK / 985_000) * sampleRate * channels;
  const maxIterations = Math.max(64, Math.ceil(maxSamples / estimatedSamplesPerChunk) * 2);

  // Progress callback support for heartbeat mechanism
  const progressIntervalMs = options.progressIntervalMs ?? 1000;
  const startTime = Date.now();
  let lastProgressTime = startTime;
  let traceEventCount = 0;
  let traceBatchCount = 0;

  if (options.captureTrace) {
    await initializeSidTraceSidecar(wavFile, {
      clock: options.traceClock ?? "PAL",
      skipSeconds: options.traceIntroSkipSec ?? 15,
      analysisSeconds: options.traceAnalysisSec ?? 15,
    });
  }

  while (collectedSamples < maxSamples && iterations < maxIterations) {
    iterations += 1;
    const chunk = engine.renderCycles(RENDER_CYCLES_PER_CHUNK);

    if (options.captureTrace) {
      const traceBatch = engine.getAndClearSidWriteTraces();
      if (traceBatch.length > 0) {
        await appendSidTraceBatch(wavFile, traceBatch);
        traceEventCount += traceBatch.length;
        traceBatchCount += 1;
      }
    }

    if (chunk === null) {
      renderLogger.debug("Renderer returned null chunk; stopping early");
      break;
    }

    if (chunk.length === 0) {
      silentIterations += 1;
      if (silentIterations >= MAX_SILENT_ITERATIONS) {
        renderLogger.debug("Silent iteration limit reached; stopping");
        break;
      }
      continue;
    }

    silentIterations = 0;
    const allowed = Math.min(chunk.length, maxSamples - collectedSamples);
    if (allowed <= 0) {
      break;
    }

    // Copy the chunk immediately: some engines return views into a reused buffer.
    // Keeping references would make earlier "chunks" mutate on later renderCycles calls.
    const slice = allowed === chunk.length ? chunk : chunk.subarray(0, allowed);
    chunks.push(slice.slice());
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
  }

  if (collectedSamples === 0) {
    throw new Error(`WASM renderer produced no audio for ${sidFile}`);
  }

  renderLogger.debug("Assembling PCM data");
  const pcm = new Int16Array(collectedSamples);
  let writeOffset = 0;
  for (const chunk of chunks) {
    pcm.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  renderLogger.debug(`Encoding to WAV for ${path.basename(wavFile)}`);
  const wavBuffer = encodePcmToWav(pcm, sampleRate, channels);
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

  // Write trace sidecar so the SID-native feature extractor can reuse these traces
  // instead of performing a second full WASM render pass for the same song.
  if (options.captureTrace) {
    try {
      const tailBatch = engine.getAndClearSidWriteTraces();
      if (tailBatch.length > 0) {
        await appendSidTraceBatch(wavFile, tailBatch);
        traceEventCount += tailBatch.length;
        traceBatchCount += 1;
      }
      await finalizeSidTraceSidecar(wavFile, {
        kind: "footer",
        eventCount: traceEventCount,
        batchCount: traceBatchCount,
      });
    } catch (err) {
      renderLogger.warn(`Trace sidecar write failed for ${path.basename(wavFile)}`, err);
    }
  }
}
