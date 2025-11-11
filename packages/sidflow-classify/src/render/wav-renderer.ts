import { ensureDir } from "@sidflow/common";
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
}

export const RENDER_CYCLES_PER_CHUNK = 20_000;
export const MAX_RENDER_SECONDS = 600;
export const MAX_SILENT_ITERATIONS = 32;

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
    await engine.selectSong(zeroBased);
  }

  const sampleRate = engine.getSampleRate();
  const channels = engine.getChannels();
  const maxSeconds = resolveMaxRenderSeconds(options.maxRenderSeconds);
  const maxSamples = Math.max(1, Math.floor(sampleRate * channels * maxSeconds));
  const chunks: Int16Array[] = [];

  let collectedSamples = 0;
  let silentIterations = 0;
  let iterations = 0;
  const maxIterations = Math.max(64, Math.ceil(maxSamples / RENDER_CYCLES_PER_CHUNK) * 4);

  while (collectedSamples < maxSamples && iterations < maxIterations) {
    iterations += 1;
    const chunk = engine.renderCycles(RENDER_CYCLES_PER_CHUNK);
    if (chunk === null) {
      break;
    }
    if (chunk.length === 0) {
      silentIterations += 1;
      if (silentIterations >= MAX_SILENT_ITERATIONS) {
        break;
      }
      continue;
    }

    silentIterations = 0;
    const copy = chunk.slice();
    const allowed = Math.min(copy.length, maxSamples - collectedSamples);
    if (allowed <= 0) {
      break;
    }
    const trimmed = allowed === copy.length ? copy : copy.subarray(0, allowed);
    chunks.push(trimmed);
    collectedSamples += allowed;
  }

  if (collectedSamples === 0) {
    throw new Error(`WASM renderer produced no audio for ${sidFile}`);
  }

  const pcm = new Int16Array(collectedSamples);
  let writeOffset = 0;
  for (const chunk of chunks) {
    pcm.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  const wavBuffer = encodePcmToWav(pcm, sampleRate, channels);
  await writeFile(wavFile, wavBuffer);

  const hashFile = `${wavFile}.hash`;
  try {
    const hash = await computeFileHash(sidFile);
    await writeFile(hashFile, hash, "utf8");
  } catch {
    // Hash storage is best-effort; ignore failures.
  }
}
