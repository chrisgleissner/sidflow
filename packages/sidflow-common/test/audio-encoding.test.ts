import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  encodeWavToM4aNative,
  encodeWavToM4aWasm,
  encodeWavToFlacNative,
  getM4aBitrate,
  isNativeFfmpegAvailable,
  DEFAULT_M4A_BITRATE,
  DEFAULT_FLAC_COMPRESSION_LEVEL,
} from "../src/audio-encoding";
import { encodePcmToWav } from "../../sidflow-classify/src/render/wav-renderer";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const testDir = path.join(tmpdir(), "sidflow-audio-encoding-test");
const testWavPath = path.join(testDir, "test.wav");
const testM4aPath = path.join(testDir, "test.m4a");
const testM4aWasmPath = path.join(testDir, "test-wasm.m4a");
const testFlacPath = path.join(testDir, "test.flac");

let ffmpegAvailable = false;

beforeAll(async () => {
  ffmpegAvailable = await isNativeFfmpegAvailable();
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
    if (existsSync(testWavPath)) {
      await unlink(testWavPath);
    }
    if (existsSync(testM4aPath)) {
      await unlink(testM4aPath);
    }
    if (existsSync(testM4aWasmPath)) {
      await unlink(testM4aWasmPath);
    }
    if (existsSync(testFlacPath)) {
      await unlink(testFlacPath);
    }
  } catch {
    // Ignore cleanup errors
  }
});

describe("Audio Encoding", () => {
  const testOrSkip = (name: string, fn: () => Promise<void>) =>
    ffmpegAvailable ? test(name, fn) : test.skip(name, fn);

  testOrSkip("encodeWavToM4aNative creates M4A file", async () => {
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

  testOrSkip("encodeWavToFlacNative creates FLAC file", async () => {
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

  testOrSkip("encodeWavToM4aNative uses default 256 kbps when unspecified", async () => {
    await encodeWavToM4aNative({
      inputPath: testWavPath,
      outputPath: testM4aPath,
    });

    const bitrate = await getM4aBitrate(testM4aPath);
    expect(bitrate).not.toBeNull();

    if (bitrate !== null) {
      expect(Math.abs(bitrate - DEFAULT_M4A_BITRATE)).toBeLessThanOrEqual(40);
    }
  });

  test.skip("encodeWavToM4aWasm matches default 256 kbps output", async () => {
    // Skipped: ffmpeg.wasm has compatibility issues with Bun runtime
    // TODO: Re-enable when ffmpeg.wasm Bun support is improved or use Node.js for wasm tests
    const result = await encodeWavToM4aWasm({
      inputPath: testWavPath,
      outputPath: testM4aWasmPath,
    });

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(testM4aWasmPath);
    expect(existsSync(testM4aWasmPath)).toBe(true);

    const bitrate = await getM4aBitrate(testM4aWasmPath);
    expect(bitrate).not.toBeNull();

    if (bitrate !== null) {
      expect(Math.abs(bitrate - DEFAULT_M4A_BITRATE)).toBeLessThanOrEqual(40);
    }
  });

  testOrSkip("encodeWavToM4aNative with custom bitrate", async () => {
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

  testOrSkip("encodeWavToFlacNative with custom compression level", async () => {
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
