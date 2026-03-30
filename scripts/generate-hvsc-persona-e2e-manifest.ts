#!/usr/bin/env bun

import path from "node:path";
import process from "node:process";

import {
  HVSC_E2E_SUBSET_TARGET_COUNT,
  collectHvscE2eCatalog,
  selectHvscE2eSubset,
  writeHvscE2eSubsetManifest,
} from "../packages/sidflow-common/src/index.js";

function parseArgs(argv: string[]): { hvscRoot: string; outputPath: string } {
  let hvscRoot = path.resolve(process.cwd(), "workspace/hvsc");
  let outputPath = path.resolve(process.cwd(), "integration-tests/fixtures/hvsc-persona-300-manifest.json");

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--hvsc-root":
        hvscRoot = path.resolve(process.cwd(), argv[++index] ?? "workspace/hvsc");
        break;
      case "--output":
        outputPath = path.resolve(process.cwd(), argv[++index] ?? outputPath);
        break;
      case "--help":
      case "-h":
        console.log([
          "Usage: bun scripts/generate-hvsc-persona-e2e-manifest.ts [options]",
          "",
          "Options:",
          "  --hvsc-root <path>   Local HVSC root (default: workspace/hvsc)",
          "  --output <path>      Output manifest path (default: integration-tests/fixtures/hvsc-persona-300-manifest.json)",
        ].join("\n"));
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { hvscRoot, outputPath };
}

async function main(): Promise<void> {
  const { hvscRoot, outputPath } = parseArgs(process.argv.slice(2));
  const catalog = await collectHvscE2eCatalog(hvscRoot);
  const manifest = selectHvscE2eSubset(catalog);

  if (manifest.entries.length !== HVSC_E2E_SUBSET_TARGET_COUNT) {
    throw new Error(`Expected ${HVSC_E2E_SUBSET_TARGET_COUNT} selected entries, received ${manifest.entries.length}`);
  }

  await writeHvscE2eSubsetManifest(outputPath, manifest);
  console.log(`Wrote ${manifest.entries.length}-file manifest to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});