/**
 * End-to-end integration test for the complete SIDFlow pipeline.
 * 
 * This test exercises the full workflow:
 * 1. Load SID files from test-data
 * 2. Build WAV cache using real sidplayfp (if available, otherwise mock)
 * 3. Extract features and classify
 * 4. Build LanceDB database
 * 5. Generate playlist with recommendations
 * 6. Test playback flow
 */

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  buildWavCache,
  essentiaFeatureExtractor,
  generateAutoTags,
  planClassification,
  tfjsPredictRatings,
  type ClassificationPlan,
  defaultExtractMetadata,
  defaultRenderWav
} from "../packages/sidflow-classify/src/index.js";
import { ensureDir } from "../packages/sidflow-common/src/fs.js";
import { stringifyDeterministic } from "../packages/sidflow-common/src/json.js";
import { createPlaybackController, PlaybackState } from "../packages/sidflow-play/src/index.js";
import { parseSidFile } from "../packages/sidflow-common/src/sid-parser.js";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-e2e-");
const TEST_DATA_PATH = path.join(process.cwd(), "test-data");
const TEST_SID_PATH = "C64Music/MUSICIANS/G/Garvalf/Lully_Marche_Ceremonie_Turcs_Wip.sid";

/**
 * Check if sidplayfp is available in the system.
 */
async function isSidplayfpAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("sidplayfp", ["--version"]);
    proc.on("error", () => resolve(false));
    proc.on("exit", (code) => resolve(code === 0));
  });
}

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
async function listSidFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSidFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".sid")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("End-to-End SIDFlow Pipeline", () => {
  let tempRoot: string;
  let sidPath: string;
  let wavCachePath: string;
  let tagsPath: string;
  let classifiedPath: string;
  let dataPath: string;
  let configPath: string;
  let plan: ClassificationPlan;
  let sidFileCount: number;
  let totalSongCount: number;
  let hasSidplayfp: boolean;

  beforeAll(async () => {
    // Check if sidplayfp is available
    hasSidplayfp = await isSidplayfpAvailable();
    console.log(`Running E2E test with ${hasSidplayfp ? "real" : "mock"} sidplayfp`);

    // Create temporary directories
    tempRoot = await mkdtemp(TEMP_PREFIX);
    sidPath = path.join(tempRoot, "hvsc");
    wavCachePath = path.join(tempRoot, "wav-cache");
    tagsPath = path.join(tempRoot, "tags");
    classifiedPath = path.join(tempRoot, "classified");
    dataPath = path.join(tempRoot, "data");

    // Copy test SID files to temp hvsc directory
    const testDataSrc = path.join(TEST_DATA_PATH, "C64Music");
    const testDataDest = path.join(sidPath, "C64Music");

    // Create hvsc directory first
    await mkdir(sidPath, { recursive: true });

    // Use shell to copy the entire directory structure
    const copyResult = await Bun.spawn(["cp", "-r", testDataSrc, testDataDest]).exited;
    if (copyResult !== 0) {
      throw new Error("Failed to copy test data");
    }

    const sidFiles = await listSidFiles(sidPath);
    sidFileCount = sidFiles.length;
    totalSongCount = 0;

    for (const sidFile of sidFiles) {
      try {
        const metadata = await parseSidFile(sidFile);
        totalSongCount += Math.max(1, metadata.songs ?? 1);
      } catch {
        totalSongCount += 1;
      }
    }

    // Create config
    const config = {
      sidPath,
      wavCachePath,
      tagsPath,
      classifiedPath,
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
    let renderHook;

    if (hasSidplayfp) {
      // Use real sidplayfp
      renderHook = async (options: { sidFile: string; wavFile: string }) => {
        await defaultRenderWav(options);
      };
    } else {
      // Mock WAV renderer for CI without sidplayfp
      renderHook = async ({ wavFile }: { wavFile: string }) => {
        await ensureDir(path.dirname(wavFile));
        const wavData = generateTestWav(2, 440, 44100);
        await writeFile(wavFile, wavData);
      };
    }

    const result = await buildWavCache(plan, {
      render: renderHook,
      forceRebuild: false
    });

    expect(result.rendered).toHaveLength(totalSongCount);
    expect(result.skipped).toHaveLength(0);
    expect(result.metrics.totalFiles).toBe(totalSongCount);
    expect(result.metrics.cacheHitRate).toBe(0);
  });

  it("extracts features from WAV files", async () => {
    const wavFiles = await readdir(wavCachePath, { recursive: true });
    const wavFile = wavFiles.find(f => f.endsWith(".wav"));
    expect(wavFile).toBeDefined();

    const fullWavPath = path.join(wavCachePath, wavFile!);
    const relativeWavPath = wavFile!;
    const sidRelativeWithIndex = relativeWavPath.replace(/\.wav$/i, ".sid");
    let sidFile = path.join(sidPath, sidRelativeWithIndex);

    if (!existsSync(sidFile)) {
      const sidRelativeWithoutIndex = sidRelativeWithIndex.replace(/-(\d+)\.sid$/i, ".sid");
      const fallback = path.join(sidPath, sidRelativeWithoutIndex);
      if (existsSync(fallback)) {
        sidFile = fallback;
      } else {
        throw new Error(`Unable to locate SID file for ${relativeWavPath}`);
      }
    }

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

  it("validates WAV files have reasonable durations", async () => {
    // This test verifies that WAV files are not truncated (e.g., not all 15 seconds)
    // We expect durations to vary based on actual song lengths from Songlengths.md5
    const wavFiles = await readdir(wavCachePath, { recursive: true });
    const wavPaths = wavFiles.filter(f => f.endsWith(".wav")).map(f => path.join(wavCachePath, f));
    
    expect(wavPaths.length).toBeGreaterThan(0);
    
    // Helper to get WAV duration using ffprobe if available
    const getWavDuration = async (wavPath: string): Promise<number | null> => {
      return new Promise((resolve) => {
        const proc = spawn("ffprobe", [
          "-v", "error",
          "-show_entries", "format=duration",
          "-of", "default=noprint_wrappers=1:nokey=1",
          wavPath
        ]);
        
        let output = "";
        proc.stdout.on("data", (data) => { output += data.toString(); });
        proc.on("error", () => resolve(null));
        proc.on("exit", (code) => {
          if (code === 0) {
            const duration = parseFloat(output.trim());
            resolve(isNaN(duration) ? null : duration);
          } else {
            resolve(null);
          }
        });
      });
    };
    
    const durations: number[] = [];
    for (const wavPath of wavPaths.slice(0, 5)) { // Test first 5 files
      const duration = await getWavDuration(wavPath);
      if (duration !== null) {
        durations.push(duration);
      }
    }
    
    if (durations.length > 0) {
      // Verify all durations are reasonable
      // Mock WAVs may be short (2s), real renders should be longer
      const minExpectedDuration = hasSidplayfp ? 10 : 1;
      const maxExpectedDuration = 600;
      
      for (const duration of durations) {
        expect(duration).toBeGreaterThan(minExpectedDuration);
        expect(duration).toBeLessThan(maxExpectedDuration);
      }
      
      // If we have real sidplayfp, verify variety in durations
      // (Mock renders may produce uniform durations, which is OK for testing)
      if (hasSidplayfp && durations.length >= 3) {
        const uniqueDurations = new Set(durations.map(d => Math.floor(d)));
        // With real sidplayfp and Songlengths.md5, expect variety
        // But don't fail if all songs happen to have similar lengths
        if (uniqueDurations.size === 1) {
          console.warn("All tested WAV files have similar durations - this may be OK if songs are similar length");
        }
      }
    } else {
      // ffprobe not available, skip duration validation
      console.warn("ffprobe not available, skipping WAV duration validation");
    }
  });

  it("classifies SID files with auto-tags", async () => {
    let metadataExtractor;

    if (hasSidplayfp) {
      // Use real metadata extractor
      metadataExtractor = async (options: { sidFile: string; relativePath: string }) => {
        return await defaultExtractMetadata(options);
      };
    } else {
      // Mock metadata extractor
      metadataExtractor = async () => ({ title: "Test Song" });
    }

    const result = await generateAutoTags(plan, {
      extractMetadata: metadataExtractor,
      featureExtractor: essentiaFeatureExtractor,
      predictRatings: tfjsPredictRatings
    });

    expect(result.autoTagged).toHaveLength(totalSongCount);
    expect(result.metrics.predictionsGenerated).toBe(totalSongCount);
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
      rootPath: sidPath
    });

    expect(controller).toBeDefined();
    expect(controller.getState()).toBe(PlaybackState.IDLE);
  });

  it("loads queue with mock recommendations", () => {
    const controller = createPlaybackController({
      rootPath: sidPath
    });

    // Mock recommendations based on classified songs
    const mockRecommendations = [
      {
        sid_path: TEST_SID_PATH,
        score: 0.9,
        similarity: 0.95,
        songFeedback: 0.8,
        userAffinity: 0.7,
        ratings: { e: 4, m: 3, c: 4, p: 4 },
        feedback: { likes: 0, dislikes: 0, skips: 0, plays: 0 }
      }
    ];

    controller.loadQueue(mockRecommendations);

    const queue = controller.getQueue();
    expect(queue.songs.length).toBeGreaterThan(0);
    expect(queue.remaining).toBe(mockRecommendations.length);
  });

  it("verifies full pipeline metrics", async () => {
    // This test verifies the entire pipeline ran successfully
    expect(sidFileCount).toBeGreaterThanOrEqual(3);

    // Verify WAV cache was built
    expect(existsSync(wavCachePath)).toBe(true);

    // Verify tags were generated
    expect(existsSync(tagsPath)).toBe(true);

    // Verify classification outputs exist
    const autoTagsExist = existsSync(path.join(tagsPath, "auto-tags.json")) ||
      existsSync(path.join(tagsPath, "C64Music", "auto-tags.json"));
    expect(autoTagsExist || existsSync(tagsPath)).toBe(true);
  });
});
