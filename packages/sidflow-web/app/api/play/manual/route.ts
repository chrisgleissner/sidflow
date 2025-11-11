import { NextRequest, NextResponse } from 'next/server';
import { PlayRequestSchema, type ApiResponse } from '@/lib/validation';
import { pathExists } from '@sidflow/common';
import {
  resolvePlaybackEnvironment,
  resolveSidPath,
  createRateTrackInfo,
} from '@/lib/rate-playback';
import { createPlaybackSession } from '@/lib/playback-session';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { ZodError } from 'zod';
import { scheduleWavPrefetchForTrack } from '@/lib/wav-cache-service';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const body = await request.json();
    const validated = PlayRequestSchema.parse(body);

    console.log('[API] /api/play/manual - Request:', {
      sidPath: validated.sid_path,
      timestamp: new Date().toISOString(),
    });

    const env = await resolvePlaybackEnvironment();

    const sidPath = await resolveSidPath(validated.sid_path, env);

    if (!(await pathExists(sidPath))) {
      const response: ApiResponse = {
        success: false,
        error: 'SID not found',
        details: sidPath,
      };
      return NextResponse.json(response, { status: 404 });
    }

    const payload: RateTrackInfo = await createRateTrackInfo({
      env,
      sidPath,
      relativeBase: 'hvsc',
    });

    const session = createPlaybackSession({
      scope: 'manual',
      sidPath,
      track: payload,
      durationSeconds: payload.durationSeconds,
      selectedSong: payload.selectedSong,
      romPaths: {
        kernal: env.kernalRomPath ?? null,
        basic: env.basicRomPath ?? null,
        chargen: env.chargenRomPath ?? null,
      },
    });

      scheduleWavPrefetchForTrack(payload);

    const elapsedMs = Date.now() - startTime;
    console.log('[API] /api/play/manual - Success:', {
      sessionId: session.sessionId,
      sidPath,
      selectedSong: session.selectedSong,
      durationSeconds: session.durationSeconds,
      elapsedMs,
    });

    const response: ApiResponse<{ track: RateTrackInfo; session: typeof session }> = {
      success: true,
      data: {
        track: payload,
        session,
      },
    };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    console.error('[API] /api/play/manual - Error:', {
      error: error instanceof Error ? error.message : String(error),
      elapsedMs,
    });

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
      error: 'Failed to start playback',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
