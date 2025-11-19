/**
 * Playlist Reorder API
 * POST /api/playlists/[id]/reorder - Reorder tracks in a playlist
 */

import { NextRequest, NextResponse } from 'next/server';
import { reorderPlaylistTracks } from '@/lib/server/playlist-storage';
import type { PlaylistResponse, PlaylistErrorResponse } from '@/lib/types/playlist';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ReorderRequest {
  trackOrder: string[]; // Array of sidPaths in new order
}

/**
 * POST /api/playlists/[id]/reorder
 * Reorder tracks within a playlist
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as ReorderRequest;

    // Validation
    if (!Array.isArray(body.trackOrder)) {
      const errorResponse: PlaylistErrorResponse = {
        error: 'trackOrder must be an array of sidPaths',
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const playlist = await reorderPlaylistTracks(id, body.trackOrder);

    if (!playlist) {
      const errorResponse: PlaylistErrorResponse = {
        error: 'Playlist not found',
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: PlaylistResponse = {
      playlist,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('[Playlist Reorder API] POST error:', error);
    const errorResponse: PlaylistErrorResponse = {
      error: 'Failed to reorder playlist tracks',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
