/**
 * Rate API endpoint - submits ratings via sidflow-rate CLI
 */
import { NextRequest, NextResponse } from 'next/server';
import { executeCli } from '@/lib/cli-executor';
import { RateRequestSchema, type ApiResponse } from '@/lib/validation';
import { ZodError } from 'zod';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = RateRequestSchema.parse(body);

    const args = [
      validatedData.sid_path,
      '--energy', String(validatedData.ratings.e),
      '--mood', String(validatedData.ratings.m),
      '--complexity', String(validatedData.ratings.c),
      '--preference', String(validatedData.ratings.p),
    ];

    const result = await executeCli('sidflow-rate', args, {
      timeout: 10000, // 10 seconds for rating
    });

    if (result.success) {
      const response: ApiResponse<{ message: string }> = {
        success: true,
        data: {
          message: 'Rating submitted successfully',
        },
      };
      return NextResponse.json(response, { status: 200 });
    } else {
      const response: ApiResponse = {
        success: false,
        error: 'Rating command failed',
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
