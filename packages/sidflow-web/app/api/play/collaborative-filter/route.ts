import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { findCollaborativeRecommendations } from '@/lib/server/collaborative-filter';
import { pathExists } from '@sidflow/common';

interface CollaborativeFilterRequest {
    seed_sid_path: string;
    limit?: number;
    min_correlation?: number;
}

interface CollaborativeFilterResponse {
    seedTrack: Awaited<ReturnType<typeof findCollaborativeRecommendations>>['seedTrack'];
    tracks: Awaited<ReturnType<typeof findCollaborativeRecommendations>>['tracks'];
    stationName: string;
}

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json()) as CollaborativeFilterRequest;
        const { seed_sid_path, limit = 20, min_correlation } = body;

        if (!seed_sid_path) {
            const response: ApiResponse = {
                success: false,
                error: 'Missing seed_sid_path',
                details: 'seed_sid_path is required for collaborative filtering',
            };
            return NextResponse.json(response, { status: 400 });
        }

        if (!(await pathExists(seed_sid_path))) {
            const response: ApiResponse = {
                success: false,
                error: 'Seed track not found',
                details: `SID path does not exist: ${seed_sid_path}`,
            };
            return NextResponse.json(response, { status: 404 });
        }

        console.log('[API] /api/play/collaborative-filter', {
            seed_sid_path,
            limit,
            min_correlation,
            timestamp: new Date().toISOString(),
        });

        const result = await findCollaborativeRecommendations({
            seedSidPath: seed_sid_path,
            limit,
            minCorrelation: min_correlation,
        });

        const response: ApiResponse<CollaborativeFilterResponse> = {
            success: true,
            data: {
                seedTrack: result.seedTrack,
                tracks: result.tracks,
                stationName: result.stationName,
            },
        };

        return NextResponse.json(response, { status: 200 });
    } catch (error) {
        console.error('[API] /api/play/collaborative-filter - Error', error);
        const response: ApiResponse = {
            success: false,
            error: 'Failed to find collaborative recommendations',
            details: error instanceof Error ? error.message : String(error),
        };
        return NextResponse.json(response, { status: 500 });
    }
}
