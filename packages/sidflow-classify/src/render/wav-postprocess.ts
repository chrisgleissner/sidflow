import { promises as fs } from "node:fs";
import { validateWavHeader } from "../essentia-features.js";
import { resolveRepresentativeAnalysisWindow } from "../audio-window.js";

function computeThresholdRaw(bitsPerSample: number, thresholdNormalized: number): number {
  if (bitsPerSample === 16) {
    return Math.max(1, Math.floor(thresholdNormalized * 32768));
  }
  if (bitsPerSample === 32) {
    return Math.max(1, Math.floor(thresholdNormalized * 2147483648));
  }
  if (bitsPerSample === 8) {
    return Math.max(1, Math.floor(thresholdNormalized * 128));
  }
  return 0;
}

export function trimLeadingSilenceWavBuffer(
  buffer: Buffer,
  options?: {
    maxTrimSeconds?: number;
    threshold?: number;
  }
): Buffer {
  const validation = validateWavHeader(buffer);
  if (!validation.valid || !validation.header) {
    return buffer;
  }

  const header = validation.header;
  const bytesPerSample = header.bitsPerSample / 8;
  const bytesPerFrame = bytesPerSample * Math.max(1, header.numChannels);
  if (!Number.isFinite(bytesPerFrame) || bytesPerFrame <= 0) {
    return buffer;
  }

  const totalSamples = Math.floor(header.dataLength / bytesPerFrame);
  if (totalSamples <= 0) {
    return buffer;
  }

  const maxTrimSeconds = options?.maxTrimSeconds ?? 2;
  if (!Number.isFinite(maxTrimSeconds) || maxTrimSeconds <= 0) {
    return buffer;
  }

  const thresholdNormalized = options?.threshold ?? 1e-4;
  const thresholdRaw = computeThresholdRaw(header.bitsPerSample, thresholdNormalized);
  if (thresholdRaw <= 0) {
    return buffer;
  }

  const maxScanSamples = Math.min(totalSamples, Math.max(1, Math.floor(header.sampleRate * maxTrimSeconds)));
  const dataEnd = header.dataStart + header.dataLength;

  let firstNonSilentSample = 0;
  let found = false;

  for (let sample = 0; sample < maxScanSamples; sample += 1) {
    const frameOffset = header.dataStart + sample * bytesPerFrame;
    if (frameOffset + bytesPerFrame > dataEnd) {
      break;
    }

    for (let ch = 0; ch < header.numChannels; ch += 1) {
      const off = frameOffset + ch * bytesPerSample;
      let absRaw = 0;
      if (header.bitsPerSample === 16) {
        absRaw = Math.abs(buffer.readInt16LE(off));
      } else if (header.bitsPerSample === 32) {
        absRaw = Math.abs(buffer.readInt32LE(off));
      } else if (header.bitsPerSample === 8) {
        absRaw = Math.abs(buffer.readUInt8(off) - 128);
      } else {
        return buffer;
      }

      if (absRaw > thresholdRaw) {
        firstNonSilentSample = sample;
        found = true;
        break;
      }
    }

    if (found) {
      break;
    }
  }

  if (!found || firstNonSilentSample <= 0) {
    return buffer;
  }

  const startByteOffset = header.dataStart + firstNonSilentSample * bytesPerFrame;
  const newDataLength = Math.max(0, dataEnd - startByteOffset);

  if (newDataLength <= 0) {
    return buffer;
  }

  const sliced = Buffer.concat([
    buffer.subarray(0, header.dataStart),
    buffer.subarray(startByteOffset, dataEnd),
  ]);

  // Patch RIFF chunk size at offset 4: fileSize - 8
  sliced.writeUInt32LE(sliced.length - 8, 4);
  // Patch data chunk size: 4 bytes immediately before dataStart.
  sliced.writeUInt32LE(newDataLength, header.dataStart - 4);

  return sliced;
}

export async function trimLeadingSilenceWavFile(
  wavPath: string,
  options?: {
    maxTrimSeconds?: number;
    threshold?: number;
  }
): Promise<{ readonly trimmed: boolean; readonly bytesRemoved: number }>
{
  const original = await fs.readFile(wavPath);
  const trimmedBuffer = trimLeadingSilenceWavBuffer(original, options);
  if (trimmedBuffer === original || trimmedBuffer.length === original.length) {
    return { trimmed: false, bytesRemoved: 0 };
  }

  await fs.writeFile(wavPath, trimmedBuffer);
  return { trimmed: true, bytesRemoved: Math.max(0, original.length - trimmedBuffer.length) };
}

function sliceWavBufferFromStartSample(
  buffer: Buffer,
  startSample: number
): { readonly buffer: Buffer; readonly bytesRemoved: number } {
  const validation = validateWavHeader(buffer);
  if (!validation.valid || !validation.header) {
    return { buffer, bytesRemoved: 0 };
  }

  const header = validation.header;
  const bytesPerSample = header.bitsPerSample / 8;
  const bytesPerFrame = bytesPerSample * Math.max(1, header.numChannels);
  if (!Number.isFinite(bytesPerFrame) || bytesPerFrame <= 0) {
    return { buffer, bytesRemoved: 0 };
  }

  const totalSamples = Math.floor(header.dataLength / bytesPerFrame);
  if (totalSamples <= 0) {
    return { buffer, bytesRemoved: 0 };
  }

  const clampedStartSample = Math.max(0, Math.min(totalSamples - 1, Math.floor(startSample)));
  if (clampedStartSample <= 0) {
    return { buffer, bytesRemoved: 0 };
  }

  const dataEnd = header.dataStart + header.dataLength;
  const startByteOffset = header.dataStart + clampedStartSample * bytesPerFrame;
  if (startByteOffset <= header.dataStart || startByteOffset >= dataEnd) {
    return { buffer, bytesRemoved: 0 };
  }

  const newDataLength = Math.max(0, dataEnd - startByteOffset);
  if (newDataLength <= 0) {
    return { buffer, bytesRemoved: 0 };
  }

  const sliced = Buffer.concat([
    buffer.subarray(0, header.dataStart),
    buffer.subarray(startByteOffset, dataEnd),
  ]);

  // Patch RIFF chunk size at offset 4: fileSize - 8
  sliced.writeUInt32LE(sliced.length - 8, 4);
  // Patch data chunk size: 4 bytes immediately before dataStart.
  sliced.writeUInt32LE(newDataLength, header.dataStart - 4);

  return { buffer: sliced, bytesRemoved: Math.max(0, buffer.length - sliced.length) };
}

export function sliceWavBufferToRepresentativeStart(
  buffer: Buffer,
  options: {
    readonly maxWindowSeconds: number;
    readonly introSkipSec?: number;
  }
): { readonly buffer: Buffer; readonly startSec: number; readonly bytesRemoved: number } {
  const maxWindowSeconds = options.maxWindowSeconds;
  if (!Number.isFinite(maxWindowSeconds) || maxWindowSeconds <= 0) {
    return { buffer, startSec: 0, bytesRemoved: 0 };
  }

  const validation = validateWavHeader(buffer);
  if (!validation.valid || !validation.header) {
    return { buffer, startSec: 0, bytesRemoved: 0 };
  }

  const header = validation.header;
  const window = resolveRepresentativeAnalysisWindow(
    buffer,
    {
      numChannels: header.numChannels,
      sampleRate: header.sampleRate,
      bitsPerSample: header.bitsPerSample,
      dataStart: header.dataStart,
      dataLength: header.dataLength,
    },
    maxWindowSeconds,
    options.introSkipSec
  );

  if (!Number.isFinite(window.startSample) || window.startSample <= 0) {
    return { buffer, startSec: 0, bytesRemoved: 0 };
  }

  const sliced = sliceWavBufferFromStartSample(buffer, window.startSample);
  return { buffer: sliced.buffer, startSec: window.startSec, bytesRemoved: sliced.bytesRemoved };
}

export async function sliceWavFileToRepresentativeStart(
  wavPath: string,
  options: {
    readonly maxWindowSeconds: number;
    readonly introSkipSec?: number;
  }
): Promise<{ readonly sliced: boolean; readonly startSec: number; readonly bytesRemoved: number }> {
  const original = await fs.readFile(wavPath);
  const result = sliceWavBufferToRepresentativeStart(original, options);
  if (result.buffer === original || result.buffer.length === original.length) {
    return { sliced: false, startSec: 0, bytesRemoved: 0 };
  }

  await fs.writeFile(wavPath, result.buffer);
  return { sliced: true, startSec: result.startSec, bytesRemoved: result.bytesRemoved };
}
