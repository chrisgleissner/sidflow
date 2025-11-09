import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { RateControlRequestSchema, type ApiResponse } from '@/lib/validation';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = RateControlRequestSchema.parse(body);

    const response: ApiResponse = {
      success: false,
      error: 'Playback control not available server-side',
      details: 'Browser-managed playback handles pause, resume, and seek locally.',
    };
    return NextResponse.json(response, { status: 501 });
  } catch (error) {
    if (error instanceof ZodError) {
      const response: ApiResponse = {
        success: false,
        error: 'Validation error',
        details: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      };
      return NextResponse.json(response, { status: 400 });
    }
    const response: ApiResponse = {
      success: false,
      error: 'Failed to control playback',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
