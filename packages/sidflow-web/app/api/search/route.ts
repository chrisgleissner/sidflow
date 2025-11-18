import { NextRequest, NextResponse } from 'next/server';
import { getSearchIndex } from '@/lib/server/search-index';

const enableSearchLogs = process.env.SIDFLOW_LOG_SEARCH === '1';

export const dynamic = 'force-dynamic';

interface ClassifiedTrack {
  sid_path: string;
  ratings?: {
    e?: number;
    m?: number;
    c?: number;
    p?: number;
  };
  features?: Record<string, number>;
}

interface SearchResult {
  sidPath: string;
  displayName: string;
  artist: string;
  matchedIn: string[];
}

/**
 * Parse HVSC-style path to extract artist and title
 * Example: "MUSICIANS/Hubbard_Rob/Delta.sid" → { artist: "Rob Hubbard", title: "Delta" }
 */
function parseSidPath(sidPath: string): { artist: string; title: string } {
  const parts = sidPath.split('/');
  const filename = parts[parts.length - 1];
  const title = filename.replace('.sid', '').replace(/_/g, ' ');
  
  // Extract artist from path
  let artist = 'Unknown';
  if (parts.length >= 2) {
    const artistPart = parts[parts.length - 2];
    // Handle formats like "Hubbard_Rob" or "Rob_Hubbard"
    artist = artistPart.replace(/_/g, ' ');
  }
  
  return { artist, title };
}

/**
 * GET /api/search?q=query&limit=20
 * Search for SID tracks by title or artist
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const logPrefix = `[search-api] q=${JSON.stringify(query)} limit=${limit}`;

    if (!query || query.trim().length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Invalid request',
        details: 'Query parameter "q" is required',
      }, { status: 400 });
    }

    const normalizedQuery = query.trim().toLowerCase();
    const startedAt = Date.now();
    if (enableSearchLogs) {
      console.info(`${logPrefix} — start`);
    }

    // Query cached search index
    const searchIndex = getSearchIndex();
    const matchedRecords = await searchIndex.query(normalizedQuery, { limit });
    const results: SearchResult[] = matchedRecords.map((record) => {
      const { artist, title } = parseSidPath(record.sidPath);
      const matchedIn: string[] = [];
      if (title.toLowerCase().includes(normalizedQuery)) {
        matchedIn.push('title');
      }
      if (artist.toLowerCase().includes(normalizedQuery)) {
        matchedIn.push('artist');
      }
      if (matchedIn.length === 0) {
        matchedIn.push('path');
      }
      return {
        sidPath: record.sidPath,
        displayName: title,
        artist,
        matchedIn,
      };
    });

    if (enableSearchLogs) {
      console.info(`${logPrefix} — results=${results.length} duration=${Date.now() - startedAt}ms`);
    }

    return NextResponse.json({
      success: true,
      data: {
        query,
        results,
        total: results.length,
        limit,
      },
    });
  } catch (error) {
    if (enableSearchLogs) {
      console.error('[search-api] failed', error);
    }
    return NextResponse.json(
      {
        success: false,
        error: 'Search failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
