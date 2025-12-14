import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FeatureExtractor, FeatureVector } from "./index.js";
import { FEATURE_SCHEMA_VERSION, loadConfig } from "@sidflow/common";
import { resolveRepresentativeAnalysisWindow } from "./audio-window.js";

/**
 * Configuration for audio preprocessing.
 * SID music has an effective bandwidth of ~4kHz, so 11025 Hz sample rate
 * captures all relevant audio content while reducing processing time by ~4x.
 */
export const FEATURE_EXTRACTION_SAMPLE_RATE = 11025;

// Lazy-load Essentia.js modules to avoid initialization issues
let EssentiaWASM: any = null;
let Essentia: any = null;
let essentiaLoadAttempted = false;
let essentiaAvailable = false;
let essentiaInstance: any = null; // Cached Essentia instance for reuse

// Flag to control whether to use worker pool (disabled due to ESM/CJS compatibility issues)
let useWorkerPool = false;

/**
 * Enable or disable worker pool for feature extraction.
 * Note: Worker pool is disabled by default due to ESM/CJS compatibility issues
 * with essentia.js module loading in worker threads.
 */
export function setUseWorkerPool(enable: boolean): void {
  useWorkerPool = enable;
}

/**
 * Check if Essentia.js is available in the current environment.
 * Call early in the pipeline to fail fast if Essentia is required but unavailable.
 * 
 * @param requireEssentia - If true, throw an error if Essentia is unavailable
 * @returns true if Essentia is available, false otherwise
 * @throws Error if requireEssentia is true and Essentia is unavailable
 */
export async function checkEssentiaAvailability(requireEssentia = false): Promise<boolean> {
  const { available } = await getEssentia();
  
  if (!available && requireEssentia) {
    throw new Error(
      "Essentia.js is required but not available. " +
      "Install essentia.js: npm install essentia.js@0.1.3 " +
      "or run with --allow-degraded to use heuristic features."
    );
  }
  
  return available;
}

/**
 * Get Essentia availability status synchronously after initialization.
 * Only valid after at least one feature extraction call or explicit check.
 */
export function isEssentiaAvailable(): boolean {
  return essentiaAvailable;
}

async function getEssentia() {
  if (!essentiaLoadAttempted) {
    essentiaLoadAttempted = true;
    try {
      const essentiaModule = await import("essentia.js");
      // EssentiaWASM is the already-initialized WASM module
      // Essentia is a class constructor that takes the WASM module
      EssentiaWASM = essentiaModule.EssentiaWASM;
      Essentia = essentiaModule.Essentia;
      essentiaAvailable = true;
    } catch (error) {
      essentiaAvailable = false;
    }
  }
  return { EssentiaWASM, Essentia, available: essentiaAvailable };
}

/**
 * Get or create a cached Essentia instance.
 * Reusing the instance avoids expensive WASM module re-initialization on every call.
 * 
 * Usage: new Essentia(EssentiaWASM) creates an instance that provides methods like
 * RMS(), Spectrum(), Centroid(), etc.
 */
async function getEssentiaInstance(): Promise<any | null> {
  if (essentiaInstance) {
    return essentiaInstance;
  }
  const { EssentiaWASM: wasmModule, Essentia: EssentiaClass, available } = await getEssentia();
  if (!available || !wasmModule || !EssentiaClass) {
    return null;
  }
  try {
    // Essentia class constructor takes the WASM module as argument
    essentiaInstance = new EssentiaClass(wasmModule);
    return essentiaInstance;
  } catch (error) {
    console.warn("[essentiaFeatureExtractor] Failed to initialize Essentia:", error);
    return null;
  }
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

/**
 * Validation result for WAV header.
 */
export interface WavHeaderValidation {
  valid: boolean;
  header?: WavHeader;
  errors: string[];
  warnings: string[];
}

/**
 * Validate WAV header for feature extraction compatibility.
 * 
 * Requirements:
 * - PCM format (format = 1)
 * - 1-2 channels (mono/stereo)
 * - 8000-192000 Hz sample rate
 * - 8, 16, 24, or 32 bits per sample
 * - Non-zero data length
 */
export function validateWavHeader(buffer: Buffer): WavHeaderValidation {
  const result: WavHeaderValidation = {
    valid: true,
    errors: [],
    warnings: [],
  };

  try {
    const header = parseWavHeader(buffer);
    result.header = header;

    // Validate PCM format
    if (header.format !== 1) {
      result.errors.push(`Unsupported audio format: ${header.format} (expected PCM = 1)`);
      result.valid = false;
    }

    // Validate channels
    if (header.numChannels < 1 || header.numChannels > 2) {
      result.errors.push(`Unsupported channel count: ${header.numChannels} (expected 1 or 2)`);
      result.valid = false;
    }

    // Validate sample rate
    if (header.sampleRate < 8000 || header.sampleRate > 192000) {
      result.warnings.push(`Unusual sample rate: ${header.sampleRate} Hz`);
    }

    // Validate bits per sample
    if (![8, 16, 24, 32].includes(header.bitsPerSample)) {
      result.errors.push(`Unsupported bits per sample: ${header.bitsPerSample}`);
      result.valid = false;
    }

    // Validate data length
    if (header.dataLength === 0) {
      result.errors.push("Empty audio data");
      result.valid = false;
    }

    // Calculate expected duration
    const bytesPerSample = header.bitsPerSample / 8;
    const totalSamples = header.dataLength / (bytesPerSample * header.numChannels);
    const durationSeconds = totalSamples / header.sampleRate;

    if (durationSeconds < 0.1) {
      result.warnings.push(`Very short audio: ${durationSeconds.toFixed(3)} seconds`);
    }

    if (durationSeconds > 3600) {
      result.warnings.push(`Very long audio: ${durationSeconds.toFixed(0)} seconds`);
    }

  } catch (error) {
    result.valid = false;
    result.errors.push((error as Error).message);
  }

  return result;
}

function parseWavHeader(buffer: Buffer): WavHeader {
  // Verify RIFF header
  const riff = buffer.toString("ascii", 0, 4);
  if (riff !== "RIFF") {
    throw new Error("Invalid WAV file: missing RIFF header");
  }

  // Verify WAVE format
  const wave = buffer.toString("ascii", 8, 12);
  if (wave !== "WAVE") {
    throw new Error("Invalid WAV file: missing WAVE format");
  }

  // Find fmt chunk
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

      // Find data chunk
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
 * Essentia.js-based feature extractor.
 * Extracts audio features from WAV files using Essentia WASM.
 * Features include: tempo (BPM), energy, spectral centroid, spectral rolloff, and more.
 * 
 * Performance optimizations:
 * 1. Essentia WASM instance is cached and reused across calls
 * 2. Audio is downsampled to 11025 Hz (sufficient for SID's ~4kHz bandwidth)
 * 3. Spectrum results are computed once and reused for centroid/rolloff
 * 
 * Note: Essentia.js requires WASM support and may not work in all Node.js environments.
 * Falls back to basic heuristic features if Essentia.js is unavailable.
 */
export const essentiaFeatureExtractor: FeatureExtractor = async ({ wavFile, sidFile }) => {
  // Get or create cached Essentia instance
  const essentia = await getEssentiaInstance();
  
  // If Essentia.js is not available, fall back to basic features
  if (!essentia) {
    return await extractBasicFeatures(wavFile, sidFile);
  }

  try {
    return await extractEssentiaFeaturesOptimized(wavFile, essentia);
  } catch (error) {
    // If Essentia.js fails, fall back to basic features
    return await extractBasicFeatures(wavFile, sidFile);
  }
};

/**
 * Extract and downsample audio data from WAV buffer.
 * Reduces to FEATURE_EXTRACTION_SAMPLE_RATE for faster processing.
 */
async function extractAndDownsampleAudio(
  buffer: Buffer,
  header: WavHeader
): Promise<{
  audioData: Float32Array;
  originalSampleRate: number;
  analysisStartSec: number;
  analysisWindowSec: number;
}> {
  const bytesPerSample = header.bitsPerSample / 8;
  const dataEnd = header.dataStart + header.dataLength;
  if (header.dataStart <= 0 || header.dataStart >= buffer.length) {
    throw new Error("Invalid WAV file: invalid data chunk offset");
  }
  if (header.dataLength <= 0 || dataEnd > buffer.length) {
    throw new Error("Invalid WAV file: invalid data chunk length");
  }

  const config = await loadConfig(process.env.SIDFLOW_CONFIG);
  const maxExtractSec = config.maxClassifySec ?? 10;
  const introSkipSec = config.introSkipSec ?? 10;

  const window = resolveRepresentativeAnalysisWindow(buffer, header, maxExtractSec, introSkipSec);

  const ratio = header.sampleRate / FEATURE_EXTRACTION_SAMPLE_RATE;
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
    originalSampleRate: header.sampleRate,
    analysisStartSec: window.startSec,
    analysisWindowSec: audioData.length / FEATURE_EXTRACTION_SAMPLE_RATE,
  };
}

/**
 * Extract features using optimized Essentia.js pipeline.
 * Uses cached instance, downsampling, and spectrum reuse.
 */
async function extractEssentiaFeaturesOptimized(wavFile: string, essentia: any): Promise<FeatureVector> {
  // Read WAV file
  const wavBuffer = await readFile(wavFile);
  const header = parseWavHeader(wavBuffer);
  const { audioData, originalSampleRate, analysisStartSec, analysisWindowSec } = await extractAndDownsampleAudio(wavBuffer, header);

  // Convert to Essentia vector format
  const audioVector = essentia.arrayToVector(audioData);

  const features: FeatureVector = {};

  try {
    // Compute Spectrum once - reused by centroid and rolloff
    const spectrum = essentia.Spectrum(audioVector);
    
    // Extract spectral features from shared spectrum
    const spectralCentroid = essentia.Centroid(spectrum);
    features.spectralCentroid = spectralCentroid;

    const spectralRolloff = essentia.RollOff(spectrum);
    features.spectralRolloff = spectralRolloff;

    // Energy and RMS from audio directly
    const energy = essentia.Energy(audioVector);
    features.energy = energy;

    const rms = essentia.RMS(audioVector);
    features.rms = rms;

    const zcr = essentia.ZeroCrossingRate(audioVector);
    features.zeroCrossingRate = zcr;

    // RhythmExtractor2013 is intentionally not used here (too expensive for batch runs).
    // Use a lightweight BPM estimate derived from zero-crossing rate instead.
    const estimatedBpm = Math.min(200, Math.max(60, zcr * 5000));
    features.bpm = estimatedBpm;
    features.confidence = 0.5; // Medium confidence for heuristic

    // Cleanup spectrum
    spectrum.delete();
  } finally {
    audioVector.delete();
  }

  // Add metadata - use original sample rate for display but actual samples processed
  features.sampleRate = originalSampleRate;
  features.analysisSampleRate = FEATURE_EXTRACTION_SAMPLE_RATE;
  features.duration = analysisWindowSec;
  features.analysisWindowSec = analysisWindowSec;
  features.analysisStartSec = analysisStartSec;
  features.numSamples = audioData.length;
  features.featureSetVersion = FEATURE_SCHEMA_VERSION;
  features.featureVariant = "essentia";

  return features;
}

/**
 * Extract basic features without Essentia.js.
 * Provides a fallback when Essentia.js is unavailable.
 * Uses downsampling for faster processing.
 */
async function extractBasicFeatures(wavFile: string, sidFile: string): Promise<FeatureVector> {
  try {
    // Read WAV file for basic analysis
    const wavBuffer = await readFile(wavFile);
    const header = parseWavHeader(wavBuffer);
    // Use downsampled audio for faster processing
    const { audioData, originalSampleRate, analysisStartSec, analysisWindowSec } = await extractAndDownsampleAudio(wavBuffer, header);
    
    // Get file stats
    const [wavStats, sidStats] = await Promise.all([
      stat(wavFile),
      stat(sidFile)
    ]);

    // Calculate basic features
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

    // Estimate tempo from zero crossing rate (rough heuristic)
    const estimatedBpm = Math.min(200, Math.max(60, zeroCrossingRate * 5000));

    return {
      energy,
      rms,
      zeroCrossingRate,
      bpm: estimatedBpm,
      confidence: 0.3, // Low confidence for heuristic
      spectralCentroid: 2000, // Placeholder
      spectralRolloff: 4000, // Placeholder
      sampleRate: originalSampleRate,
      analysisSampleRate: FEATURE_EXTRACTION_SAMPLE_RATE,
      duration: analysisWindowSec,
      analysisWindowSec: analysisWindowSec,
      analysisStartSec,
      numSamples: audioData.length,
      featureSetVersion: FEATURE_SCHEMA_VERSION,
      featureVariant: "heuristic",
      wavBytes: wavStats.size,
      sidBytes: sidStats.size,
      nameSeed: computeSeed(path.basename(sidFile))
    };
  } catch (error) {
    // If basic feature extraction fails, re-throw with context
    throw new Error(`Failed to extract basic features from ${wavFile}: ${(error as Error).message}`, {
      cause: error as Error
    });
  }
}

function computeSeed(value: string): number {
  let seed = 0;
  for (let index = 0; index < value.length; index += 1) {
    seed = (seed * 31 + value.charCodeAt(index)) % 1_000_000;
  }
  return seed;
}
