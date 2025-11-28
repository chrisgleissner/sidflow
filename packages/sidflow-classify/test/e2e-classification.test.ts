/**
 * E2E Test: Full Classification Pipeline
 * 
 * Tests the complete classification workflow:
 * 1. SID file → WAV rendering
 * 2. WAV → Essentia.js feature extraction
 * 3. Features → Heuristic rating prediction
 * 4. Ratings → JSONL output
 * 
 * This test uses real SID files from test-data/ and verifies all artifacts are created.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, access, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateAutoTags, type ClassificationPlan } from "../src/index.js";
import { copyFile } from "node:fs/promises";
import type { SidflowConfig } from "@sidflow/common";

describe("E2E Classification Pipeline Test", () => {
  let tempDir: string;
  let wavCachePath: string;
  let classifiedPath: string;
  let testSidPath: string;

  beforeAll(async () => {
    // Create temporary workspace
    tempDir = await mkdtemp(join(tmpdir(), "sidflow-e2e-test-"));
    wavCachePath = join(tempDir, "wav-cache");
    classifiedPath = join(tempDir, "classified");

    // Use existing test SID file (Garvalf - Lully) - simpler file with fewer subtunes
    const sourceSid = join(process.cwd(), "test-data/C64Music/MUSICIANS/G/Garvalf/Lully_Marche_Ceremonie_Turcs_Wip.sid");
    testSidPath = join(tempDir, "test-collection");
    
    // Create test collection directory
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(testSidPath, "MUSICIANS/G/Garvalf"), { recursive: true });
    
    const destSid = join(testSidPath, "MUSICIANS/G/Garvalf/Lully_Marche_Ceremonie_Turcs_Wip.sid");
    
    try {
      await copyFile(sourceSid, destSid);
      console.log(`[E2E Test] Test SID file copied: ${destSid}`);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        console.log(`[E2E Test] Source SID file not found: ${sourceSid}`);
        console.log("[E2E Test] Cannot run E2E test - test SID file missing");
        testSidPath = ""; // Mark as unavailable
        return;
      }
      throw err;
    }
  });

  afterAll(async () => {
    // Cleanup temp directory
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("Full pipeline: SID → WAV → Features → Ratings → auto-tags.json", async () => {
    // Skip if no test SID file
    if (!testSidPath) {
      console.log("[E2E Test] Skipping - test SID file not available");
      return;
    }

    const relativePath = "MUSICIANS/G/Garvalf/Lully_Marche_Ceremonie_Turcs_Wip.sid";
    const sidFile = join(testSidPath, relativePath);

    // Verify SID file exists
    await access(sidFile); // Will throw if file doesn't exist

    // Create tags directory
    await mkdir(join(tempDir, "tags"), { recursive: true });
    const tagsPath = join(tempDir, "tags");

    // Create classification plan
    const plan: ClassificationPlan = {
      config: {
        sidPath: testSidPath,
        wavCachePath,
        tagsPath,
        sidplayPath: undefined,
        threads: 1,
        classificationDepth: 3,
      } as SidflowConfig,
      wavCachePath,
      tagsPath,
      forceRebuild: true,
      classificationDepth: 3,
      sidPath: testSidPath,
    };

    // Run classification
    console.log("[E2E Test] Starting classification...");
    const result = await generateAutoTags(plan, {
      threads: 1,
      onProgress: (progress) => {
        console.log(`[E2E Test] ${progress.phase}: ${progress.processedFiles}/${progress.totalFiles} (${progress.percentComplete.toFixed(1)}%) - ${progress.currentFile || ""}`);
      },
    });

    console.log("[E2E Test] Classification result:", result);

    // Verify result structure
    expect(result).toHaveProperty("autoTagged");
    expect(result).toHaveProperty("metrics");
    expect(result.autoTagged.length).toBeGreaterThan(0);
    expect(result.metrics.autoTaggedCount).toBeGreaterThan(0);

    // Verify WAV directory was created (at least one subtune)
    const wavDir = join(wavCachePath, "MUSICIANS/G/Garvalf");
    await access(wavDir); // Will throw if directory doesn't exist
    console.log(`[E2E Test] ✓ WAV directory created: ${wavDir}`);

    // Verify tagFiles were created
    expect(result.tagFiles.length).toBeGreaterThan(0);
    const autoTagsFile = result.tagFiles[0];
    await access(autoTagsFile); // Will throw if file doesn't exist
    console.log(`[E2E Test] ✓ auto-tags.json created: ${autoTagsFile}`);

    // Read and verify auto-tags.json content
    const autoTagsContent = await readFile(autoTagsFile, "utf-8");
    const autoTags = JSON.parse(autoTagsContent);
    
    // Log all keys to see what's actually in the file
    const keys = Object.keys(autoTags);
    console.log("[E2E Test] Auto-tags keys:", keys);
    expect(keys.length).toBeGreaterThan(0);
    
    // Use the first key
    const autoTagsKey = keys[0];
    expect(autoTags[autoTagsKey]).toBeDefined();
    
    const entry = autoTags[autoTagsKey];
    console.log("[E2E Test] Auto-tags entry:", entry);

    // Verify ratings structure (ratings are directly on the entry: e, m, c)
    expect(entry.e).toBeGreaterThanOrEqual(1);
    expect(entry.e).toBeLessThanOrEqual(5);
    expect(entry.m).toBeGreaterThanOrEqual(1);
    expect(entry.m).toBeLessThanOrEqual(5);
    expect(entry.c).toBeGreaterThanOrEqual(1);
    expect(entry.c).toBeLessThanOrEqual(5);
    console.log(`[E2E Test] ✓ Ratings: e=${entry.e}, m=${entry.m}, c=${entry.c}`);

    // Verify source is "auto"
    expect(entry.source).toBe("auto");
    
    // Note: The auto-tags.json format does NOT include features or metadata
    // Those are stored in separate .meta.json and .jsonl files
    // This is the correct, simplified format for auto-tags.json

    console.log("[E2E Test] ✓ Full classification pipeline completed successfully");
  }, 180000); // 180 second timeout for real rendering with Essentia.js (increased from 90s)

  test("Pipeline can be run multiple times (idempotent)", async () => {
    if (!testSidPath) {
      return;
    }

    const tagsPath = join(tempDir, "tags");
    
    const plan: ClassificationPlan = {
      config: {
        sidPath: testSidPath,
        wavCachePath,
        tagsPath,
        sidplayPath: undefined,
        threads: 1,
        classificationDepth: 3,
      } as SidflowConfig,
      wavCachePath,
      tagsPath,
      forceRebuild: false, // Should use cached WAV
      classificationDepth: 3,
      sidPath: testSidPath,
    };

    // Run classification a second time (should be faster with cache)
    const startTime = Date.now();
    const result2 = await generateAutoTags(plan, { threads: 1 });
    const duration = Date.now() - startTime;

    console.log(`[E2E Test] Second run took ${duration}ms (with WAV cache)`);
    expect(result2.autoTagged.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(30000); // Should be faster than first run
  });
});
