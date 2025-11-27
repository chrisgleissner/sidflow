import { createLogger, ensureDir } from "@sidflow/common";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SidAudioEngine } from "@sidflow/libsidplayfp-wasm";

export interface RenderWavOptions {
  sidFile: string;
  wavFile: string;
  songIndex?: number;
  maxRenderSeconds?: number;
  targetDurationMs?: number;
}

export const RENDER_CYCLES_PER_CHUNK = 20_000;
export const MAX_RENDER_SECONDS = 600;
export const MAX_SILENT_ITERATIONS = 32;
export const WAV_HASH_EXTENSION = ".sha256";
const SONG_LENGTH_PADDING_SECONDS = 2;

const renderLogger = createLogger("renderWav");

function resolveMaxRenderSeconds(override?: number): number {
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

  let maxSeconds = fallbackSeconds;
  if (
    typeof options.targetDurationMs === "number" &&
    Number.isFinite(options.targetDurationMs) &&
    options.targetDurationMs > 0
  ) {
    const paddedSeconds = Math.max(
      1,
      options.targetDurationMs / 1000 + SONG_LENGTH_PADDING_SECONDS
    );
    if (paddedSeconds > fallbackSeconds) {
      renderLogger.debug(
        `Songlength ${paddedSeconds.toFixed(3)}s clamped to ${fallbackSeconds.toFixed(3)}s for ${path.basename(
          wavFile
        )}`
      );
    } else {
      renderLogger.debug(
        `Songlength target ${paddedSeconds.toFixed(3)}s for ${path.basename(
          wavFile
        )}`
      );
      maxSeconds = paddedSeconds;
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

  while (collectedSamples < maxSamples && iterations < maxIterations) {
    iterations += 1;
    const chunk = engine.renderCycles(RENDER_CYCLES_PER_CHUNK);

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

    const slice = allowed === chunk.length ? chunk : chunk.subarray(0, allowed);
    chunks.push(slice);
    collectedSamples += slice.length;
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
    const hash = await computeFileHash(sidFile);
    await writeFile(hashFile, hash, "utf8");
  } catch (err) {
    renderLogger.warn(`Hash write failed for ${path.basename(wavFile)}`, err);
  }

  renderLogger.debug(`✓ COMPLETE for ${path.basename(wavFile)}`);
}
