import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { findLatestSessionByScope } from '@/lib/playback-session';
import type { RateTrackInfo } from '@/lib/types/rate-track';

interface RatePlaybackStatus {
  active: boolean;
  isPaused: boolean;
  positionSeconds: number;
  durationSeconds?: number;
  sidPath?: string;
  track?: RateTrackInfo;
}

export async function GET() {
  try {
    const session = findLatestSessionByScope('rate');
    if (!session) {
      const response: ApiResponse<RatePlaybackStatus> = {
        success: true,
        data: {
          active: false,
          isPaused: true,
          positionSeconds: 0,
        },
      };
      return NextResponse.json(response, { status: 200 });
    }

    const trackInfo = session.track as RateTrackInfo | undefined;
    const response: ApiResponse<RatePlaybackStatus> = {
      success: true,
      data: {
        active: true,
        isPaused: true,
        positionSeconds: 0,
        durationSeconds: session.durationSeconds,
        sidPath: session.sidPath,
        track: trackInfo,
      },
    };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('[api/rate/status] Failed to load playback status', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to load playback status',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
