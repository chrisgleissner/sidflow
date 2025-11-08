export type ClassifyPhase =
  | 'idle'
  | 'analyzing'
  | 'building'
  | 'metadata'
  | 'tagging'
  | 'completed'
  | 'error';

export interface ClassifyThreadStatus {
  id: number;
  currentFile?: string;
  status: 'idle' | 'working';
  updatedAt: number;
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
  updatedAt: number;
}
