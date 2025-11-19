/**
 * Individual Playlist API
 * GET /api/playlists/[id] - Get a single playlist
 * PUT /api/playlists/[id] - Update a playlist
 * DELETE /api/playlists/[id] - Delete a playlist
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getPlaylist,
  updatePlaylist,
  deletePlaylist,
} from '@/lib/server/playlist-storage';
import type {
  UpdatePlaylistRequest,
  PlaylistResponse,
  PlaylistErrorResponse,
} from '@/lib/types/playlist';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/playlists/[id]
 * Get a single playlist by ID
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const playlist = await getPlaylist(id);

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
    console.error('[Playlist API] GET error:', error);
    const errorResponse: PlaylistErrorResponse = {
      error: 'Failed to get playlist',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

/**
 * PUT /api/playlists/[id]
 * Update a playlist
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as UpdatePlaylistRequest;

    // Validation
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length === 0)) {
      const errorResponse: PlaylistErrorResponse = {
        error: 'Playlist name must be a non-empty string',
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    if (body.tracks !== undefined) {
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
    }

    const playlist = await updatePlaylist(id, body);

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
    console.error('[Playlist API] PUT error:', error);
    const errorResponse: PlaylistErrorResponse = {
      error: 'Failed to update playlist',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

/**
 * DELETE /api/playlists/[id]
 * Delete a playlist
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const deleted = await deletePlaylist(id);

    if (!deleted) {
      const errorResponse: PlaylistErrorResponse = {
        error: 'Playlist not found',
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('[Playlist API] DELETE error:', error);
    const errorResponse: PlaylistErrorResponse = {
      error: 'Failed to delete playlist',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
