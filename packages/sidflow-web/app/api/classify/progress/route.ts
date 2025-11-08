import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { getClassifyProgressSnapshot } from '@/lib/classify-progress-store';

export async function GET() {
  const snapshot = getClassifyProgressSnapshot();
  const response: ApiResponse<typeof snapshot> = {
    success: true,
    data: snapshot,
  };
  return NextResponse.json(response, { status: 200 });
}
