#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

console.log('=== DEBUG: Testing sidflow-play package ===');

const packagePath = 'packages/sidflow-play';
const testDir = 'test';

console.log(`Package path: ${packagePath}`);
console.log(`Test dir exists: ${existsSync(`${packagePath}/${testDir}`)}`);
console.log(`Current working directory: ${process.cwd()}`);

try {
  console.log('\n--- Running with execSync ---');
  const output = execSync(`bun test "${testDir}" --coverage --coverage-reporter=text`, {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd: packagePath,
    env: process.env,
    maxBuffer: 1024 * 1024 * 10,
  });
  
  console.log('Output length:', output.length);
  console.log('Output preview (first 500 chars):', output.substring(0, 500));
  console.log('Output preview (last 500 chars):', output.substring(Math.max(0, output.length - 500)));
  
} catch (error) {
  console.error('execSync failed:', error.message);
  if (error.stdout) {
    console.log('Error stdout length:', error.stdout.length);
    console.log('Error stdout:', error.stdout);
  }
  if (error.stderr) {
    console.log('Error stderr:', error.stderr);
  }
}