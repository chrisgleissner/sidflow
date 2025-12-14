import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { getClassifyProgressSnapshot, reconcileClassifyProgressWithRunner } from '@/lib/classify-progress-store';
import { getClassificationDiskUsage } from '@/lib/disk-usage';
import type { ClassifyStorageStats } from '@/lib/types/classify-progress';
import { getClassificationRunnerPid } from '@/lib/classify-runner';

type ProgressWithStorage = ReturnType<typeof getClassifyProgressSnapshot> & {
  storage?: ClassifyStorageStats;
};

export async function GET() {
  reconcileClassifyProgressWithRunner(getClassificationRunnerPid());
  const snapshot = getClassifyProgressSnapshot();
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
