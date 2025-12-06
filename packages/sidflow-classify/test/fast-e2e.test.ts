/**
 * Fast Classification Pipeline E2E Test
 * 
 * Tests the complete classification workflow with pre-generated WAV files
 * to ensure fast execution (<10s target).
 * 
 * Validates:
 * - JSONL ordering is deterministic
 * - Features include required metadata
 * - Ratings are within valid ranges
 * - No duplicate records
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateAutoTags, type ClassificationPlan } from "../src/index.js";
import { FEATURE_SCHEMA_VERSION, type ClassificationRecord } from "@sidflow/common";
import type { SidflowConfig } from "@sidflow/common";

/**
 * Generate a minimal valid WAV file for testing (mono, 16-bit, 44100Hz).
 * Creates a short sine wave tone.
 */
function generateTestWav(durationSeconds: number, frequency: number, sampleRate = 44100): Buffer {
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample
  const fileSize = 44 + dataSize;

  const buffer = Buffer.alloc(fileSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write("WAVE", 8);
  
  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  
  // data chunk
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

/**
 * Generate a minimal valid SID file header for testing.
 * This creates a parseable SID file structure without actual music data.
 */
function generateTestSid(title: string, author: string): Buffer {
  const buffer = Buffer.alloc(124);
  
  // PSID header
  buffer.write("PSID", 0);
  buffer.writeUInt16BE(0x0002, 4); // version
  buffer.writeUInt16BE(0x007C, 6); // data offset (124)
  buffer.writeUInt16BE(0x1000, 8); // load address
  buffer.writeUInt16BE(0x1000, 10); // init address
  buffer.writeUInt16BE(0x1003, 12); // play address
  buffer.writeUInt16BE(1, 14); // songs
  buffer.writeUInt16BE(1, 16); // start song
  buffer.writeUInt32BE(0, 18); // speed
  
  // Title, author, released (32 bytes each)
  buffer.write(title.padEnd(32, "\0"), 22);
  buffer.write(author.padEnd(32, "\0"), 54);
  buffer.write("2024 Test".padEnd(32, "\0"), 86);
  
  return buffer;
}

describe("Fast Classification Pipeline E2E", () => {
  let tempDir: string;
  let sidPath: string;
  let audioCachePath: string;
  let tagsPath: string;
  let classifiedPath: string;

  beforeAll(async () => {
    // Create temporary workspace
    tempDir = await mkdtemp(join(tmpdir(), "sidflow-fast-e2e-"));
    sidPath = join(tempDir, "hvsc");
    audioCachePath = join(tempDir, "audio-cache");
    tagsPath = join(tempDir, "tags");
    classifiedPath = join(tempDir, "classified");

    // Create directory structure
    await mkdir(join(sidPath, "MUSICIANS", "TestArtist"), { recursive: true });
    await mkdir(join(audioCachePath, "MUSICIANS", "TestArtist"), { recursive: true });
    await mkdir(tagsPath, { recursive: true });
    await mkdir(classifiedPath, { recursive: true });

    // Create test SID files with pre-rendered WAV files
    const testFiles = [
      { name: "song1.sid", freq: 440 },
      { name: "song2.sid", freq: 880 },
      { name: "song3.sid", freq: 660 },
    ];

    for (const { name, freq } of testFiles) {
      const sidFile = join(sidPath, "MUSICIANS", "TestArtist", name);
      const wavFile = join(audioCachePath, "MUSICIANS", "TestArtist", name.replace(".sid", ".wav"));
      
      // Write test SID
      await writeFile(sidFile, generateTestSid(`Test Song ${freq}`, "TestArtist"));
      
      // Write pre-rendered WAV (short 1-second clip for speed)
      await writeFile(wavFile, generateTestWav(1, freq));
    }
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("classifies pre-rendered WAV files in under 10 seconds", async () => {
    const startTime = performance.now();

    // Create classification plan
    const plan: ClassificationPlan = {
      config: {
        sidPath,
        audioCachePath,
        tagsPath,
        classifiedPath,
        threads: 1,
        classificationDepth: 3,
      } as SidflowConfig,
      audioCachePath,
      tagsPath,
      forceRebuild: false, // Use pre-rendered WAVs
      classificationDepth: 3,
      sidPath,
    };

    // Run classification
    const result = await generateAutoTags(plan, {
      threads: 1,
    });

    const elapsed = performance.now() - startTime;

    // Performance assertion: must complete in under 10 seconds
    expect(elapsed).toBeLessThan(10000);
    console.log(`Classification completed in ${(elapsed / 1000).toFixed(2)}s`);

    // Verify output
    expect(result.jsonlRecordCount).toBe(3);
    expect(result.autoTagged.length).toBe(3);
    expect(result.tagFiles.length).toBeGreaterThan(0);
  });

  test("JSONL output has valid schema and metadata", async () => {
    // Read the most recent JSONL file
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(classifiedPath);
    const jsonlFiles = files.filter(f => f.endsWith(".jsonl"));
    expect(jsonlFiles.length).toBeGreaterThan(0);

    const jsonlFile = join(classifiedPath, jsonlFiles[0]);
    const content = await readFile(jsonlFile, "utf8");
    const lines = content.split("\n").filter(line => line.trim().length > 0);

    expect(lines.length).toBe(3);

    const seenPaths = new Set<string>();

    for (const line of lines) {
      const record = JSON.parse(line) as ClassificationRecord;

      // Validate sid_path
      expect(typeof record.sid_path).toBe("string");
      expect(record.sid_path.length).toBeGreaterThan(0);
      expect(record.sid_path).toMatch(/\.sid$/);

      // Validate ratings
      expect(record.ratings).toBeDefined();
      expect(typeof record.ratings.e).toBe("number");
      expect(typeof record.ratings.m).toBe("number");
      expect(typeof record.ratings.c).toBe("number");
      expect(record.ratings.e).toBeGreaterThanOrEqual(1);
      expect(record.ratings.e).toBeLessThanOrEqual(5);
      expect(record.ratings.m).toBeGreaterThanOrEqual(1);
      expect(record.ratings.m).toBeLessThanOrEqual(5);
      expect(record.ratings.c).toBeGreaterThanOrEqual(1);
      expect(record.ratings.c).toBeLessThanOrEqual(5);

      // Validate features if present
      if (record.features) {
        expect(typeof record.features.energy).toBe("number");
        expect(typeof record.features.rms).toBe("number");
        
        // Check for new metadata fields
        if (record.features.featureSetVersion) {
          expect(record.features.featureSetVersion).toBe(FEATURE_SCHEMA_VERSION);
        }
        if (record.features.featureVariant) {
          expect(["essentia", "heuristic", "cached"]).toContain(record.features.featureVariant);
        }
      }

      // Check for duplicates
      const pathKey = record.song_index 
        ? `${record.sid_path}:${record.song_index}` 
        : record.sid_path;
      expect(seenPaths.has(pathKey)).toBe(false);
      seenPaths.add(pathKey);
    }
  });

  test("JSONL records are ordered deterministically", async () => {
    // Read the JSONL file twice and compare
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(classifiedPath);
    const jsonlFiles = files.filter(f => f.endsWith(".jsonl"));
    
    const jsonlFile = join(classifiedPath, jsonlFiles[0]);
    const content1 = await readFile(jsonlFile, "utf8");
    
    // Parse and extract paths in order
    const lines1 = content1.split("\n").filter(line => line.trim().length > 0);
    const paths1 = lines1.map(line => {
      const record = JSON.parse(line) as ClassificationRecord;
      return record.sid_path;
    });

    // Verify ordering is alphabetical (deterministic)
    const sortedPaths = [...paths1].sort();
    expect(paths1).toEqual(sortedPaths);
  });

  test("ratings are consistent for same input", async () => {
    // Run classification again with fresh output
    const newClassifiedPath = join(tempDir, "classified2");
    await mkdir(newClassifiedPath, { recursive: true });

    const plan: ClassificationPlan = {
      config: {
        sidPath,
        audioCachePath,
        tagsPath,
        classifiedPath: newClassifiedPath,
        threads: 1,
        classificationDepth: 3,
      } as SidflowConfig,
      audioCachePath,
      tagsPath,
      forceRebuild: false,
      classificationDepth: 3,
      sidPath,
    };

    await generateAutoTags(plan, { threads: 1 });

    // Read both JSONL files
    const { readdir } = await import("node:fs/promises");
    
    const files1 = await readdir(classifiedPath);
    const files2 = await readdir(newClassifiedPath);
    
    const file1 = join(classifiedPath, files1.filter(f => f.endsWith(".jsonl"))[0]);
    const file2 = join(newClassifiedPath, files2.filter(f => f.endsWith(".jsonl"))[0]);
    
    const content1 = await readFile(file1, "utf8");
    const content2 = await readFile(file2, "utf8");
    
    const records1 = content1.split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as ClassificationRecord);
    const records2 = content2.split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as ClassificationRecord);

    // Verify ratings match
    for (let i = 0; i < records1.length; i++) {
      expect(records1[i].sid_path).toBe(records2[i].sid_path);
      expect(records1[i].ratings.e).toBe(records2[i].ratings.e);
      expect(records1[i].ratings.m).toBe(records2[i].ratings.m);
      expect(records1[i].ratings.c).toBe(records2[i].ratings.c);
    }
  });
});
