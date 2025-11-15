import type { RenderEngine, RenderFormat } from "./config.js";

/**
 * Job orchestration types for background tasks (fetch, classify, train, render, pipeline)
 */

export const BASE_JOB_TYPES = ['fetch', 'classify', 'train', 'render'] as const;
export type BaseJobType = (typeof BASE_JOB_TYPES)[number];
export type JobType = BaseJobType | 'pipeline';
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

export type RenderEngineSelection = RenderEngine | "auto";

export interface RenderJobParams {
  readonly configPath?: string;
  readonly sidPaths?: string[];
  readonly sidListFile?: string;
  readonly engine?: RenderEngineSelection;
  readonly preferredEngines?: RenderEngine[];
  readonly chip?: "6581" | "8580r5";
  readonly formats?: RenderFormat[];
  readonly outputPath?: string;
  readonly targetDurationMs?: number;
  readonly maxLossRate?: number;
}

export interface PipelineStage {
  readonly type: BaseJobType;
  readonly params?: FetchJobParams | ClassifyJobParams | TrainJobParams | RenderJobParams;
  readonly label?: string;
}

export interface PipelineJobParams {
  readonly stages: PipelineStage[];
  readonly allowResume?: boolean;
  readonly label?: string;
}

export type JobParams =
  | FetchJobParams
  | ClassifyJobParams
  | TrainJobParams
  | RenderJobParams
  | PipelineJobParams;

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
