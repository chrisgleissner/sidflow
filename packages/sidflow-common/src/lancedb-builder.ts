/**
 * LanceDB builder for SIDFlow.
 * 
 * Combines classified JSONL and feedback JSONL files into a unified
 * vector database with aggregated feedback statistics.
 */

import { readdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { connect, type Table } from "vectordb";
import type { ClassificationRecord, FeedbackRecord, FeedbackAction } from "./jsonl-schema.js";
import { FEEDBACK_WEIGHTS } from "./jsonl-schema.js";
import { ensureDir } from "./fs.js";

/**
 * Database record combining classification and feedback data.
 */
export interface DatabaseRecord {
  /** Primary identifier - SID path */
  sid_path: string;
  /** Rating vector [e, m, c, p] for similarity search */
  vector: number[];
  /** Energy rating (1-5) */
  e: number;
  /** Mood rating (1-5) */
  m: number;
  /** Complexity rating (1-5) */
  c: number;
  /** Preference rating (1-5, optional) */
  p?: number;
  /** All extracted audio features as JSON string (for LanceDB compatibility) */
  features_json?: string;
  /** Number of likes */
  likes: number;
  /** Number of dislikes */
  dislikes: number;
  /** Number of skips */
  skips: number;
  /** Total play count */
  plays: number;
  /** Most recent play timestamp */
  last_played?: string;
  /** Allow additional properties for LanceDB compatibility */
  [key: string]: unknown;
}

/**
 * Feedback aggregates for a single SID.
 */
interface FeedbackAggregate {
  likes: number;
  dislikes: number;
  skips: number;
  plays: number;
  lastPlayed?: string;
}

/**
 * Options for building the database.
 */
export interface BuildDatabaseOptions {
  /** Path to classified JSONL files */
  classifiedPath: string;
  /** Path to feedback JSONL files */
  feedbackPath: string;
  /** Path to output database */
  dbPath: string;
  /** Force rebuild even if database exists */
  forceRebuild?: boolean;
}

/**
 * Result from building the database.
 */
export interface BuildDatabaseResult {
  /** Number of records in database */
  recordCount: number;
  /** Number of classification files processed */
  classificationFiles: number;
  /** Number of feedback events processed */
  feedbackEvents: number;
  /** Build duration in milliseconds */
  durationMs: number;
}

/**
 * Manifest file for the database.
 */
export interface DatabaseManifest {
  /** Manifest version */
  version: string;
  /** Database schema version */
  schema_version: string;
  /** Creation timestamp */
  created_at: string;
  /** Number of records in database */
  record_count: number;
  /** Source data checksums */
  source_checksums: {
    classified: string;
    feedback: string;
  };
  /** Database statistics */
  stats: {
    total_classifications: number;
    total_feedback_events: number;
    unique_songs: number;
  };
}

/**
 * Options for generating manifest.
 */
export interface GenerateManifestOptions {
  classifiedPath: string;
  feedbackPath: string;
  dbPath: string;
  manifestPath: string;
  result: BuildDatabaseResult;
}

/**
 * Reads all JSONL files from a directory recursively.
 */
async function readJsonlFiles<T>(dirPath: string): Promise<T[]> {
  const records: T[] = [];
  
  if (!existsSync(dirPath)) {
    return records;
  }

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const content = await readFile(fullPath, "utf8");
        const lines = content.split("\n").filter(line => line.trim());
        
        for (const line of lines) {
          try {
            records.push(JSON.parse(line) as T);
          } catch (error) {
            // Skip invalid JSON lines
            console.warn(`Skipping invalid JSON in ${fullPath}`);
          }
        }
      }
    }
  }
  
  await walk(dirPath);
  return records;
}

/**
 * Aggregates feedback events by SID path.
 */
function aggregateFeedback(events: FeedbackRecord[]): Map<string, FeedbackAggregate> {
  const aggregates = new Map<string, FeedbackAggregate>();
  
  for (const event of events) {
    const existing = aggregates.get(event.sid_path) ?? {
      likes: 0,
      dislikes: 0,
      skips: 0,
      plays: 0
    };
    
    // Update counts based on action
    switch (event.action) {
      case "like":
        existing.likes++;
        break;
      case "dislike":
        existing.dislikes++;
        break;
      case "skip":
        existing.skips++;
        break;
      case "play":
        existing.plays++;
        break;
    }
    
    // Track most recent play timestamp
    if (event.action === "play" || event.action === "like") {
      if (!existing.lastPlayed || event.ts > existing.lastPlayed) {
        existing.lastPlayed = event.ts;
      }
    }
    
    aggregates.set(event.sid_path, existing);
  }
  
  return aggregates;
}

/**
 * Converts a classification record and feedback aggregate into a database record.
 */
function toDatabaseRecord(
  classification: ClassificationRecord,
  feedback?: FeedbackAggregate
): DatabaseRecord {
  const { e, m, c, p } = classification.ratings;
  
  // Create rating vector [e, m, c, p] for similarity search
  const vector = p !== undefined ? [e, m, c, p] : [e, m, c, 3]; // Default p=3 if not present
  
  const record: DatabaseRecord = {
    sid_path: classification.sid_path,
    vector,
    e,
    m,
    c,
    likes: feedback?.likes ?? 0,
    dislikes: feedback?.dislikes ?? 0,
    skips: feedback?.skips ?? 0,
    plays: feedback?.plays ?? 0
  };
  
  // Only include optional fields if they have values (LanceDB has issues with undefined/null)
  if (p !== undefined) {
    record.p = p;
  }
  
  if (feedback?.lastPlayed) {
    record.last_played = feedback.lastPlayed;
  }
  
  // Convert features to JSON string for LanceDB compatibility
  if (classification.features && Object.keys(classification.features).length > 0) {
    record.features_json = JSON.stringify(classification.features);
  }
  
  return record;
}

/**
 * Computes SHA256 checksum of all files in a directory.
 */
async function computeDirectoryChecksum(dirPath: string): Promise<string> {
  if (!existsSync(dirPath)) {
    return "empty";
  }
  
  const hash = createHash("sha256");
  const files: string[] = [];
  
  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  
  await walk(dirPath);
  
  // Sort for determinism
  files.sort();
  
  for (const file of files) {
    const content = await readFile(file);
    hash.update(content);
  }
  
  return hash.digest("hex");
}

/**
 * Builds the LanceDB database from classification and feedback data.
 */
export async function buildDatabase(
  options: BuildDatabaseOptions
): Promise<BuildDatabaseResult> {
  const startTime = Date.now();
  const { classifiedPath, feedbackPath, dbPath, forceRebuild } = options;
  
  // Remove existing database if force rebuild
  if (forceRebuild && existsSync(dbPath)) {
    await rm(dbPath, { recursive: true, force: true });
  }
  
  // Read classification records
  const classifications = await readJsonlFiles<ClassificationRecord>(classifiedPath);
  
  // Read feedback events
  const feedbackEvents = await readJsonlFiles<FeedbackRecord>(feedbackPath);
  
  // Aggregate feedback by SID path
  const feedbackAggregates = aggregateFeedback(feedbackEvents);
  
  // Convert to database records
  const records: DatabaseRecord[] = classifications.map(classification =>
    toDatabaseRecord(classification, feedbackAggregates.get(classification.sid_path))
  );
  
  // Connect to LanceDB and create/replace table
  const db = await connect(dbPath);
  
  // Count unique classification files (approximate based on record count)
  const classificationFiles = Math.ceil(classifications.length / 100);
  
  if (records.length > 0) {
    // Create or replace the table - LanceDB will handle vector indexing
    await db.createTable("sidflow", records as Record<string, unknown>[]);
  }
  // Skip creating empty table - just return empty result
  
  const durationMs = Date.now() - startTime;
  
  return {
    recordCount: records.length,
    classificationFiles,
    feedbackEvents: feedbackEvents.length,
    durationMs
  };
}

/**
 * Generates a manifest file for the database.
 */
export async function generateManifest(
  options: GenerateManifestOptions
): Promise<DatabaseManifest> {
  const { classifiedPath, feedbackPath, manifestPath, result } = options;
  
  // Compute checksums
  const classifiedChecksum = await computeDirectoryChecksum(classifiedPath);
  const feedbackChecksum = await computeDirectoryChecksum(feedbackPath);
  
  const manifest: DatabaseManifest = {
    version: "1.0",
    schema_version: "1.0",
    created_at: new Date().toISOString(),
    record_count: result.recordCount,
    source_checksums: {
      classified: classifiedChecksum,
      feedback: feedbackChecksum
    },
    stats: {
      total_classifications: result.recordCount,
      total_feedback_events: result.feedbackEvents,
      unique_songs: result.recordCount
    }
  };
  
  // Ensure directory exists
  const manifestDir = path.dirname(manifestPath);
  await ensureDir(manifestDir);
  
  // Write manifest
  await writeFile(
    manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );
  
  return manifest;
}
