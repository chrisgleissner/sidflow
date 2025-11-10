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
const wasmDistDir = path.join(projectRoot, '../libsidplayfp-wasm/dist');
const wasmPublicDir = path.join(projectRoot, 'public/wasm');

async function copyWasmArtifacts(): Promise<void> {
  console.log('[build-worker] Syncing libsidplayfp WASM artifacts...');

  const wasmBinary = await Bun.file(path.join(wasmDistDir, 'libsidplayfp.wasm')).arrayBuffer();
  await Bun.write(path.join(wasmPublicDir, 'libsidplayfp.wasm'), wasmBinary);

  const wasmJs = await Bun.file(path.join(wasmDistDir, 'libsidplayfp.js')).text();
  await Bun.write(path.join(wasmPublicDir, 'libsidplayfp.js'), wasmJs);

  const indexSource = await Bun.file(path.join(wasmDistDir, 'index.js')).text();
  const indexRewritten = indexSource
    .replace('../dist/libsidplayfp.js', './libsidplayfp.js')
    .replace('new URL("../dist/', 'new URL("./');
  await Bun.write(path.join(wasmPublicDir, 'index.js'), indexRewritten);

  const playerSource = await Bun.file(path.join(wasmDistDir, 'player.js')).text();
  await Bun.write(path.join(wasmPublicDir, 'player.js'), playerSource);
}

async function rewriteWorkerImports(): Promise<void> {
  const workerPath = path.join(workerOutputDir, 'sid-producer.worker.js');
  const source = await Bun.file(workerPath).text();
  const rewritten = source.replace(/from "@sidflow\/libsidplayfp-wasm"/g, 'from "../../wasm/index.js"');
  if (rewritten !== source) {
    await Bun.write(workerPath, rewritten);
  }
}

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
  await copyWasmArtifacts();
  await rewriteWorkerImports();
  console.log('[build] ✓ All audio components built successfully');
} catch (error) {
  console.error('[build] Build error:', error);
  process.exit(1);
}
