/**
 * User feedback logging for SIDFlow.
 * 
 * Implements append-only JSONL feedback logging with date-based partitioning
 * for tracking user interactions with SID files (play, like, dislike, skip).
 */

import { ensureDir } from "./fs.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FeedbackRecord, FeedbackAction } from "./jsonl-schema.js";
import { appendCanonicalJsonLines } from "./canonical-writer.js";
import type { JsonValue } from "./json.js";

/**
 * Options for logging feedback events.
 */
export interface LogFeedbackOptions {
  /** Base path for feedback logs (e.g., "./data/feedback") */
  feedbackPath: string;
  /** SID path relative to HVSC root */
  sidPath: string;
  /** User action type */
  action: FeedbackAction;
  /** Optional timestamp (defaults to current time) */
  timestamp?: Date;
  /** Optional UUID for deduplication */
  uuid?: string;
}

/**
 * Options for validating feedback logs.
 */
export interface ValidateFeedbackOptions {
  /** Base path for feedback logs */
  feedbackPath: string;
  /** Start date for validation (optional) */
  startDate?: Date;
  /** End date for validation (optional) */
  endDate?: Date;
}

/**
 * Result from validating feedback logs.
 */
export interface ValidateFeedbackResult {
  /** Total number of events validated */
  totalEvents: number;
  /** Number of duplicate UUIDs found */
  duplicates: number;
  /** Number of invalid records */
  invalidRecords: number;
  /** Validation errors by date */
  errorsByDate: Map<string, string[]>;
}

/**
 * Logs a user feedback event to date-partitioned JSONL files.
 * 
 * @param options - Feedback logging options
 * @returns Path to the log file where the event was written
 */
export async function logFeedback(options: LogFeedbackOptions): Promise<string> {
  const { feedbackPath, sidPath, action, timestamp, uuid } = options;
  
  const ts = timestamp ?? new Date();
  const year = ts.getFullYear();
  const month = String(ts.getMonth() + 1).padStart(2, "0");
  const day = String(ts.getDate()).padStart(2, "0");
  
  // Create date-partitioned path: data/feedback/YYYY/MM/DD/
  const datePath = path.join(feedbackPath, String(year), month, day);
  await ensureDir(datePath);
  
  const logFile = path.join(datePath, "events.jsonl");
  
  // Create feedback record
  const record: FeedbackRecord = {
    ts: ts.toISOString(),
    sid_path: sidPath,
    action
  };
  
  // Add UUID if provided
  if (uuid) {
    record.uuid = uuid;
  }
  
  await appendCanonicalJsonLines(
    logFile,
    [record as unknown as JsonValue],
    {
      details: {
        partition: `${year}-${month}-${day}`,
        action,
        sidPath
      }
    }
  );
  
  return logFile;
}

/**
 * Logs multiple feedback events in a batch.
 * 
 * @param feedbackPath - Base path for feedback logs
 * @param events - Array of feedback events to log
 * @returns Array of paths to log files where events were written
 */
export async function logFeedbackBatch(
  feedbackPath: string,
  events: Array<Omit<LogFeedbackOptions, "feedbackPath">>
): Promise<string[]> {
  const logFiles: string[] = [];
  
  for (const event of events) {
    const logFile = await logFeedback({
      feedbackPath,
      ...event
    });
    logFiles.push(logFile);
  }
  
  return logFiles;
}

/**
 * Generates a unique event ID for deduplication.
 * 
 * @returns UUID string
 */
export function generateEventId(): string {
  return randomUUID();
}

/**
 * Validates feedback logs for correctness and consistency.
 * 
 * @param options - Validation options
 * @returns Validation result with statistics and errors
 */
export async function validateFeedbackLogs(
  options: ValidateFeedbackOptions
): Promise<ValidateFeedbackResult> {
  const { feedbackPath } = options;
  const { readdir, stat } = await import("node:fs/promises");
  
  let totalEvents = 0;
  let invalidRecords = 0;
  const uuidSet = new Set<string>();
  let duplicates = 0;
  const errorsByDate = new Map<string, string[]>();
  
  // Walk through date-partitioned directories
  async function walkDatePartitions(currentPath: string, level: number): Promise<void> {
    try {
      const entries = await readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          await walkDatePartitions(fullPath, level + 1);
        } else if (entry.isFile() && entry.name === "events.jsonl") {
          // Found a log file, validate it
          const dateKey = path.relative(feedbackPath, path.dirname(fullPath));
          const errors: string[] = [];
          
          try {
            const content = await readFile(fullPath, "utf8");
            const lines = content.split("\n").filter(line => line.trim());
            
            for (let i = 0; i < lines.length; i++) {
              totalEvents++;
              
              try {
                const record = JSON.parse(lines[i]) as FeedbackRecord;
                
                // Validate required fields
                if (!record.ts || !record.sid_path || !record.action) {
                  invalidRecords++;
                  errors.push(`Line ${i + 1}: Missing required field(s)`);
                  continue;
                }
                
                // Validate action type
                const validActions: FeedbackAction[] = ["play", "like", "dislike", "skip"];
                if (!validActions.includes(record.action)) {
                  invalidRecords++;
                  errors.push(`Line ${i + 1}: Invalid action "${record.action}"`);
                }
                
                // Check for duplicate UUIDs
                if (record.uuid) {
                  if (uuidSet.has(record.uuid)) {
                    duplicates++;
                    errors.push(`Line ${i + 1}: Duplicate UUID "${record.uuid}"`);
                  } else {
                    uuidSet.add(record.uuid);
                  }
                }
              } catch (error) {
                invalidRecords++;
                errors.push(`Line ${i + 1}: Invalid JSON`);
              }
            }
          } catch (error) {
            errors.push(`Error reading file: ${(error as Error).message}`);
          }
          
          if (errors.length > 0) {
            errorsByDate.set(dateKey, errors);
          }
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  
  await walkDatePartitions(feedbackPath, 0);
  
  return {
    totalEvents,
    duplicates,
    invalidRecords,
    errorsByDate
  };
}
