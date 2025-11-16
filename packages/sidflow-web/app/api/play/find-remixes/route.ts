import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { findRemixRadarTracks } from '@/lib/server/remix-radar';
import { pathExists } from '@sidflow/common';

interface RemixRadarRequest {
    sid_path: string;
    limit?: number;
    min_title_similarity?: number;
}

interface RemixRadarResponse {
    seedTrack: Awaited<ReturnType<typeof findRemixRadarTracks>>['seedTrack'];
    tracks: Awaited<ReturnType<typeof findRemixRadarTracks>>['tracks'];
    stationName: string;
    explanations: Awaited<ReturnType<typeof findRemixRadarTracks>>['explanations'];
}

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json()) as RemixRadarRequest;
        const { sid_path, limit = 12, min_title_similarity } = body;

        if (!sid_path) {
            const response: ApiResponse = {
                success: false,
                error: 'Missing sid_path',
                details: 'sid_path is required to find remixes',
            };
            return NextResponse.json(response, { status: 400 });
        }

        if (!(await pathExists(sid_path))) {
            const response: ApiResponse = {
                success: false,
                error: 'Track not found',
                details: `SID path does not exist: ${sid_path}`,
            };
            return NextResponse.json(response, { status: 404 });
        }

        console.log('[API] /api/play/find-remixes', {
            sid_path,
            limit,
            min_title_similarity,
            timestamp: new Date().toISOString(),
        });

        const result = await findRemixRadarTracks({
            sidPath: sid_path,
            limit,
            minTitleSimilarity: min_title_similarity,
        });

        const response: ApiResponse<RemixRadarResponse> = {
            success: true,
            data: {
                seedTrack: result.seedTrack,
                tracks: result.tracks,
                stationName: result.stationName,
                explanations: result.explanations,
            },
        };

        return NextResponse.json(response, { status: 200 });
    } catch (error) {
        console.error('[API] /api/play/find-remixes - Error', error);
        const response: ApiResponse = {
            success: false,
            error: 'Failed to find remixes',
            details: error instanceof Error ? error.message : String(error),
        };
        return NextResponse.json(response, { status: 500 });
    }
}
