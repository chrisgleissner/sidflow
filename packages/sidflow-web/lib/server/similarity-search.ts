/**
 * Similarity search using LanceDB for finding similar SID tracks.
 */

import { connect, type Table } from 'vectordb';
import { loadConfig } from '@sidflow/common';
import path from 'node:path';
import { pathExists } from '@sidflow/common';
import type { DatabaseRecord } from '@sidflow/common';
import { similarityCache, tableCache, getCachedDbConnection, createCacheKey } from './cache';

export interface SimilarTrack {
  sid_path: string;
  e: number;
  m: number;
  c: number;
  p?: number;
  likes: number;
  dislikes: number;
  skips: number;
  plays: number;
  last_played?: string;
  similarity_score: number;
}

export interface SimilaritySearchOptions {
  /** Target track SID path to find similar tracks for */
  seedSidPath: string;
  /** Number of similar tracks to return (default: 20) */
  limit?: number;
  /** Minimum similarity score threshold (0-1, default: 0.5) */
  minSimilarity?: number;
  /** Boost factor for tracks the user has liked (default: 1.5) */
  likeBoost?: number;
  /** Penalty factor for tracks the user has disliked (default: 0.5) */
  dislikeBoost?: number;
}

/**
 * Connects to the LanceDB database and returns the sidflow table.
 * Uses caching to avoid repeated connections.
 */
async function getTable(): Promise<Table | null> {
  const cacheKey = 'sidflow-table';

  // Check cache first
  const cachedTable = tableCache.get(cacheKey);
  if (cachedTable) {
    return cachedTable;
  }

  try {
    const config = await loadConfig();
    // Model path is typically data/model relative to workspace root
    const modelPath = path.join(process.cwd(), 'data', 'model');
    const dbPath = path.join(modelPath, 'lancedb');

    if (!(await pathExists(dbPath))) {
      console.warn('[similarity-search] LanceDB not found at:', dbPath);
      return null;
    }

    const db = await getCachedDbConnection(dbPath);
    const tableNames = await db.tableNames();

    if (!tableNames.includes('sidflow')) {
      console.warn('[similarity-search] Table "sidflow" not found in database');
      return null;
    }

    const table = await db.openTable('sidflow');

    // Cache the table connection
    tableCache.set(cacheKey, table);

    return table;
  } catch (error) {
    console.error('[similarity-search] Failed to connect to LanceDB:', error);
    return null;
  }
}

/**
 * Finds the seed track in the database.
 */
async function findSeedTrack(table: Table, seedSidPath: string): Promise<DatabaseRecord | null> {
  try {
    // Query for the exact seed track using empty vector (we're filtering by path)
    const emptyVector = new Array(4).fill(0); // E/M/C/P dimensions
    const results = await table
      .search(emptyVector)
      .filter(`sid_path = '${seedSidPath.replace(/'/g, "''")}'`)
      .limit(1)
      .execute();

    if (results.length === 0) {
      return null;
    }

    return results[0] as DatabaseRecord;
  } catch (error) {
    console.error('[similarity-search] Failed to find seed track:', error);
    return null;
  }
}

/**
 * Performs vector similarity search to find tracks similar to the seed.
 */
async function performVectorSearch(
  table: Table,
  vector: number[],
  limit: number,
  seedSidPath: string
): Promise<SimilarTrack[]> {
  try {
    // Perform vector similarity search
    // Fetch more than requested to account for filtering (2x is sufficient)
    const results = await table
      .search(vector)
      .limit(limit * 2)
      .execute();

    // Filter out the seed track and convert to SimilarTrack format
    const similarTracks: SimilarTrack[] = [];

    for (const result of results) {
      const record = result as DatabaseRecord & { _distance?: number };

      // Skip the seed track itself
      if (record.sid_path === seedSidPath) {
        continue;
      }

      // LanceDB returns distance (lower is more similar)
      // Convert to similarity score (0-1, higher is more similar)
      const distance = record._distance ?? 0;
      const similarity_score = Math.max(0, 1 - distance / 10); // Normalize distance

      similarTracks.push({
        sid_path: record.sid_path,
        e: record.e,
        m: record.m,
        c: record.c,
        p: record.p,
        likes: record.likes ?? 0,
        dislikes: record.dislikes ?? 0,
        skips: record.skips ?? 0,
        plays: record.plays ?? 0,
        last_played: record.last_played,
        similarity_score,
      });

      if (similarTracks.length >= limit) {
        break;
      }
    }

    return similarTracks;
  } catch (error) {
    console.error('[similarity-search] Vector search failed:', error);
    return [];
  }
}

/**
 * Applies personalization boost based on user feedback.
 */
function applyPersonalizationBoost(
  tracks: SimilarTrack[],
  likeBoost: number,
  dislikeBoost: number
): SimilarTrack[] {
  return tracks.map((track) => {
    let boost = 1.0;

    // Boost tracks with positive feedback
    if (track.likes > 0) {
      boost *= Math.pow(likeBoost, Math.min(track.likes, 5));
    }

    // Penalize tracks with negative feedback
    if (track.dislikes > 0) {
      boost *= Math.pow(dislikeBoost, Math.min(track.dislikes, 5));
    }

    // Slight penalty for skipped tracks
    if (track.skips > 0) {
      boost *= Math.pow(0.9, Math.min(track.skips, 3));
    }

    return {
      ...track,
      similarity_score: track.similarity_score * boost,
    };
  });
}

/**
 * Finds tracks similar to a seed track using vector similarity search.
 * 
 * @param options - Search options including seed track and parameters
 * @returns Array of similar tracks sorted by similarity score
 */
export async function findSimilarTracks(
  options: SimilaritySearchOptions
): Promise<SimilarTrack[]> {
  const {
    seedSidPath,
    limit = 20,
    minSimilarity = 0.5,
    likeBoost = 1.5,
    dislikeBoost = 0.5,
  } = options;

  // Check cache first
  const cacheKey = createCacheKey('similarity', seedSidPath, limit, minSimilarity, likeBoost, dislikeBoost);
  const cached = similarityCache.get(cacheKey);
  if (cached) {
    console.log('[similarity-search] Cache hit for:', seedSidPath);
    return cached;
  }

  console.log('[similarity-search] Finding similar tracks for:', {
    seedSidPath,
    limit,
    minSimilarity,
  });

  // Connect to database
  const table = await getTable();
  if (!table) {
    console.warn('[similarity-search] Database not available, returning empty results');
    return [];
  }

  // Find the seed track
  const seedTrack = await findSeedTrack(table, seedSidPath);
  if (!seedTrack) {
    console.warn('[similarity-search] Seed track not found in database:', seedSidPath);
    return [];
  }

  // Perform vector similarity search
  const similarTracks = await performVectorSearch(
    table,
    seedTrack.vector,
    limit,
    seedSidPath
  );

  // Apply personalization boost
  const boosted = applyPersonalizationBoost(similarTracks, likeBoost, dislikeBoost);

  // Filter by minimum similarity and sort
  const filtered = boosted
    .filter((track) => track.similarity_score >= minSimilarity)
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, limit);

  console.log('[similarity-search] Found similar tracks:', {
    count: filtered.length,
    topScore: filtered[0]?.similarity_score,
  });

  // Cache the result
  similarityCache.set(cacheKey, filtered);

  return filtered;
}
