export type FetchPhase =
  | 'idle'
  | 'initializing'
  | 'downloading'
  | 'applying'
  | 'extracting'
  | 'completed'
  | 'error';

export interface FetchProgressSnapshot {
  phase: FetchPhase;
  percent: number;
  message: string;
  filename?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  updatedAt: number;
  error?: string;
  logs: string[];
  isActive: boolean;
}
