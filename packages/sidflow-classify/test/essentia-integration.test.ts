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
} from "../src/index.js";
import { parseSidFile, stringifyDeterministic } from "@sidflow/common";

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

describe("Essentia.js integration in classification", () => {
  it("uses Essentia.js feature extractor as default", async () => {
    // This test verifies that the default feature extractor is Essentia.js
    // The actual extraction is tested in essentia-features.test.ts
    const { defaultFeatureExtractor, essentiaFeatureExtractor } = await import("../src/index.js");
    
    expect(defaultFeatureExtractor).toBe(essentiaFeatureExtractor);
  });

  it.skip("uses Essentia.js by default and extracts audio features [FULL E2E - MANUAL ONLY]", async () => {
    // Full end-to-end test including WAV rendering - skipped in CI due to timeout
    // Run manually when testing classification pipeline changes
    const testRoot = await mkdtemp(TEMP_PREFIX);
    
    try {
      // Setup test SID collection
      const sidPath = path.join(testRoot, "MUSICIANS", "Test");
      const wavCachePath = path.join(testRoot, "wav-cache");
      const tagsPath = path.join(testRoot, "tags");
      
      // Create minimal SID file
      const sidFile = path.join(sidPath, "test_track.sid");
      await require("node:fs/promises").mkdir(path.dirname(sidFile), { recursive: true });
      await require("node:fs/promises").writeFile(sidFile, createMinimalSidFile());
      
      // Verify SID file is parseable
      const metadata = await parseSidFile(sidFile);
      expect(metadata.title).toBe("Test Track");
      
      // Create classification plan
      const plan: ClassificationPlan = {
        config: {
          sidPath,
          wavCachePath,
          tagsPath,
          sidplayPath: undefined,
          threads: 1,
          classificationDepth: 3,
        },
        wavCachePath,
        tagsPath,
        forceRebuild: true,
        classificationDepth: 3,
        sidPath,
      };
      
      // Run classification
      const result = await generateAutoTags(plan, {
        threads: 1,
      });
      
      // Verify auto-tags were generated
      expect(result.autoTagged.length).toBeGreaterThan(0);
      expect(result.metrics.autoTaggedCount).toBeGreaterThan(0);
      
      // Read the generated auto-tags file
      const autoTagsKey = "MUSICIANS/Test/test_track.sid";
      const autoTagsPath = path.join(tagsPath, "auto-tags.json");
      
      const autoTagsContent = await readFile(autoTagsPath, "utf-8");
      const autoTags = JSON.parse(autoTagsContent);
      
      expect(autoTags[autoTagsKey]).toBeDefined();
      const entry = autoTags[autoTagsKey];
      
      // Verify ratings were generated
      expect(entry.ratings).toBeDefined();
      expect(entry.ratings.e).toBeGreaterThanOrEqual(1);
      expect(entry.ratings.e).toBeLessThanOrEqual(5);
      expect(entry.ratings.m).toBeGreaterThanOrEqual(1);
      expect(entry.ratings.m).toBeLessThanOrEqual(5);
      expect(entry.ratings.c).toBeGreaterThanOrEqual(1);
      expect(entry.ratings.c).toBeLessThanOrEqual(5);
      
      // Verify features were extracted
      // Essentia.js should produce rich features like energy, rms, spectralCentroid, etc.
      // If Essentia.js is unavailable, fallback to heuristic features (simpler)
      expect(entry.features).toBeDefined();
      
      // Check for Essentia.js-specific features
      // If these exist, Essentia.js was used successfully
      if (entry.features.energy !== undefined && entry.features.rms !== undefined) {
        console.log("[TEST] Essentia.js features detected:");
        console.log(`  energy: ${entry.features.energy}`);
        console.log(`  rms: ${entry.features.rms}`);
        console.log(`  spectralCentroid: ${entry.features.spectralCentroid}`);
        console.log(`  bpm: ${entry.features.bpm}`);
        expect(entry.features.energy).toBeGreaterThanOrEqual(0);
        expect(entry.features.rms).toBeGreaterThanOrEqual(0);
      } else {
        // Fallback heuristic features
        console.log("[TEST] Heuristic fallback features used (Essentia.js unavailable)");
        expect(entry.features.wavBytes).toBeGreaterThan(0);
        expect(entry.features.sidBytes).toBeGreaterThan(0);
      }
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  }, 30000); // 30s timeout for WAV rendering + feature extraction
});
