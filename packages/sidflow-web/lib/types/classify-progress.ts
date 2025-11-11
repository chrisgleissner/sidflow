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
}

export interface ClassifyProgressSnapshot {
  phase: ClassifyPhase;
  totalFiles: number;
  processedFiles: number;
  renderedFiles: number;
  skippedFiles: number;
  percentComplete: number;
  threads: number;
  perThread: ClassifyThreadStatus[];
  message?: string;
  error?: string;
  isActive: boolean;
  isPaused: boolean;
  updatedAt: number;
  startedAt: number;
}

export interface ClassifyStorageStats {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}
