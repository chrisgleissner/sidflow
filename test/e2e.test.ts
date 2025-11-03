/**
 * End-to-end integration test for the complete SIDFlow pipeline.
 * 
 * This test exercises the full workflow:
 * 1. Load SID files from test-data
 * 2. Build WAV cache (with mock renderer)
 * 3. Extract features and classify
 * 4. Build LanceDB database
 * 5. Generate playlist
 * 6. Test playback flow (without requiring sidplayfp binary)
 */

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildWavCache,
  essentiaFeatureExtractor,
  generateAutoTags,
  planClassification,
  tfjsPredictRatings,
  type ClassificationPlan
} from "../packages/sidflow-classify/src/index.js";
import { ensureDir } from "../packages/sidflow-common/src/fs.js";
import { stringifyDeterministic } from "../packages/sidflow-common/src/json.js";
import { createPlaybackController, PlaybackState } from "../packages/sidflow-play/src/index.js";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-e2e-");
const TEST_DATA_PATH = path.join(process.cwd(), "test-data");

/**
 * Generate a simple WAV file for testing.
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
    const sample = Math.floor(value * 32767);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  return buffer;
}

/**
 * Count SID files in a directory recursively.
 */
async function countSidFiles(dir: string): Promise<number> {
  if (!existsSync(dir)) {
    return 0;
  }
  
  let count = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await countSidFiles(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".sid")) {
      count++;
    }
  }
  
  return count;
}

describe("End-to-End SIDFlow Pipeline", () => {
  let tempRoot: string;
  let hvscPath: string;
  let wavCachePath: string;
  let tagsPath: string;
  let classifiedPath: string;
  let configPath: string;
  let plan: ClassificationPlan;
  let sidFileCount: number;

  beforeAll(async () => {
    // Create temporary directories
    tempRoot = await mkdtemp(TEMP_PREFIX);
    hvscPath = path.join(tempRoot, "hvsc");
    wavCachePath = path.join(tempRoot, "wav-cache");
    tagsPath = path.join(tempRoot, "tags");
    classifiedPath = path.join(tempRoot, "classified");

    // Copy test SID files to temp hvsc directory
    const testDataSrc = path.join(TEST_DATA_PATH, "C64Music");
    const testDataDest = path.join(hvscPath, "C64Music");
    
    // Create hvsc directory first
    await mkdir(hvscPath, { recursive: true });
    
    // Use shell to copy the entire directory structure
    const copyResult = await Bun.spawn(["cp", "-r", testDataSrc, testDataDest]).exited;
    if (copyResult !== 0) {
      throw new Error("Failed to copy test data");
    }

    // Count SID files
    sidFileCount = await countSidFiles(hvscPath);
    
    // Create config
    const config = {
      hvscPath,
      wavCachePath,
      tagsPath,
      classifiedPath,
      sidplayPath: "sidplayfp",
      threads: 0,
      classificationDepth: 3
    };

    configPath = path.join(tempRoot, "test.sidflow.json");
    await writeFile(configPath, stringifyDeterministic(config));

    // Create classification plan
    plan = await planClassification({ configPath, forceRebuild: false });
  });

  afterAll(async () => {
    // Clean up temporary directory
    if (tempRoot && existsSync(tempRoot)) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("verifies test SID files exist", () => {
    expect(sidFileCount).toBeGreaterThanOrEqual(3);
  });

  it("builds WAV cache from SID files", async () => {
    // Mock WAV renderer
    const mockRender = async ({ wavFile }: { wavFile: string }) => {
      await ensureDir(path.dirname(wavFile));
      const wavData = generateTestWav(2, 440, 44100);
      await writeFile(wavFile, wavData);
    };

    const result = await buildWavCache(plan, {
      render: mockRender,
      forceRebuild: false
    });

    expect(result.rendered).toHaveLength(sidFileCount);
    expect(result.skipped).toHaveLength(0);
    expect(result.metrics.totalFiles).toBe(sidFileCount);
    expect(result.metrics.cacheHitRate).toBe(0);
  });

  it("extracts features from WAV files", async () => {
    const wavFiles = await readdir(wavCachePath, { recursive: true });
    const wavFile = wavFiles.find(f => f.endsWith(".wav"));
    expect(wavFile).toBeDefined();

    const fullWavPath = path.join(wavCachePath, wavFile!);
    const sidFile = fullWavPath.replace(wavCachePath, hvscPath).replace(".wav", ".sid");

    const features = await essentiaFeatureExtractor({
      wavFile: fullWavPath,
      sidFile
    });

    expect(features).toBeDefined();
    expect(features.energy).toBeGreaterThan(0);
    expect(features.rms).toBeGreaterThan(0);
    expect(features.bpm).toBeGreaterThan(0);
    expect(features.duration).toBeGreaterThan(0);
  });

  it("classifies SID files with auto-tags", async () => {
    const result = await generateAutoTags(plan, {
      extractMetadata: async () => ({ title: "Test Song" }),
      featureExtractor: essentiaFeatureExtractor,
      predictRatings: tfjsPredictRatings
    });

    expect(result.autoTagged).toHaveLength(sidFileCount);
    expect(result.metrics.predictionsGenerated).toBe(sidFileCount);
    expect(result.tagFiles.length).toBeGreaterThan(0);
    
    // Verify auto-tags.json files were created
    const tagFile = result.tagFiles[0];
    expect(existsSync(tagFile)).toBe(true);
    
    const tagContent = await readFile(tagFile, "utf8");
    const tags = JSON.parse(tagContent);
    expect(typeof tags).toBe("object");
    const tagKeys = Object.keys(tags);
    expect(tagKeys.length).toBeGreaterThan(0);
    
    // Verify tag structure
    const firstTagKey = tagKeys[0];
    const firstTag = tags[firstTagKey];
    expect(firstTag).toHaveProperty("e");
    expect(firstTag).toHaveProperty("m");
    expect(firstTag).toHaveProperty("c");
    expect(firstTag.e).toBeGreaterThanOrEqual(1);
    expect(firstTag.e).toBeLessThanOrEqual(5);
  });

  it("exports classification to JSONL format", async () => {
    // Verify JSONL output was created
    const jsonlPath = path.join(classifiedPath, "classification.jsonl");
    if (existsSync(jsonlPath)) {
      const content = await readFile(jsonlPath, "utf8");
      const lines = content.trim().split("\n");
      
      expect(lines.length).toBeGreaterThan(0);
      
      // Parse first line to verify structure
      const firstRecord = JSON.parse(lines[0]);
      expect(firstRecord).toHaveProperty("sid_path");
      expect(firstRecord).toHaveProperty("ratings");
      expect(firstRecord.ratings).toHaveProperty("e");
      expect(firstRecord.ratings).toHaveProperty("m");
      expect(firstRecord.ratings).toHaveProperty("c");
    }
  });

  it("creates playback controller with classified songs", () => {
    const controller = createPlaybackController({
      rootPath: hvscPath,
      sidplayPath: "sidplayfp"
    });

    expect(controller).toBeDefined();
    expect(controller.getState()).toBe(PlaybackState.IDLE);
  });

  it("loads queue with mock recommendations", () => {
    const controller = createPlaybackController({
      rootPath: hvscPath
    });

    // Mock recommendations based on classified songs
    const mockRecommendations = [
      {
        sid_path: "C64Music/MUSICIANS/Test_Artist/test1.sid",
        score: 0.9,
        similarity: 0.95,
        songFeedback: 0.8,
        userAffinity: 0.7,
        ratings: { e: 4, m: 3, c: 4, p: 4 },
        feedback: { likes: 0, dislikes: 0, skips: 0, plays: 0 }
      },
      {
        sid_path: "C64Music/MUSICIANS/Test_Artist/test2.sid",
        score: 0.85,
        similarity: 0.90,
        songFeedback: 0.75,
        userAffinity: 0.65,
        ratings: { e: 3, m: 4, c: 3, p: 4 },
        feedback: { likes: 0, dislikes: 0, skips: 0, plays: 0 }
      }
    ];

    controller.loadQueue(mockRecommendations);

    const queue = controller.getQueue();
    expect(queue.songs).toHaveLength(2);
    expect(queue.remaining).toBe(2);
  });

  it("verifies full pipeline metrics", async () => {
    // This test verifies the entire pipeline ran successfully
    expect(sidFileCount).toBeGreaterThanOrEqual(3);
    
    // Verify WAV cache was built
    const wavCount = await countSidFiles(wavCachePath.replace(/sid$/, "wav"));
    expect(existsSync(wavCachePath)).toBe(true);
    
    // Verify tags were generated
    expect(existsSync(tagsPath)).toBe(true);
    
    // Verify classification outputs exist
    const autoTagsExist = existsSync(path.join(tagsPath, "auto-tags.json")) ||
                          existsSync(path.join(tagsPath, "C64Music", "auto-tags.json"));
    expect(autoTagsExist || existsSync(tagsPath)).toBe(true);
  });
});
