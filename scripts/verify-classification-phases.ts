#!/usr/bin/env bun

/**
 * Manual verification script for classification phase transitions and heartbeat.
 * 
 * Run this script to verify:
 * 1. All expected phases appear: analyzing → metadata → building → tagging
 * 2. Threads never show "Stale" status (no 5+ second gaps)
 * 3. Heartbeat mechanism works during inline rendering
 * 
 * Usage: bun run scripts/verify-classification-phases.ts
 */

import { rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAutoTags } from '../packages/sidflow-classify/src/index.js';
import type { ClassificationPlan } from '../packages/sidflow-classify/src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const testWorkspace = path.resolve(repoRoot, 'test-workspace');
const testDataPath = path.resolve(repoRoot, 'test-data');
const testWavCache = path.resolve(testWorkspace, 'wav-cache');
const testTagsPath = path.resolve(testWorkspace, 'tags');

console.log('\n=== Classification Phase Transition Verification ===\n');

// Clear WAV cache to force rebuild
try {
  rmSync(testWavCache, { recursive: true, force: true });
  console.log(`[Setup] Cleared WAV cache: ${testWavCache}\n`);
} catch {
  console.log(`[Setup] WAV cache already clean\n`);
}

const threadHistory = new Map();
let lastUpdate = Date.now();
const MAX_UPDATE_GAP_MS = 5000; // Stale threshold
let maxGapMs = 0;
let staleGaps = 0;

const handleThreadUpdate = (update: any) => {
  const now = Date.now();
  const gap = now - lastUpdate;

  if (gap > maxGapMs) {
    maxGapMs = gap;
  }

  if (!threadHistory.has(update.threadId)) {
    threadHistory.set(update.threadId, { states: [] });
  }

  const history = threadHistory.get(update.threadId);
  const prevState = history.states[history.states.length - 1];

  // Only log state changes
  if (!prevState ||
      prevState.phase !== update.phase ||
      prevState.status !== update.status ||
      prevState.file !== update.file) {
    
    const state = {
      timestamp: now,
      phase: update.phase,
      status: update.status,
      file: update.file,
      gap
    };

    history.states.push(state);

    const gapInfo = gap > 100 ? ` [${gap}ms since last update]` : '';
    console.log(
      `[Thread ${update.threadId}] ${update.phase} - ${update.status}${gapInfo}` +
      (update.file ? ` - ${path.basename(update.file)}` : '')
    );

    // Check for stale gaps
    if (gap > MAX_UPDATE_GAP_MS) {
      staleGaps++;
      console.error(
        `❌ [STALE] Thread ${update.threadId} went ${gap}ms without updates ` +
        `(threshold: ${MAX_UPDATE_GAP_MS}ms)!`
      );
    }
  }

  lastUpdate = now;
};

const plan: ClassificationPlan = {
  config: {
    sidPath: testDataPath,
    wavCachePath: testWavCache,
    tagsPath: testTagsPath,
    threads: 1,
    classificationDepth: 3
  } as any,
  sidPath: testDataPath,
  wavCachePath: testWavCache,
  tagsPath: testTagsPath,
  forceRebuild: true,
  classificationDepth: 3
};

console.log(`[Config] Testing with: ${testDataPath}`);
console.log(`[Config] Force rebuild enabled\n`);

try {
  await generateAutoTags(plan, {
    threads: 1,
    onThreadUpdate: handleThreadUpdate
  });

  console.log('\n=== Verification Results ===\n');

  console.log(`Threads monitored: ${threadHistory.size}`);
  console.log(`Maximum update gap: ${maxGapMs}ms`);
  console.log(`Stale gaps detected: ${staleGaps}\n`);

  for (const [threadId, history] of threadHistory) {
    const phases = new Set(history.states.map((s: any) => s.phase));
    console.log(`Thread ${threadId}:`);
    console.log(`  - State transitions: ${history.states.length}`);
    console.log(`  - Phases: ${Array.from(phases).join(' → ')}`);
    
    // Check for critical phases
    const hasBuilding = phases.has('building');
    const hasTagging = phases.has('tagging');
    
    console.log(`  - Has "building" phase: ${hasBuilding ? '✅' : '❌'}`);
    console.log(`  - Has "tagging" phase: ${hasTagging ? '✅' : '❌'}`);
  }

  console.log('\n=== Overall Result ===\n');

  if (staleGaps === 0 && maxGapMs < MAX_UPDATE_GAP_MS) {
    console.log('✅ SUCCESS: No stale thread gaps detected!');
    console.log('✅ Heartbeat mechanism working correctly');
    process.exit(0);
  } else {
    console.error('❌ FAILURE: Stale thread gaps detected!');
    console.error(`   Maximum gap: ${maxGapMs}ms (threshold: ${MAX_UPDATE_GAP_MS}ms)`);
    console.error(`   Stale gaps: ${staleGaps}`);
    process.exit(1);
  }

} catch (error) {
  console.error('\n❌ Classification failed:', error);
  process.exit(1);
}
