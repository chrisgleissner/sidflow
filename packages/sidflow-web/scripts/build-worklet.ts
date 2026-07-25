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

  // Both engines are deployed: reSIDfp at the root, SIDLite in sidlite/, mirroring
  // dist/. The browser player asks for reSIDfp explicitly, but shipping both means
  // a caller can pass { engine: 'sidlite' } without the loader reaching outside
  // the served directory.
  const sidliteDistDir = path.join(wasmDistDir, 'sidlite');
  const sidlitePublicDir = path.join(wasmPublicDir, 'sidlite');
  for (const file of ['libsidplayfp.wasm', 'libsidplayfp.js']) {
    const source = Bun.file(path.join(sidliteDistDir, file));
    if (await source.exists()) {
      await Bun.write(path.join(sidlitePublicDir, file), await source.arrayBuffer());
    }
  }

  const indexSource = await Bun.file(path.join(wasmDistDir, 'index.js')).text();
  // Global, not first-match: index.js references ../dist/ several times (the
  // default artifact, the SIDLite base URL, and the dynamic SIDLite import), and
  // any left behind escapes the served /wasm/ directory at runtime.
  const indexRewritten = indexSource.replaceAll('../dist/', './');
  if (indexRewritten.includes('../dist/')) {
    throw new Error('index.js still references ../dist/ after rewriting; it would not resolve under /wasm/');
  }
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
