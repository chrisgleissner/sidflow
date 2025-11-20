import { NextRequest, NextResponse } from 'next/server';
import { getCachedFavorites, addFavorite, removeFavorite } from '@/lib/server/favorites-cache';

const enableFavoritesLogs = process.env.SIDFLOW_LOG_FAVORITES === '1';

function log(message: string, meta?: Record<string, unknown>) {
  if (!enableFavoritesLogs) {
    return;
  }
  const serializedMeta = meta ? ` ${JSON.stringify(meta)}` : '';
  console.info(`[favorites-api] ${message}${serializedMeta}`);
}

export const dynamic = 'force-dynamic';

/**
 * GET /api/favorites
 * Returns the list of favorite SID paths
 */
export async function GET() {
  try {
    const startedAt = Date.now();
    log('GET start');
    const favorites = await getCachedFavorites();
    log('GET success', { durationMs: Date.now() - startedAt, count: favorites.length });
    return NextResponse.json({
      success: true,
      data: { favorites },
    });
  } catch (error) {
    log('GET failure', { error: error instanceof Error ? error.message : String(error) });
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

    const startedAt = Date.now();
    log('POST start', { sid_path });
    const result = await addFavorite(sid_path);
    log('POST success', { durationMs: Date.now() - startedAt, added: result.added });
    return NextResponse.json({
      success: true,
      data: {
        favorites: result.favorites,
        added: result.added,
        message: result.added ? undefined : 'Already in favorites',
      },
    });
  } catch (error) {
    log('POST failure', { error: error instanceof Error ? error.message : String(error) });
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

    const startedAt = Date.now();
    log('DELETE start', { sid_path });
    const result = await removeFavorite(sid_path);
    log('DELETE success', { durationMs: Date.now() - startedAt, removed: result.removed });
    return NextResponse.json({
      success: true,
      data: {
        favorites: result.favorites,
        removed: result.removed,
      },
    });
  } catch (error) {
    log('DELETE failure', { error: error instanceof Error ? error.message : String(error) });
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
