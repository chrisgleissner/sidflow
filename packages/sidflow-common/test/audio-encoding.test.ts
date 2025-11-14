import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  encodeWavToM4aNative,
  encodeWavToFlacNative,
  getM4aBitrate,
  DEFAULT_M4A_BITRATE,
  DEFAULT_FLAC_COMPRESSION_LEVEL,
} from "../src/audio-encoding";
import { encodePcmToWav } from "../../sidflow-classify/src/render/wav-renderer";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const testDir = "/tmp/audio-encoding-test";
const testWavPath = path.join(testDir, "test.wav");
const testM4aPath = path.join(testDir, "test.m4a");
const testFlacPath = path.join(testDir, "test.flac");

beforeAll(async () => {
  if (!existsSync(testDir)) {
    await mkdir(testDir, { recursive: true });
  }

  // Generate a test WAV file (1 second of sine wave)
  const sampleRate = 44100;
  const channels = 2;
  const durationSeconds = 1;
  const samples = new Int16Array(sampleRate * channels * durationSeconds);

  // Generate 440 Hz sine wave
  const frequency = 440;
  for (let i = 0; i < samples.length / 2; i++) {
    const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 16384;
    samples[i * 2] = value; // left
    samples[i * 2 + 1] = value; // right
  }

  const wavBuffer = encodePcmToWav(samples, sampleRate, channels);
  await writeFile(testWavPath, wavBuffer);
});

afterAll(async () => {
  // Clean up test files
  try {
    if (existsSync(testWavPath)) await unlink(testWavPath);
    if (existsSync(testM4aPath)) await unlink(testM4aPath);
    if (existsSync(testFlacPath)) await unlink(testFlacPath);
  } catch {
    // Ignore cleanup errors
  }
});

describe("Audio Encoding", () => {
  test("encodeWavToM4aNative creates M4A file", async () => {
    const result = await encodeWavToM4aNative({
      inputPath: testWavPath,
      outputPath: testM4aPath,
      m4aBitrate: DEFAULT_M4A_BITRATE,
    });

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(testM4aPath);
    expect(existsSync(testM4aPath)).toBe(true);

    // Check file size is reasonable (should be compressed)
    const stats = await import("node:fs/promises").then((fs) =>
      fs.stat(testM4aPath)
    );
    expect(stats.size).toBeGreaterThan(0);
    expect(stats.size).toBeLessThan(100000); // Less than 100KB for 1 second
  });

  test("encodeWavToFlacNative creates FLAC file", async () => {
    const result = await encodeWavToFlacNative({
      inputPath: testWavPath,
      outputPath: testFlacPath,
      flacCompressionLevel: DEFAULT_FLAC_COMPRESSION_LEVEL,
    });

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(testFlacPath);
    expect(existsSync(testFlacPath)).toBe(true);

    // Check file size is reasonable
    const stats = await import("node:fs/promises").then((fs) =>
      fs.stat(testFlacPath)
    );
    expect(stats.size).toBeGreaterThan(0);
  });

  test("M4A file has correct bitrate", async () => {
    // First encode with known bitrate
    await encodeWavToM4aNative({
      inputPath: testWavPath,
      outputPath: testM4aPath,
      m4aBitrate: 256,
    });

    // Then check the bitrate
    const bitrate = await getM4aBitrate(testM4aPath);
    expect(bitrate).not.toBeNull();

    // Bitrate should be close to 256 kbps (allow some variance)
    if (bitrate !== null) {
      expect(bitrate).toBeGreaterThan(200);
      expect(bitrate).toBeLessThan(300);
    }
  });

  test("encodeWavToM4aNative with custom bitrate", async () => {
    const customBitrate = 128;
    const result = await encodeWavToM4aNative({
      inputPath: testWavPath,
      outputPath: testM4aPath,
      m4aBitrate: customBitrate,
    });

    expect(result.success).toBe(true);

    const bitrate = await getM4aBitrate(testM4aPath);
    if (bitrate !== null) {
      // Should be roughly 128 kbps
      expect(bitrate).toBeGreaterThan(100);
      expect(bitrate).toBeLessThan(160);
    }
  });

  test("encodeWavToFlacNative with custom compression level", async () => {
    const result = await encodeWavToFlacNative({
      inputPath: testWavPath,
      outputPath: testFlacPath,
      flacCompressionLevel: 0, // Fastest, largest
    });

    expect(result.success).toBe(true);

    const fastStats = await import("node:fs/promises").then((fs) =>
      fs.stat(testFlacPath)
    );

    // Encode with higher compression
    await encodeWavToFlacNative({
      inputPath: testWavPath,
      outputPath: testFlacPath,
      flacCompressionLevel: 8, // Slowest, smallest
    });

    const slowStats = await import("node:fs/promises").then((fs) =>
      fs.stat(testFlacPath)
    );

    // Higher compression should produce smaller file
    // (though for a 1-second sine wave the difference may be small)
    expect(slowStats.size).toBeLessThanOrEqual(fastStats.size);
  });

  test("encodeWavToM4aNative handles missing input file", async () => {
    const result = await encodeWavToM4aNative({
      inputPath: "/nonexistent/file.wav",
      outputPath: testM4aPath,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("encodeWavToFlacNative handles missing input file", async () => {
    const result = await encodeWavToFlacNative({
      inputPath: "/nonexistent/file.wav",
      outputPath: testFlacPath,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
