#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(new URL("../", import.meta.url).pathname);
const coverageDir = path.join(repoRoot, "coverage");
const mergedLcovPath = path.join(coverageDir, "lcov.info");

const coverageArgs = [
  "--coverage",
  "--coverage-reporter=lcov",
  "--exclude=**/*.spec.ts",
  "--exclude=**/tests/e2e/**",
  "--exclude=**/dist/**",
];

const batchRoots = [
  { name: "libsidplayfp-wasm", dir: "packages/libsidplayfp-wasm/test", chunkSize: 10 },
  { name: "sidflow-classify", dir: "packages/sidflow-classify/test", chunkSize: 1 },
  { name: "sidflow-common", dir: "packages/sidflow-common/test", chunkSize: 16 },
  { name: "sidflow-fetch", dir: "packages/sidflow-fetch/test", chunkSize: 12 },
  { name: "sidflow-performance", dir: "packages/sidflow-performance/test", chunkSize: 12 },
  { name: "sidflow-play", dir: "packages/sidflow-play/test", chunkSize: 10 },
  { name: "sidflow-rate", dir: "packages/sidflow-rate/test", chunkSize: 12 },
  { name: "sidflow-train", dir: "packages/sidflow-train/test", chunkSize: 12 },
  { name: "sidflow-web", dir: "packages/sidflow-web/tests/unit", chunkSize: 10 },
  { name: "integration-tests", dir: "integration-tests", chunkSize: 10 },
];

function splitIntoChunks(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function collectTestFiles(relativeDir) {
  const absoluteDir = path.join(repoRoot, relativeDir);
  const files = [];

  async function walk(currentDir) {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        files.push(path.relative(repoRoot, fullPath));
      }
    }
  }

  await walk(absoluteDir);
  return files;
}

async function waitForCoverageArtifact(timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      return await readFile(mergedLcovPath, "utf8");
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  let coverageListing = [];
  try {
    coverageListing = await readdir(coverageDir);
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) {
      throw error;
    }
  }

  throw new Error(
    `Coverage reporter did not produce ${path.relative(repoRoot, mergedLcovPath)} within ${timeoutMs}ms` +
      (coverageListing.length > 0 ? ` (found: ${coverageListing.sort().join(", ")})` : "")
  );
}

function spawnCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited with signal ${signal}`));
        return;
      }
      if ((code ?? 0) !== 0) {
        reject(new Error(`${command} exited with code ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });
}

function parseLcov(lcovContent) {
  const files = new Map();
  let current = null;

  for (const rawLine of lcovContent.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      current = { path: line.slice(3), lines: new Map() };
      continue;
    }
    if (line.startsWith("DA:")) {
      if (!current) {
        continue;
      }
      const [lineNumberText, hitsText] = line.slice(3).split(",");
      current.lines.set(Number(lineNumberText), Number(hitsText));
      continue;
    }
    if (line === "end_of_record" && current) {
      files.set(current.path, current);
      current = null;
    }
  }

  return files;
}

function mergeCoverage(targetFiles, incomingFiles) {
  for (const [filePath, incomingCoverage] of incomingFiles.entries()) {
    const existing = targetFiles.get(filePath);
    if (!existing) {
      targetFiles.set(filePath, {
        path: filePath,
        lines: new Map(incomingCoverage.lines),
      });
      continue;
    }

    for (const [lineNumber, hits] of incomingCoverage.lines.entries()) {
      const previousHits = existing.lines.get(lineNumber) ?? 0;
      existing.lines.set(lineNumber, previousHits + hits);
    }
  }
}

function generateLcov(files) {
  const lines = [];
  const sortedFiles = Array.from(files.values()).sort((left, right) => left.path.localeCompare(right.path));

  for (const file of sortedFiles) {
    lines.push(`SF:${file.path}`);
    const sortedLines = Array.from(file.lines.entries()).sort((left, right) => left[0] - right[0]);
    for (const [lineNumber, hits] of sortedLines) {
      lines.push(`DA:${lineNumber},${hits}`);
    }
    const linesFound = sortedLines.length;
    const linesHit = sortedLines.filter(([, hits]) => hits > 0).length;
    lines.push(`LF:${linesFound}`);
    lines.push(`LH:${linesHit}`);
    lines.push("end_of_record");
  }

  return `${lines.join("\n")}\n`;
}

async function prepareBatches() {
  const batches = [];

  for (const root of batchRoots) {
    const files = await collectTestFiles(root.dir);
    const chunks = splitIntoChunks(files, root.chunkSize);
    chunks.forEach((chunk, chunkIndex) => {
      batches.push({
        name: chunks.length === 1 ? root.name : `${root.name}-${chunkIndex + 1}`,
        files: chunk,
      });
    });
  }

  return batches.filter((batch) => batch.files.length > 0);
}

async function main() {
  process.chdir(repoRoot);
  const mergedFiles = new Map();
  const batches = await prepareBatches();

  if (batches.length === 0) {
    console.error("[coverage-batches] No test files found.");
    process.exit(1);
  }

  await rm(coverageDir, { recursive: true, force: true });

  console.log(`[coverage-batches] Running ${batches.length} coverage batches...`);

  for (const [index, batch] of batches.entries()) {
    const startedAt = Date.now();
    console.log(`[coverage-batches] Batch ${index + 1}/${batches.length}: ${batch.name} (${batch.files.length} files)`);
    await rm(coverageDir, { recursive: true, force: true });
    await spawnCommand("node", ["scripts/run-bun.mjs", "test", ...batch.files, ...coverageArgs]);
    const lcovContent = await waitForCoverageArtifact();
    mergeCoverage(mergedFiles, parseLcov(lcovContent));
    console.log(`[coverage-batches] Completed ${batch.name} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  }

  await mkdir(coverageDir, { recursive: true });
  await writeFile(mergedLcovPath, generateLcov(mergedFiles), "utf8");
  console.log(`[coverage-batches] Wrote merged unit coverage to ${path.relative(repoRoot, mergedLcovPath)}`);
}

main().catch((error) => {
  console.error("[coverage-batches] ERROR:", error instanceof Error ? error.message : error);
  process.exit(1);
});