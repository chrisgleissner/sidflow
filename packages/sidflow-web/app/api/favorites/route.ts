import { NextRequest, NextResponse } from 'next/server';
import { getCachedFavorites, addFavorite, removeFavorite } from '@/lib/server/favorites-cache';

export const dynamic = 'force-dynamic';

/**
 * GET /api/favorites
 * Returns the list of favorite SID paths
 */
export async function GET() {
  try {
    const favorites = await getCachedFavorites();
    
    return NextResponse.json({
      success: true,
      data: { favorites },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load favorites',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/favorites
 * Adds a SID path to favorites (if not already present)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sid_path } = body;

    if (!sid_path || typeof sid_path !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request',
          details: 'sid_path is required and must be a string',
        },
        { status: 400 }
      );
    }

    const result = await addFavorite(sid_path);

    return NextResponse.json({
      success: true,
      data: {
        favorites: result.favorites,
        added: result.added,
        message: result.added ? undefined : 'Already in favorites',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to add favorite',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/favorites
 * Removes a SID path from favorites
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { sid_path } = body;

    if (!sid_path || typeof sid_path !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request',
          details: 'sid_path is required and must be a string',
        },
        { status: 400 }
      );
    }

    const result = await removeFavorite(sid_path);

    return NextResponse.json({
      success: true,
      data: {
        favorites: result.favorites,
        removed: result.removed,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to remove favorite',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
