#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const testWorkspace = resolve(repoRoot, 'test-workspace');
const testData = resolve(repoRoot, 'test-data');
const prefsFile = resolve(repoRoot, '.sidflow-preferences.json');

console.log('Setting up test workspace...');
console.log(`  Source: ${testData}`);
console.log(`  Target: ${testWorkspace}`);

// Reset preferences to avoid conflicts with production sidBasePath
if (existsSync(prefsFile)) {
    console.log('  Resetting preferences for test run...');
    try {
        const prefs = JSON.parse(readFileSync(prefsFile, 'utf8'));
        // Clear sidBasePath so tests use config's sidPath instead
        delete prefs.sidBasePath;
        writeFileSync(prefsFile, JSON.stringify(prefs, null, 2));
        console.log('  ✓ Preferences reset (sidBasePath cleared)');
    } catch (err) {
        console.warn(`  ⚠ Could not reset preferences: ${err.message}`);
    }
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
