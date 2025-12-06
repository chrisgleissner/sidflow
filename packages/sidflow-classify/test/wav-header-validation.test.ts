/**
 * Unit tests for WAV header validation
 */

import { describe, test, expect } from "bun:test";
import { validateWavHeader } from "../src/essentia-features.js";

/**
 * Generate a valid WAV file header for testing
 */
function generateValidWavHeader(options: {
  format?: number;
  channels?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  dataLength?: number;
} = {}): Buffer {
  const format = options.format ?? 1; // PCM
  const channels = options.channels ?? 1; // Mono
  const sampleRate = options.sampleRate ?? 44100;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const dataLength = options.dataLength ?? 44100 * 2; // 1 second of mono 16-bit audio

  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const fileSize = 36 + dataLength;

  const buffer = Buffer.alloc(44 + dataLength);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(fileSize, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(format, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);

  return buffer;
}

describe("WAV Header Validation", () => {
  test("validates valid mono 16-bit PCM WAV", () => {
    const buffer = generateValidWavHeader({ channels: 1, bitsPerSample: 16 });
    const result = validateWavHeader(buffer);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.header).toBeDefined();
    expect(result.header?.numChannels).toBe(1);
    expect(result.header?.bitsPerSample).toBe(16);
    expect(result.header?.format).toBe(1);
  });

  test("validates valid stereo 16-bit PCM WAV", () => {
    const buffer = generateValidWavHeader({ channels: 2, bitsPerSample: 16 });
    const result = validateWavHeader(buffer);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.header?.numChannels).toBe(2);
  });

  test("validates 8-bit PCM WAV", () => {
    const buffer = generateValidWavHeader({ bitsPerSample: 8 });
    const result = validateWavHeader(buffer);

    expect(result.valid).toBe(true);
    expect(result.header?.bitsPerSample).toBe(8);
  });

  test("validates 32-bit PCM WAV", () => {
    const buffer = generateValidWavHeader({ bitsPerSample: 32 });
    const result = validateWavHeader(buffer);

    expect(result.valid).toBe(true);
    expect(result.header?.bitsPerSample).toBe(32);
  });

  test("rejects non-PCM format", () => {
    const buffer = generateValidWavHeader({ format: 3 }); // IEEE float
    const result = validateWavHeader(buffer);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("format"))).toBe(true);
  });

  test("rejects unsupported channel count", () => {
    const buffer = generateValidWavHeader({ channels: 6 }); // 5.1 surround
    const result = validateWavHeader(buffer);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("channel"))).toBe(true);
  });

  test("rejects zero channels", () => {
    const buffer = generateValidWavHeader({ channels: 0 });
    const result = validateWavHeader(buffer);

    expect(result.valid).toBe(false);
  });

  test("warns about unusual sample rate (low)", () => {
    const buffer = generateValidWavHeader({ sampleRate: 4000 });
    const result = validateWavHeader(buffer);

    expect(result.warnings.some(w => w.includes("sample rate"))).toBe(true);
  });

  test("warns about unusual sample rate (high)", () => {
    const buffer = generateValidWavHeader({ sampleRate: 200000 });
    const result = validateWavHeader(buffer);

    expect(result.warnings.some(w => w.includes("sample rate"))).toBe(true);
  });

  test("rejects unsupported bits per sample", () => {
    const buffer = generateValidWavHeader({ bitsPerSample: 12 });
    const result = validateWavHeader(buffer);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("bits per sample"))).toBe(true);
  });

  test("rejects empty audio data", () => {
    const buffer = generateValidWavHeader({ dataLength: 0 });
    const result = validateWavHeader(buffer);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes("empty") || e.toLowerCase().includes("data"))).toBe(true);
  });

  test("warns about very short audio", () => {
    // 0.05 seconds of audio at 44100 Hz
    const buffer = generateValidWavHeader({ dataLength: Math.floor(44100 * 0.05 * 2) });
    const result = validateWavHeader(buffer);

    expect(result.warnings.some(w => w.includes("short"))).toBe(true);
  });

  test("rejects missing RIFF header", () => {
    const buffer = Buffer.from("INVALID DATA");
    const result = validateWavHeader(buffer);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("RIFF"))).toBe(true);
  });

  test("rejects missing WAVE format", () => {
    const buffer = Buffer.alloc(44);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36, 4);
    buffer.write("XXXX", 8); // Invalid format

    const result = validateWavHeader(buffer);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("WAVE"))).toBe(true);
  });

  test("handles standard sample rates", () => {
    const standardRates = [8000, 11025, 22050, 44100, 48000, 96000];

    for (const rate of standardRates) {
      const buffer = generateValidWavHeader({ sampleRate: rate });
      const result = validateWavHeader(buffer);

      expect(result.valid).toBe(true);
      expect(result.header?.sampleRate).toBe(rate);
    }
  });
});
