import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { findHiddenGems } from '@/lib/server/hidden-gems';
import { resolvePlaybackEnvironment, createRateTrackInfo } from '@/lib/rate-playback';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { pathExists } from '@sidflow/common';
import { stat } from 'node:fs/promises';
import { lookupSongLength } from '@/lib/songlengths';

interface HiddenGemsRequest {
    limit?: number;
    minRating?: number;
}

interface HiddenGemsResponse {
    tracks: RateTrackInfo[];
    stationName: string;
}

/**
 * POST /api/play/hidden-gems
 * 
 * Finds "hidden gem" tracks: high quality but underplayed.
 * Uses ML ratings and play count statistics to surface great tracks
 * that deserve more attention.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as HiddenGemsRequest;
        const { limit = 20, minRating = 4.0 } = body;

        console.log('[API] /api/play/hidden-gems - Request:', {
            limit,
            minRating,
            timestamp: new Date().toISOString(),
        });

        const env = await resolvePlaybackEnvironment();

        // Find hidden gems
        const gemTracks = await findHiddenGems({
            limit,
            minRating,
        });

        if (gemTracks.length === 0) {
            const response: ApiResponse = {
                success: false,
                error: 'No hidden gems found',
                details: 'No underplayed tracks with high ratings found',
            };
            return NextResponse.json(response, { status: 404 });
        }

        // Enrich tracks with full metadata
        const enrichedTracks: RateTrackInfo[] = [];
        for (const track of gemTracks) {
            try {
                if (!(await pathExists(track.sid_path))) {
                    continue;
                }

                const fileStats = await stat(track.sid_path);
                const length = await lookupSongLength(track.sid_path, env.sidPath, env.musicRoot);

                const rateTrackInfo = await createRateTrackInfo({
                    env,
                    sidPath: track.sid_path,
                    relativeBase: 'collection',
                    lengthHint: length,
                });

                const enrichedTrack: RateTrackInfo = {
                    ...rateTrackInfo,
                    metadata: {
                        ...rateTrackInfo.metadata,
                        length,
                        fileSizeBytes: fileStats.size,
                    },
                };

                enrichedTracks.push(enrichedTrack);
            } catch (error) {
                console.warn('[API] Failed to load hidden gem track:', track.sid_path, error);
                continue;
            }
        }

        const stationName = 'Hidden Gems';

        console.log('[API] /api/play/hidden-gems - Success:', {
            tracksFound: enrichedTracks.length,
            stationName,
        });

        const response: ApiResponse<HiddenGemsResponse> = {
            success: true,
            data: {
                tracks: enrichedTracks,
                stationName,
            },
        };
        return NextResponse.json(response, {
            status: 200,
            headers: {
                'Cache-Control': 'public, max-age=1800, s-maxage=3600', // 30min client, 1hr CDN
            },
        });
    } catch (error) {
        console.error('[API] /api/play/hidden-gems - Error:', error);
        const response: ApiResponse = {
            success: false,
            error: 'Failed to find hidden gems',
            details: error instanceof Error ? error.message : String(error),
        };
        return NextResponse.json(response, { status: 500 });
    }
}
