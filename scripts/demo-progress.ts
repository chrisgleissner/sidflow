#!/usr/bin/env bun
/**
 * Demo script to test the progress output of the classify CLI
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runClassifyCli } from "../packages/sidflow-classify/src/cli.js";

async function main() {
  // Create a temporary workspace
  const testRoot = path.join(tmpdir(), "sidflow-progress-demo");
  await rm(testRoot, { recursive: true, force: true }).catch(() => { });

  const hvscPath = path.join(testRoot, "hvsc");
  const wavCachePath = path.join(testRoot, "wav");
  const tagsPath = path.join(testRoot, "tags");

  await mkdir(hvscPath, { recursive: true });
  await mkdir(wavCachePath, { recursive: true });
  await mkdir(tagsPath, { recursive: true });

  // Create some test SID files
  console.log("Creating test files...");
  for (let i = 0; i < 20; i++) {
    await writeFile(path.join(hvscPath, `song${i}.sid`), `test-content-${i}`);
  }

  // Create config file
  const configPath = path.join(testRoot, ".sidflow.json");
  await writeFile(
    configPath,
    JSON.stringify({
      hvscPath,
      wavCachePath,
      tagsPath,
      threads: 2,
      classificationDepth: 3
    })
  );

  console.log("Running classification with progress...\n");

  // Mock implementations
  const { planClassification, buildWavCache, generateAutoTags } = await import("../packages/sidflow-classify/src/index.js");

  const mockRender = async ({ wavFile }: any) => {
    await mkdir(path.dirname(wavFile), { recursive: true });
    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, 50));
    await writeFile(wavFile, "mock-wav-data");
    // Store hash file
  const hashFile = `${wavFile}.sha256`;
    await writeFile(hashFile, "mock-hash");
  };

  const mockExtractMetadata = async () => ({ title: "Test Song" });
  const mockFeatureExtractor = async () => ({ energy: 0.5 });
  const mockPredictRatings = async () => ({ s: 3, m: 3, c: 3, e: 3 });

  await runClassifyCli(["--config", configPath], {
    stdout: process.stdout,
    stderr: process.stderr,
    planClassification,
    buildWavCache,
    generateAutoTags,
    loadRenderModule: async () => mockRender,
    loadMetadataModule: async () => mockExtractMetadata,
    loadFeatureModule: async () => mockFeatureExtractor,
    loadPredictorModule: async () => mockPredictRatings
  });

  // Cleanup
  console.log("\n\nCleaning up...");
  await rm(testRoot, { recursive: true, force: true });
}

main().catch(console.error);
