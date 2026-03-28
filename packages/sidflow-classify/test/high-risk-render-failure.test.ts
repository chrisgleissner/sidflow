/**
 * High-risk SID classification test — fail fast on render failure
 *
 * Multi-SID and other high-risk fixtures must abort classification explicitly when
 * rendering fails. The strict classify path must not persist metadata-only records
 * or normalize exhausted render attempts as success.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { type SidflowConfig } from "@sidflow/common";
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
 * High-risk files present in test-data — strict classification must abort for these
 * fixtures if rendering fails.
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

async function createRoundPlan(tmpDir: string) {
  const configPath = path.join(tmpDir, ".sidflow.json");
  const audioCachePath = path.join(tmpDir, "wav");
  const tagsPath = path.join(tmpDir, "tags");
  const classifiedPath = path.join(tmpDir, "classified");
  const lifecycleLogPath = path.join(tmpDir, "lifecycle.jsonl");

  await mkdir(audioCachePath, { recursive: true });
  await mkdir(tagsPath, { recursive: true });
  await mkdir(classifiedPath, { recursive: true });

  const config: SidflowConfig = {
    sidPath: TEST_SID_ROOT,
    audioCachePath,
    tagsPath,
    classifiedPath,
    threads: 1,
    classificationDepth: 3,
    maxRenderSec: 10,
    introSkipSec: 1,
    maxClassifySec: 5,
    render: { preferredEngines: ["wasm"] },
  } as SidflowConfig;
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

  return {
    plan: await planClassification({ configPath, forceRebuild: true }),
    classifiedPath,
    lifecycleLogPath,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("High-risk SID classification — fail fast on render failure", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "sidflow-high-risk-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("aborts on high-risk render failure without writing classification records — 3 consecutive rounds", async () => {
    for (let round = 1; round <= 3; round++) {
      for (const rel of HIGH_RISK_RELATIVE_PATHS) {
        const caseDir = path.join(tmpDir, `round-${round}`, rel.replace(/[\\/]/g, "_"));
        await mkdir(caseDir, { recursive: true });

        const { plan, classifiedPath, lifecycleLogPath } = await createRoundPlan(caseDir);

        await expect(
          generateAutoTags(plan, {
            threads: 1,
            render: alwaysFailingRender,
            featureExtractor: heuristicFeatureExtractor,
            predictRatings: heuristicPredictRatings,
            lifecycleLogPath,
            sidPathPrefix: rel,
            limit: 1,
          })
        ).rejects.toThrow(/Render attempts exhausted|mock render failure/);

        const classifiedEntries = await readdir(classifiedPath);
        const classificationJsonl = classifiedEntries.filter(
          (entry) => /^classification_.*\.jsonl$/.test(entry) && !entry.endsWith(".events.jsonl")
        );
        expect(
          classificationJsonl,
          `round ${round}: ${rel} must not persist successful classification records after render failure`
        ).toEqual([]);
      }
    }
  }, 120_000);
});
