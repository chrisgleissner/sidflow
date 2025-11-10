/**
 * Build script for AudioWorklet processor and Web Worker.
 * 
 * Bundles the worklet and worker code into single JS files.
 */

import * as path from 'node:path';
import { build } from 'bun';

const projectRoot = path.resolve(import.meta.dir, '..');

// Worklet build
const workletSource = path.join(projectRoot, 'lib/audio/worklet/sid-renderer.worklet.ts');
const workletOutputDir = path.join(projectRoot, 'public/audio/worklet');

// Worker build
const workerSource = path.join(projectRoot, 'lib/audio/worker/sid-producer.worker.ts');
const workerOutputDir = path.join(projectRoot, 'public/audio/worker');

async function buildWorklet() {
  console.log('[build-worklet] Building AudioWorklet processor...');
  console.log(`  Source: ${workletSource}`);

  // Ensure output directory exists
  await Bun.write(path.join(workletOutputDir, '.gitkeep'), '');

  const result = await build({
    entrypoints: [workletSource],
    outdir: workletOutputDir,
    target: 'browser',
    format: 'esm',
    minify: false,
    sourcemap: 'inline',
    naming: '[dir]/[name].js',
  });

  if (!result.success) {
    console.error('[build-worklet] Build failed');
    for (const log of result.logs) {
      console.error(log);
    }
    throw new Error('Worklet build failed');
  }

  console.log('[build-worklet] ✓ Worklet build successful');
}

async function buildWorker() {
  console.log('[build-worker] Building Web Worker...');
  console.log(`  Source: ${workerSource}`);

  // Ensure output directory exists
  await Bun.write(path.join(workerOutputDir, '.gitkeep'), '');

  const result = await build({
    entrypoints: [workerSource],
    outdir: workerOutputDir,
    target: 'browser',
    format: 'esm',
    minify: false,
    sourcemap: 'inline',
    naming: '[dir]/[name].js',
    // Mark @sidflow/libsidplayfp-wasm as external so it can be imported at runtime
    external: ['@sidflow/libsidplayfp-wasm'],
  });

  if (!result.success) {
    console.error('[build-worker] Build failed');
    for (const log of result.logs) {
      console.error(log);
    }
    throw new Error('Worker build failed');
  }

  console.log('[build-worker] ✓ Worker build successful');
}

try {
  await buildWorklet();
  await buildWorker();
  console.log('[build] ✓ All audio components built successfully');
} catch (error) {
  console.error('[build] Build error:', error);
  process.exit(1);
}
