import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FeatureExtractor, FeatureVector } from "./index.js";

// Lazy-load Essentia.js modules to avoid initialization issues
let EssentiaWASM: any = null;
let Essentia: any = null;
let essentiaLoadAttempted = false;
let essentiaAvailable = false;

async function getEssentia() {
  if (!essentiaLoadAttempted) {
    essentiaLoadAttempted = true;
    try {
      const essentiaModule = await import("essentia.js");
      // The module exports objects, not classes in Node.js context
      EssentiaWASM = essentiaModule.EssentiaWASM;
      Essentia = essentiaModule.Essentia;
      essentiaAvailable = true;
    } catch (error) {
      essentiaAvailable = false;
    }
  }
  return { EssentiaWASM, Essentia, available: essentiaAvailable };
}

interface WavHeader {
  format: number;
  numChannels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataLength: number;
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

function extractAudioData(buffer: Buffer, header: WavHeader): Float32Array {
  // Find data chunk starting position
  let offset = 12;
  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === "data") {
      const dataStart = offset + 8;
      const bytesPerSample = header.bitsPerSample / 8;
      const numSamples = Math.floor(header.dataLength / (bytesPerSample * header.numChannels));
      const audioData = new Float32Array(numSamples);

      for (let i = 0; i < numSamples; i++) {
        let sum = 0;
        for (let ch = 0; ch < header.numChannels; ch++) {
          const sampleOffset = dataStart + (i * header.numChannels + ch) * bytesPerSample;
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
        // Average across channels (mix to mono)
        audioData[i] = sum / header.numChannels;
      }

      return audioData;
    }

    offset += 8 + chunkSize;
  }

  throw new Error("Invalid WAV file: data chunk not found");
}

/**
 * Essentia.js-based feature extractor.
 * Extracts audio features from WAV files using Essentia WASM.
 * Features include: tempo (BPM), energy, spectral centroid, spectral rolloff, and more.
 * 
 * Note: Essentia.js requires WASM support and may not work in all Node.js environments.
 * Falls back to basic heuristic features if Essentia.js is unavailable.
 */
export const essentiaFeatureExtractor: FeatureExtractor = async ({ wavFile, sidFile }) => {
  const { EssentiaWASM: EssentiaWASMClass, available } = await getEssentia();
  
  // If Essentia.js is not available, fall back to basic features
  if (!available || !EssentiaWASMClass) {
    return await extractBasicFeatures(wavFile, sidFile);
  }

  try {
    // Try to use Essentia.js for feature extraction
    return await extractEssentiaFeatures(wavFile, EssentiaWASMClass);
  } catch (error) {
    // If Essentia.js fails, fall back to basic features
    return await extractBasicFeatures(wavFile, sidFile);
  }
};

/**
 * Extract features using Essentia.js WASM
 */
async function extractEssentiaFeatures(wavFile: string, EssentiaWASMClass: any): Promise<FeatureVector> {
  // Initialize Essentia WASM
  const essentia = new EssentiaWASMClass();
  await essentia.initialize();

  // Read WAV file
  const wavBuffer = await readFile(wavFile);
  const header = parseWavHeader(wavBuffer);
  const audioData = extractAudioData(wavBuffer, header);

  // Convert to Essentia vector format
  const audioVector = essentia.arrayToVector(audioData);

  const features: FeatureVector = {};

  try {
    // Extract spectral features
    const spectrum = essentia.Spectrum(audioVector);
    const spectralCentroid = essentia.Centroid(spectrum);
    features.spectralCentroid = spectralCentroid;

    const spectralRolloff = essentia.RollOff(spectrum);
    features.spectralRolloff = spectralRolloff;

    // Extract energy
    const energy = essentia.Energy(audioVector);
    features.energy = energy;

    // Extract RMS (root mean square)
    const rms = essentia.RMS(audioVector);
    features.rms = rms;

    // Extract zero crossing rate
    const zcr = essentia.ZeroCrossingRate(audioVector);
    features.zeroCrossingRate = zcr;

    // Try to estimate tempo using rhythm extractor
    try {
      const rhythmResult = essentia.RhythmExtractor2013(audioVector, header.sampleRate);
      features.bpm = rhythmResult.bpm;
      features.confidence = rhythmResult.confidence;
    } catch {
      // If rhythm extraction fails, use a fallback
      features.bpm = 120; // Default BPM
      features.confidence = 0;
    }

    // Cleanup spectrum
    spectrum.delete();
  } finally {
    // Cleanup
    audioVector.delete();
  }

  // Add metadata features
  features.sampleRate = header.sampleRate;
  features.duration = audioData.length / header.sampleRate;
  features.numSamples = audioData.length;

  return features;
}

/**
 * Extract basic features without Essentia.js.
 * Provides a fallback when Essentia.js is unavailable.
 */
async function extractBasicFeatures(wavFile: string, sidFile: string): Promise<FeatureVector> {
  // Read WAV file for basic analysis
  const wavBuffer = await readFile(wavFile);
  const header = parseWavHeader(wavBuffer);
  const audioData = extractAudioData(wavBuffer, header);
  
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
    sampleRate: header.sampleRate,
    duration: audioData.length / header.sampleRate,
    numSamples: audioData.length,
    wavBytes: wavStats.size,
    sidBytes: sidStats.size,
    nameSeed: computeSeed(path.basename(sidFile))
  };
}

function computeSeed(value: string): number {
  let seed = 0;
  for (let index = 0; index < value.length; index += 1) {
    seed = (seed * 31 + value.charCodeAt(index)) % 1_000_000;
  }
  return seed;
}
