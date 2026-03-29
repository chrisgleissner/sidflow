/**
 * High-risk SID classification test — WASM-error SIDs are recorded as failures.
 *
 * When rendering fails with a non-recoverable WASM error on every fallback profile
 * (e.g. "out of bounds memory access" on 2SID/3SID files with unsupported chip
 * addresses), the SID must not produce a successful classification record, but it
 * must be written to the structured failure JSONL so the batch can continue.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Minimal silent WAV: 44-byte RIFF header, mono, 16-bit PCM, 44 100 Hz, 0 samples.
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

describe("High-risk SID classification — WASM errors skip the SID silently", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "sidflow-high-risk-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("records un-renderable SIDs as structured failures without writing classification records — 3 consecutive rounds", async () => {
    for (let round = 1; round <= 3; round++) {
      for (const rel of HIGH_RISK_RELATIVE_PATHS) {
        const caseDir = path.join(tmpDir, `round-${round}`, rel.replace(/[\\/]/g, "_"));
        await mkdir(caseDir, { recursive: true });

        const { plan, classifiedPath, lifecycleLogPath } = await createRoundPlan(caseDir);

        // When all render attempts fail with non-recoverable WASM errors,
        // generateAutoTags must resolve, write zero successful classification
        // records, and persist one structured failure record.
        const result = await generateAutoTags(plan, {
          threads: 1,
          render: alwaysFailingRender,
          featureExtractor: heuristicFeatureExtractor,
          predictRatings: heuristicPredictRatings,
          lifecycleLogPath,
          sidPathPrefix: rel,
          limit: 1,
        });

        expect(
          result.jsonlRecordCount,
          `round ${round}: ${rel} must produce 0 records when render always fails with WASM errors`
        ).toBe(0);

        const classifiedEntries = await readdir(classifiedPath);
        const classificationJsonl = classifiedEntries.filter(
          (entry) => /^classification_.*\.jsonl$/.test(entry) && !entry.endsWith(".events.jsonl") && !entry.endsWith(".failures.jsonl")
        );
        expect(
          classificationJsonl,
          `round ${round}: ${rel} must not persist successful classification records after render failure`
        ).toEqual([]);

        expect(result.metrics.failedCount).toBe(1);
        expect(result.metrics.retriedCount).toBe(1);

        const failureLines = (await readFile(result.failureFile, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(failureLines).toHaveLength(1);
        expect(failureLines[0]?.sid_path).toBe(rel);
        expect(failureLines[0]?.error).toEqual(expect.stringContaining("Out of bounds memory access"));
      }
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Regression: skip-hole in flushIntermediate
// ---------------------------------------------------------------------------
// When the FIRST job in the queue fails with a WASM error, flushIntermediate
// must still flush the results for all subsequent jobs.  Before the fix, a
// missing slot at index 0 would permanently block all later indices from ever
// being written, producing 0 records even though later songs were renderable.
// ---------------------------------------------------------------------------

describe("Skip-hole regression — songs after a WASM-skipped slot are still classified", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "sidflow-skip-hole-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("songs after WASM-skipped index 0 produce classification records", async () => {
    // MUSICIANS/G contains two SIDs, sorted alphabetically:
    //   index 0: Garvalf/Lully_Marche_...  ← mock render throws (WASM error)
    //   index 1+: Greenlee_Michael/Foreign_Carols.sid  ← mock render succeeds
    //
    // Without the skip-hole fix, index 0's missing slot blocks index 1+ forever
    // → 0 records.  With the fix, the skipped slot is registered and
    // flushIntermediate advances past it → Greenlee_Michael is classified.
    const selectiveFailRender: RenderWav = async (options) => {
      if (options.sidFile.includes("Garvalf")) {
        // Simulate the WASM error text that isSkippableSidError() recognises.
        throw new Error(
          "Out of bounds memory access (evaluating 'getWasmTableEntry(index)(a1)'): skip-hole test"
        );
      }
      await mkdir(path.dirname(options.wavFile), { recursive: true });
      await writeFile(options.wavFile, silentWav());
    };

    const caseDir = path.join(tmpDir, "skip-hole");
    await mkdir(caseDir, { recursive: true });
    const { plan, lifecycleLogPath } = await createRoundPlan(caseDir);

    const result = await generateAutoTags(plan, {
      threads: 1,
      render: selectiveFailRender,
      featureExtractor: heuristicFeatureExtractor,
      predictRatings: heuristicPredictRatings,
      lifecycleLogPath,
      sidPathPrefix: "MUSICIANS/G",
    });

    // At least Greenlee_Michael must produce a classification record.
    expect(
      result.jsonlRecordCount,
      "songs following a WASM-skipped slot must not be silently dropped"
    ).toBeGreaterThan(0);
  }, 60_000);
});
