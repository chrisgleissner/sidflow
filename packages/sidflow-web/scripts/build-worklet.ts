/**
 * Build script for AudioWorklet processor and Web Worker.
 * 
 * Bundles the worklet and worker code into single JS files.
 */

import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'bun';

const projectRoot = path.resolve(import.meta.dir, '..');

// Worklet build
const workletSource = path.join(projectRoot, 'lib/audio/worklet/sid-renderer.worklet.ts');
const workletOutputDir = path.join(projectRoot, 'public/audio/worklet');

// Worker build
const workerSource = path.join(projectRoot, 'lib/audio/worker/sid-producer.worker.ts');
const workerOutputDir = path.join(projectRoot, 'public/audio/worker');
// Resolved through node_modules rather than a sibling workspace path, so the
// served artifacts come from the published, integrity-checked package.
const wasmDistDir = path.join(
  path.dirname(fileURLToPath(import.meta.resolve('libsidplayfp-wasm/package.json'))),
  'dist',
);
const wasmPublicDir = path.join(projectRoot, 'public/wasm');

async function copyWasmArtifacts(): Promise<void> {
  console.log('[build-worker] Syncing libsidplayfp WASM artifacts...');

  // Copy what the package ships, rather than a hand-listed subset. The list this
  // replaces named four files and missed `upstream-versions.js`, which `index.js`
  // imports — so the served bundle referenced a module that was never deployed.
  // A list has to be updated every time the package grows a module; a filter only
  // has to know what a browser never needs.
  const runtimeOnly = (name: string) =>
    !name.endsWith('.d.ts') &&
    !name.endsWith('.map') &&
    !name.endsWith('.md') &&
    !name.startsWith('complete-source.tar.gz') &&
    name !== 'package.json' &&
    name !== 'LICENSE' &&
    name !== 'UPSTREAM.json';

  let copied = 0;
  for (const relative of ['', 'sidlite']) {
    const from = path.join(wasmDistDir, relative);
    const to = path.join(wasmPublicDir, relative);
    for (const entry of await readdir(from, { withFileTypes: true })) {
      if (!entry.isFile() || !runtimeOnly(entry.name)) continue;
      const source = Bun.file(path.join(from, entry.name));
      // index.js is copied unmodified. Up to libsidplayfp-wasm 0.1.0 it reached
      // outside its own directory (`../dist/...`), which did not resolve once
      // served from /wasm/, so it had to be rewritten here — and a rewritten
      // copy is one that can drift from the package it claims to be. Since
      // 0.1.1 it resolves relative to itself; the check below keeps it that way
      // instead of quietly reintroducing the rewrite on some future version.
      if (entry.name.endsWith('.js')) {
        const text = await source.text();
        const escaping = [...text.matchAll(/["(](\.\.\/[^"')]+)["')]/g)].map((match) => match[1]);
        if (escaping.length > 0) {
          throw new Error(
            `${relative || '.'}/${entry.name} reaches outside its own directory ` +
              `(${escaping.join(', ')}), which will not resolve under /wasm/`,
          );
        }
        await Bun.write(path.join(to, entry.name), text);
      } else {
        await Bun.write(path.join(to, entry.name), await source.arrayBuffer());
      }
      copied++;
    }
  }

  // Every relative import in what we just deployed must land inside it.
  for (const relative of ['', 'sidlite']) {
    const dir = path.join(wasmPublicDir, relative);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      const text = await Bun.file(path.join(dir, entry.name)).text();
      for (const match of text.matchAll(/from\s+"(\.[^"]+)"|import\("(\.[^"]+)"\)/g)) {
        // Two alternatives, so the specifier is in whichever group matched.
        const specifier = match[1] ?? match[2];
        const target = path.resolve(dir, specifier);
        if (!(await Bun.file(target).exists())) {
          throw new Error(`${entry.name} imports ${specifier}, which is not deployed under public/wasm/`);
        }
      }
    }
  }

  console.log(`[build-worker] ${copied} files -> public/wasm/`);
}

async function rewriteWorkerImports(): Promise<void> {
  const workerPath = path.join(workerOutputDir, 'sid-producer.worker.js');
  const source = await Bun.file(workerPath).text();
  const rewritten = source.replace(/from "libsidplayfp-wasm"/g, 'from "../../wasm/index.js"');
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
    external: ['libsidplayfp-wasm'],
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
