/**
 * Feature Extraction Worker
 * 
 * This worker performs CPU-intensive audio feature extraction using Essentia.js.
 * By running in a separate thread, it prevents blocking the main event loop,
 * enabling heartbeat callbacks to fire regularly (every 3s) and avoiding
 * "stale thread" detection during long operations.
 * 
 * Performance optimizations:
 * 1. Essentia WASM instance is initialized once per worker and reused
 * 2. Audio is downsampled to 11025 Hz (sufficient for SID music's ~4kHz bandwidth)
 * 3. Spectrum results are reused across algorithms (MFCC, centroid, rolloff)
 * 4. Preallocated buffers avoid GC pressure in tight loops
 * 
 * These optimizations enable CI tests to run fast enough (~10s vs ~85s)
 * with heartbeat gaps staying under 5s threshold.
 */

import { parentPort } from "node:worker_threads";
import { readFile, stat } from "node:fs/promises";
import { FEATURE_SCHEMA_VERSION, loadConfig, type SidflowConfig } from "@sidflow/common";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolveRepresentativeAnalysisWindow } from "./audio-window.js";
import { estimateBpmAutocorr } from "./bpm-estimator.js";
import { ESSENTIA_FRAME_SIZE, extractEssentiaFrameSummaries } from "./essentia-frame-features.js";

// Default target sample rate for SID music analysis.
// SID output is ~4kHz effective bandwidth, so 11025 Hz captures all relevant content
// while reducing sample count by ~4x compared to 44100 Hz.
//
// Note: This can be overridden via SidflowConfig.analysisSampleRate.
const DEFAULT_TARGET_SAMPLE_RATE = 11025;

function resolveTargetSampleRate(config: SidflowConfig, inputSampleRate: number): number {
  const configured = config.analysisSampleRate ?? DEFAULT_TARGET_SAMPLE_RATE;
  if (typeof configured !== "number" || !Number.isFinite(configured)) {
    return Math.min(DEFAULT_TARGET_SAMPLE_RATE, inputSampleRate);
  }

  const rounded = Math.max(1, Math.round(configured));
  return Math.max(1, Math.min(rounded, Math.max(1, Math.round(inputSampleRate))));
}

function computeBasicStats(audioData: Float32Array): { energy: number; rms: number; zeroCrossingRate: number } {
  if (audioData.length <= 0) {
    return { energy: 0, rms: 0, zeroCrossingRate: 0 };
  }
  let sumSquares = 0;
  let zeroCrossings = 0;
  let prev = audioData[0];
  for (let i = 0; i < audioData.length; i++) {
    const s = audioData[i];
    sumSquares += s * s;
    if ((prev >= 0 && s < 0) || (prev < 0 && s >= 0)) zeroCrossings += 1;
    prev = s;
  }
  const energy = sumSquares / audioData.length;
  const rms = Math.sqrt(energy);
  const zeroCrossingRate = zeroCrossings / audioData.length;
  return { energy, rms, zeroCrossingRate };
}

// Lazy-loaded Essentia instance - initialized once per worker
let essentiaInstance: any = null;
let essentiaLoadAttempted = false;
let essentiaAvailable = false;
let essentiaLoadError: unknown = null;

// Preallocated buffers for frame processing (reused across extractions)
let frameBuffer: Float32Array | null = null;
let spectrumBuffer: Float32Array | null = null;

let cachedConfig: SidflowConfig | null = null;
let cachedConfigKey: string | undefined;

async function getWorkerConfig(configPath?: string): Promise<SidflowConfig> {
  const resolvedPath = configPath ?? process.env.SIDFLOW_CONFIG;
  const key = resolvedPath ?? "__default__";
  if (cachedConfig && cachedConfigKey === key) {
    return cachedConfig;
  }
  cachedConfig = await loadConfig(resolvedPath);
  cachedConfigKey = key;
  return cachedConfig;
}

function isAllowDegradedEnabled(): boolean {
  const value = process.env.SIDFLOW_ALLOW_DEGRADED;
  if (!value) {
    return false;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function formatUnknownError(error: unknown): string {
  if (!error) {
    return "";
  }
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function formatErrorWithCauses(error: unknown): { message: string; stack?: string } {
  const root = error instanceof Error ? error : new Error(String(error));
  const messages: string[] = [];

  let current: unknown = root;
  let depth = 0;
  while (current && depth < 5) {
    if (current instanceof Error) {
      if (current.message) {
        messages.push(current.message);
      }
      current = (current as any).cause;
    } else {
      const msg = formatUnknownError(current);
      if (msg) messages.push(msg);
      break;
    }
    depth += 1;
  }

  const message = messages.filter(Boolean).join(" | caused by: ");
  return { message: message || root.message || "Feature extraction failed", stack: root.stack };
}

interface WavHeader {
  format: number;
  numChannels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataStart: number;
  dataLength: number;
}

interface FeatureVector {
  [key: string]: number | string | undefined;
}

interface WorkerMessage {
  type: "extract";
  jobId: number;
  wavFile: string;
  sidFile: string;
  configPath?: string;
}

interface WorkerResponse {
  type: "result" | "error";
  jobId: number;
  features?: FeatureVector;
  error?: { message: string; stack?: string };
}

/**
 * Initialize Essentia WASM module - called once per worker
 */
async function initEssentia(): Promise<void> {
  if (essentiaLoadAttempted) {
    return;
  }
  essentiaLoadAttempted = true;
  
  try {
    // Bun can resolve dynamic imports relative to process.cwd().
    // Resolve relative to this worker module so it works regardless of where
    // the process was started from.
    const require = createRequire(import.meta.url);
    const resolved = require.resolve("essentia.js");
    const essentiaModule = await import(pathToFileURL(resolved).href);
    const EssentiaWASM = (essentiaModule as any).EssentiaWASM;
    const Essentia = (essentiaModule as any).Essentia;

    if (!EssentiaWASM || !Essentia) {
      throw new Error("essentia.js did not provide EssentiaWASM + Essentia exports");
    }

    // essentia.js API varies by build:
    // - Some builds expose EssentiaWASM as an already-initialized WASM module object
    // - Older builds exposed EssentiaWASM as a constructor with an initialize() method
    let wasmModule: any = EssentiaWASM;

    if (typeof EssentiaWASM === "function") {
      try {
        const maybeModule = new EssentiaWASM();
        if (typeof maybeModule?.initialize === "function") {
          await maybeModule.initialize();
        }
        wasmModule = maybeModule;
      } catch {
        // Fall back: treat EssentiaWASM as module object if construction fails
        wasmModule = EssentiaWASM;
      }
    }

    // Essentia is the class constructor that wraps the WASM module.
    essentiaInstance = new Essentia(wasmModule);
    essentiaAvailable = true;
  } catch (error) {
    essentiaLoadError = error;
    essentiaAvailable = false;
    console.error("[FeatureWorker] Failed to initialize Essentia:", error);
    if (!isAllowDegradedEnabled()) {
      const detail = formatUnknownError(error);
      const suffix = detail ? ` Details: ${detail}` : "";
      throw new Error(
        "Essentia.js feature extraction is required but failed to initialize in worker. " +
          "Set SIDFLOW_ALLOW_DEGRADED=1 (or pass --allow-degraded) to permit heuristic fallback." +
          suffix
      );
    }
  }
}

/**
 * Parse WAV file header to extract audio metadata
 */
function parseWavHeader(buffer: Buffer): WavHeader {
  const riff = buffer.toString("ascii", 0, 4);
  if (riff !== "RIFF") {
    throw new Error("Invalid WAV file: missing RIFF header");
  }

  const wave = buffer.toString("ascii", 8, 12);
  if (wave !== "WAVE") {
    throw new Error("Invalid WAV file: missing WAVE format");
  }

  let offset = 12;
  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === "fmt ") {
      const format = buffer.readUInt16LE(offset + 8);
      const numChannels = buffer.readUInt16LE(offset + 10);
      const sampleRate = buffer.readUInt32LE(offset + 12);
      const byteRate = buffer.readUInt32LE(offset + 16);
      const blockAlign = buffer.readUInt16LE(offset + 20);
      const bitsPerSample = buffer.readUInt16LE(offset + 22);

      let dataOffset = offset + 8 + chunkSize;
      while (dataOffset < buffer.length - 8) {
        const dataChunkId = buffer.toString("ascii", dataOffset, dataOffset + 4);
        const dataChunkSize = buffer.readUInt32LE(dataOffset + 4);

        if (dataChunkId === "data") {
          return {
            format,
            numChannels,
            sampleRate,
            byteRate,
            blockAlign,
            bitsPerSample,
            dataStart: dataOffset + 8,
            dataLength: dataChunkSize
          };
        }
        dataOffset += 8 + dataChunkSize;
      }
      throw new Error("Invalid WAV file: missing data chunk");
    }
    offset += 8 + chunkSize;
  }
  throw new Error("Invalid WAV file: missing fmt chunk");
}

/**
 * Extract and preprocess audio data from WAV buffer.
 * - Converts stereo to mono
 * - Downsamples to TARGET_SAMPLE_RATE for faster processing
 * - Uses efficient TypedArray operations
 */
async function extractAndDownsampleAudio(
  buffer: Buffer,
  header: WavHeader,
  config: SidflowConfig
): Promise<{
  audioData: Float32Array;
  analysisStartSec: number;
  analysisWindowSec: number;
  analysisSampleRate: number;
  wavDurationSec: number;
}> {
  const bytesPerSample = header.bitsPerSample / 8;
  const totalSamples = header.dataLength / (bytesPerSample * header.numChannels);
  const wavDurationSec = totalSamples / header.sampleRate;
  const dataEnd = header.dataStart + header.dataLength;
  if (header.dataStart <= 0 || header.dataStart >= buffer.length) {
    throw new Error("Invalid WAV file: invalid data chunk offset");
  }
  if (header.dataLength <= 0 || dataEnd > buffer.length) {
    throw new Error("Invalid WAV file: invalid data chunk length");
  }

  const maxExtractSec = config.maxClassifySec ?? 15;
  const introSkipSec = config.introSkipSec ?? 30;

  const window = resolveRepresentativeAnalysisWindow(buffer, header, maxExtractSec, introSkipSec);

  const targetSampleRate = resolveTargetSampleRate(config, header.sampleRate);

  const ratio = header.sampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.floor(window.sampleCount / ratio));
  const audioData = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = window.startSample + Math.floor(i * ratio);
    let sum = 0;

    for (let ch = 0; ch < header.numChannels; ch++) {
      const sampleOffset = header.dataStart + (srcIndex * header.numChannels + ch) * bytesPerSample;
      let sample = 0;

      if (header.bitsPerSample === 16) {
        sample = buffer.readInt16LE(sampleOffset) / 32768.0;
      } else if (header.bitsPerSample === 32) {
        sample = buffer.readInt32LE(sampleOffset) / 2147483648.0;
      } else if (header.bitsPerSample === 8) {
        sample = (buffer.readUInt8(sampleOffset) - 128) / 128.0;
      }
      sum += sample;
    }
    audioData[i] = sum / header.numChannels;
  }

  return {
    audioData,
    wavDurationSec,
    analysisStartSec: window.startSec,
    analysisWindowSec: audioData.length / targetSampleRate,
    analysisSampleRate: targetSampleRate,
  };
}

/**
 * Extract features using optimized Essentia.js pipeline.
 * - Reuses single Essentia instance
 * - Computes Spectrum once and reuses for downstream algorithms
 * - Avoids intermediate allocations
 */
async function extractFeatures(
  wavFile: string,
  sidFile: string,
  configPath?: string
): Promise<FeatureVector> {
  const config = await getWorkerConfig(configPath);
  if (!essentiaAvailable || !essentiaInstance) {
    if (isAllowDegradedEnabled()) {
      return extractBasicFeatures(wavFile, sidFile, config);
    }
    const detail = formatUnknownError(essentiaLoadError);
    const suffix = detail ? ` Details: ${detail}` : "";
    throw new Error(
      "Essentia.js feature extraction is required but was not available in worker. " +
        "Set SIDFLOW_ALLOW_DEGRADED=1 (or pass --allow-degraded) to permit heuristic fallback." +
        suffix
    );
  }

  try {
    const wavBuffer = await readFile(wavFile);
    const sidStats = await stat(sidFile);
    const header = parseWavHeader(wavBuffer);
    const { audioData, analysisStartSec, analysisSampleRate, analysisWindowSec, wavDurationSec } =
      await extractAndDownsampleAudio(wavBuffer, header, config);
    const fullNumSamples = Math.max(1, Math.round(wavDurationSec * analysisSampleRate));

    if (!frameBuffer || frameBuffer.length !== ESSENTIA_FRAME_SIZE) {
      frameBuffer = new Float32Array(ESSENTIA_FRAME_SIZE);
    }

    const features: FeatureVector = {};

    const basic = computeBasicStats(audioData);
    features.energy = basic.energy;
    features.rms = basic.rms;
    features.zeroCrossingRate = basic.zeroCrossingRate;

    const frameSummaries = extractEssentiaFrameSummaries(essentiaInstance, audioData, analysisSampleRate, {
      frame: frameBuffer,
    });
    for (const [k, v] of Object.entries(frameSummaries)) {
      features[k] = v;
    }

    const bpmEstimate = estimateBpmAutocorr(audioData, analysisSampleRate);
    if (bpmEstimate && bpmEstimate.confidence >= 0.15 && Number.isFinite(bpmEstimate.bpm)) {
      features.bpm = bpmEstimate.bpm;
      features.confidence = bpmEstimate.confidence;
      features.bpmMethod = bpmEstimate.method;
    } else {
      const z = basic.zeroCrossingRate;
      const estimatedBpm = Math.min(200, Math.max(60, z * 5000));
      features.bpm = estimatedBpm;
      features.confidence = 0.2;
      features.bpmMethod = "zcr";
    }

    // Add metadata
    features.wavBytes = wavBuffer.byteLength;
    features.sidBytes = sidStats.size;
    features.sampleRate = header.sampleRate;
    features.analysisSampleRate = analysisSampleRate;
    features.duration = wavDurationSec;
    features.analysisWindowSec = analysisWindowSec;
    features.analysisStartSec = analysisStartSec;
    features.numSamples = fullNumSamples;
    features.featureSetVersion = FEATURE_SCHEMA_VERSION;
    features.featureVariant = "essentia";

    return features;
  } catch (error) {
    if (isAllowDegradedEnabled()) {
      return extractBasicFeatures(wavFile, sidFile, config);
    }

    const detail = formatUnknownError(error);
    const suffix = detail ? ` Details: ${detail}` : "";
    throw new Error(
      `Essentia.js feature extraction failed for ${wavFile}. ` +
        "Set SIDFLOW_ALLOW_DEGRADED=1 (or pass --allow-degraded) to permit heuristic fallback." +
        suffix,
      { cause: error as Error }
    );
  }
}

/**
 * Fallback basic feature extraction when Essentia is unavailable
 */
async function extractBasicFeatures(
  wavFile: string,
  sidFile: string,
  config: SidflowConfig
): Promise<FeatureVector> {
  const wavBuffer = await readFile(wavFile);
  const sidStats = await stat(sidFile);
  const header = parseWavHeader(wavBuffer);
  const { audioData, analysisStartSec, analysisWindowSec, analysisSampleRate, wavDurationSec } =
    await extractAndDownsampleAudio(wavBuffer, header, config);
  const fullNumSamples = Math.max(1, Math.round(wavDurationSec * analysisSampleRate));

  let sumSquares = 0;
  let zeroCrossings = 0;
  let prevSample = audioData[0];

  for (let i = 0; i < audioData.length; i++) {
    const sample = audioData[i];
    sumSquares += sample * sample;
    if ((prevSample >= 0 && sample < 0) || (prevSample < 0 && sample >= 0)) {
      zeroCrossings++;
    }
    prevSample = sample;
  }
  const rms = Math.sqrt(sumSquares / audioData.length);
  const energy = sumSquares / audioData.length;
  const zeroCrossingRate = zeroCrossings / audioData.length;
  const estimatedBpm = Math.min(200, Math.max(60, zeroCrossingRate * 5000));

  return {
    energy,
    rms,
    zeroCrossingRate,
    bpm: estimatedBpm,
    confidence: 0.3,
    spectralCentroid: 2000,
    spectralRolloff: 4000,
    sampleRate: header.sampleRate,
    analysisSampleRate,
    duration: wavDurationSec,
    analysisWindowSec: analysisWindowSec,
    analysisStartSec,
    numSamples: fullNumSamples,
    featureSetVersion: FEATURE_SCHEMA_VERSION,
    featureVariant: "heuristic",
    wavBytes: wavBuffer.byteLength,
    sidBytes: sidStats.size,
  };
}

/**
 * Handle incoming extraction requests
 */
async function handleExtract(
  jobId: number,
  wavFile: string,
  sidFile: string,
  configPath?: string
): Promise<void> {
  try {
    // Ensure Essentia is initialized (once per worker)
    await initEssentia();
    
    const features = await extractFeatures(wavFile, sidFile, configPath);
    const response: WorkerResponse = { type: "result", jobId, features };
    parentPort!.postMessage(response);
  } catch (error) {
    const err = formatErrorWithCauses(error);
    const response: WorkerResponse = {
      type: "error",
      jobId,
      error: { message: err.message, stack: err.stack }
    };
    parentPort!.postMessage(response);
  }
}

// Verify we're running as a worker
if (!parentPort) {
  throw new Error("Feature extraction worker must be started as a worker thread");
}

// Handle incoming messages
parentPort.on("message", (message: WorkerMessage) => {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "extract") {
    void handleExtract(message.jobId, message.wavFile, message.sidFile, message.configPath);
  }
});
