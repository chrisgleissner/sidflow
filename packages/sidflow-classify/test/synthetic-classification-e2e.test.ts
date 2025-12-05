/**
 * E2E Test: Synthetic SID Classification with Essentia.js
 * 
 * Creates synthetic SID + WAV files, runs essentia.js feature extraction,
 * writes JSONL output, and verifies the persisted files contain correct features.
 */

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { essentiaFeatureExtractor } from "../src/index.js";

const TEST_DIR = path.join(import.meta.dir, "..", "..", "..", "test-workspace", "synthetic-e2e");
const OUTPUT_JSONL = path.join(import.meta.dir, "..", "..", "..", "data", "classified", "synthetic-e2e.jsonl");

const testSongs = [
  { name: "E2E_Low", freq: 220, duration: 1 },
  { name: "E2E_Mid", freq: 440, duration: 1 },
  { name: "E2E_High", freq: 880, duration: 1 },
];

/**
 * Generate a minimal valid PSID file
 */
function createSidFile(title: string, author: string): Buffer {
  const headerSize = 124;
  const codeSize = 4;
  const buffer = Buffer.alloc(headerSize + codeSize);

  buffer.write("PSID", 0);
  buffer.writeUInt16BE(0x0002, 4);
  buffer.writeUInt16BE(headerSize, 6);
  buffer.writeUInt16BE(0x1000, 8);
  buffer.writeUInt16BE(0x1000, 10);
  buffer.writeUInt16BE(0x1003, 12);
  buffer.writeUInt16BE(0x0001, 14);
  buffer.writeUInt16BE(0x0001, 16);
  buffer.writeUInt32BE(0x00000001, 18);
  buffer.write(title.slice(0, 31), 22);
  buffer.write(author.slice(0, 31), 54);
  buffer.write("2025 E2E Test", 86);
  buffer.writeUInt16BE(0x0000, 118);
  buffer.writeUInt8(0x60, headerSize);
  buffer.writeUInt8(0x4C, headerSize + 1);
  buffer.writeUInt8(0x03, headerSize + 2);
  buffer.writeUInt8(0x10, headerSize + 3);

  return buffer;
}

/**
 * Generate a WAV file with a sine wave
 */
function createWavFile(durationSec: number, freq: number): Buffer {
  const sampleRate = 44100;
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;
  const buffer = Buffer.alloc(fileSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const value = Math.sin(2 * Math.PI * freq * t);
    buffer.writeInt16LE(Math.floor(value * 32767), 44 + i * 2);
  }

  return buffer;
}

/**
 * Setup test fixtures: create synthetic SID/WAV files and run classification
 */
async function setupTestFixtures(): Promise<void> {
  const sidDir = path.join(TEST_DIR, "sids");
  const wavDir = path.join(TEST_DIR, "wavs");
  const outputDir = path.dirname(OUTPUT_JSONL);

  await mkdir(sidDir, { recursive: true });
  await mkdir(wavDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const entries: string[] = [];

  for (const song of testSongs) {
    const sidFile = path.join(sidDir, `${song.name}.sid`);
    const wavFile = path.join(wavDir, `${song.name}.wav`);

    // Create synthetic files
    await writeFile(sidFile, createSidFile(song.name, "E2E Test"));
    await writeFile(wavFile, createWavFile(song.duration, song.freq));

    // Extract features and build JSONL entry
    const features = await essentiaFeatureExtractor({ wavFile, sidFile });
    const entry = {
      sid_path: `C64Music/MUSICIANS/E2E_Test/${song.name}.sid`,
      features,
      ratings: { e: 3, m: 3, c: 3 },
    };
    entries.push(JSON.stringify(entry));
  }

  await writeFile(OUTPUT_JSONL, entries.join("\n") + "\n");
}

describe("Synthetic SID Classification E2E", () => {
  beforeAll(async () => {
    await setupTestFixtures();
  });

  afterAll(async () => {
    // Cleanup test files
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
    if (existsSync(OUTPUT_JSONL)) {
      await rm(OUTPUT_JSONL);
    }
  });

  it("creates synthetic SID and WAV files", () => {
    const sidDir = path.join(TEST_DIR, "sids");
    const wavDir = path.join(TEST_DIR, "wavs");

    for (const song of testSongs) {
      const sidFile = path.join(sidDir, `${song.name}.sid`);
      const wavFile = path.join(wavDir, `${song.name}.wav`);

      expect(existsSync(sidFile)).toBe(true);
      expect(existsSync(wavFile)).toBe(true);
    }
  });

  it("extracts essentia.js features from synthetic WAVs", async () => {
    const sidDir = path.join(TEST_DIR, "sids");
    const wavDir = path.join(TEST_DIR, "wavs");

    for (const song of testSongs) {
      const sidFile = path.join(sidDir, `${song.name}.sid`);
      const wavFile = path.join(wavDir, `${song.name}.wav`);

      const features = await essentiaFeatureExtractor({ wavFile, sidFile });

      // Verify essentia.js-specific features exist
      expect(features.energy).toBeGreaterThan(0);
      expect(features.rms).toBeGreaterThan(0);
      expect(features.spectralCentroid).toBeGreaterThan(0);
      expect(features.spectralRolloff).toBeGreaterThan(0);
      expect(features.zeroCrossingRate).toBeGreaterThanOrEqual(0);
      expect(features.bpm).toBeGreaterThan(0);
      expect(features.duration).toBe(song.duration);
      expect(features.sampleRate).toBe(44100);
    }
  });

  it("writes classification output to JSONL file", () => {
    expect(existsSync(OUTPUT_JSONL)).toBe(true);
  });

  it("verifies persisted JSONL contains essentia.js features", async () => {
    const content = await readFile(OUTPUT_JSONL, "utf-8");
    const lines = content.trim().split("\n");

    expect(lines.length).toBe(3);

    for (let i = 0; i < lines.length; i++) {
      const entry = JSON.parse(lines[i]);
      const song = testSongs[i];

      // Verify structure
      expect(entry.sid_path).toBe(`C64Music/MUSICIANS/E2E_Test/${song.name}.sid`);
      expect(entry.features).toBeDefined();
      expect(entry.ratings).toBeDefined();

      // Verify essentia.js features are present
      const f = entry.features;
      expect(f.energy).toBeGreaterThan(0);
      expect(f.rms).toBeGreaterThan(0);
      expect(f.spectralCentroid).toBeGreaterThan(0);
      expect(f.spectralRolloff).toBeGreaterThan(0);
      expect(f.zeroCrossingRate).toBeGreaterThanOrEqual(0);
      expect(f.bpm).toBeGreaterThan(0);
      expect(f.duration).toBe(song.duration);
      expect(f.sampleRate).toBe(44100);
      expect(f.numSamples).toBeGreaterThan(0);
      expect(f.wavBytes).toBeGreaterThan(0);
      expect(f.sidBytes).toBeGreaterThan(0);

      console.log(`✅ ${song.name}: energy=${f.energy.toFixed(3)}, rms=${f.rms.toFixed(3)}, zcr=${f.zeroCrossingRate.toFixed(4)}`);
    }
  });

  it("verifies zero-crossing rate increases with frequency", async () => {
    const content = await readFile(OUTPUT_JSONL, "utf-8");
    const lines = content.trim().split("\n");
    const entries = lines.map(l => JSON.parse(l));

    const zcrLow = entries[0].features.zeroCrossingRate;
    const zcrMid = entries[1].features.zeroCrossingRate;
    const zcrHigh = entries[2].features.zeroCrossingRate;

    // Higher frequency = more zero crossings
    expect(zcrMid).toBeGreaterThan(zcrLow);
    expect(zcrHigh).toBeGreaterThan(zcrMid);

    console.log(`✅ ZCR increases with frequency: ${zcrLow.toFixed(4)} < ${zcrMid.toFixed(4)} < ${zcrHigh.toFixed(4)}`);
  });
});
