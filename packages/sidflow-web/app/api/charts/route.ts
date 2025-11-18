import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getRepoRoot } from '@/lib/server-env';

export const dynamic = 'force-dynamic';

interface FeedbackEvent {
  ts: string;
  sid_path: string;
  action: 'play' | 'skip' | 'like' | 'dislike';
}

interface ChartEntry {
  sidPath: string;
  playCount: number;
  displayName: string;
  artist: string;
}

// Cache for charts to avoid re-reading files on every request
let chartsCache: { [key: string]: { entries: ChartEntry[]; timestamp: number } } = {};
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Parse HVSC-style path to extract artist and title
 */
function parseSidPath(sidPath: string): { artist: string; title: string } {
  const parts = sidPath.split('/');
  const filename = parts[parts.length - 1];
  const title = filename.replace('.sid', '').replace(/_/g, ' ');

  let artist = 'Unknown';
  if (parts.length >= 2) {
    const artistPart = parts[parts.length - 2];
    artist = artistPart.replace(/_/g, ' ');
  }

  return { artist, title };
}

/**
 * Aggregate play counts from feedback JSONL files
 * Optimized to reduce stat() calls and skip unnecessary directories
 */
async function aggregatePlayCounts(timeRange: 'week' | 'month' | 'all'): Promise<Map<string, number>> {
  const repoRoot = getRepoRoot();
  const feedbackDir = path.join(repoRoot, 'data', 'feedback');

  const playCounts = new Map<string, number>();
  const now = new Date();
  const cutoffDate = new Date();

  // Calculate cutoff date based on time range
  if (timeRange === 'week') {
    cutoffDate.setDate(now.getDate() - 7);
  } else if (timeRange === 'month') {
    cutoffDate.setMonth(now.getMonth() - 1);
  } else {
    // all-time: use a very old date
    cutoffDate.setFullYear(2000);
  }

  try {
    // Read all feedback files - use withFileTypes for faster directory checks
    const years = await fs.readdir(feedbackDir, { withFileTypes: true });

    for (const year of years) {
      if (!year.isDirectory()) continue;

      const yearPath = path.join(feedbackDir, year.name);
      const months = await fs.readdir(yearPath, { withFileTypes: true });

      for (const month of months) {
        if (!month.isDirectory()) continue;

        const monthPath = path.join(yearPath, month.name);
        const days = await fs.readdir(monthPath, { withFileTypes: true });

        for (const day of days) {
          if (!day.isDirectory()) continue;

          const eventsFile = path.join(monthPath, day.name, 'events.jsonl');

          try {
            const content = await fs.readFile(eventsFile, 'utf-8');
            const lines = content.split('\n');

            for (const line of lines) {
              if (line.length === 0) continue;

              try {
                const event = JSON.parse(line) as FeedbackEvent;

                // Only count play events
                if (event.action !== 'play') continue;

                // Check if event is within time range
                const eventDate = new Date(event.ts);
                if (eventDate < cutoffDate) continue;

                // Increment play count
                const count = playCounts.get(event.sid_path) || 0;
                playCounts.set(event.sid_path, count + 1);
              } catch {
                // Skip malformed lines silently for performance
                continue;
              }
            }
          } catch {
            // Skip missing or unreadable files
            continue;
          }
        }
      }
    }
  } catch (err) {
    console.error('Error reading feedback directory:', err);
  }

  return playCounts;
}

/**
 * GET /api/charts?range=week&limit=20
 * Get top played tracks for the specified time range
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const range = (searchParams.get('range') || 'week') as 'week' | 'month' | 'all';
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);

    // Validate range
    if (!['week', 'month', 'all'].includes(range)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid request',
        details: 'Range must be one of: week, month, all',
      }, { status: 400 });
    }

    const cacheKey = `${range}-${limit}`;

    // Check cache first
    if (chartsCache[cacheKey] && Date.now() - chartsCache[cacheKey].timestamp < CACHE_TTL) {
      return NextResponse.json({
        success: true,
        data: {
          range,
          charts: chartsCache[cacheKey].entries,
        },
      }, {
        headers: {
          'Cache-Control': 'public, max-age=3600, s-maxage=7200', // 1hr client, 2hr CDN
        },
      });
    }

    // Aggregate play counts
    const playCounts = await aggregatePlayCounts(range);

    // Convert to sorted array
    const entries: ChartEntry[] = Array.from(playCounts.entries())
      .map(([sidPath, playCount]) => {
        const { artist, title } = parseSidPath(sidPath);
        return {
          sidPath,
          playCount,
          displayName: title,
          artist,
        };
      })
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, limit);

    // Update cache
    chartsCache[cacheKey] = {
      entries,
      timestamp: Date.now(),
    };

    return NextResponse.json({
      success: true,
      data: {
        range,
        charts: entries,
      },
    }, {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=7200', // 1hr client, 2hr CDN
      },
    });
  } catch (error) {
    console.error('Charts API error:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
