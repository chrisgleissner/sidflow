/**
 * Playlists API - List and Create playlists
 * GET /api/playlists - List all playlists
 * POST /api/playlists - Create a new playlist
 */

import { NextRequest, NextResponse } from 'next/server';
import {
    listPlaylists,
    createPlaylist,
} from '@/lib/server/playlist-storage';
import type {
    CreatePlaylistRequest,
    PlaylistsResponse,
    PlaylistResponse,
    PlaylistErrorResponse,
} from '@/lib/types/playlist';

/**
 * GET /api/playlists
 * List all playlists
 */
export async function GET() {
    try {
        const playlists = await listPlaylists();

        const response: PlaylistsResponse = {
            playlists,
            total: playlists.length,
        };

        return NextResponse.json(response, { status: 200 });
    } catch (error) {
        console.error('[Playlists API] GET error:', error);
        const errorResponse: PlaylistErrorResponse = {
            error: 'Failed to list playlists',
            details: error instanceof Error ? error.message : String(error),
        };
        return NextResponse.json(errorResponse, { status: 500 });
    }
}

/**
 * POST /api/playlists
 * Create a new playlist
 */
export async function POST(request: NextRequest) {
    try {
        const body = (await request.json()) as CreatePlaylistRequest;

        // Validation
        if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
            const errorResponse: PlaylistErrorResponse = {
                error: 'Playlist name is required',
            };
            return NextResponse.json(errorResponse, { status: 400 });
        }

        if (!Array.isArray(body.tracks)) {
            const errorResponse: PlaylistErrorResponse = {
                error: 'Tracks must be an array',
            };
            return NextResponse.json(errorResponse, { status: 400 });
        }

        // Validate each track has required sidPath
        for (const track of body.tracks) {
            if (!track.sidPath || typeof track.sidPath !== 'string') {
                const errorResponse: PlaylistErrorResponse = {
                    error: 'Each track must have a sidPath',
                };
                return NextResponse.json(errorResponse, { status: 400 });
            }
        }

        const playlist = await createPlaylist(body);

        const response: PlaylistResponse = {
            playlist,
        };

        return NextResponse.json(response, { status: 201 });
    } catch (error) {
        console.error('[Playlists API] POST error:', error);
        const errorResponse: PlaylistErrorResponse = {
            error: 'Failed to create playlist',
            details: error instanceof Error ? error.message : String(error),
        };
        return NextResponse.json(errorResponse, { status: 500 });
    }
}
