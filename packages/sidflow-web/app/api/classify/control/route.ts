import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { requestClassificationPause } from '@/lib/classify-runner';
import { pauseClassifyProgress, getClassifyProgressSnapshot } from '@/lib/classify-progress-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body?.action;

    if (action === 'pause') {
      const paused = requestClassificationPause();
      if (!paused) {
        const response: ApiResponse = {
          success: false,
          error: 'No active classification run to pause',
        };
        return NextResponse.json(response, { status: 409 });
      }
      pauseClassifyProgress('Pausing classification...');
      const response: ApiResponse<{ progress: ReturnType<typeof getClassifyProgressSnapshot> }> = {
        success: true,
        data: {
          progress: getClassifyProgressSnapshot(),
        },
      };
      return NextResponse.json(response, { status: 200 });
    }

    const response: ApiResponse = {
      success: false,
      error: `Unsupported action: ${action}`,
    };
    return NextResponse.json(response, { status: 400 });
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error: 'Classification control failed',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
