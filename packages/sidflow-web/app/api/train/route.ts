/**
 * Train API endpoint - trains ML model via sidflow-train CLI
 */
import { NextRequest, NextResponse } from 'next/server';
import { executeCli } from '@/lib/cli-executor';
import { TrainRequestSchema, type ApiResponse } from '@/lib/validation';
import { ZodError } from 'zod';
import { describeCliFailure, describeCliSuccess } from '@/lib/cli-logs';
import { resolveSidCollectionContext, buildCliEnvOverrides } from '@/lib/sid-collection';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = TrainRequestSchema.parse(body);

    const args: string[] = [];
    if (validatedData.configPath) {
      args.push('--config', validatedData.configPath);
    }
    if (validatedData.epochs !== undefined) {
      args.push('--epochs', String(validatedData.epochs));
    }
    if (validatedData.batchSize !== undefined) {
      args.push('--batch-size', String(validatedData.batchSize));
    }
    if (validatedData.learningRate !== undefined) {
      args.push('--learning-rate', String(validatedData.learningRate));
    }
    if (validatedData.evaluate === false) {
      args.push('--no-evaluate');
    }
    if (validatedData.force === true) {
      args.push('--force');
    }

    const command = 'sidflow-train';
    const collection = await resolveSidCollectionContext();
    const envOverrides = buildCliEnvOverrides(collection);
    const result = await executeCli(command, args, {
      timeout: 600000, // 10 minutes for training (can be long-running)
      env: envOverrides,
    });

    if (result.success) {
      const { logs } = describeCliSuccess(command, result);
      const response: ApiResponse<{ output: string; logs: string }> = {
        success: true,
        data: {
          output: result.stdout,
          logs,
        },
      };
      return NextResponse.json(response, { status: 200 });
    } else {
      const { details, logs } = describeCliFailure(command, result);
      const response: ApiResponse = {
        success: false,
        error: 'Training command failed',
        details,
        logs,
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

    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
