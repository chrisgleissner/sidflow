#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const testWorkspace = resolve(repoRoot, 'test-workspace');
const testData = resolve(repoRoot, 'test-data');
// Web preferences are stored under repoRoot/data/.sidflow-preferences.json (see lib/preferences-store.ts).
// Keep E2E runs deterministic by resetting scheduler + sidBasePath there.
const prefsFile = resolve(repoRoot, 'data', '.sidflow-preferences.json');

console.log('Setting up test workspace...');
console.log(`  Source: ${testData}`);
console.log(`  Target: ${testWorkspace}`);

// Reset preferences to avoid conflicts with production sidBasePath
console.log('  Resetting preferences for test run...');
try {
  const existing = existsSync(prefsFile) ? JSON.parse(readFileSync(prefsFile, 'utf8')) : {};
  // Clear sidBasePath so tests use config's sidPath instead
  delete existing.sidBasePath;
  // Disable any background schedulers / training to avoid unexpected pipeline runs during E2E.
  existing.scheduler = { enabled: false, time: '06:00', timezone: 'UTC' };
  existing.training = { enabled: false };
  // Keep renderPrefs deterministic (avoid side effects like deleting WAVs between tests).
  existing.renderPrefs = { preserveWav: true, enableFlac: false, enableM4a: false };
  mkdirSync(dirname(prefsFile), { recursive: true });
  writeFileSync(prefsFile, JSON.stringify(existing, null, 2));
  console.log('  ✓ Preferences reset (scheduler disabled, sidBasePath cleared)');
} catch (err) {
  console.warn(`  ⚠ Could not reset preferences: ${err.message}`);
}

// Clean existing test-workspace
if (existsSync(testWorkspace)) {
    console.log('  Cleaning existing test-workspace...');
    rmSync(testWorkspace, { recursive: true, force: true });
}

// Create test-workspace structure
console.log('  Creating test-workspace directories...');
mkdirSync(testWorkspace, { recursive: true });
mkdirSync(resolve(testWorkspace, 'hvsc'), { recursive: true });
mkdirSync(resolve(testWorkspace, 'wav-cache'), { recursive: true });
mkdirSync(resolve(testWorkspace, 'tags'), { recursive: true });

// Copy test-data/C64Music to test-workspace/hvsc/C64Music
const sourceMusic = resolve(testData, 'C64Music');
const targetMusic = resolve(testWorkspace, 'hvsc', 'C64Music');

if (existsSync(sourceMusic)) {
    console.log('  Copying C64Music files...');
    cpSync(sourceMusic, targetMusic, { recursive: true });
    console.log('  ✓ Test workspace ready');
} else {
    console.error(`  ✗ Source directory not found: ${sourceMusic}`);
    process.exit(1);
}
