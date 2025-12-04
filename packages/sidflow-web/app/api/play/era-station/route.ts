import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { findTracksInEra } from '@/lib/server/era-explorer';
import { resolvePlaybackEnvironment, createRateTrackInfo } from '@/lib/rate-playback';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { pathExists, lookupSongLength } from '@sidflow/common';
import { stat } from 'node:fs/promises';

interface EraStationRequest {
    yearStart: number;
    yearEnd: number;
    limit?: number;
}

interface EraStationResponse {
    tracks: RateTrackInfo[];
    stationName: string;
    yearRange: string;
}

/**
 * POST /api/play/era-station
 * 
 * Creates a station featuring tracks from a specific era (year range).
 * Filters tracks by release year and returns high-quality selections.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as EraStationRequest;
        const { yearStart, yearEnd, limit = 20 } = body;

        console.log('[API] /api/play/era-station - Request:', {
            yearStart,
            yearEnd,
            limit,
            timestamp: new Date().toISOString(),
        });

        // Validate year range
        if (!yearStart || !yearEnd || yearStart > yearEnd) {
            const response: ApiResponse = {
                success: false,
                error: 'Invalid year range',
                details: 'yearStart and yearEnd must be valid years with yearStart <= yearEnd',
            };
            return NextResponse.json(response, { status: 400 });
        }

        if (yearStart < 1980 || yearEnd > 2030) {
            const response: ApiResponse = {
                success: false,
                error: 'Year range out of bounds',
                details: 'Years must be between 1980 and 2030',
            };
            return NextResponse.json(response, { status: 400 });
        }

        const env = await resolvePlaybackEnvironment();

        // Find tracks in the era
        const eraTracks = await findTracksInEra({
            yearStart,
            yearEnd,
            limit,
        });

        if (eraTracks.length === 0) {
            const response: ApiResponse = {
                success: false,
                error: 'No tracks found',
                details: `No tracks found for years ${yearStart}-${yearEnd}`,
            };
            return NextResponse.json(response, { status: 404 });
        }

        // Enrich tracks with full metadata
        const enrichedTracks: RateTrackInfo[] = [];
        for (const track of eraTracks) {
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
                console.warn('[API] Failed to load era track:', track.sid_path, error);
                continue;
            }
        }

        const yearRange = yearStart === yearEnd ? `${yearStart}` : `${yearStart}-${yearEnd}`;
        const stationName = `Era Explorer: ${yearRange}`;

        console.log('[API] /api/play/era-station - Success:', {
            tracksFound: enrichedTracks.length,
            stationName,
        });

        const response: ApiResponse<EraStationResponse> = {
            success: true,
            data: {
                tracks: enrichedTracks,
                stationName,
                yearRange,
            },
        };
        return NextResponse.json(response, { status: 200 });
    } catch (error) {
        console.error('[API] /api/play/era-station - Error:', error);
        const response: ApiResponse = {
            success: false,
            error: 'Failed to create era station',
            details: error instanceof Error ? error.message : String(error),
        };
        return NextResponse.json(response, { status: 500 });
    }
}
