import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { getAggregateRating } from '@/lib/server/rating-aggregator';

/**
 * GET /api/rate/aggregate?sid_path=<path>
 * 
 * Returns aggregate rating information for a specific track,
 * including aggregate ratings and trending status.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sidPath = searchParams.get('sid_path');

    if (!sidPath) {
      const response: ApiResponse = {
        success: false,
        error: 'Missing sid_path parameter',
        details: 'sid_path query parameter is required',
      };
      return NextResponse.json(response, { status: 400 });
    }

    console.log('[API] /api/rate/aggregate - Request:', {
      sidPath,
      timestamp: new Date().toISOString(),
    });

    const aggregateRating = await getAggregateRating(sidPath);

    if (!aggregateRating) {
      const response: ApiResponse = {
        success: false,
        error: 'Failed to calculate aggregate rating',
        details: 'Unable to aggregate ratings for the specified track',
      };
      return NextResponse.json(response, { status: 500 });
    }

    console.log('[API] /api/rate/aggregate - Success:', {
      sidPath,
      averageRating: aggregateRating.community.averageRating,
      totalRatings: aggregateRating.community.totalRatings,
      isTrending: aggregateRating.trending.isTrending,
    });

    const response: ApiResponse<typeof aggregateRating> = {
      success: true,
      data: aggregateRating,
    };
    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=600', // 5min client, 10min CDN
      },
    });
  } catch (error) {
    console.error('[API] /api/rate/aggregate - Error:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to get aggregate rating',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
