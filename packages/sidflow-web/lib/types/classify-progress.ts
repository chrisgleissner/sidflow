export type ClassifyPhase =
  | 'idle'
  | 'analyzing'
  | 'building'
  | 'metadata'
  | 'tagging'
  | 'paused'
  | 'completed'
  | 'error';

export interface ClassifyThreadStatus {
  id: number;
  currentFile?: string;
  status: 'idle' | 'working';
  phase?: 'analyzing' | 'building' | 'metadata' | 'tagging';
  updatedAt: number;
  stale?: boolean;
  phaseStartedAt?: number;
  /** Number of consecutive no-audio failures for engine health monitoring */
  noAudioStreak?: number;
}

/** Global counters for classification progress */
export interface ClassifyCounters {
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
  /** Total errors encountered */
  errors: number;
  /** Total retries performed */
  retries: number;
}

export interface ClassifyProgressSnapshot {
  phase: ClassifyPhase;
  totalFiles: number;
  processedFiles: number;
  /** Number of files that required WAV rendering (not cached) */
  renderedFiles: number;
  /** Number of files with tags generated */
  taggedFiles: number;
  /** Number of files that used cached WAV files */
  cachedFiles: number;
  /** Number of files skipped due to existing cached WAV files (used by "[Converting]" phase) */
  skippedFiles: number;
  /** Number of files with audio features extracted */
  extractedFiles: number;
  percentComplete: number;
  threads: number;
  perThread: ClassifyThreadStatus[];
  renderEngine?: string;
  activeEngine?: string;
  message?: string;
  error?: string;
  isActive: boolean;
  isPaused: boolean;
  updatedAt: number;
  startedAt: number;
  /** Global counters for detailed progress tracking */
  counters?: ClassifyCounters;
}

export interface ClassifyStorageStats {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}
