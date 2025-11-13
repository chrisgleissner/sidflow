import { NextRequest, NextResponse } from 'next/server';
import { PlayRequestSchema, type ApiResponse } from '@/lib/validation';
import { ZodError } from 'zod';
import { resolvePlaybackEnvironment, resolveSidPath, createRateTrackInfo } from '@/lib/rate-playback';
import { pathExists } from '@sidflow/common';
import { createPlaybackSession } from '@/lib/playback-session';
import type { RateTrackInfo } from '@/lib/types/rate-track';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = PlayRequestSchema.parse(body);
    const env = await resolvePlaybackEnvironment();
    const sidPath = await resolveSidPath(validatedData.sid_path, env);

    if (!(await pathExists(sidPath))) {
      const response: ApiResponse = {
        success: false,
        error: 'SID not found',
        details: sidPath,
      };
      return NextResponse.json(response, { status: 404 });
    }

    const track: RateTrackInfo = await createRateTrackInfo({
      env,
      sidPath,
      relativeBase: 'hvsc',
    });

    const session = createPlaybackSession({
      scope: 'play',
      sidPath,
      track,
      durationSeconds: track.durationSeconds,
      selectedSong: track.selectedSong,
      romPaths: {
        kernal: env.kernalRomPath ?? null,
        basic: env.basicRomPath ?? null,
        chargen: env.chargenRomPath ?? null,
      },
      fallbackHlsUrl: null,
    });

    const response: ApiResponse<{ track: RateTrackInfo; session: typeof session }> = {
      success: true,
      data: {
        track,
        session,
      },
    };
    return NextResponse.json(response, { status: 200 });
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
