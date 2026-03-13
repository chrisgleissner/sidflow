import type { ClassifyProgressSnapshot } from '@/lib/types/classify-progress';
import type { FetchProgressSnapshot } from '@/lib/types/fetch-progress';
import { JobOrchestrator, type JobDescriptor, type JobStatus, type JobType } from '@sidflow/common';
import { resolveFromRepoRoot } from '@/lib/server-env';

export async function getJobOrchestrator(): Promise<JobOrchestrator> {
  const orchestrator = new JobOrchestrator({
    manifestPath: resolveFromRepoRoot('data', 'jobs', 'manifest.json'),
  });
  await orchestrator.load();
  return orchestrator;
}

export function findLatestJobByType(
  jobs: JobDescriptor[],
  type: JobType,
  statuses?: JobStatus[]
): JobDescriptor | null {
  const filtered = jobs.filter((job) => {
    if (job.type !== type) {
      return false;
    }
    if (statuses && !statuses.includes(job.status)) {
      return false;
    }
    return true;
  });

  filtered.sort((left, right) => {
    const leftTime = Date.parse(left.metadata.createdAt);
    const rightTime = Date.parse(right.metadata.createdAt);
    return rightTime - leftTime;
  });

  return filtered[0] ?? null;
}

export function buildFetchProgressSnapshot(job: JobDescriptor | null): FetchProgressSnapshot {
  if (!job) {
    return {
      phase: 'idle',
      percent: 0,
      message: 'Idle',
      updatedAt: Date.now(),
      logs: [],
      isActive: false,
    };
  }

  const updatedAt = Date.parse(
    job.metadata.completedAt
      ?? job.metadata.failedAt
      ?? job.metadata.startedAt
      ?? job.metadata.createdAt
  );
  const progress = job.metadata.progress;
  const percent = progress && progress.total > 0
    ? Math.max(0, Math.min(100, Math.round((progress.current / progress.total) * 100)))
    : job.status === 'completed'
      ? 100
      : 0;

  if (job.status === 'failed') {
    const error = job.metadata.error ?? 'Fetch job failed';
    return {
      phase: 'error',
      percent,
      message: error,
      error,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      logs: [error],
      isActive: false,
    };
  }

  if (job.status === 'completed') {
    const message = progress?.message ?? 'HVSC sync completed successfully';
    return {
      phase: 'completed',
      percent: 100,
      message,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      logs: [message],
      isActive: false,
    };
  }

  const message = progress?.message ?? (job.status === 'pending' ? 'Fetch job queued' : 'Fetch job running');
  return {
    phase: job.status === 'pending' ? 'initializing' : 'downloading',
    percent,
    message,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    logs: [message],
    isActive: true,
  };
}

export function buildClassifyProgressSnapshot(job: JobDescriptor | null): ClassifyProgressSnapshot | null {
  if (!job) {
    return null;
  }

  const params = job.params as {
    threads?: number;
    renderEngineDescription?: string;
  };
  const threads = Math.max(1, params.threads ?? 1);
  const progress = job.metadata.progress;
  const percentComplete = progress && progress.total > 0
    ? Math.max(0, Math.min(100, Math.round((progress.current / progress.total) * 100)))
    : job.status === 'completed'
      ? 100
      : 0;
  const updatedAtRaw = Date.parse(
    job.metadata.completedAt
      ?? job.metadata.failedAt
      ?? job.metadata.startedAt
      ?? job.metadata.createdAt
  );
  const updatedAt = Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now();
  const phase = job.status === 'failed'
    ? 'error'
    : job.status === 'completed'
      ? 'completed'
      : job.status === 'paused'
        ? 'paused'
        : 'analyzing';
  const message = progress?.message
    ?? (job.status === 'pending' ? 'Classification job queued' : 'Classification job running');
  const perThread = Array.from({ length: threads }, (_, index) => ({
    id: index + 1,
    status: job.status === 'completed' ? 'idle' : 'working',
    phase: phase === 'error' || phase === 'paused' || phase === 'completed' ? undefined : 'analyzing',
    updatedAt,
    stale: false,
  }));

  return {
    phase,
    totalFiles: progress?.total ?? 0,
    processedFiles: progress?.current ?? 0,
    renderedFiles: 0,
    taggedFiles: job.status === 'completed' ? progress?.total ?? 0 : 0,
    cachedFiles: 0,
    skippedFiles: 0,
    extractedFiles: 0,
    percentComplete,
    threads,
    perThread,
    renderEngine: params.renderEngineDescription,
    activeEngine: params.renderEngineDescription?.split(' → ')[0],
    message,
    error: job.metadata.error,
    isActive: job.status === 'pending' || job.status === 'running',
    isPaused: job.status === 'paused',
    updatedAt,
    startedAt: updatedAt,
    counters: {
      analyzed: progress?.current ?? 0,
      rendered: 0,
      metadataExtracted: 0,
      essentiaTagged: 0,
      skipped: 0,
      errors: job.status === 'failed' ? 1 : 0,
      retries: 0,
    },
  };
}