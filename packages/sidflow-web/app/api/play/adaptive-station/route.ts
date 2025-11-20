import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { createAdaptiveStation, type SessionAction } from '@/lib/server/adaptive-station';
import { pathExists } from '@sidflow/common';

interface AdaptiveStationRequest {
    seed_sid_path: string;
    session_actions: SessionAction[];
    limit?: number;
}

interface AdaptiveStationResponse {
    tracks: Awaited<ReturnType<typeof createAdaptiveStation>>['tracks'];
    stationName: string;
    adaptationSummary: Awaited<ReturnType<typeof createAdaptiveStation>>['adaptationSummary'];
}

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json()) as AdaptiveStationRequest;
        const { seed_sid_path, session_actions = [], limit = 20 } = body;

        if (!seed_sid_path) {
            const response: ApiResponse = {
                success: false,
                error: 'Missing seed_sid_path',
                details: 'seed_sid_path is required for adaptive station',
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

        console.log('[API] /api/play/adaptive-station', {
            seed_sid_path,
            actionCount: session_actions.length,
            limit,
            timestamp: new Date().toISOString(),
        });

        const result = await createAdaptiveStation({
            seedSidPath: seed_sid_path,
            sessionActions: session_actions,
            limit,
        });

        const response: ApiResponse<AdaptiveStationResponse> = {
            success: true,
            data: {
                tracks: result.tracks,
                stationName: result.stationName,
                adaptationSummary: result.adaptationSummary,
            },
        };

        return NextResponse.json(response, { status: 200 });
    } catch (error) {
        console.error('[API] /api/play/adaptive-station - Error', error);
        const response: ApiResponse = {
            success: false,
            error: 'Failed to create adaptive station',
            details: error instanceof Error ? error.message : String(error),
        };
        return NextResponse.json(response, { status: 500 });
    }
}
