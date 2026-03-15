/**
 * Fetch API endpoint - synchronizes HVSC via sidflow-fetch CLI
 */
import { NextRequest, NextResponse } from 'next/server';
import { FetchRequestSchema, type ApiResponse } from '@/lib/validation';
import { ZodError } from 'zod';
import type { FetchProgressSnapshot } from '@/lib/types/fetch-progress';
import { buildFetchProgressSnapshot, findLatestJobByType, getJobOrchestrator } from '@/lib/server/jobs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = FetchRequestSchema.parse(body);

    const orchestrator = await getJobOrchestrator();
    const activeJob = findLatestJobByType(orchestrator.listJobs(), 'fetch', ['pending', 'running', 'paused']);
    if (activeJob) {
      const snapshot = buildFetchProgressSnapshot(activeJob);
      const response: ApiResponse = {
        success: false,
        error: 'Fetch already running',
        details: 'A fetch operation is currently in progress. Please wait for it to finish.',
        progress: snapshot,
        logs: snapshot.logs.join('\n'),
      };
      return NextResponse.json(response, { status: 409 });
    }

    const job = await orchestrator.createJob('fetch', {
      configPath: validatedData.configPath,
      remoteBaseUrl: validatedData.remoteBaseUrl,
      hvscVersionPath: validatedData.hvscVersionPath,
    });
    const snapshot = buildFetchProgressSnapshot(job);
    const response: ApiResponse<{ jobId: string; progress: FetchProgressSnapshot; output: string; logs: string }> = {
      success: true,
      data: {
        jobId: job.id,
        progress: snapshot,
        output: '',
        logs: snapshot.logs.join('\n'),
      },
    };
    return NextResponse.json(response, { status: 202 });
  } catch (error) {
    if (error instanceof ZodError) {
      const response: ApiResponse = {
        success: false,
        error: 'Validation error',
        details: error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
      };
      return NextResponse.json(response, { status: 400 });
    }

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
