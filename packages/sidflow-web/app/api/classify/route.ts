/**
 * Classify API endpoint - triggers classification via sidflow-classify CLI
 */
import { NextRequest, NextResponse } from 'next/server';
import { executeCli } from '@/lib/cli-executor';
import { ClassifyRequestSchema, type ApiResponse } from '@/lib/validation';
import { ZodError } from 'zod';
import { describeCliFailure, describeCliSuccess } from '@/lib/cli-logs';
import path from 'node:path';
import os from 'node:os';
import { getRepoRoot, getSidflowConfig } from '@/lib/server-env';
import {
  beginClassifyProgress,
  completeClassifyProgress,
  failClassifyProgress,
  getClassifyProgressSnapshot,
  ingestClassifyStdout,
} from '@/lib/classify-progress-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = ClassifyRequestSchema.parse(body);

    const config = await getSidflowConfig();
    const root = getRepoRoot();
    const hvscPath = path.resolve(root, config.hvscPath);
    const defaultTarget = path.join(hvscPath, 'C64Music');
    const targetPath = validatedData.path?.trim() || defaultTarget;
    const threads = config.threads && config.threads > 0 ? config.threads : os.cpus().length;
    beginClassifyProgress(threads);

    const command = 'sidflow-classify';
    const result = await executeCli(command, [], {
      timeout: 300000, // 5 minutes for classification (can be long-running)
      cwd: root,
      onStdout: ingestClassifyStdout,
    });

    if (result.success) {
      const { logs } = describeCliSuccess(command, result);
      completeClassifyProgress('Classification completed successfully');
      const response: ApiResponse<{ output: string; logs: string; progress: ReturnType<typeof getClassifyProgressSnapshot> }> = {
        success: true,
        data: {
          output: result.stdout,
          logs,
          progress: getClassifyProgressSnapshot(),
        },
      };
      return NextResponse.json(response, { status: 200 });
    } else {
      const { details, logs } = describeCliFailure(command, result);
      failClassifyProgress(details);
      const response: ApiResponse = {
        success: false,
        error: 'Classification command failed',
        details,
        logs,
        progress: getClassifyProgressSnapshot(),
      };
      return NextResponse.json(response, { status: 500 });
    }
  } catch (error) {
    if (error instanceof ZodError) {
      const response: ApiResponse = {
        success: false,
        error: 'Validation error',
        details: error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
      };
      return NextResponse.json(response, { status: 400 });
    }

    failClassifyProgress(error instanceof Error ? error.message : String(error));
    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
      progress: getClassifyProgressSnapshot(),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
