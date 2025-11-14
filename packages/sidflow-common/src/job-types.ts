/**
 * Job orchestration types for background tasks (fetch, classify, train, render)
 */

export type JobType = 'fetch' | 'classify' | 'train' | 'render';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

export interface JobMetadata {
  readonly id: string;
  readonly type: JobType;
  readonly status: JobStatus;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly failedAt?: string;
  readonly pausedAt?: string;
  readonly error?: string;
  readonly progress?: JobProgress;
  readonly resumeData?: Record<string, unknown>;
}

export interface JobProgress {
  readonly current: number;
  readonly total: number;
  readonly message?: string;
}

export interface FetchJobParams {
  readonly force?: boolean;
}

export interface ClassifyJobParams {
  readonly sidPaths?: string[];
  readonly force?: boolean;
  readonly maxRenderSeconds?: number;
}

export interface TrainJobParams {
  readonly epochs?: number;
  readonly batchSize?: number;
  readonly learningRate?: number;
  readonly evaluate?: boolean;
}

export interface RenderJobParams {
  readonly sidPaths: string[];
  readonly engine: 'wasm' | 'sidplayfp-cli' | 'ultimate64';
  readonly chip?: '6581' | '8580r5';
  readonly formats: ('wav' | 'm4a' | 'flac')[];
  readonly force?: boolean;
}

export type JobParams = FetchJobParams | ClassifyJobParams | TrainJobParams | RenderJobParams;

export interface JobDescriptor {
  readonly id: string;
  readonly type: JobType;
  readonly params: JobParams;
  readonly status: JobStatus;
  readonly metadata: JobMetadata;
}

export interface JobManifest {
  readonly version: string;
  readonly jobs: Record<string, JobDescriptor>;
  readonly lastUpdated: string;
}
