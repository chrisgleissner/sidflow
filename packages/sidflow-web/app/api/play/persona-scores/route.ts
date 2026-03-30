import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  PERSONA_IDS,
  scoreAllPersonas,
  type PersonaId,
  type PersonaTrackContext,
} from '@sidflow/common';
import type { ApiResponse } from '@/lib/validation';

const MAX_TRACK_IDS = 500;

const PersonaScoresRequestSchema = z.object({
  trackIds: z.array(z.string()).min(1).max(MAX_TRACK_IDS),
});

type PersonaScoresResponse = {
  scores: Record<string, Record<PersonaId, number>>;
};

/**
 * POST /api/play/persona-scores
 *
 * Returns all 9 persona scores for a batch of tracks.
 * The web client uses this to pre-compute scores and enable
 * instant switching without server round-trips.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = PersonaScoresRequestSchema.safeParse(body);

    if (!parsed.success) {
      const response: ApiResponse = {
        success: false,
        error: 'Invalid request',
        details: parsed.error.issues.map((i) => i.message).join(', '),
      };
      return NextResponse.json(response, { status: 400 });
    }

    const { trackIds } = parsed.data;

    if (trackIds.length > MAX_TRACK_IDS) {
      const response: ApiResponse = {
        success: false,
        error: `Maximum ${MAX_TRACK_IDS} track IDs per request`,
      };
      return NextResponse.json(response, { status: 400 });
    }

    console.log('[API] /api/play/persona-scores - Request:', {
      trackCount: trackIds.length,
      timestamp: new Date().toISOString(),
    });

    // For now, return empty scores for unknown tracks.
    // In production, this would load track data from the classified corpus
    // and compute scores using scoreAllPersonas from @sidflow/common.
    const scores: Record<string, Record<PersonaId, number>> = {};

    const response: ApiResponse<PersonaScoresResponse> = {
      success: true,
      data: { scores },
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=600',
      },
    });
  } catch (error) {
    console.error('[API] /api/play/persona-scores - Error:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to compute persona scores',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
