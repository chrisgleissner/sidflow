import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getRepoRoot } from '@/lib/server-env';

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

    if (!query || query.trim().length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Invalid request',
        details: 'Query parameter "q" is required',
      }, { status: 400 });
    }

    const normalizedQuery = query.trim().toLowerCase();

    // Read classified tracks
    const repoRoot = getRepoRoot();
    const classifiedPath = path.join(repoRoot, 'data', 'classified', 'sample.jsonl');
    
    let tracks: ClassifiedTrack[] = [];
    try {
      const content = await fs.readFile(classifiedPath, 'utf-8');
      const lines = content.trim().split('\n');
      tracks = lines.map(line => JSON.parse(line) as ClassifiedTrack);
    } catch (error) {
      // If no classified data, return empty results
      return NextResponse.json({
        success: true,
        data: {
          query,
          results: [],
          total: 0,
        },
      });
    }

    // Search through tracks
    const results: SearchResult[] = [];
    
    for (const track of tracks) {
      const { artist, title } = parseSidPath(track.sid_path);
      const sidPathLower = track.sid_path.toLowerCase();
      const artistLower = artist.toLowerCase();
      const titleLower = title.toLowerCase();
      
      const matchedIn: string[] = [];
      
      if (titleLower.includes(normalizedQuery)) {
        matchedIn.push('title');
      }
      if (artistLower.includes(normalizedQuery)) {
        matchedIn.push('artist');
      }
      if (sidPathLower.includes(normalizedQuery) && matchedIn.length === 0) {
        matchedIn.push('path');
      }
      
      if (matchedIn.length > 0) {
        results.push({
          sidPath: track.sid_path,
          displayName: title,
          artist,
          matchedIn,
        });
      }
      
      if (results.length >= limit) {
        break;
      }
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
