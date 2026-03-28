/**
 * High-risk SID classification test — graceful render failure handling
 *
 * Tests that multi-SID (2SID/3SID) and other high-risk SID files never crash
 * the classification pipeline and always produce a classification record.
 *
 * Strategy: inject a mock render function that always throws, simulating the
 * "Out of bounds memory access" WASM crash observed on Missile_Defence_2SID.sid
 * and similar files.  The fix in index.ts catches the exhausted fallback ladder,
 * sets wavRenderFailed=true, and produces an "unavailable" feature record so
 * every song is still classified.
 *
 * We run the whole test-data corpus (which includes Waterfall_3SID, Space_Oddity_2SID,
 * Super_Mario_Bros_64_2SID, Great_Giana_Sisters, and normal single-SID files) through
 * three identical rounds to satisfy the 3-consecutive-pass requirement.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { type SidflowConfig, type ClassificationRecord } from "@sidflow/common";
import {
  generateAutoTags,
  heuristicFeatureExtractor,
  heuristicPredictRatings,
  planClassification,
  type RenderWav,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = path.join(import.meta.dir, "../../../");
const TEST_SID_ROOT = path.join(REPO_ROOT, "test-data/C64Music");

/**
 * High-risk files present in test-data — must all produce a classification record
 * regardless of whether the WASM renderer supports them.
 */
const HIGH_RISK_RELATIVE_PATHS = [
  "MUSICIANS/C/Chiummo_Gaetano/Waterfall_3SID.sid",  // 3SID v4 — chip addr $4244/$0010
  "MUSICIANS/C/C0zmo/Space_Oddity_2SID.sid",          // 2SID v3 — chip addr $5000
  "GAMES/S-Z/Super_Mario_Bros_64_2SID.sid",           // 2SID v3, 37 subtunes — addr $4200
  "MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid", // 23 subtunes (single SID)
];

// ---------------------------------------------------------------------------
// Mock render — mimics the WASM crash for unsupported chip configurations
// ---------------------------------------------------------------------------

/**
 * A render function that always throws, simulating the "Out of bounds memory access"
 * (getWasmTableEntry) crash seen in libsidplayfp-wasm when processing 2SID/3SID files
 * that use chip addresses not supported by the current WASM build.
 *
 * The error message matches the WASM crash pattern so that isRecoverableError() correctly
 * classifies it as fatal, bypassing all retry delays for fast test execution.
 */
const alwaysFailingRender: RenderWav = async (_options) => {
  throw new Error("Out of bounds memory access (evaluating 'getWasmTableEntry(index)(a1)'): mock render failure for high-risk SID");
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readClassificationRecords(jsonlFile: string): Promise<ClassificationRecord[]> {
  const content = await readFile(jsonlFile, "utf8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ClassificationRecord);
}

interface RoundResult {
  jsonlRecordCount: number;
  metadataOnlyCount: number;
  records: ClassificationRecord[];
}

async function runOneRound(tmpDir: string): Promise<RoundResult> {
  const configPath = path.join(tmpDir, ".sidflow.json");
  const audioCachePath = path.join(tmpDir, "wav");
  const tagsPath = path.join(tmpDir, "tags");
  const lifecycleLogPath = path.join(tmpDir, "lifecycle.jsonl");

  await mkdir(audioCachePath, { recursive: true });
  await mkdir(tagsPath, { recursive: true });

  const config: SidflowConfig = {
    sidPath: TEST_SID_ROOT,
    audioCachePath,
    tagsPath,
    threads: 1,
    classificationDepth: 3,
    maxRenderSec: 10,
    introSkipSec: 1,
    maxClassifySec: 5,
    render: { preferredEngines: ["wasm"] },
  } as SidflowConfig;
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

  const plan = await planClassification({ configPath, forceRebuild: true });

  const result = await generateAutoTags(plan, {
    threads: 1,
    render: alwaysFailingRender,
    featureExtractor: heuristicFeatureExtractor,
    predictRatings: heuristicPredictRatings,
    lifecycleLogPath,
  });

  const records = await readClassificationRecords(result.jsonlFile);

  return {
    jsonlRecordCount: result.jsonlRecordCount,
    metadataOnlyCount: result.metrics.metadataOnlyCount,
    records,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("High-risk SID classification — graceful render failure", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "sidflow-high-risk-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // We run three independent rounds in one test to prove reproducibility.
  // Each round creates its own prefix inside tmpDir to prevent WAV cache reuse.
  test("classifies all test-data SID songs without crashing — 3 consecutive rounds", async () => {
    let firstRoundCount: number | undefined;

    for (let round = 1; round <= 3; round++) {
      const roundDir = path.join(tmpDir, `round-${round}`);
      await mkdir(roundDir, { recursive: true });

      const { jsonlRecordCount, metadataOnlyCount, records } = await runOneRound(roundDir);

      // Every song across all SID files must produce exactly one record.
      expect(jsonlRecordCount, `round ${round}: record count must be > 0`).toBeGreaterThan(0);
      expect(
        records.length,
        `round ${round}: parsed record count must match jsonlRecordCount`
      ).toBe(jsonlRecordCount);

      // All renders failed → every record represents a metadata-only classification.
      expect(
        metadataOnlyCount,
        `round ${round}: metadataOnlyCount must equal jsonlRecordCount`
      ).toBe(jsonlRecordCount);

      // Every record must carry "unavailable" as the SID feature variant.
      for (const record of records) {
        expect(
          record.features?.sidFeatureVariant,
          `round ${round}: ${record.sid_path} must have sidFeatureVariant="unavailable"`
        ).toBe("unavailable");
      }

      // All high-risk files must be represented in the output.
      const sidPaths = new Set(records.map((r) => r.sid_path));
      for (const rel of HIGH_RISK_RELATIVE_PATHS) {
        const posix = rel.replace(/\\/g, "/");
        // sid_path uses posix-relative path; find at least one record for this file.
        const hasRecord = [...sidPaths].some((p) => p.endsWith(posix) || p === posix);
        expect(hasRecord, `round ${round}: no record found for high-risk file ${posix}`).toBe(true);
      }

      // Record count must be deterministic across rounds.
      if (firstRoundCount === undefined) {
        firstRoundCount = jsonlRecordCount;
      } else {
        expect(
          jsonlRecordCount,
          `round ${round}: record count must match round 1 (${firstRoundCount})`
        ).toBe(firstRoundCount);
      }
    }
  }, 120_000); // 2-minute timeout: 3 rounds × classification of ~67 songs
});
