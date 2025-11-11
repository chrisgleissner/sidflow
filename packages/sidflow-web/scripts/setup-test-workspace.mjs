#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const testWorkspace = resolve(repoRoot, 'test-workspace');
const testData = resolve(repoRoot, 'test-data');

console.log('Setting up test workspace...');
console.log(`  Source: ${testData}`);
console.log(`  Target: ${testWorkspace}`);

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
