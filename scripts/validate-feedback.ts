#!/usr/bin/env bun
/**
 * Validates feedback logs for correctness and consistency.
 * 
 * Usage:
 *   bun run scripts/validate-feedback.ts [feedback-path]
 * 
 * If feedback-path is not specified, uses "./data/feedback" by default.
 */

import { validateFeedbackLogs } from "../packages/sidflow-common/dist/index.js";
import { argv } from "node:process";

async function main(): Promise<void> {
  const args = argv.slice(2);
  
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: bun run scripts/validate-feedback.ts [feedback-path]

Validates feedback logs for correctness and consistency.

Arguments:
  feedback-path   Path to feedback directory (defaults to "./data/feedback")

Examples:
  bun run scripts/validate-feedback.ts
  bun run scripts/validate-feedback.ts ./data/feedback
`);
    return;
  }
  
  const feedbackPath = args[0] ?? "./data/feedback";
  
  console.log(`Validating feedback logs in ${feedbackPath}...\n`);
  
  try {
    const result = await validateFeedbackLogs({ feedbackPath });
    
    console.log(`✓ Validation complete:`);
    console.log(`  Total events: ${result.totalEvents}`);
    console.log(`  Duplicate UUIDs: ${result.duplicates}`);
    console.log(`  Invalid records: ${result.invalidRecords}`);
    
    if (result.errorsByDate.size > 0) {
      console.log(`\n⚠ Errors found in ${result.errorsByDate.size} date partition(s):\n`);
      
      for (const [dateKey, errors] of result.errorsByDate) {
        console.log(`  ${dateKey}:`);
        for (const error of errors) {
          console.log(`    - ${error}`);
        }
        console.log();
      }
      
      process.exit(1);
    } else {
      console.log(`\n✓ All feedback logs are valid.`);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
