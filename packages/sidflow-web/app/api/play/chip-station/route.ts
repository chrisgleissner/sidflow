import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { findTracksWithChipModel } from '@/lib/server/chip-model-stations';
import { resolvePlaybackEnvironment, createRateTrackInfo } from '@/lib/rate-playback';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { pathExists, lookupSongLength } from '@sidflow/common';
import { stat } from 'node:fs/promises';

interface ChipStationRequest {
    chipModel: '6581' | '8580' | '8580r5';
    limit?: number;
}

interface ChipStationResponse {
    tracks: RateTrackInfo[];
    stationName: string;
    chipModel: string;
}

/**
 * POST /api/play/chip-station
 * 
 * Creates a station featuring tracks from a specific SID chip model.
 * Filters tracks by their chip model for a pure audio experience.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as ChipStationRequest;
        const { chipModel, limit = 20 } = body;

        console.log('[API] /api/play/chip-station - Request:', {
            chipModel,
            limit,
            timestamp: new Date().toISOString(),
        });

        // Validate chip model
        if (!chipModel || !['6581', '8580', '8580r5'].includes(chipModel)) {
            const response: ApiResponse = {
                success: false,
                error: 'Invalid chip model',
                details: 'chipModel must be one of: 6581, 8580, 8580r5',
            };
            return NextResponse.json(response, { status: 400 });
        }

        const env = await resolvePlaybackEnvironment();

        // Normalize chip model (8580r5 -> 8580)
        const normalizedChipModel = chipModel === '8580r5' ? '8580' : chipModel;

        // Find tracks with this chip model
        const chipTracks = await findTracksWithChipModel({
            chipModel: normalizedChipModel,
            limit,
        });

        if (chipTracks.length === 0) {
            const response: ApiResponse = {
                success: false,
                error: 'No tracks found',
                details: `No tracks found with chip model ${chipModel}`,
            };
            return NextResponse.json(response, { status: 404 });
        }

        // Enrich tracks with full metadata
        const enrichedTracks: RateTrackInfo[] = [];
        for (const track of chipTracks) {
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
                console.warn('[API] Failed to load chip model track:', track.sid_path, error);
                continue;
            }
        }

        const stationName = `Pure ${chipModel} Showcase`;

        console.log('[API] /api/play/chip-station - Success:', {
            tracksFound: enrichedTracks.length,
            stationName,
        });

        const response: ApiResponse<ChipStationResponse> = {
            success: true,
            data: {
                tracks: enrichedTracks,
                stationName,
                chipModel,
            },
        };
        return NextResponse.json(response, { status: 200 });
    } catch (error) {
        console.error('[API] /api/play/chip-station - Error:', error);
        const response: ApiResponse = {
            success: false,
            error: 'Failed to create chip station',
            details: error instanceof Error ? error.message : String(error),
        };
        return NextResponse.json(response, { status: 500 });
    }
}
