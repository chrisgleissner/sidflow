import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { findSimilarComposers } from '@/lib/server/composer-discovery';

interface SimilarComposersRequest {
    composer: string;
    limit?: number;
}

interface ComposerSimilarity {
    composer: string;
    similarity_score: number;
    track_count: number;
    avg_e: number;
    avg_m: number;
    avg_c: number;
}

interface SimilarComposersResponse {
    composer: string;
    similar_composers: ComposerSimilarity[];
}

/**
 * POST /api/play/similar-composers
 * 
 * Finds composers with similar musical styles based on track feature analysis.
 * Analyzes E/M/C dimensions across a composer's body of work.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as SimilarComposersRequest;
        const { composer, limit = 5 } = body;

        console.log('[API] /api/play/similar-composers - Request:', {
            composer,
            limit,
            timestamp: new Date().toISOString(),
        });

        if (!composer || composer.trim().length === 0) {
            const response: ApiResponse = {
                success: false,
                error: 'Missing composer name',
                details: 'composer is required',
            };
            return NextResponse.json(response, { status: 400 });
        }

        // Find similar composers
        const similarComposers = await findSimilarComposers({
            composer: composer.trim(),
            limit,
        });

        if (similarComposers.length === 0) {
            const response: ApiResponse = {
                success: false,
                error: 'No similar composers found',
                details: `Could not find similar composers to "${composer}"`,
            };
            return NextResponse.json(response, { status: 404 });
        }

        console.log('[API] /api/play/similar-composers - Success:', {
            composer,
            similarFound: similarComposers.length,
        });

        const response: ApiResponse<SimilarComposersResponse> = {
            success: true,
            data: {
                composer,
                similar_composers: similarComposers,
            },
        };
        return NextResponse.json(response, { status: 200 });
    } catch (error) {
        console.error('[API] /api/play/similar-composers - Error:', error);
        const response: ApiResponse = {
            success: false,
            error: 'Failed to find similar composers',
            details: error instanceof Error ? error.message : String(error),
        };
        return NextResponse.json(response, { status: 500 });
    }
}
