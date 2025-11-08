import path from 'node:path';
import { stat } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { PlayRequestSchema, type ApiResponse } from '@/lib/validation';
import { parseSidFile, pathExists, createPlaybackLock } from '@sidflow/common';
import { resolvePlaybackEnvironment, startSidPlayback, parseDurationSeconds } from '@/lib/rate-playback';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { ZodError } from 'zod';

async function resolveSidPath(input: string, env: Awaited<ReturnType<typeof resolvePlaybackEnvironment>>): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('SID path is required');
  }

  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.replace(/^\.?\/+/, '');
  const direct = path.join(env.hvscPath, normalized);
  if (await pathExists(direct)) {
    return direct;
  }

  const withoutPrefix = normalized.replace(/^c64music[\/]/i, '');
  const musicCandidate = path.join(env.musicRoot, withoutPrefix);
  if (await pathExists(musicCandidate)) {
    return musicCandidate;
  }

  return direct;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = PlayRequestSchema.parse(body);

    const env = await resolvePlaybackEnvironment();
    const playbackLock = await createPlaybackLock(env.config);

    const sidPath = await resolveSidPath(validated.sid_path, env);

    if (!(await pathExists(sidPath))) {
      const response: ApiResponse = {
        success: false,
        error: 'SID not found',
        details: sidPath,
      };
      return NextResponse.json(response, { status: 404 });
    }

    const metadata = await parseSidFile(sidPath);
    const durationSeconds = parseDurationSeconds(metadata.length);

    await startSidPlayback({
      env,
      playbackLock,
      sidPath,
      offsetSeconds: 0,
      durationSeconds,
      source: 'play/manual',
    });

    const payload: RateTrackInfo = {
      sidPath,
      relativePath: path.relative(env.hvscPath, sidPath),
      filename: path.basename(sidPath),
      displayName: metadata.title || path.basename(sidPath).replace(/\.sid$/i, ''),
      selectedSong: metadata.startSong,
      durationSeconds,
      metadata: {
        title: metadata.title,
        author: metadata.author,
        released: metadata.released,
        songs: metadata.songs,
        startSong: metadata.startSong,
        sidType: metadata.type,
        version: metadata.version,
        sidModel: metadata.sidModel1,
        sidModelSecondary: metadata.sidModel2,
        sidModelTertiary: metadata.sidModel3,
        clock: metadata.clock,
        length: metadata.length,
        fileSizeBytes: (await stat(sidPath)).size,
      },
    };

    const response: ApiResponse<{ track: RateTrackInfo }> = {
      success: true,
      data: {
        track: payload,
      },
    };
    return NextResponse.json(response, { status: 200 });
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
      error: 'Failed to start playback',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
