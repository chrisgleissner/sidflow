import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { detectPlaybackAdapters } from '@/lib/server/playback-detect';

export async function GET() {
  const data = {
    adapters: await detectPlaybackAdapters(),
  };

  const response: ApiResponse<typeof data> = {
    success: true,
    data,
  };

  return NextResponse.json(response, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}