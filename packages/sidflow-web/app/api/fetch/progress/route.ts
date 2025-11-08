import { NextResponse } from 'next/server';
import { getFetchProgressSnapshot } from '@/lib/fetch-progress-store';
import type { ApiResponse } from '@/lib/validation';
import type { FetchProgressSnapshot } from '@/lib/types/fetch-progress';

export async function GET() {
  const snapshot = getFetchProgressSnapshot();
  const response: ApiResponse<FetchProgressSnapshot> = {
    success: true,
    data: snapshot,
  };
  return NextResponse.json(response, { status: 200 });
}
