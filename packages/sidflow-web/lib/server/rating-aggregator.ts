/**
 * Rating aggregator for calculating community and personal ratings.
 * Aggregates ratings from feedback JSONL files and explicit rating tags.
 * 
 * Implements in-memory caching with TTL to avoid re-reading feedback files on each request.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '@sidflow/common';
import type { FeedbackRecord } from '@sidflow/common';

/**
 * Cache entry for aggregated feedback data.
 */
interface CacheEntry {
  aggregates: Map<string, FeedbackAggregate>;
  timestamp: number;
}

/**
 * In-memory cache for aggregated feedback.
 * TTL: 5 minutes (300000ms)
 */
const CACHE_TTL = 5 * 60 * 1000;
let feedbackCache: CacheEntry | null = null;

export interface AggregateRating {
  sid_path: string;
  
  // Community ratings (aggregate from all users)
  community: {
    averageRating: number; // 1-5 scale
    totalRatings: number;
    likes: number;
    dislikes: number;
    skips: number;
    plays: number;
    
    // Dimension breakdown (E/M/C)
    dimensions: {
      energy: number;
      mood: number;
      complexity: number;
    };
  };
  
  // Trending score (recent popularity)
  trending: {
    score: number; // 0-1, higher = more trending
    recentPlays: number; // plays in last 7 days
    isTrending: boolean; // score > 0.7
  };
  
  // Personal rating (if user has rated)
  personal?: {
    rating: number;
    timestamp: string;
  };
}

interface FeedbackAggregate {
  likes: number;
  dislikes: number;
  skips: number;
  plays: number;
  recentPlays: number;
  lastPlayed?: string;
}

/**
 * Reads all feedback JSONL files from a directory recursively.
 */
async function readFeedbackFiles(feedbackPath: string): Promise<FeedbackRecord[]> {
  const records: FeedbackRecord[] = [];
  
  if (!existsSync(feedbackPath)) {
    return records;
  }

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const content = await readFile(fullPath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            records.push(JSON.parse(line) as FeedbackRecord);
          } catch (error) {
            // Skip invalid JSON lines
            console.warn(`[rating-aggregator] Skipping invalid JSON in ${fullPath}:`, error);
          }
        }
      }
    }
  }
  
  await walk(feedbackPath);
  return records;
}

/**
 * Aggregates feedback events by SID path.
 */
function aggregateFeedback(events: FeedbackRecord[]): Map<string, FeedbackAggregate> {
  const aggregates = new Map<string, FeedbackAggregate>();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  for (const event of events) {
    const existing = aggregates.get(event.sid_path) ?? {
      likes: 0,
      dislikes: 0,
      skips: 0,
      plays: 0,
      recentPlays: 0,
    };
    
    // Update counts based on action
    switch (event.action) {
      case 'like':
        existing.likes++;
        break;
      case 'dislike':
        existing.dislikes++;
        break;
      case 'skip':
        existing.skips++;
        break;
      case 'play':
        existing.plays++;
        // Count recent plays for trending
        if (event.ts >= sevenDaysAgo) {
          existing.recentPlays++;
        }
        break;
    }
    
    // Track most recent play timestamp
    if (event.action === 'play' || event.action === 'like') {
      if (!existing.lastPlayed || event.ts > existing.lastPlayed) {
        existing.lastPlayed = event.ts;
      }
    }
    
    aggregates.set(event.sid_path, existing);
  }
  
  return aggregates;
}

/**
 * Calculates average rating from feedback.
 * Like = 5, Skip = 3, Dislike = 1
 */
function calculateAverageRating(aggregate: FeedbackAggregate): { average: number; total: number } {
  const likeWeight = 5;
  const skipWeight = 3;
  const dislikeWeight = 1;
  
  const totalRatings = aggregate.likes + aggregate.skips + aggregate.dislikes;
  
  if (totalRatings === 0) {
    return { average: 3, total: 0 }; // Default neutral rating
  }
  
  const weightedSum =
    aggregate.likes * likeWeight +
    aggregate.skips * skipWeight +
    aggregate.dislikes * dislikeWeight;
  
  const average = weightedSum / totalRatings;
  
  return { average, total: totalRatings };
}

/**
 * Calculates trending score based on recent activity.
 */
function calculateTrendingScore(aggregate: FeedbackAggregate): { score: number; isTrending: boolean } {
  // Trending algorithm:
  // - Recent plays in last 7 days
  // - Weighted by likes vs dislikes
  // - Normalized to 0-1 scale
  
  const recentPlays = aggregate.recentPlays;
  const likeRatio = aggregate.likes > 0 
    ? aggregate.likes / (aggregate.likes + aggregate.dislikes + 1)
    : 0.5;
  
  // Score increases with recent plays and positive feedback
  const score = Math.min(1.0, (recentPlays * likeRatio) / 20);
  
  const isTrending = score > 0.7;
  
  return { score, isTrending };
}

/**
 * Estimates dimension breakdown from feedback patterns.
 * This is a heuristic approximation since we don't have explicit dimension ratings.
 */
function estimateDimensions(aggregate: FeedbackAggregate): {
  energy: number;
  mood: number;
  complexity: number;
} {
  // For now, return neutral values
  // In a real implementation, we'd use the classification data
  return {
    energy: 3,
    mood: 3,
    complexity: 3,
  };
}

/**
 * Gets or refreshes the cached feedback aggregates.
 * Returns cached data if available and fresh, otherwise reads from disk.
 */
async function getCachedAggregates(): Promise<Map<string, FeedbackAggregate>> {
  const now = Date.now();
  
  // Check if cache is valid
  if (feedbackCache && (now - feedbackCache.timestamp) < CACHE_TTL) {
    return feedbackCache.aggregates;
  }
  
  // Cache miss or expired - read from disk
  const feedbackPath = path.join(process.cwd(), 'data', 'feedback');
  const feedbackEvents = await readFeedbackFiles(feedbackPath);
  const aggregates = aggregateFeedback(feedbackEvents);
  
  // Update cache
  feedbackCache = {
    aggregates,
    timestamp: now,
  };
  
  console.log('[rating-aggregator] Cache refreshed with', aggregates.size, 'tracks');
  
  return aggregates;
}

/**
 * Clears the feedback cache. Useful for testing or forcing a refresh.
 */
export function clearCache(): void {
  feedbackCache = null;
}

/**
 * Gets aggregate rating for a specific SID path.
 * Uses in-memory cache to avoid re-reading feedback files on each request.
 */
export async function getAggregateRating(sidPath: string): Promise<AggregateRating | null> {
  try {
    // Get aggregates from cache or disk
    const aggregates = await getCachedAggregates();
    
    const aggregate = aggregates.get(sidPath);
    if (!aggregate) {
      // No feedback for this track
      return {
        sid_path: sidPath,
        community: {
          averageRating: 3,
          totalRatings: 0,
          likes: 0,
          dislikes: 0,
          skips: 0,
          plays: 0,
          dimensions: {
            energy: 3,
            mood: 3,
            complexity: 3,
          },
        },
        trending: {
          score: 0,
          recentPlays: 0,
          isTrending: false,
        },
      };
    }
    
    const { average, total } = calculateAverageRating(aggregate);
    const trending = calculateTrendingScore(aggregate);
    const dimensions = estimateDimensions(aggregate);
    
    return {
      sid_path: sidPath,
      community: {
        averageRating: average,
        totalRatings: total,
        likes: aggregate.likes,
        dislikes: aggregate.dislikes,
        skips: aggregate.skips,
        plays: aggregate.plays,
        dimensions,
      },
      trending: {
        score: trending.score,
        recentPlays: aggregate.recentPlays,
        isTrending: trending.isTrending,
      },
    };
  } catch (error) {
    console.error('[rating-aggregator] Failed to calculate aggregate rating:', error);
    return null;
  }
}

/**
 * Gets aggregate ratings for multiple SID paths (batch operation).
 * Uses in-memory cache to avoid re-reading feedback files.
 */
export async function getAggregateRatings(sidPaths: string[]): Promise<Map<string, AggregateRating>> {
  const results = new Map<string, AggregateRating>();
  
  try {
    // Get aggregates from cache or disk
    const aggregates = await getCachedAggregates();
    
    for (const sidPath of sidPaths) {
      const aggregate = aggregates.get(sidPath);
      
      if (!aggregate) {
        results.set(sidPath, {
          sid_path: sidPath,
          community: {
            averageRating: 3,
            totalRatings: 0,
            likes: 0,
            dislikes: 0,
            skips: 0,
            plays: 0,
            dimensions: {
              energy: 3,
              mood: 3,
              complexity: 3,
            },
          },
          trending: {
            score: 0,
            recentPlays: 0,
            isTrending: false,
          },
        });
        continue;
      }
      
      const { average, total } = calculateAverageRating(aggregate);
      const trending = calculateTrendingScore(aggregate);
      const dimensions = estimateDimensions(aggregate);
      
      results.set(sidPath, {
        sid_path: sidPath,
        community: {
          averageRating: average,
          totalRatings: total,
          likes: aggregate.likes,
          dislikes: aggregate.dislikes,
          skips: aggregate.skips,
          plays: aggregate.plays,
          dimensions,
        },
        trending: {
          score: trending.score,
          recentPlays: aggregate.recentPlays,
          isTrending: trending.isTrending,
        },
      });
    }
  } catch (error) {
    console.error('[rating-aggregator] Failed to calculate aggregate ratings:', error);
  }
  
  return results;
}
