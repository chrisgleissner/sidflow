/**
 * Integration test for Essentia.js feature extraction in classification pipeline
 * Verifies that classification uses Essentia.js by default and produces rich audio features
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  planClassification,
  generateAutoTags,
  type ClassificationPlan,
  resolveWavPath,
} from "../src/index.js";
import { parseSidFile, type SidflowConfig, resolveRelativeSidPath } from "@sidflow/common";
import { computeFileHash, WAV_HASH_EXTENSION } from "../src/render/wav-renderer.js";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-essentia-integration-");

/**
 * Create a minimal test SID file (Real 64 Commodore format)
 * This is a valid SID file with minimal data for testing
 */
function createMinimalSidFile(): Buffer {
  const headerSize = 124;
  const codeSize = 4; // Minimal 6502 code
  const buffer = Buffer.alloc(headerSize + codeSize);
  
  // Magic ID
  buffer.write("PSID", 0);
  
  // Version (0x0002 for PSID v2)
  buffer.writeUInt16BE(0x0002, 4);
  
  // Data offset (0x007C = 124 bytes header)
  buffer.writeUInt16BE(headerSize, 6);
  
  // Load address (0x1000)
  buffer.writeUInt16BE(0x1000, 8);
  
  // Init address (0x1000)
  buffer.writeUInt16BE(0x1000, 10);
  
  // Play address (0x1003)
  buffer.writeUInt16BE(0x1003, 12);
  
  // Songs (1)
  buffer.writeUInt16BE(0x0001, 14);
  
  // Start song (1)
  buffer.writeUInt16BE(0x0001, 16);
  
  // Speed (PAL)
  buffer.writeUInt32BE(0x00000001, 18);
  
  // Title
  buffer.write("Test Track", 22);
  
  // Author
  buffer.write("Test Author", 54);
  
  // Released
  buffer.write("2025", 86);
  
  // Flags (MUS player, built-in player, PAL, SID 6581)
  buffer.writeUInt16BE(0x0000, 118);
  
  // Add minimal 6502 code (RTS at $1000, infinite loop at $1003)
  buffer.writeUInt8(0x60, headerSize); // RTS at init
  buffer.writeUInt8(0x4C, headerSize + 1); // JMP
  buffer.writeUInt8(0x03, headerSize + 2); // $1003 (low byte)
  buffer.writeUInt8(0x10, headerSize + 3); // $1003 (high byte)
  
  return buffer;
}

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

describe("Essentia.js integration in classification", () => {
  it("uses Essentia.js feature extractor as default", async () => {
    // This test verifies that the default feature extractor is Essentia.js
    // The actual extraction is tested in essentia-features.test.ts
    const { defaultFeatureExtractor, essentiaFeatureExtractor } = await import("../src/index.js");
    
    expect(defaultFeatureExtractor).toBe(essentiaFeatureExtractor);
  });

  it("uses Essentia.js by default and extracts audio features", async () => {
    const testRoot = await mkdtemp(TEMP_PREFIX);
    
    try {
      // Setup test SID collection
      const sidPath = path.join(testRoot, "hvsc");
      const audioCachePath = path.join(testRoot, "audio-cache");
      const tagsPath = path.join(testRoot, "tags");
      const classifiedPath = path.join(testRoot, "classified");
      
      // Create minimal SID file
      const sidFile = path.join(sidPath, "C64Music", "MUSICIANS", "T", "Test", "test_track.sid");
      await require("node:fs/promises").mkdir(path.dirname(sidFile), { recursive: true });
      await require("node:fs/promises").writeFile(sidFile, createMinimalSidFile());
      
      // Verify SID file is parseable
      const metadata = await parseSidFile(sidFile);
      expect(metadata.title).toBe("Test Track");
      
      const config: SidflowConfig = {
        sidPath,
        audioCachePath,
        tagsPath,
        classifiedPath,
        threads: 1,
        classificationDepth: 3,
      };
      const configPath = path.join(testRoot, ".sidflow.test.json");
      await require("node:fs/promises").writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
      const plan: ClassificationPlan = await planClassification({ configPath });

      // Pre-render a small WAV so classification doesn't invoke the renderer.
      const wavPath = resolveWavPath(plan, sidFile);
      await require("node:fs/promises").mkdir(path.dirname(wavPath), { recursive: true });
      await require("node:fs/promises").writeFile(wavPath, createWavFile(1, 440));
      // If the SID mtime changes (or clocks are coarse), needsWavRefresh may rebuild unless a hash exists.
      const hashPath = `${wavPath}${WAV_HASH_EXTENSION}`;
      await require("node:fs/promises").writeFile(hashPath, await computeFileHash(sidFile), "utf8");
      
      // Run classification (ensure defaultRenderWav reads the same config if invoked).
      const previousConfigEnv = process.env.SIDFLOW_CONFIG;
      process.env.SIDFLOW_CONFIG = configPath;
      const result = await generateAutoTags(plan, {
        threads: 1,
        limit: 1,
      }).finally(() => {
        process.env.SIDFLOW_CONFIG = previousConfigEnv;
      });
      
      // Verify auto-tags were generated
      expect(result.autoTagged.length).toBeGreaterThan(0);
      expect(result.metrics.autoTaggedCount).toBeGreaterThan(0);
      
      // Read the generated auto-tags file (path is returned by generateAutoTags)
      expect(result.tagFiles.length).toBeGreaterThan(0);
      const autoTagsPath = result.tagFiles[0]!;
      
      const autoTagsContent = await readFile(autoTagsPath, "utf-8");
      const autoTags = JSON.parse(autoTagsContent);
      
      const relativeSidPath = resolveRelativeSidPath(plan.sidPath, sidFile);
      const matchingKey = Object.keys(autoTags).find((key) => key.includes(path.basename(relativeSidPath)));
      expect(matchingKey).toBeDefined();
      const entry = autoTags[matchingKey!];
      
      // Verify ratings were generated
      expect(entry.e).toBeGreaterThanOrEqual(1);
      expect(entry.e).toBeLessThanOrEqual(5);
      expect(entry.m).toBeGreaterThanOrEqual(1);
      expect(entry.m).toBeLessThanOrEqual(5);
      expect(entry.c).toBeGreaterThanOrEqual(1);
      expect(entry.c).toBeLessThanOrEqual(5);
      
      // Verify features were extracted via JSONL record (auto-tags.json stores only ratings + source).
      const jsonlContent = await readFile(result.jsonlFile, "utf8");
      const jsonlLines = jsonlContent.trim().split("\n").filter((line) => line.trim());
      expect(jsonlLines.length).toBeGreaterThan(0);
      const record = jsonlLines
        .map((line) => {
          try {
            return JSON.parse(line) as any;
          } catch {
            return null;
          }
        })
        .find((line) => line && String(line.sid_path).includes(path.basename(relativeSidPath)));
      expect(record).toBeDefined();
      expect(record!.features).toBeDefined();
      expect(record!.features.energy).toBeGreaterThanOrEqual(0);
      expect(record!.features.rms).toBeGreaterThanOrEqual(0);
      expect(record!.features.spectralCentroid).toBeGreaterThan(0);
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  }, 30000);
});
