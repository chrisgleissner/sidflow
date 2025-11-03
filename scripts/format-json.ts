#!/usr/bin/env bun
/**
 * Converts JSONL (JSON Lines) files to pretty-printed JSON format.
 * 
 * Usage:
 *   bun run scripts/format-json.ts <input.jsonl> [output.json]
 * 
 * If output file is not specified, pretty-printed JSON is written to stdout.
 */

import { readFile, writeFile } from "node:fs/promises";
import { argv } from "node:process";
import type { ClassificationRecord } from "@sidflow/common";

async function formatJsonl(inputPath: string, outputPath?: string): Promise<void> {
  // Read JSONL file
  const content = await readFile(inputPath, "utf8");
  const lines = content.trim().split("\n");
  
  // Parse each line as JSON
  const records: ClassificationRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) {
      try {
        records.push(JSON.parse(line));
      } catch (error) {
        console.error(`Error parsing line ${i + 1}:`, error);
        throw new Error(`Invalid JSON on line ${i + 1}`);
      }
    }
  }
  
  // Pretty-print as JSON array
  const prettyJson = JSON.stringify(records, null, 2);
  
  if (outputPath) {
    await writeFile(outputPath, prettyJson + "\n", "utf8");
    console.log(`✓ Converted ${records.length} records from ${inputPath} to ${outputPath}`);
  } else {
    console.log(prettyJson);
  }
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: bun run scripts/format-json.ts <input.jsonl> [output.json]

Converts JSONL (JSON Lines) files to pretty-printed JSON format.

Arguments:
  input.jsonl   Path to input JSONL file
  output.json   Optional path to output JSON file (defaults to stdout)

Examples:
  bun run scripts/format-json.ts data/classified/classification.jsonl
  bun run scripts/format-json.ts data/classified/classification.jsonl output.json
`);
    return;
  }
  
  const inputPath = args[0];
  const outputPath = args[1];
  
  try {
    await formatJsonl(inputPath, outputPath);
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
