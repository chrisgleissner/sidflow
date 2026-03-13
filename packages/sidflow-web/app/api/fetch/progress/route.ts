import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import type { FetchProgressSnapshot } from '@/lib/types/fetch-progress';
import { buildFetchProgressSnapshot, findLatestJobByType, getJobOrchestrator } from '@/lib/server/jobs';

export async function GET() {
  const orchestrator = await getJobOrchestrator();
  const snapshot = buildFetchProgressSnapshot(findLatestJobByType(orchestrator.listJobs(), 'fetch'));
  const response: ApiResponse<FetchProgressSnapshot> = {
    success: true,
    data: snapshot,
  };
  return NextResponse.json(response, { status: 200 });
}
