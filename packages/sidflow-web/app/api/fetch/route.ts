/**
 * Fetch API endpoint - synchronizes HVSC via sidflow-fetch CLI
 */
import { NextRequest, NextResponse } from 'next/server';
import { executeCli } from '@/lib/cli-executor';
import { FetchRequestSchema, type ApiResponse } from '@/lib/validation';
import { ZodError } from 'zod';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = FetchRequestSchema.parse(body);

    const args: string[] = [];
    if (validatedData.configPath) {
      args.push('--config', validatedData.configPath);
    }
    if (validatedData.remoteBaseUrl) {
      args.push('--remote', validatedData.remoteBaseUrl);
    }
    if (validatedData.hvscVersionPath) {
      args.push('--version-file', validatedData.hvscVersionPath);
    }

    const result = await executeCli('sidflow-fetch', args, {
      timeout: 600000, // 10 minutes for HVSC sync (can be long-running)
    });

    if (result.success) {
      const response: ApiResponse<{ output: string }> = {
        success: true,
        data: {
          output: result.stdout,
        },
      };
      return NextResponse.json(response, { status: 200 });
    } else {
      const response: ApiResponse = {
        success: false,
        error: 'Fetch command failed',
        details: result.stderr || result.stdout,
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
