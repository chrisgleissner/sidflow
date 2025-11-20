import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { findGameSoundtracks } from '@/lib/server/game-soundtrack';

interface GameSoundtrackRequest {
    game_title?: string;
    seed_sid_path?: string;
    limit?: number;
}

interface GameSoundtrackResponse {
    tracks: Awaited<ReturnType<typeof findGameSoundtracks>>['tracks'];
    stationName: string;
    gameTitle: string;
}

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json()) as GameSoundtrackRequest;
        const { game_title, seed_sid_path, limit = 20 } = body;

        if (!game_title && !seed_sid_path) {
            const response: ApiResponse = {
                success: false,
                error: 'Missing parameters',
                details: 'Either game_title or seed_sid_path is required',
            };
            return NextResponse.json(response, { status: 400 });
        }

        console.log('[API] /api/play/game-soundtrack', {
            game_title,
            seed_sid_path,
            limit,
            timestamp: new Date().toISOString(),
        });

        const result = await findGameSoundtracks({
            gameTitle: game_title,
            seedSidPath: seed_sid_path,
            limit,
        });

        const response: ApiResponse<GameSoundtrackResponse> = {
            success: true,
            data: {
                tracks: result.tracks,
                stationName: result.stationName,
                gameTitle: result.gameTitle,
            },
        };

        return NextResponse.json(response, { status: 200 });
    } catch (error) {
        console.error('[API] /api/play/game-soundtrack - Error', error);
        const response: ApiResponse = {
            success: false,
            error: 'Failed to find game soundtracks',
            details: error instanceof Error ? error.message : String(error),
        };
        return NextResponse.json(response, { status: 500 });
    }
}
