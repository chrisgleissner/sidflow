/**
 * Classification tests for multi-SID files (2SID and 3SID) in the checked-in
 * test-data collection.
 *
 * These tests verify that:
 * 1. The SID parser correctly reads the chip-count metadata from real binary SID files.
 * 2. The full classification pipeline (generateAutoTags) successfully processes every
 *    SID file in test-data/, including 2SID and 3SID variants.
 *
 * The SIDs under test:
 * - Space_Oddity_2SID.sid  (C0zmo) — PSID v3, 2 SID chips
 * - Waterfall_3SID.sid     (Chiummo_Gaetano) — PSID v4, 3 SID chips
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { parseSidFileFromBuffer } from "@sidflow/common";
import {
  generateAutoTags,
  heuristicFeatureExtractor,
  heuristicPredictRatings,
  fallbackMetadataFromPath,
  type ClassificationPlan,
} from "../src/index.js";
import type { SidflowConfig } from "@sidflow/common";

// Absolute paths to the checked-in SID files
const REPO_ROOT = join(import.meta.dir, "../../../");
// The classifier uses plan.sidPath as the collection root; both the plan and
// the WAV seeding below must agree on this base.
const SID_COLLECTION_ROOT = join(REPO_ROOT, "test-data/C64Music");
const SID_2SID = join(SID_COLLECTION_ROOT, "MUSICIANS/C/C0zmo/Space_Oddity_2SID.sid");
const SID_3SID = join(SID_COLLECTION_ROOT, "MUSICIANS/C/Chiummo_Gaetano/Waterfall_3SID.sid");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal silent WAV (44-byte RIFF header, mono, 16-bit PCM, 44100 Hz, 0 samples). */
function silentWav(): Buffer {
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(44100, 24);
  buf.writeUInt32LE(88200, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(0, 40);
  return buf;
}

async function collectSids(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectSids(full)));
    } else if (entry.name.toLowerCase().endsWith(".sid")) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Part 1: SID metadata parsing
// ---------------------------------------------------------------------------

describe("2SID / 3SID metadata parsing from real binary SID files", () => {
  test("Space_Oddity_2SID.sid is PSID v3+ with a second SID chip address", async () => {
    const buf = await readFile(SID_2SID);
    const meta = parseSidFileFromBuffer(buf);

    expect(meta.type).toBe("PSID");
    expect(meta.version).toBeGreaterThanOrEqual(3);
    expect(meta.title).toBeTruthy();
    expect(meta.author).toBeTruthy();
    // A genuine 2SID file must have a non-null second-chip address
    expect(meta.secondSIDAddress).not.toBeNull();
    expect(meta.secondSIDAddress).toBeTruthy();
  });

  test("Waterfall_3SID.sid is PSID v4+ with second and third SID chip addresses", async () => {
    const buf = await readFile(SID_3SID);
    const meta = parseSidFileFromBuffer(buf);

    expect(meta.type).toBe("PSID");
    expect(meta.version).toBeGreaterThanOrEqual(4);
    expect(meta.title).toBeTruthy();
    expect(meta.author).toBeTruthy();
    expect(meta.secondSIDAddress).not.toBeNull();
    expect(meta.secondSIDAddress).toBeTruthy();
    expect(meta.thirdSIDAddress).not.toBeNull();
    expect(meta.thirdSIDAddress).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Part 2: Full classification pipeline over all test-data SID files
// ---------------------------------------------------------------------------

describe("Classification of all test-data SID files including 2SID and 3SID", () => {
  let tempDir: string;
  let audioCachePath: string;
  let tagsPath: string;
  let classifiedPath: string;
  let plan: ClassificationPlan;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sidflow-multisid-classify-"));
    audioCachePath = join(tempDir, "audio-cache");
    tagsPath = join(tempDir, "tags");
    classifiedPath = join(tempDir, "classified");

    await mkdir(audioCachePath, { recursive: true });
    await mkdir(tagsPath, { recursive: true });
    await mkdir(classifiedPath, { recursive: true });

    plan = {
      config: {
        sidPath: SID_COLLECTION_ROOT,
        audioCachePath,
        tagsPath,
        classifiedPath,
        maxRenderSec: 30,
        introSkipSec: 15,
        maxClassifySec: 15,
        render: { preferredEngines: ["wasm"] },
        threads: 1,
        classificationDepth: 5,
      } as SidflowConfig,
      audioCachePath,
      tagsPath,
      forceRebuild: false,
      classificationDepth: 5,
      sidPath: SID_COLLECTION_ROOT,
    };
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test(
    "classifies every SID in test-data/ with a mocked render (includes 2SID and 3SID)",
    async () => {
      const allSids = await collectSids(SID_COLLECTION_ROOT);
      expect(allSids.length).toBeGreaterThan(0);

      // Verify our two new test SIDs are among the collection
      const sidNames = allSids.map((s) => s.split("/").pop()!);
      expect(sidNames).toContain("Space_Oddity_2SID.sid");
      expect(sidNames).toContain("Waterfall_3SID.sid");

      const result = await generateAutoTags(plan, {
        extractMetadata: async ({ relativePath }) => fallbackMetadataFromPath(relativePath),
        featureExtractor: heuristicFeatureExtractor,
        predictRatings: heuristicPredictRatings,
        // The render mock uses resolveWavPath to write the WAV exactly where the
        // classifier expects it, so every song request gets a valid (silent) file.
        render: async (opts) => {
          await mkdir(dirname(opts.wavFile), { recursive: true });
          await writeFile(opts.wavFile, silentWav());
        },
      });

      // Every SID should produce at least one auto-tagged entry
      expect(result.autoTagged.length).toBeGreaterThan(0);

      // 2SID / 3SID files must each appear in the output
      const tagged2sid = result.autoTagged.filter((e) => e.includes("Space_Oddity_2SID"));
      const tagged3sid = result.autoTagged.filter((e) => e.includes("Waterfall_3SID"));
      expect(tagged2sid.length).toBeGreaterThan(0);
      expect(tagged3sid.length).toBeGreaterThan(0);

      // No render degradation; all songs should complete via the mock
      expect(result.metrics.renderedFallbackCount).toBe(0);
      expect(result.metrics.metadataOnlyCount).toBe(0);
    },
    60_000
  );
});
