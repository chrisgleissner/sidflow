/**
 * JSONL Writer Queue
 * 
 * Serializes JSONL writes to prevent concurrent access issues and ensure
 * deterministic ordering. Each file gets its own write queue.
 * 
 * Features:
 * - Serial write ordering per file
 * - Automatic flushing
 * - Error handling with context
 * - Audit trail logging
 */

import { appendCanonicalJsonLines, createLogger, type JsonValue } from "@sidflow/common";

const logger = createLogger("jsonl-writer");

interface WriteJob {
  records: JsonValue[];
  details?: Record<string, unknown>;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface WriterQueue {
  filePath: string;
  queue: WriteJob[];
  processing: boolean;
  recordCount: number;
  errorCount: number;
}

// Map of file paths to their write queues
const writerQueues = new Map<string, WriterQueue>();

/**
 * Get or create a write queue for a file path.
 */
function getWriterQueue(filePath: string): WriterQueue {
  let queue = writerQueues.get(filePath);
  if (!queue) {
    queue = {
      filePath,
      queue: [],
      processing: false,
      recordCount: 0,
      errorCount: 0,
    };
    writerQueues.set(filePath, queue);
  }
  return queue;
}

/**
 * Process the next job in the queue.
 */
async function processQueue(writerQueue: WriterQueue): Promise<void> {
  if (writerQueue.processing || writerQueue.queue.length === 0) {
    return;
  }

  writerQueue.processing = true;

  while (writerQueue.queue.length > 0) {
    const job = writerQueue.queue.shift()!;

    try {
      await appendCanonicalJsonLines(writerQueue.filePath, job.records, {
        details: job.details,
      });
      writerQueue.recordCount += job.records.length;
      job.resolve();
    } catch (error) {
      writerQueue.errorCount++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to write ${job.records.length} records to ${writerQueue.filePath}: ${errorMessage}`);
      job.reject(new Error(`JSONL write failed: ${errorMessage}`, { cause: error as Error }));
    }
  }

  writerQueue.processing = false;
}

/**
 * Queue a write operation for serial execution.
 * 
 * @param filePath - Path to the JSONL file
 * @param records - Records to write
 * @param details - Optional metadata for audit logging
 * @returns Promise that resolves when write is complete
 */
export async function queueJsonlWrite(
  filePath: string,
  records: JsonValue[],
  details?: Record<string, unknown>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const writerQueue = getWriterQueue(filePath);
    
    writerQueue.queue.push({
      records,
      details,
      resolve,
      reject,
    });

    // Start processing if not already running
    void processQueue(writerQueue);
  });
}

/**
 * Get statistics for a JSONL writer queue.
 */
export function getWriterQueueStats(filePath: string): { recordCount: number; errorCount: number; pending: number } | null {
  const queue = writerQueues.get(filePath);
  if (!queue) {
    return null;
  }
  return {
    recordCount: queue.recordCount,
    errorCount: queue.errorCount,
    pending: queue.queue.length,
  };
}

/**
 * Get statistics for all JSONL writer queues.
 */
export function getAllWriterQueueStats(): Map<string, { recordCount: number; errorCount: number; pending: number }> {
  const stats = new Map<string, { recordCount: number; errorCount: number; pending: number }>();
  for (const [filePath, queue] of writerQueues) {
    stats.set(filePath, {
      recordCount: queue.recordCount,
      errorCount: queue.errorCount,
      pending: queue.queue.length,
    });
  }
  return stats;
}

/**
 * Flush all pending writes for a file and wait for completion.
 */
export async function flushWriterQueue(filePath: string): Promise<void> {
  const queue = writerQueues.get(filePath);
  if (!queue || queue.queue.length === 0) {
    return;
  }

  // Wait for all pending jobs to complete
  return new Promise((resolve) => {
    const checkComplete = (): void => {
      if (queue.queue.length === 0 && !queue.processing) {
        resolve();
      } else {
        setTimeout(checkComplete, 10);
      }
    };
    checkComplete();
  });
}

/**
 * Clear all writer queues (for testing).
 */
export function clearWriterQueues(): void {
  writerQueues.clear();
}

/**
 * Log JSONL path once when first record is written.
 */
const loggedPaths = new Set<string>();

export function logJsonlPathOnce(filePath: string): void {
  if (!loggedPaths.has(filePath)) {
    loggedPaths.add(filePath);
    logger.info(`Writing classification records to: ${filePath}`);
  }
}

export function clearLoggedPaths(): void {
  loggedPaths.clear();
}
