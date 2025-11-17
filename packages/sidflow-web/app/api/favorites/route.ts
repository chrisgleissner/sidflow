import { NextRequest, NextResponse } from 'next/server';
import { getWebPreferences, updateWebPreferences } from '@/lib/preferences-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/favorites
 * Returns the list of favorite SID paths
 */
export async function GET() {
  try {
    const prefs = await getWebPreferences();
    const favorites = prefs.favorites || [];
    
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

    const prefs = await getWebPreferences();
    const currentFavorites = prefs.favorites || [];
    
    // Add if not already present
    if (!currentFavorites.includes(sid_path)) {
      const updatedFavorites = [...currentFavorites, sid_path];
      await updateWebPreferences({ favorites: updatedFavorites });
      
      return NextResponse.json({
        success: true,
        data: { 
          favorites: updatedFavorites,
          added: true,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: { 
        favorites: currentFavorites,
        added: false,
        message: 'Already in favorites',
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

    const prefs = await getWebPreferences();
    const currentFavorites = prefs.favorites || [];
    const updatedFavorites = currentFavorites.filter(path => path !== sid_path);
    
    await updateWebPreferences({ favorites: updatedFavorites });
    
    return NextResponse.json({
      success: true,
      data: { 
        favorites: updatedFavorites,
        removed: currentFavorites.length > updatedFavorites.length,
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
