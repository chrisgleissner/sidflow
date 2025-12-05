import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { essentiaFeatureExtractor } from "@sidflow/classify";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-essentia-");

/**
 * Generate a simple WAV file for testing.
 * Creates a mono 16-bit PCM WAV with a sine wave.
 */
function generateTestWav(durationSeconds: number, frequency: number, sampleRate: number): Buffer {
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const dataSize = numSamples * 2; // 16-bit samples
  const fileSize = 44 + dataSize;

  const buffer = Buffer.alloc(fileSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24); // sample rate
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data chunk header
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Generate sine wave samples
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const value = Math.sin(2 * Math.PI * frequency * t);
    const sample = Math.floor(value * 32767);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  return buffer;
}

describe("essentiaFeatureExtractor", () => {
  it("extracts features from a valid WAV file", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const wavFile = path.join(root, "test.wav");
    const sidFile = path.join(root, "test.sid");

    // Generate a 2-second sine wave at 440 Hz (A4 note)
    const wavData = generateTestWav(2, 440, 44100);
    await writeFile(wavFile, wavData);
    await writeFile(sidFile, Buffer.from("dummy sid data"));

    const features = await essentiaFeatureExtractor({
      wavFile,
      sidFile
    });
    console.log("Extracted features:", JSON.stringify(features, null, 2));

    // Verify that key features are present
    expect(features).toBeDefined();
    expect(typeof features.energy).toBe("number");
    expect(typeof features.rms).toBe("number");
    expect(typeof features.spectralCentroid).toBe("number");
    expect(typeof features.spectralRolloff).toBe("number");
    expect(typeof features.zeroCrossingRate).toBe("number");
    expect(typeof features.sampleRate).toBe("number");
    expect(typeof features.duration).toBe("number");
    expect(typeof features.numSamples).toBe("number");

    // Verify reasonable values
    expect(features.energy).toBeGreaterThan(0);
    expect(features.rms).toBeGreaterThan(0);
    expect(features.spectralCentroid).toBeGreaterThan(0);
    expect(features.sampleRate).toBe(44100);
    expect(features.duration).toBeCloseTo(2, 0.1);
    // numSamples reflects downsampled count (11025 Hz from 44100 Hz = 4x reduction)
    expect(features.numSamples).toBe(22050);

    await rm(root, { recursive: true, force: true });
  });

  it("handles stereo WAV files", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const wavFile = path.join(root, "stereo.wav");
    const sidFile = path.join(root, "stereo.sid");

    // Generate a stereo WAV file
    const sampleRate = 44100;
    const durationSeconds = 1;
    const numSamples = Math.floor(durationSeconds * sampleRate);
    const dataSize = numSamples * 2 * 2; // 16-bit, stereo
    const fileSize = 44 + dataSize;

    const buffer = Buffer.alloc(fileSize);

    // RIFF header
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(fileSize - 8, 4);
    buffer.write("WAVE", 8);

    // fmt chunk
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(2, 22); // stereo
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 4, 28);
    buffer.writeUInt16LE(4, 32);
    buffer.writeUInt16LE(16, 34);

    // data chunk
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Generate stereo samples
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const valueL = Math.sin(2 * Math.PI * 440 * t);
      const valueR = Math.sin(2 * Math.PI * 880 * t);
      buffer.writeInt16LE(Math.floor(valueL * 32767), 44 + i * 4);
      buffer.writeInt16LE(Math.floor(valueR * 32767), 44 + i * 4 + 2);
    }

    await writeFile(wavFile, buffer);
    await writeFile(sidFile, Buffer.from("dummy sid data"));

    const features = await essentiaFeatureExtractor({
      wavFile,
      sidFile
    });

    expect(features).toBeDefined();
    expect(features.sampleRate).toBe(44100);
    expect(features.duration).toBeCloseTo(1, 0.1);
    expect(features.energy).toBeGreaterThan(0);

    await rm(root, { recursive: true, force: true });
  });

  it("throws error for invalid WAV file", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const wavFile = path.join(root, "invalid.wav");

    // Write invalid data
    await writeFile(wavFile, Buffer.from("not a wav file"));

    await expect(
      essentiaFeatureExtractor({
        wavFile,
        sidFile: path.join(root, "invalid.sid")
      })
    ).rejects.toThrow();

    await rm(root, { recursive: true, force: true });
  });

  it("handles 32-bit WAV files", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const wavFile = path.join(root, "test32.wav");
    const sidFile = path.join(root, "test32.sid");

    // Generate a 32-bit WAV file
    const sampleRate = 44100;
    const durationSeconds = 1;
    const numSamples = Math.floor(durationSeconds * sampleRate);
    const dataSize = numSamples * 4; // 32-bit samples
    const fileSize = 44 + dataSize;

    const buffer = Buffer.alloc(fileSize);

    // RIFF header
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(fileSize - 8, 4);
    buffer.write("WAVE", 8);

    // fmt chunk
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 4, 28);
    buffer.writeUInt16LE(4, 32);
    buffer.writeUInt16LE(32, 34); // 32 bits per sample

    // data chunk
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Generate samples
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const value = Math.sin(2 * Math.PI * 440 * t);
      const sample = Math.floor(value * 2147483647);
      buffer.writeInt32LE(sample, 44 + i * 4);
    }

    await writeFile(wavFile, buffer);
    await writeFile(sidFile, Buffer.from("dummy sid data"));

    const features = await essentiaFeatureExtractor({
      wavFile,
      sidFile
    });

    expect(features).toBeDefined();
    expect(features.energy).toBeGreaterThan(0);

    await rm(root, { recursive: true, force: true });
  });

  it("handles 8-bit WAV files", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const wavFile = path.join(root, "test8.wav");
    const sidFile = path.join(root, "test8.sid");

    // Generate an 8-bit WAV file
    const sampleRate = 44100;
    const durationSeconds = 1;
    const numSamples = Math.floor(durationSeconds * sampleRate);
    const dataSize = numSamples; // 8-bit samples
    const fileSize = 44 + dataSize;

    const buffer = Buffer.alloc(fileSize);

    // RIFF header
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(fileSize - 8, 4);
    buffer.write("WAVE", 8);

    // fmt chunk
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate, 28);
    buffer.writeUInt16LE(1, 32);
    buffer.writeUInt16LE(8, 34); // 8 bits per sample

    // data chunk
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Generate samples
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const value = Math.sin(2 * Math.PI * 440 * t);
      const sample = Math.floor(value * 127) + 128;
      buffer.writeUInt8(sample, 44 + i);
    }

    await writeFile(wavFile, buffer);
    await writeFile(sidFile, Buffer.from("dummy sid data"));

    const features = await essentiaFeatureExtractor({
      wavFile,
      sidFile
    });

    expect(features).toBeDefined();
    expect(features.energy).toBeGreaterThan(0);

    await rm(root, { recursive: true, force: true });
  });
});
