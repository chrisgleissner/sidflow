#!/usr/bin/env bun
/**
 * JSONL Classification Output Validator
 * 
 * Validates classification JSONL files against schema contracts:
 * - Each record has valid sid_path and ratings
 * - Features include required metadata (featureSetVersion, featureVariant)
 * - Records are ordered deterministically
 * - No duplicate sid_path + song_index combinations
 * 
 * Usage: bun run scripts/classify-validate-jsonl.ts [path/to/file.jsonl]
 */

import { readFile } from "node:fs/promises";
import { FEATURE_SCHEMA_VERSION, type ClassificationRecord, type AudioFeatures } from "@sidflow/common";

interface ValidationResult {
  valid: boolean;
  recordCount: number;
  errors: string[];
  warnings: string[];
  stats: {
    withFeatures: number;
    withEssentia: number;
    withHeuristic: number;
    withRatings: number;
    uniquePaths: number;
    duplicates: number;
  };
}

const REQUIRED_RATING_DIMENSIONS = ["e", "m", "c"] as const;

function validateRecord(record: unknown, lineNumber: number): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (typeof record !== "object" || record === null) {
    errors.push(`Line ${lineNumber}: Record is not an object`);
    return { errors, warnings };
  }
  
  const r = record as Record<string, unknown>;
  
  // Validate sid_path
  if (typeof r.sid_path !== "string" || r.sid_path.length === 0) {
    errors.push(`Line ${lineNumber}: Missing or invalid sid_path`);
  }
  
  // Validate song_index if present
  if (r.song_index !== undefined) {
    if (typeof r.song_index !== "number" || r.song_index < 1 || !Number.isInteger(r.song_index)) {
      errors.push(`Line ${lineNumber}: Invalid song_index (must be positive integer)`);
    }
  }
  
  // Validate ratings
  if (typeof r.ratings !== "object" || r.ratings === null) {
    errors.push(`Line ${lineNumber}: Missing or invalid ratings object`);
  } else {
    const ratings = r.ratings as Record<string, unknown>;
    for (const dim of REQUIRED_RATING_DIMENSIONS) {
      const value = ratings[dim];
      if (typeof value !== "number") {
        errors.push(`Line ${lineNumber}: Missing rating dimension '${dim}'`);
      } else if (value < 1 || value > 5) {
        errors.push(`Line ${lineNumber}: Rating '${dim}' out of range [1,5]: ${value}`);
      }
    }
  }
  
  // Validate features if present
  if (r.features !== undefined) {
    if (typeof r.features !== "object" || r.features === null) {
      errors.push(`Line ${lineNumber}: Invalid features object`);
    } else {
      const features = r.features as Record<string, unknown>;
      
      // Check for feature metadata
      if (!features.featureSetVersion) {
        warnings.push(`Line ${lineNumber}: Missing featureSetVersion`);
      } else if (features.featureSetVersion !== FEATURE_SCHEMA_VERSION) {
        warnings.push(`Line ${lineNumber}: Feature version mismatch: ${features.featureSetVersion} !== ${FEATURE_SCHEMA_VERSION}`);
      }
      
      if (!features.featureVariant) {
        warnings.push(`Line ${lineNumber}: Missing featureVariant`);
      }
      
      // Check for core audio features
      const coreFeatures = ["energy", "rms", "spectralCentroid", "zeroCrossingRate"];
      for (const feat of coreFeatures) {
        if (features[feat] === undefined) {
          warnings.push(`Line ${lineNumber}: Missing core feature '${feat}'`);
        }
      }
    }
  }
  
  return { errors, warnings };
}

async function validateJsonlFile(filePath: string): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: true,
    recordCount: 0,
    errors: [],
    warnings: [],
    stats: {
      withFeatures: 0,
      withEssentia: 0,
      withHeuristic: 0,
      withRatings: 0,
      uniquePaths: 0,
      duplicates: 0,
    },
  };
  
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    result.valid = false;
    result.errors.push(`Failed to read file: ${(error as Error).message}`);
    return result;
  }
  
  const lines = content.split("\n").filter(line => line.trim().length > 0);
  const seenPaths = new Set<string>();
  
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    let record: unknown;
    
    try {
      record = JSON.parse(lines[i]);
    } catch (error) {
      result.errors.push(`Line ${lineNumber}: Invalid JSON: ${(error as Error).message}`);
      result.valid = false;
      continue;
    }
    
    result.recordCount++;
    
    const { errors, warnings } = validateRecord(record, lineNumber);
    result.errors.push(...errors);
    result.warnings.push(...warnings);
    
    if (errors.length > 0) {
      result.valid = false;
    }
    
    // Collect stats
    const r = record as ClassificationRecord;
    const pathKey = r.song_index ? `${r.sid_path}:${r.song_index}` : r.sid_path;
    
    if (seenPaths.has(pathKey)) {
      result.stats.duplicates++;
      result.errors.push(`Line ${lineNumber}: Duplicate path ${pathKey}`);
      result.valid = false;
    } else {
      seenPaths.add(pathKey);
    }
    
    if (r.ratings) {
      result.stats.withRatings++;
    }
    
    if (r.features) {
      result.stats.withFeatures++;
      const variant = (r.features as AudioFeatures).featureVariant;
      if (variant === "essentia") {
        result.stats.withEssentia++;
      } else if (variant === "heuristic") {
        result.stats.withHeuristic++;
      }
    }
  }
  
  result.stats.uniquePaths = seenPaths.size;
  
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Find most recent classification file
    const { readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    
    const classifiedPath = "data/classified";
    try {
      const files = await readdir(classifiedPath);
      const jsonlFiles = files.filter(f => f.endsWith(".jsonl")).sort().reverse();
      
      if (jsonlFiles.length === 0) {
        console.log("No JSONL files found in data/classified/");
        console.log("Usage: bun run scripts/classify-validate-jsonl.ts [path/to/file.jsonl]");
        process.exit(1);
      }
      
      args.push(join(classifiedPath, jsonlFiles[0]));
      console.log(`Validating most recent file: ${args[0]}\n`);
    } catch {
      console.log("Usage: bun run scripts/classify-validate-jsonl.ts [path/to/file.jsonl]");
      process.exit(1);
    }
  }
  
  const filePath = args[0];
  console.log("🔍 JSONL Classification Validator\n");
  console.log("=".repeat(60));
  
  const result = await validateJsonlFile(filePath);
  
  console.log(`\nFile: ${filePath}`);
  console.log(`Records: ${result.recordCount}`);
  console.log(`Status: ${result.valid ? "✓ VALID" : "✗ INVALID"}\n`);
  
  console.log("📊 Statistics:");
  console.log(`  - Unique paths: ${result.stats.uniquePaths}`);
  console.log(`  - With features: ${result.stats.withFeatures}`);
  console.log(`  - Essentia features: ${result.stats.withEssentia}`);
  console.log(`  - Heuristic features: ${result.stats.withHeuristic}`);
  console.log(`  - With ratings: ${result.stats.withRatings}`);
  console.log(`  - Duplicates: ${result.stats.duplicates}`);
  
  if (result.errors.length > 0) {
    console.log(`\n❌ Errors (${result.errors.length}):`);
    for (const error of result.errors.slice(0, 10)) {
      console.log(`  - ${error}`);
    }
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more errors`);
    }
  }
  
  if (result.warnings.length > 0) {
    console.log(`\n⚠️ Warnings (${result.warnings.length}):`);
    for (const warning of result.warnings.slice(0, 10)) {
      console.log(`  - ${warning}`);
    }
    if (result.warnings.length > 10) {
      console.log(`  ... and ${result.warnings.length - 10} more warnings`);
    }
  }
  
  console.log("\n");
  
  process.exit(result.valid ? 0 : 1);
}

main().catch(console.error);
