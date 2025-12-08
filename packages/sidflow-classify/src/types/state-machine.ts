/**
 * State Machine Contract for Classification Pipeline
 * 
 * This module defines the complete state machine for the classification worker lifecycle,
 * including phase transitions, heartbeat contracts, and event schemas.
 * 
 * ## Worker Lifecycle
 * 
 * Each worker thread processes SID files through these phases IN ORDER:
 * 1. ANALYZING - Determine if WAV needs rendering
 * 2. BUILDING - Render WAV file (if needed)
 * 3. METADATA - Extract SID metadata
 * 4. TAGGING - Run Essentia feature extraction and prediction
 * 5. FINALIZE - Complete and emit structured log
 * 
 * ## Heartbeat Contract
 * 
 * During any long-running phase (especially BUILDING):
 * - Heartbeat interval: 3000ms
 * - Stale threshold: 5000ms
 * - Workers MUST emit heartbeats during blocking operations
 * 
 * ## Retry Rules
 * 
 * - BUILDING phase: Up to 3 retries with exponential backoff
 * - METADATA phase: 1 retry, fallback to path-based metadata
 * - TAGGING phase: 1 retry, fallback to heuristic features
 * - FINALIZE: Always runs, records failure deterministically
 * 
 * @module
 */

/**
 * Classification phase enumeration.
 * Phases must be processed in sequence: analyzing → building → metadata → tagging
 */
export type ClassifyPhase = 
  | "idle"
  | "analyzing" 
  | "building" 
  | "metadata" 
  | "tagging"
  | "completed"
  | "error"
  | "paused";

/**
 * Worker phase subset - phases a worker can be actively processing
 */
export type WorkerPhase = "analyzing" | "building" | "metadata" | "tagging";

/**
 * Thread status values
 */
export type ThreadStatus = "idle" | "working" | "stale" | "error";

/**
 * Heartbeat configuration constants
 */
export const HEARTBEAT_CONFIG = {
  /** How often to emit heartbeat during long operations (ms) */
  INTERVAL_MS: 3000,
  /** After this many ms without update, thread is considered stale (ms) */
  STALE_THRESHOLD_MS: 30000,  // 30 seconds - long enough for feature extraction (can block 10-30s)
  /** After this many ms of global inactivity, classification is stalled (ms) */
  GLOBAL_STALL_TIMEOUT_MS: 60000,  // 60 seconds for global stall
  /** Number of consecutive no-audio failures before engine escalation */
  NO_AUDIO_STREAK_THRESHOLD: 3,
} as const;

/**
 * Retry configuration for each phase
 */
export const RETRY_CONFIG = {
  building: {
    maxRetries: 3,
    baseDelayMs: 100,
    backoffMultiplier: 2,
  },
  metadata: {
    maxRetries: 1,
    baseDelayMs: 50,
    backoffMultiplier: 1,
  },
  tagging: {
    maxRetries: 1,
    baseDelayMs: 50,
    backoffMultiplier: 1,
  },
} as const;

/**
 * Error classification for retry decisions
 */
export type ErrorType = "recoverable" | "fatal";

/**
 * Error categories for structured error handling
 */
export interface ClassifyError {
  type: ErrorType;
  phase: WorkerPhase;
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

/**
 * Extended thread activity update with structured logging fields
 */
export interface StructuredThreadUpdate {
  /** Thread identifier (1-based) */
  threadId: number;
  /** Current processing phase */
  phase: WorkerPhase;
  /** Thread status */
  status: ThreadStatus;
  /** Current file being processed (relative path) */
  file?: string;
  /** Full SID file path */
  sidPath?: string;
  /** Song index for multi-song SIDs */
  songIndex?: number;
  /** When this update was emitted (epoch ms) */
  timestamp: number;
  /** When this phase started (epoch ms) */
  phaseStartedAt?: number;
  /** Duration of current phase so far (ms) */
  phaseDurationMs?: number;
  /** Is this a heartbeat (vs state transition) */
  isHeartbeat?: boolean;
  /** Counters for this thread */
  counters?: ThreadCounters;
  /** Error information if status is 'error' */
  error?: ClassifyError;
}

/**
 * Thread-level counters
 */
export interface ThreadCounters {
  /** Number of files analyzed by this thread */
  analyzed: number;
  /** Number of WAVs rendered by this thread */
  rendered: number;
  /** Number of metadata extractions completed */
  metadataExtracted: number;
  /** Number of Essentia feature extractions completed */
  essentiaTagged: number;
  /** Number of files skipped (cache hit) */
  skipped: number;
  /** Number of errors encountered */
  errors: number;
}

/**
 * Global classification progress snapshot
 */
export interface ClassifyProgressSnapshot {
  /** Current overall phase */
  phase: ClassifyPhase;
  /** Total files to process */
  totalFiles: number;
  /** Files processed so far */
  processedFiles: number;
  /** Files rendered (WAV created) */
  renderedFiles: number;
  /** Files with Essentia features extracted */
  taggedFiles: number;
  /** Files skipped (cache hit) */
  skippedFiles: number;
  /** Completion percentage (0-100) */
  percentComplete: number;
  /** Number of worker threads */
  threads: number;
  /** Per-thread status */
  perThread: ThreadStatusSnapshot[];
  /** Render engine description */
  renderEngine?: string;
  /** Active engine currently in use */
  activeEngine?: string;
  /** Status message */
  message?: string;
  /** Error message if failed */
  error?: string;
  /** Is classification actively running */
  isActive: boolean;
  /** Is classification paused */
  isPaused: boolean;
  /** When last updated (epoch ms) */
  updatedAt: number;
  /** When classification started (epoch ms) */
  startedAt: number;
  /** Global counters */
  counters?: GlobalCounters;
}

/**
 * Thread status for UI display
 */
export interface ThreadStatusSnapshot {
  id: number;
  currentFile?: string;
  status: ThreadStatus;
  phase?: WorkerPhase;
  updatedAt: number;
  stale: boolean;
  phaseStartedAt?: number;
  noAudioStreak?: number;
}

/**
 * Global counters across all threads
 */
export interface GlobalCounters {
  /** Total files analyzed */
  analyzed: number;
  /** Total WAVs rendered */
  rendered: number;
  /** Total metadata extractions */
  metadataExtracted: number;
  /** Total Essentia feature extractions */
  essentiaTagged: number;
  /** Total files skipped */
  skipped: number;
  /** Total errors */
  errors: number;
  /** Total retries performed */
  retries: number;
}

/**
 * Structured log entry for phase transitions
 */
export interface PhaseTransitionLog {
  /** Log level */
  level: "info" | "warn" | "error" | "debug";
  /** Log timestamp (ISO string) */
  timestamp: string;
  /** Thread ID */
  threadId: number;
  /** Previous phase */
  fromPhase: WorkerPhase | "idle";
  /** New phase */
  toPhase: WorkerPhase | "idle" | "completed" | "error";
  /** File being processed */
  file?: string;
  /** Duration in previous phase (ms) */
  durationMs?: number;
  /** Error details if transitioning to error */
  error?: ClassifyError;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Structured log entry for phase completion
 */
export interface PhaseCompletionLog {
  level: "info" | "debug";
  timestamp: string;
  threadId: number;
  phase: WorkerPhase;
  file: string;
  durationMs: number;
  success: boolean;
  /** Phase-specific metrics */
  metrics?: {
    /** For building phase: render format used */
    renderFormat?: string;
    /** For building phase: output file size */
    outputSizeBytes?: number;
    /** For tagging phase: feature count */
    featureCount?: number;
    /** For tagging phase: was Essentia used */
    usedEssentia?: boolean;
  };
}

/**
 * Message types for worker → orchestrator communication
 */
export type WorkerMessage =
  | { type: "phase_start"; data: StructuredThreadUpdate }
  | { type: "heartbeat"; data: StructuredThreadUpdate }
  | { type: "phase_complete"; data: PhaseCompletionLog }
  | { type: "phase_error"; data: StructuredThreadUpdate }
  | { type: "retry"; data: { threadId: number; phase: WorkerPhase; attempt: number; maxAttempts: number } }
  | { type: "file_complete"; data: { threadId: number; file: string; totalDurationMs: number } };

/**
 * Create initial thread counters
 */
export function createThreadCounters(): ThreadCounters {
  return {
    analyzed: 0,
    rendered: 0,
    metadataExtracted: 0,
    essentiaTagged: 0,
    skipped: 0,
    errors: 0,
  };
}

/**
 * Create initial global counters
 */
export function createGlobalCounters(): GlobalCounters {
  return {
    analyzed: 0,
    rendered: 0,
    metadataExtracted: 0,
    essentiaTagged: 0,
    skipped: 0,
    errors: 0,
    retries: 0,
  };
}

/**
 * Check if an error is recoverable based on its code
 */
export function isRecoverableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Network/IO errors are recoverable
    if (message.includes("enoent") || message.includes("timeout") || message.includes("busy")) {
      return true;
    }
    // Corrupt file errors are not recoverable
    if (message.includes("invalid") || message.includes("corrupt") || message.includes("malformed")) {
      return false;
    }
  }
  // Default to recoverable for unknown errors
  return true;
}

/**
 * Create a classify error from an exception
 */
export function createClassifyError(
  phase: WorkerPhase,
  error: unknown,
  code?: string
): ClassifyError {
  const message = error instanceof Error ? error.message : String(error);
  const recoverable = isRecoverableError(error);
  
  return {
    type: recoverable ? "recoverable" : "fatal",
    phase,
    code: code ?? `${phase.toUpperCase()}_ERROR`,
    message,
    retryable: recoverable,
    details: error instanceof Error ? { stack: error.stack } : undefined,
  };
}

/**
 * Calculate exponential backoff delay for a given attempt
 * @param phase - The phase to get retry config for
 * @param attempt - Current attempt number (1-based)
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  phase: keyof typeof RETRY_CONFIG,
  attempt: number
): number {
  const config = RETRY_CONFIG[phase];
  // Exponential backoff: baseDelay * multiplier^(attempt-1)
  return config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
}

/**
 * Get the maximum number of retries for a phase
 */
export function getMaxRetries(phase: keyof typeof RETRY_CONFIG): number {
  return RETRY_CONFIG[phase].maxRetries;
}

/**
 * Execute a function with retry logic for a specific phase
 * @param phase - The phase being executed
 * @param fn - The async function to execute
 * @param options - Optional callbacks for logging
 * @returns The result of the function
 * @throws The last error if all retries fail
 */
export async function withRetry<T>(
  phase: keyof typeof RETRY_CONFIG,
  fn: () => Promise<T>,
  options?: {
    onRetry?: (attempt: number, maxAttempts: number, error: Error, delayMs: number) => void;
    onFatalError?: (error: ClassifyError) => void;
  }
): Promise<T> {
  const maxRetries = RETRY_CONFIG[phase].maxRetries;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if error is recoverable
      if (!isRecoverableError(error)) {
        const classifyError = createClassifyError(phase, error);
        options?.onFatalError?.(classifyError);
        throw error;
      }
      
      // If we have retries left, wait and retry
      if (attempt <= maxRetries) {
        const delayMs = calculateBackoffDelay(phase, attempt);
        options?.onRetry?.(attempt, maxRetries + 1, lastError, delayMs);
        await sleep(delayMs);
      }
    }
  }

  // All retries exhausted
  throw lastError;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
