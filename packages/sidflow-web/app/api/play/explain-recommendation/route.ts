import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { explainRecommendation } from '@/lib/server/explain-recommendation';
import { pathExists } from '@sidflow/common';

interface ExplainRecommendationRequest {
    seed_sid_path: string;
    target_sid_path: string;
}

interface ExplainRecommendationResponse {
    seedTrack: Awaited<ReturnType<typeof explainRecommendation>>['seedTrack'];
    targetTrack: Awaited<ReturnType<typeof explainRecommendation>>['targetTrack'];
    overallSimilarity: number;
    explanations: Awaited<ReturnType<typeof explainRecommendation>>['explanations'];
}

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json()) as ExplainRecommendationRequest;
        const { seed_sid_path, target_sid_path } = body;

        if (!seed_sid_path || !target_sid_path) {
            const response: ApiResponse = {
                success: false,
                error: 'Missing parameters',
                details: 'Both seed_sid_path and target_sid_path are required',
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

        if (!(await pathExists(target_sid_path))) {
            const response: ApiResponse = {
                success: false,
                error: 'Target track not found',
                details: `SID path does not exist: ${target_sid_path}`,
            };
            return NextResponse.json(response, { status: 404 });
        }

        console.log('[API] /api/play/explain-recommendation', {
            seed_sid_path,
            target_sid_path,
            timestamp: new Date().toISOString(),
        });

        const result = await explainRecommendation({
            seedSidPath: seed_sid_path,
            targetSidPath: target_sid_path,
        });

        const response: ApiResponse<ExplainRecommendationResponse> = {
            success: true,
            data: {
                seedTrack: result.seedTrack,
                targetTrack: result.targetTrack,
                overallSimilarity: result.overallSimilarity,
                explanations: result.explanations,
            },
        };

        return NextResponse.json(response, { status: 200 });
    } catch (error) {
        console.error('[API] /api/play/explain-recommendation - Error', error);
        const response: ApiResponse = {
            success: false,
            error: 'Failed to explain recommendation',
            details: error instanceof Error ? error.message : String(error),
        };
        return NextResponse.json(response, { status: 500 });
    }
}
