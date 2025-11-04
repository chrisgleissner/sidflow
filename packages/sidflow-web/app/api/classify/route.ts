/**
 * Classify API endpoint - triggers classification via sidflow-classify CLI
 */
import { NextRequest, NextResponse } from 'next/server';
import { executeCli } from '@/lib/cli-executor';
import { ClassifyRequestSchema, type ApiResponse } from '@/lib/validation';
import { ZodError } from 'zod';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = ClassifyRequestSchema.parse(body);

    const args = [validatedData.path];

    const result = await executeCli('sidflow-classify', args, {
      timeout: 300000, // 5 minutes for classification (can be long-running)
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
        error: 'Classification command failed',
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
