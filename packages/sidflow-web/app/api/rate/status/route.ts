import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { resolvePlaybackEnvironment, computePlaybackPosition } from '@/lib/rate-playback';
import { createPlaybackLock } from '@sidflow/common';
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
    const env = await resolvePlaybackEnvironment();
    const playbackLock = await createPlaybackLock(env.config);
    const metadata = await playbackLock.getMetadata();

    if (!metadata) {
      const response: ApiResponse<RatePlaybackStatus> = {
        success: true,
        data: {
          active: false,
          isPaused: false,
          positionSeconds: 0,
        },
      };
      return NextResponse.json(response, { status: 200 });
    }

    const position = computePlaybackPosition(metadata);

    const trackInfo = metadata.track as RateTrackInfo | undefined;
    const response: ApiResponse<RatePlaybackStatus> = {
      success: true,
      data: {
        active: true,
        isPaused: Boolean(metadata.isPaused),
        positionSeconds: position,
        durationSeconds: metadata.durationSeconds,
        sidPath: metadata.sidPath,
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
