import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { getClassifyProgressSnapshot, reconcileClassifyProgressWithRunner } from '@/lib/classify-progress-store';
import { getClassificationDiskUsage } from '@/lib/disk-usage';
import type { ClassifyStorageStats } from '@/lib/types/classify-progress';
import { getClassificationRunnerPid } from '@/lib/classify-runner';
import { buildClassifyProgressSnapshot, findLatestJobByType, getJobOrchestrator } from '@/lib/server/jobs';

type ProgressWithStorage = ReturnType<typeof getClassifyProgressSnapshot> & {
  storage?: ClassifyStorageStats;
};

export async function GET() {
  reconcileClassifyProgressWithRunner(getClassificationRunnerPid());
  const currentSnapshot = getClassifyProgressSnapshot();
  const orchestrator = await getJobOrchestrator();
  const queuedSnapshot = buildClassifyProgressSnapshot(findLatestJobByType(orchestrator.listJobs(), 'classify', ['pending', 'running', 'paused']));
  const snapshot = currentSnapshot.isActive || currentSnapshot.isPaused ? currentSnapshot : (queuedSnapshot ?? currentSnapshot);
  const storage = await getClassificationDiskUsage();
  const response: ApiResponse<ProgressWithStorage> = {
    success: true,
    data: {
      ...snapshot,
      storage: storage ?? undefined,
    },
  };
  return NextResponse.json(response, { status: 200 });
}
