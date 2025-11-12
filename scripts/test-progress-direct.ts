#!/usr/bin/env bun
/**
 * Direct test of progress functionality
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";

async function main() {
  const { planClassification, buildWavCache, generateAutoTags } = await import("../packages/sidflow-classify/src/index.js");

  // Create a temporary workspace
  const testRoot = path.join(tmpdir(), "sidflow-progress-test");
  await rm(testRoot, { recursive: true, force: true }).catch(() => { });

  const hvscPath = path.join(testRoot, "hvsc");
  const wavCachePath = path.join(testRoot, "wav");
  const tagsPath = path.join(testRoot, "tags");

  await mkdir(hvscPath, { recursive: true });

  // Create test SID files
  console.log("Creating 15 test SID files...");
  for (let i = 0; i < 15; i++) {
    await writeFile(path.join(hvscPath, `song${String(i).padStart(2, '0')}.sid`), `test-${i}`);
  }

  // Create config file
  const configPath = path.join(testRoot, ".sidflow.json");
  await writeFile(
    configPath,
    JSON.stringify({
      hvscPath,
      wavCachePath,
      tagsPath,
      threads: os.cpus().length,
      classificationDepth: 3
    })
  );

  const plan = await planClassification({ configPath });

  console.log(`\nStarting WAV cache build (threads: ${plan.config.threads || os.cpus().length})...\n`);

  // Mock render that simulates work
  const mockRender = async ({ wavFile }: any) => {
    await mkdir(path.dirname(wavFile), { recursive: true });
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate work
    await writeFile(wavFile, "mock-wav");
    await writeFile(`${wavFile}.hash`, "mock-hash");
  };

  const result = await buildWavCache(plan, {
    render: mockRender,
    onProgress: (progress) => {
      const percent = progress.percentComplete.toFixed(1).padStart(5);
      const elapsed = `${(progress.elapsedMs / 1000).toFixed(2)}s`.padStart(8);

      if (progress.phase === "analyzing") {
        console.log(`[Analyzing] ${progress.processedFiles}/${progress.totalFiles} files (${percent}%) - ${elapsed}`);
      } else {
        const file = progress.currentFile || "";
        console.log(`[Building] Rendered: ${progress.renderedFiles}, Cached: ${progress.skippedFiles}, Remaining: ${progress.totalFiles - progress.processedFiles} (${percent}%) - ${file.padEnd(15)} - ${elapsed}`);
      }
    }
  });

  console.log(`\n✓ WAV cache complete:`);
  console.log(`  Total files: ${result.metrics.totalFiles}`);
  console.log(`  Rendered: ${result.metrics.rendered}`);
  console.log(`  Cached: ${result.metrics.skipped}`);
  console.log(`  Cache hit rate: ${(result.metrics.cacheHitRate * 100).toFixed(1)}%`);
  console.log(`  Duration: ${(result.metrics.durationMs / 1000).toFixed(2)}s`);

  // Run again to test cache hits
  console.log(`\n\nRunning again to test cache hits...\n`);

  const result2 = await buildWavCache(plan, {
    render: mockRender,
    onProgress: (progress) => {
      const percent = progress.percentComplete.toFixed(1).padStart(5);
      const elapsed = `${(progress.elapsedMs / 1000).toFixed(2)}s`.padStart(8);

      if (progress.phase === "analyzing") {
        console.log(`[Analyzing] ${progress.processedFiles}/${progress.totalFiles} files (${percent}%) - ${elapsed}`);
      } else {
        console.log(`[Building] Rendered: ${progress.renderedFiles}, Cached: ${progress.skippedFiles} (${percent}%) - ${elapsed}`);
      }
    }
  });

  console.log(`\n✓ Second run complete (should be all cached):`);
  console.log(`  Total files: ${result2.metrics.totalFiles}`);
  console.log(`  Rendered: ${result2.metrics.rendered}`);
  console.log(`  Cached: ${result2.metrics.skipped}`);
  console.log(`  Cache hit rate: ${(result2.metrics.cacheHitRate * 100).toFixed(1)}%`);
  console.log(`  Duration: ${(result2.metrics.durationMs / 1000).toFixed(2)}s`);

  // Cleanup
  console.log("\nCleaning up...");
  await rm(testRoot, { recursive: true, force: true });
  console.log("Done!");
}

main().catch(console.error);
