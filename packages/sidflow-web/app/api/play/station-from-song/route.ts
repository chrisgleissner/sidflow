import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { findSimilarTracks } from '@/lib/server/similarity-search';
import { pathExists, lookupSongLength } from '@sidflow/common';
import { resolvePlaybackEnvironment, createRateTrackInfo } from '@/lib/rate-playback';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { stat } from 'node:fs/promises';

interface StationRequest {
  sid_path: string;
  limit?: number;
  similarity?: number;
  discovery?: number;
}

interface StationResponse {
  seedTrack: RateTrackInfo;
  similarTracks: RateTrackInfo[];
  stationName: string;
}

/**
 * POST /api/play/station-from-song
 * 
 * Creates a personalized radio station based on a seed song.
 * Uses vector similarity search to find similar tracks and blends
 * them with user's historical preferences.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as StationRequest;
    const { sid_path, limit = 20, similarity = 0.5, discovery = 0.5 } = body;

    if (!sid_path) {
      const response: ApiResponse = {
        success: false,
        error: 'Missing sid_path',
        details: 'sid_path is required to create a station',
      };
      return NextResponse.json(response, { status: 400 });
    }

    console.log('[API] /api/play/station-from-song - Request:', {
      sid_path,
      limit,
      similarity,
      discovery,
      timestamp: new Date().toISOString(),
    });

    const env = await resolvePlaybackEnvironment();

    // Verify seed track exists
    if (!(await pathExists(sid_path))) {
      const response: ApiResponse = {
        success: false,
        error: 'Seed track not found',
        details: `Track not found: ${sid_path}`,
      };
      return NextResponse.json(response, { status: 404 });
    }

    // Load seed track info
    const seedTrack = await createRateTrackInfo({
      env,
      sidPath: sid_path,
      relativeBase: 'collection',
    });

    // Find similar tracks using vector similarity search
    // Discovery parameter adjusts the balance between similarity and exploration
    // 0   = very similar      (min similarity 0.8)
    // 0.5 = balanced          (min similarity 0.55)
    // 1.0 = more exploration  (min similarity 0.3)
    const minSimilarity = Math.max(0.3, 0.8 - discovery * 0.5);

    // Similarity parameter adjusts boost factors
    // Higher similarity means stronger personalization based on user feedback
    const likeBoost = 1.0 + similarity * 1.0; // 1.0 to 2.0
    const dislikeBoost = 1.0 - similarity * 0.5; // 1.0 to 0.5

    const similarTracks = await findSimilarTracks({
      seedSidPath: sid_path,
      limit,
      minSimilarity,
      likeBoost,
      dislikeBoost,
    });

    // Convert similar tracks to RateTrackInfo format
    const enrichedTracks: RateTrackInfo[] = [];
    for (const similar of similarTracks) {
      try {
        if (!(await pathExists(similar.sid_path))) {
          continue;
        }

        const fileStats = await stat(similar.sid_path);
        const length = await lookupSongLength(similar.sid_path, env.sidPath, env.musicRoot);

        const track = await createRateTrackInfo({
          env,
          sidPath: similar.sid_path,
          relativeBase: 'collection',
          lengthHint: length,
        });

        const enrichedTrack: RateTrackInfo = {
          ...track,
          metadata: {
            ...track.metadata,
            length,
            fileSizeBytes: fileStats.size,
          },
        };

        enrichedTracks.push(enrichedTrack);
      } catch (error) {
        console.warn('[API] Failed to load similar track:', similar.sid_path, error);
        // Skip tracks that fail to load
        continue;
      }
    }

    const stationName = `Station: ${seedTrack.displayName}`;

    console.log('[API] /api/play/station-from-song - Success:', {
      seedTrack: sid_path,
      similarTracksFound: enrichedTracks.length,
      stationName,
    });

    const response: ApiResponse<StationResponse> = {
      success: true,
      data: {
        seedTrack,
        similarTracks: enrichedTracks,
        stationName,
      },
    };
    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=600', // 5min client, 10min CDN
      },
    });
  } catch (error) {
    console.error('[API] /api/play/station-from-song - Error:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to create station',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
