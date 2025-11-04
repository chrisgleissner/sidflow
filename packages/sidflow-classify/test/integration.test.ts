import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildWavCache,
  essentiaFeatureExtractor,
  generateAutoTags,
  planClassification,
  tfjsPredictRatings,
  type ClassificationPlan
} from "@sidflow/classify";
import { ensureDir } from "@sidflow/common";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-integration-");

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

describe("Essentia.js + TF.js integration", () => {
  it("end-to-end workflow: feature extraction and prediction", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const hvscPath = path.join(root, "hvsc");
    const wavCachePath = path.join(root, "wav");
    const tagsPath = path.join(root, "tags");

    console.log(`[TEST] Created temp directory: ${root}`);
    console.log(`[TEST] hvscPath: ${hvscPath}`);
    console.log(`[TEST] wavCachePath: ${wavCachePath}`);
    console.log(`[TEST] tagsPath: ${tagsPath}`);

    // Create directory structure
    await mkdir(path.join(hvscPath, "MUSICIANS", "Test"), { recursive: true });
    console.log(`[TEST] Created directory structure`);

    // Create test SID files
    const sidFile1 = path.join(hvscPath, "MUSICIANS", "Test", "song1.sid");
    const sidFile2 = path.join(hvscPath, "MUSICIANS", "Test", "song2.sid");
    await writeFile(sidFile1, Buffer.from("dummy sid 1"));
    await writeFile(sidFile2, Buffer.from("dummy sid 2"));
    console.log(`[TEST] Created SID files: ${sidFile1}, ${sidFile2}`);

    // Create a mock plan - using proper type construction
    const plan: ClassificationPlan = {
      config: {
        hvscPath,
        wavCachePath,
        tagsPath,
        sidplayPath: "sidplayfp",
        threads: 0,
        classificationDepth: 3
      } as ClassificationPlan["config"],
      forceRebuild: false,
      classificationDepth: 3,
      hvscPath,
      wavCachePath,
      tagsPath,
      sidplayPath: "sidplayfp"
    };

    // Mock WAV renderer
    const mockRender = async ({ wavFile, songIndex }: { wavFile: string; songIndex?: number }) => {
      console.log(`[TEST] Rendering WAV: ${wavFile} (songIndex: ${songIndex})`);
      await ensureDir(path.dirname(wavFile));
      const wavData = generateTestWav(2, 440, 44100);
      await writeFile(wavFile, wavData);
      console.log(`[TEST] WAV file written: ${wavFile}`);
    };

    // Step 1: Build WAV cache
    console.log(`[TEST] Starting buildWavCache...`);
    const wavResult = await buildWavCache(plan, {
      render: mockRender,
      forceRebuild: false
    });

    console.log(`[TEST] buildWavCache completed:`);
    console.log(`[TEST]   rendered.length: ${wavResult.rendered.length}`);
    console.log(`[TEST]   rendered: ${JSON.stringify(wavResult.rendered)}`);
    console.log(`[TEST]   skipped.length: ${wavResult.skipped.length}`);

    expect(wavResult.rendered).toHaveLength(2);
    expect(wavResult.skipped).toHaveLength(0);

    // Step 2: Extract features using Essentia.js
    const wavFile1 = path.join(wavCachePath, "MUSICIANS", "Test", "song1-1.wav");
    console.log(`[TEST] Checking for WAV file: ${wavFile1}`);
    
    // Check if file exists
    const fs = await import("node:fs/promises");
    try {
      const stats = await fs.stat(wavFile1);
      console.log(`[TEST] WAV file exists, size: ${stats.size} bytes`);
    } catch (error) {
      console.error(`[TEST] WAV file does not exist: ${wavFile1}`);
      console.error(`[TEST] Error: ${error}`);
      // List directory contents
      try {
        const dir = path.dirname(wavFile1);
        const files = await fs.readdir(dir);
        console.log(`[TEST] Directory contents of ${dir}:`, files);
      } catch (dirError) {
        console.error(`[TEST] Cannot read directory: ${dirError}`);
      }
    }

    console.log(`[TEST] Extracting features from: ${wavFile1}`);
    const features1 = await essentiaFeatureExtractor({
      wavFile: wavFile1,
      sidFile: sidFile1
    });

    console.log(`[TEST] Features extracted:`, Object.keys(features1));
    expect(features1).toBeDefined();
    expect(features1.energy).toBeGreaterThan(0);
    expect(features1.rms).toBeGreaterThan(0);
    expect(features1.bpm).toBeGreaterThan(0);

    // Step 3: Predict ratings using TF.js
    console.log(`[TEST] Predicting ratings...`);
    const ratings1 = await tfjsPredictRatings({
      features: features1,
      sidFile: sidFile1,
      relativePath: "MUSICIANS/Test/song1.sid",
      metadata: { title: "Song 1" }
    });

    console.log(`[TEST] Ratings predicted:`, ratings1);
    expect(ratings1).toBeDefined();
    expect(ratings1.e).toBeGreaterThanOrEqual(1);
    expect(ratings1.e).toBeLessThanOrEqual(5);
    expect(ratings1.m).toBeGreaterThanOrEqual(1);
    expect(ratings1.m).toBeLessThanOrEqual(5);
    expect(ratings1.c).toBeGreaterThanOrEqual(1);
    expect(ratings1.c).toBeLessThanOrEqual(5);

    // Step 4: Generate auto-tags using the new extractors
    console.log(`[TEST] Generating auto-tags...`);
    const autoTagsResult = await generateAutoTags(plan, {
      extractMetadata: async () => ({ title: "Test Song" }),
      featureExtractor: essentiaFeatureExtractor,
      predictRatings: tfjsPredictRatings
    });

    console.log(`[TEST] Auto-tags generated:`);
    console.log(`[TEST]   autoTagged.length: ${autoTagsResult.autoTagged.length}`);
    console.log(`[TEST]   predictionsGenerated: ${autoTagsResult.metrics.predictionsGenerated}`);
    console.log(`[TEST]   tagFiles.length: ${autoTagsResult.tagFiles.length}`);

    expect(autoTagsResult.autoTagged).toHaveLength(2);
    expect(autoTagsResult.metrics.predictionsGenerated).toBe(2);
    expect(autoTagsResult.tagFiles).toHaveLength(1);

    console.log(`[TEST] Test completed successfully`);
    await rm(root, { recursive: true, force: true });
  });

  it("fallback behavior when Essentia.js fails", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const wavFile = path.join(root, "test.wav");
    const sidFile = path.join(root, "test.sid");

    // Create valid WAV and SID files
    const wavData = generateTestWav(1, 440, 44100);
    await writeFile(wavFile, wavData);
    await writeFile(sidFile, Buffer.from("dummy sid"));

    // The feature extractor should work and fall back if needed
    const features = await essentiaFeatureExtractor({
      wavFile,
      sidFile
    });

    expect(features).toBeDefined();
    expect(typeof features.energy).toBe("number");
    expect(typeof features.rms).toBe("number");
    expect(features.energy).toBeGreaterThan(0);

    // Predictions should still work
    const ratings = await tfjsPredictRatings({
      features,
      sidFile,
      relativePath: "test.sid",
      metadata: {}
    });

    expect(ratings.e).toBeGreaterThanOrEqual(1);
    expect(ratings.e).toBeLessThanOrEqual(5);

    await rm(root, { recursive: true, force: true });
  });
});
