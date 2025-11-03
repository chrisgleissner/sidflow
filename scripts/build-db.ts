#!/usr/bin/env bun
/**
 * LanceDB builder script for SIDFlow.
 * 
 * Combines classified JSONL and feedback JSONL files into a unified
 * LanceDB vector database with feedback aggregates.
 */

import { parseArgs } from "node:util";
import { loadConfig, createLogger } from "../packages/sidflow-common/src/index.js";
import { buildDatabase, generateManifest } from "../packages/sidflow-common/src/lancedb-builder.js";

const logger = createLogger("build:db");

const USAGE = `
Usage: bun run build:db [options]

Options:
  --config <path>         Path to .sidflow.json (default: ./.sidflow.json)
  --update-manifest       Regenerate manifest even if database exists
  --help                  Show this help message

Combines classification and feedback data into a LanceDB vector database.
The database is derived (not committed to Git) but reproducible from source data.
`;

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      "update-manifest": { type: "boolean", default: false },
      help: { type: "boolean", default: false }
    },
    strict: true,
    allowPositionals: false
  });

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  try {
    const config = await loadConfig(values.config);
    
    // Set default paths if not specified
    const classifiedPath = config.classifiedPath ?? "./data/classified";
    const feedbackPath = "./data/feedback";
    const dbPath = "./data/sidflow.lance";
    const manifestPath = "./data/sidflow.lance.manifest.json";

    logger.info("Building LanceDB from classification and feedback data...");
    logger.info(`  Classified path: ${classifiedPath}`);
    logger.info(`  Feedback path: ${feedbackPath}`);
    logger.info(`  Database path: ${dbPath}`);

    // Build the database
    const result = await buildDatabase({
      classifiedPath,
      feedbackPath,
      dbPath,
      forceRebuild: false
    });

    logger.info(`Database built successfully!`);
    logger.info(`  Records: ${result.recordCount}`);
    logger.info(`  Classification files: ${result.classificationFiles}`);
    logger.info(`  Feedback events: ${result.feedbackEvents}`);
    logger.info(`  Duration: ${result.durationMs}ms`);

    // Generate manifest
    logger.info("Generating manifest...");
    const manifest = await generateManifest({
      classifiedPath,
      feedbackPath,
      dbPath,
      manifestPath,
      result
    });

    logger.info(`Manifest written to ${manifestPath}`);
    logger.info(`  Schema version: ${manifest.schema_version}`);
    logger.info(`  Unique songs: ${manifest.stats.unique_songs}`);

  } catch (error) {
    logger.error("Failed to build database:", error);
    process.exit(1);
  }
}

main();
