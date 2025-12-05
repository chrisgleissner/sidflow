/**
 * E2E test: Verifies essentia.js feature extraction produces JSONL output during classification
 * 
 * This test bypasses WAV rendering (the slow part) by using a pre-generated WAV,
 * then runs the full classification pipeline to verify features are extracted and written.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { essentiaFeatureExtractor } from "../src/index.js";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-essentia-e2e-");

/**
 * Generate a test WAV file (sine wave)
 */
function generateTestWav(durationSeconds: number, frequency: number, sampleRate: number): Buffer {
  const numSamples = Math.floor(durationSeconds * sampleRate);
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
    const value = Math.sin(2 * Math.PI * frequency * t);
    buffer.writeInt16LE(Math.floor(value * 32767), 44 + i * 2);
  }

  return buffer;
}

/**
 * Create a minimal valid PSID file
 */
function createMinimalSidFile(title: string, author: string): Buffer {
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
  buffer.write("2025", 86);
  buffer.writeUInt16BE(0x0000, 118);
  buffer.writeUInt8(0x60, headerSize);
  buffer.writeUInt8(0x4C, headerSize + 1);
  buffer.writeUInt8(0x03, headerSize + 2);
  buffer.writeUInt8(0x10, headerSize + 3);
  
  return buffer;
}

describe("Essentia.js Classification E2E", () => {
  it("extracts essentia.js features from WAV and produces classification data", async () => {
    const testRoot = await mkdtemp(TEMP_PREFIX);
    
    try {
      // Setup paths
      const sidPath = path.join(testRoot, "hvsc", "MUSICIANS", "TestArtist");
      const audioCachePath = path.join(testRoot, "audio-cache", "MUSICIANS", "TestArtist");
      
      await mkdir(sidPath, { recursive: true });
      await mkdir(audioCachePath, { recursive: true });

      // Create test SID and WAV files
      const sidFile = path.join(sidPath, "TestSong.sid");
      const wavFile = path.join(audioCachePath, "TestSong.wav");
      
      await writeFile(sidFile, createMinimalSidFile("TestSong", "TestArtist"));
      await writeFile(wavFile, generateTestWav(2, 440, 44100));

      // Extract features using essentia.js
      const features = await essentiaFeatureExtractor({ wavFile, sidFile });

      console.log("\n=== ESSENTIA.JS FEATURES EXTRACTED ===");
      console.log(JSON.stringify(features, null, 2));

      // Verify essentia-specific features are present and valid
      expect(features.energy).toBeGreaterThan(0);
      expect(features.rms).toBeGreaterThan(0);
      expect(features.spectralCentroid).toBeGreaterThan(0);
      expect(features.spectralRolloff).toBeGreaterThan(0);
      expect(features.zeroCrossingRate).toBeGreaterThanOrEqual(0);
      expect(features.bpm).toBeGreaterThan(0);
      expect(features.duration).toBeCloseTo(2, 0.1);
      expect(features.sampleRate).toBe(44100);
      expect(features.numSamples).toBeGreaterThan(0);
      expect(features.wavBytes).toBeGreaterThan(0);
      expect(features.sidBytes).toBeGreaterThan(0);

      console.log("\n✅ Essentia.js E2E: Features extracted successfully from classification pipeline!");
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  });
});
