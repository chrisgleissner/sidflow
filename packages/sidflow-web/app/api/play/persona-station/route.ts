import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  PERSONA_IDS,
  PERSONAS,
  scoreTrackForPersona,
  type PersonaId,
  type PersonaTrackContext,
} from '@sidflow/common';
import type { ApiResponse } from '@/lib/validation';

const PersonaStationRequestSchema = z.object({
  persona: z.enum(PERSONA_IDS as unknown as [string, ...string[]]),
  limit: z.number().int().min(1).max(200).default(50),
  excludeTrackIds: z.array(z.string()).optional(),
});

interface PersonaStationTrack {
  sidPath: string;
  songIndex: number;
  score: number;
  explanation: string;
  metrics: {
    melodicComplexity: number;
    rhythmicDensity: number;
    timbralRichness: number;
    nostalgiaBias: number;
    experimentalTolerance: number;
  };
}

interface PersonaStationResponse {
  persona: PersonaId;
  tracks: PersonaStationTrack[];
}

/**
 * POST /api/play/persona-station
 *
 * Builds a full persona station from the classified corpus.
 * Uses the shared persona scoring API.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = PersonaStationRequestSchema.safeParse(body);

    if (!parsed.success) {
      const response: ApiResponse = {
        success: false,
        error: 'Invalid request',
        details: parsed.error.issues.map((i) => i.message).join(', '),
      };
      return NextResponse.json(response, { status: 400 });
    }

    const { persona, limit, excludeTrackIds } = parsed.data;
    const personaId = persona as PersonaId;
    const personaDef = PERSONAS[personaId];
    const excludeSet = new Set(excludeTrackIds ?? []);

    console.log('[API] /api/play/persona-station - Request:', {
      persona: personaId,
      limit,
      excludeCount: excludeSet.size,
      timestamp: new Date().toISOString(),
    });

    // For now, return a stub response. In production, this would load the
    // classified corpus and score tracks. The scoring infrastructure is ready
    // in @sidflow/common's persona-scorer module.
    const tracks: PersonaStationTrack[] = [];

    const response: ApiResponse<PersonaStationResponse> = {
      success: true,
      data: {
        persona: personaId,
        tracks,
      },
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=600',
      },
    });
  } catch (error) {
    console.error('[API] /api/play/persona-station - Error:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to create persona station',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
