import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { RateControlRequestSchema, type ApiResponse } from '@/lib/validation';
import { resolvePlaybackEnvironment, startSidPlayback, computePlaybackPosition } from '@/lib/rate-playback';
import { createPlaybackLock } from '@sidflow/common';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = RateControlRequestSchema.parse(body);

    const env = await resolvePlaybackEnvironment();
    const playbackLock = await createPlaybackLock(env.config);
    const metadata = await playbackLock.getMetadata();

    if (!metadata) {
      const response: ApiResponse = {
        success: false,
        error: 'No active playback',
        details: 'Start playback before sending transport commands.',
      };
      return NextResponse.json(response, { status: 409 });
    }

    const pid = metadata.pid;

    const successResponse = (message: string): ApiResponse<{ message: string }> => ({
      success: true,
      data: { message },
    });

    switch (validated.action) {
      case 'pause': {
        if (metadata.isPaused) {
          return NextResponse.json(successResponse('Playback already paused'), { status: 200 });
        }
        try {
          process.kill(pid, 'SIGSTOP');
        } catch (error) {
          return NextResponse.json(
            {
              success: false,
              error: 'Failed to pause playback',
              details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
          );
        }
        const position = computePlaybackPosition(metadata);
        await playbackLock.updateMetadata({
          ...metadata,
          offsetSeconds: position,
          startedAt: new Date().toISOString(),
          isPaused: true,
        });
        return NextResponse.json(successResponse('Playback paused'), { status: 200 });
      }
      case 'resume': {
        if (!metadata.isPaused) {
          return NextResponse.json(successResponse('Playback already running'), { status: 200 });
        }
        try {
          process.kill(pid, 'SIGCONT');
        } catch (error) {
          return NextResponse.json(
            {
              success: false,
              error: 'Failed to resume playback',
              details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
          );
        }
        await playbackLock.updateMetadata({
          ...metadata,
          startedAt: new Date().toISOString(),
          isPaused: false,
        });
        return NextResponse.json(successResponse('Playback resumed'), { status: 200 });
      }
      case 'stop': {
        try {
          process.kill(pid, 'SIGTERM');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            return NextResponse.json(
              {
                success: false,
                error: 'Failed to stop playback',
                details: error instanceof Error ? error.message : String(error),
              },
              { status: 500 }
            );
          }
        }
        await playbackLock.forceRelease();
        return NextResponse.json(successResponse('Playback stopped'), { status: 200 });
      }
      case 'seek': {
        if (typeof validated.positionSeconds !== 'number' || validated.positionSeconds < 0) {
          return NextResponse.json(
            {
              success: false,
              error: 'Invalid seek position',
              details: 'Provide a non-negative positionSeconds value.',
            },
            { status: 400 }
          );
        }
        if (!metadata.sidPath) {
          return NextResponse.json(
            {
              success: false,
              error: 'Unknown SID path',
              details: 'Cannot seek without sidPath metadata.',
            },
            { status: 500 }
          );
        }
        await startSidPlayback({
          env,
          playbackLock,
          sidPath: metadata.sidPath,
          offsetSeconds: validated.positionSeconds,
          durationSeconds: metadata.durationSeconds,
          source: metadata.source ?? 'api/rate/random',
        });
        return NextResponse.json(successResponse('Seeked to new position'), { status: 200 });
      }
      default:
        return NextResponse.json(
          {
            success: false,
            error: `Unsupported action: ${validated.action}`,
          },
          { status: 400 }
        );
    }
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
