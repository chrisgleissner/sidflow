#!/usr/bin/env bun
/**
 * Classification Pipeline Benchmark Script
 * 
 * Measures per-phase durations for the classification pipeline:
 * - Render: SID → WAV
 * - Extract: WAV → Features (Essentia.js)
 * - Predict: Features → Ratings
 * 
 * Acceptance criteria:
 * - 10_Orbyte.sid: <12s extraction
 * - Average: <6s across benchmark set
 * - Fast fixture run: ≤10s
 */

import { generateAutoTags, planClassification, type ClassificationPlan } from "@sidflow/classify";
import { loadConfig, pathExists } from "@sidflow/common";
import { mkdtemp, rm, mkdir, copyFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

interface BenchmarkResult {
  file: string;
  totalMs: number;
  renderedFiles: number;
  extractedFiles: number;
  recordCount: number;
}

interface PhaseTiming {
  phase: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
}

const BENCHMARK_SIDS = [
  "test-data/C64Music/MUSICIANS/G/Garvalf/Lully_Marche_Ceremonie_Turcs_Wip.sid",
  "test-data/C64Music/MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid",
  "test-data/C64Music/DEMOS/0-9/10_Orbyte.sid",
];

async function runBenchmark(): Promise<void> {
  const startTime = performance.now();
  console.log("🎵 SIDFlow Classification Benchmark\n");
  console.log("=".repeat(60));
  
  // Find available benchmark SIDs
  const availableSids: string[] = [];
  for (const sidPath of BENCHMARK_SIDS) {
    const fullPath = join(process.cwd(), sidPath);
    if (await pathExists(fullPath)) {
      availableSids.push(fullPath);
      console.log(`✓ Found: ${basename(sidPath)}`);
    } else {
      console.log(`✗ Missing: ${basename(sidPath)}`);
    }
  }
  
  if (availableSids.length === 0) {
    console.error("\n❌ No benchmark SIDs found. Please ensure test-data/ is populated.");
    process.exit(1);
  }
  
  console.log(`\nRunning benchmark with ${availableSids.length} SID files...\n`);
  
  const results: BenchmarkResult[] = [];
  
  for (const sidPath of availableSids) {
    const sidName = basename(sidPath);
    console.log(`\n📊 Benchmarking: ${sidName}`);
    console.log("-".repeat(40));
    
    // Create isolated temp workspace
    const tempDir = await mkdtemp(join(tmpdir(), "sidflow-bench-"));
    const testSidPath = join(tempDir, "hvsc");
    const audioCachePath = join(tempDir, "audio-cache");
    const tagsPath = join(tempDir, "tags");
    const classifiedPath = join(tempDir, "classified");
    
    try {
      // Copy SID file to temp workspace
      await mkdir(join(testSidPath, "test"), { recursive: true });
      await copyFile(sidPath, join(testSidPath, "test", sidName));
      await mkdir(tagsPath, { recursive: true });
      await mkdir(classifiedPath, { recursive: true });
      
      // Create classification plan
      const plan: ClassificationPlan = {
        config: {
          sidPath: testSidPath,
          audioCachePath,
          tagsPath,
          classifiedPath,
          threads: 1,
          classificationDepth: 3,
        } as ClassificationPlan["config"],
        audioCachePath,
        tagsPath,
        forceRebuild: true,
        classificationDepth: 3,
        sidPath: testSidPath,
      };
      
      const benchStart = performance.now();
      
      // Run classification
      const result = await generateAutoTags(plan, {
        threads: 1,
        onProgress: (progress) => {
          if (progress.phase === "tagging") {
            const elapsed = (performance.now() - benchStart) / 1000;
            process.stdout.write(`\r  Phase: ${progress.phase} | Extracted: ${progress.extractedFiles} | Elapsed: ${elapsed.toFixed(1)}s`);
          }
        },
      });
      
      const benchEnd = performance.now();
      const totalMs = benchEnd - benchStart;
      
      console.log(`\n  ✓ Completed in ${(totalMs / 1000).toFixed(2)}s`);
      console.log(`    Rendered: ${result.metrics.totalFiles - result.metrics.skippedAlreadyClassified}`);
      console.log(`    JSONL records: ${result.jsonlRecordCount}`);
      
      results.push({
        file: sidName,
        totalMs,
        renderedFiles: result.metrics.totalFiles - result.metrics.skippedAlreadyClassified,
        extractedFiles: result.metrics.predictionsGenerated,
        recordCount: result.jsonlRecordCount,
      });
      
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
  
  // Print summary
  const endTime = performance.now();
  const totalDuration = endTime - startTime;
  
  console.log("\n" + "=".repeat(60));
  console.log("📈 BENCHMARK SUMMARY\n");
  
  const avgMs = results.reduce((sum, r) => sum + r.totalMs, 0) / results.length;
  
  console.log("| File                         | Time (s) | Records |");
  console.log("|------------------------------|----------|---------|");
  for (const r of results) {
    const name = r.file.padEnd(28).substring(0, 28);
    const time = (r.totalMs / 1000).toFixed(2).padStart(8);
    const records = r.recordCount.toString().padStart(7);
    console.log(`| ${name} | ${time} | ${records} |`);
  }
  console.log("|------------------------------|----------|---------|");
  console.log(`| Average                      | ${(avgMs / 1000).toFixed(2).padStart(8)} |         |`);
  console.log(`| Total                        | ${(totalDuration / 1000).toFixed(2).padStart(8)} |         |`);
  
  // Check acceptance criteria
  console.log("\n📋 ACCEPTANCE CRITERIA\n");
  
  const orbyte = results.find(r => r.file.includes("Orbyte"));
  if (orbyte) {
    const pass = orbyte.totalMs < 12000;
    console.log(`${pass ? "✓" : "✗"} 10_Orbyte.sid: ${(orbyte.totalMs / 1000).toFixed(2)}s (target: <12s)`);
  }
  
  const avgPass = avgMs < 6000;
  console.log(`${avgPass ? "✓" : "✗"} Average extraction: ${(avgMs / 1000).toFixed(2)}s (target: <6s)`);
  
  const fixturePass = totalDuration < 10000;
  console.log(`${fixturePass ? "✓" : "✗"} Total benchmark time: ${(totalDuration / 1000).toFixed(2)}s (target: <10s)`);
  
  console.log("\n");
}

runBenchmark().catch(console.error);
