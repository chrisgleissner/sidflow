/**
 * Train API endpoint - trains ML model via sidflow-train CLI
 */
import { NextRequest, NextResponse } from 'next/server';
import { TrainRequestSchema, type ApiResponse } from '@/lib/validation';
import { ZodError } from 'zod';
import { findLatestJobByType, getJobOrchestrator } from '@/lib/server/jobs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = TrainRequestSchema.parse(body);

    const orchestrator = await getJobOrchestrator();
    const activeJob = findLatestJobByType(orchestrator.listJobs(), 'train', ['pending', 'running', 'paused']);
    if (activeJob) {
      const response: ApiResponse = {
        success: false,
        error: 'Training already running',
        details: 'A training job is already pending or running. Wait for it to finish before queueing another.',
      };
      return NextResponse.json(response, { status: 409 });
    }

    const job = await orchestrator.createJob('train', {
      configPath: validatedData.configPath,
      epochs: validatedData.epochs,
      batchSize: validatedData.batchSize,
      learningRate: validatedData.learningRate,
      evaluate: validatedData.evaluate,
      force: validatedData.force,
    });

    const response: ApiResponse<{ jobId: string; output: string; logs: string }> = {
      success: true,
      data: {
        jobId: job.id,
        output: '',
        logs: 'Training job queued',
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
