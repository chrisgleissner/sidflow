import { NextResponse } from 'next/server';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { pathExists } from '@sidflow/common';
import { findUntaggedSids, createTagFilePath } from '@sidflow/rate';
import type { ApiResponse } from '@/lib/validation';
import { resolvePlaybackEnvironment } from '@/lib/rate-playback';
import { lookupSongLength } from '@/lib/songlengths';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { createRateTrackInfo } from '@/lib/rate-playback';
import { createPlaybackSession } from '@/lib/playback-session';
import { ensureHlsForTrack } from '@/lib/server/hls-service';
import { resolveSessionStreamAssets } from '@/lib/server/availability-service';

type RateTrackPayload = RateTrackInfo;

// Cache untagged SIDs list for 5 minutes to avoid slow directory scans
let untaggedCache: { sids: string[]; timestamp: number; sidPath: string; tagsPath: string } | null = null;
let cacheBuilding = false;
const CACHE_TTL_MS = 5 * 60 * 1000;
const QUICK_SCAN_LIMIT = 50; // Only scan first N files for instant response

async function quickFindUntaggedSid(sidPath: string, tagsPath: string): Promise<string | null> {
  // Quick scan: find first untagged SID in a shallow search
  async function quickWalk(dir: string, depth: number = 0): Promise<string | null> {
    if (depth > 3) return null; // Don't go too deep
    
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      // First check files in current dir
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.sid')) {
          const fullPath = path.join(dir, entry.name);
          const tagPath = createTagFilePath(sidPath, tagsPath, fullPath);
          if (!(await pathExists(tagPath))) {
            return fullPath;
          }
        }
      }
      
      // Then recurse into subdirectories
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const result = await quickWalk(path.join(dir, entry.name), depth + 1);
          if (result) return result;
        }
      }
    } catch {
      return null;
    }
    
    return null;
  }
  
  return quickWalk(sidPath);
}

async function getCachedUntaggedSids(sidPath: string, tagsPath: string): Promise<string[]> {
  const now = Date.now();
  if (
    untaggedCache &&
    untaggedCache.sidPath === sidPath &&
    untaggedCache.tagsPath === tagsPath &&
    now - untaggedCache.timestamp < CACHE_TTL_MS
  ) {
    return untaggedCache.sids;
  }

  const sids = await findUntaggedSids(sidPath, tagsPath);
  untaggedCache = { sids, timestamp: now, sidPath, tagsPath };
  return sids;
}

function startBackgroundCacheBuild(sidPath: string, tagsPath: string): void {
  if (cacheBuilding) return;
  
  cacheBuilding = true;
  getCachedUntaggedSids(sidPath, tagsPath)
    .then(() => {
      console.log('[rate/random] Background cache build complete');
    })
    .catch((error) => {
      console.error('[rate/random] Background cache build failed:', error);
    })
    .finally(() => {
      cacheBuilding = false;
    });
}

async function pickRandomUntaggedSid(
  hvscRoot: string,
  collectionRoot: string,
  tagsPath: string
): Promise<string | null> {
  // If cache exists and is valid, use it for true random selection
  const now = Date.now();
  if (
    untaggedCache &&
    untaggedCache.sidPath === collectionRoot &&
    untaggedCache.tagsPath === tagsPath &&
    now - untaggedCache.timestamp < CACHE_TTL_MS &&
    untaggedCache.sids.length > 0
  ) {
    const index = Math.floor(Math.random() * untaggedCache.sids.length);
    const candidate = untaggedCache.sids[index] ?? null;
    if (candidate && (await pathExists(candidate))) {
      return candidate;
    }
  }

  // No cache or expired: do quick scan for instant response
  const quickResult = await quickFindUntaggedSid(collectionRoot, tagsPath);
  
  // Start building full cache in background for next requests
  if (!cacheBuilding) {
    startBackgroundCacheBuild(collectionRoot, tagsPath);
  }
  
  return quickResult;
}
export async function POST() {
  const startTime = Date.now();
  try {
    console.log('[API] /api/rate/random - Request:', {
      timestamp: new Date().toISOString(),
    });

    const env = await resolvePlaybackEnvironment();
    const sidPath = await pickRandomUntaggedSid(env.sidPath, env.musicRoot, env.tagsPath);
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

    const length = await lookupSongLength(sidPath, env.sidPath, env.musicRoot);

    const track = await createRateTrackInfo({
      env,
      sidPath,
      relativeBase: 'collection',
      lengthHint: length,
    });

    const fallbackHlsUrl = await ensureHlsForTrack(track);
    const streamAssets = await resolveSessionStreamAssets(track);

    const session = createPlaybackSession({
      scope: 'rate',
      sidPath,
      track,
      durationSeconds: track.durationSeconds,
      selectedSong: track.selectedSong,
      romPaths: {
        kernal: env.kernalRomPath ?? null,
        basic: env.basicRomPath ?? null,
        chargen: env.chargenRomPath ?? null,
      },
      fallbackHlsUrl,
      streamAssets,
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
