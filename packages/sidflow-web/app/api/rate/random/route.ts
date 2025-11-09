import { NextResponse } from 'next/server';
import path from 'node:path';
import { pathExists } from '@sidflow/common';
import { createTagFilePath, findUntaggedSids } from '@sidflow/rate';
import type { ApiResponse } from '@/lib/validation';
import { resolvePlaybackEnvironment } from '@/lib/rate-playback';
import { loadSonglengthsData, lookupSongLength } from '@/lib/songlengths';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { createRateTrackInfo } from '@/lib/rate-playback';
import { createPlaybackSession } from '@/lib/playback-session';

type RateTrackPayload = RateTrackInfo;

async function pickRandomUntaggedSid(
  hvscRoot: string,
  collectionRoot: string,
  tagsPath: string
): Promise<string | null> {
  const { paths } = await loadSonglengthsData(hvscRoot);
  const baseRelative = path.relative(hvscRoot, collectionRoot);
  const normalizedBase = baseRelative
    .split(path.sep)
    .filter(Boolean)
    .join('/');
  const basePrefix = normalizedBase ? `${normalizedBase.replace(/\/+$/, '')}/` : '';
  const subsetSupported =
    normalizedBase === '' || (!normalizedBase.startsWith('..') && !path.isAbsolute(baseRelative));

  if (paths.length > 0 && subsetSupported) {
    const filtered = normalizedBase
      ? paths.filter((relative) => relative === normalizedBase || relative.startsWith(basePrefix))
      : paths;
    const maxAttempts = Math.min(filtered.length, 2000);
    const seen = new Set<number>();

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let index = Math.floor(Math.random() * filtered.length);
      while (seen.has(index) && seen.size < filtered.length) {
        index = (index + 1) % filtered.length;
      }
      if (seen.has(index)) {
        break;
      }
      seen.add(index);
      const relativePosix = filtered[index].replace(/^\//, '');
      const absolutePath = path.join(hvscRoot, ...relativePosix.split('/'));
      if (
        !(await pathExists(absolutePath)) ||
        !absolutePath.startsWith(collectionRoot)
      ) {
        continue;
      }
      const tagBase = absolutePath.startsWith(hvscRoot) ? hvscRoot : collectionRoot;
      const tagPath = createTagFilePath(tagBase, tagsPath, absolutePath);
      if (!(await pathExists(tagPath))) {
        return absolutePath;
      }
    }
  }

  const fallback = await findUntaggedSids(collectionRoot, tagsPath);
  if (fallback.length === 0) {
    return null;
  }
  const index = Math.floor(Math.random() * fallback.length);
  const candidate = fallback[index] ?? null;
  if (candidate && (await pathExists(candidate))) {
    return candidate;
  }
  return null;
}
export async function POST() {
  const startTime = Date.now();
  try {
    console.log('[API] /api/rate/random - Request:', {
      timestamp: new Date().toISOString(),
    });

    const env = await resolvePlaybackEnvironment();
    const sidPath = await pickRandomUntaggedSid(env.hvscPath, env.musicRoot, env.tagsPath);
    if (!sidPath) {
      console.log('[API] /api/rate/random - No untagged SIDs found');
      const response: ApiResponse = {
        success: false,
        error: 'No SID files to rate',
        details: 'All SID files appear to be tagged already.',
      };
      return NextResponse.json(response, { status: 404 });
    }
    if (!(await pathExists(sidPath))) {
      return NextResponse.json(
        {
          success: false,
          error: 'Selected SID no longer exists',
          details: `Could not find ${sidPath}`,
        },
        { status: 410 }
      );
    }

    const length = await lookupSongLength(sidPath, env.hvscPath, env.musicRoot);

    const track = await createRateTrackInfo({
      env,
      sidPath,
      relativeBase: 'collection',
      lengthHint: length,
    });

    const session = createPlaybackSession({
      scope: 'rate',
      sidPath,
      track,
      durationSeconds: track.durationSeconds,
      selectedSong: track.selectedSong,
    });

    const elapsedMs = Date.now() - startTime;
    console.log('[API] /api/rate/random - Success:', {
      sessionId: session.sessionId,
      sidPath,
      selectedSong: session.selectedSong,
      durationSeconds: session.durationSeconds,
      elapsedMs,
    });

    const response: ApiResponse<{ track: RateTrackPayload; session: typeof session }> = {
      success: true,
      data: {
        track,
        session,
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    console.error('[API] /api/rate/random - Error:', {
      error: error instanceof Error ? error.message : String(error),
      elapsedMs,
    });
    const response: ApiResponse = {
      success: false,
      error: 'Failed to load random SID',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
