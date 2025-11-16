/**
 * Hidden Gems Finder - discover high-quality but underplayed tracks.
 */

import { connect, type Table } from 'vectordb';
import { loadConfig } from '@sidflow/common';
import path from 'node:path';
import { pathExists } from '@sidflow/common';
import type { DatabaseRecord } from '@sidflow/common';

export interface HiddenGemTrack {
    sid_path: string;
    e: number;
    m: number;
    c: number;
    p?: number;
    likes: number;
    dislikes: number;
    skips: number;
    plays: number;
    predicted_rating: number;
    gem_score: number;
}

export interface HiddenGemsOptions {
    limit?: number;
    minRating?: number; // Minimum predicted rating (1-5 scale)
}

/**
 * Connects to the LanceDB database and returns the sidflow table.
 */
async function getTable(): Promise<Table | null> {
    try {
        const config = await loadConfig();
        const modelPath = path.join(process.cwd(), 'data', 'model');
        const dbPath = path.join(modelPath, 'lancedb');

        if (!(await pathExists(dbPath))) {
            console.warn('[hidden-gems] LanceDB not found at:', dbPath);
            return null;
        }

        const db = await connect(dbPath);
        const tableNames = await db.tableNames();

        if (!tableNames.includes('sidflow')) {
            console.warn('[hidden-gems] Table "sidflow" not found in database');
            return null;
        }

        return await db.openTable('sidflow');
    } catch (error) {
        console.error('[hidden-gems] Failed to connect to LanceDB:', error);
        return null;
    }
}

/**
 * Calculate predicted rating from E/M/C dimensions.
 * Simple heuristic: average of E, M, C with slight weight toward M (mood).
 */
function predictRating(record: DatabaseRecord): number {
    // Weight: 30% energy, 40% mood, 30% complexity
    return (record.e * 0.3 + record.m * 0.4 + record.c * 0.3);
}

/**
 * Calculate gem score: high rating + low plays = high gem score.
 */
function calculateGemScore(record: DatabaseRecord, predictedRating: number, playPercentile: number): number {
    let score = 0;

    // Base score from predicted rating (0-5 -> 0-50 points)
    score += predictedRating * 10;

    // Bonus for being in low play percentile (0-1 -> 0-30 points)
    // Lower percentile = higher bonus
    score += (1 - playPercentile) * 30;

    // Small bonus for having some likes (proves quality)
    score += Math.min(record.likes, 5) * 2;

    // Penalty for dislikes (quality concerns)
    score -= record.dislikes * 5;

    // Penalty for excessive skips (listeners didn't enjoy)
    score -= Math.min(record.skips, 3) * 2;

    return Math.max(0, score);
}

/**
 * Find hidden gem tracks: high quality but underplayed.
 * 
 * Algorithm:
 * 1. Query all tracks from database
 * 2. Calculate predicted rating from E/M/C
 * 3. Filter for high ratings (>= minRating)
 * 4. Calculate play count percentile
 * 5. Find tracks with high rating + low play percentile
 * 6. Sort by "gem score" and return top N
 * 
 * @param options - Hidden gems options (limit, minRating)
 * @returns Array of hidden gem tracks sorted by gem score
 */
export async function findHiddenGems(
    options: HiddenGemsOptions
): Promise<HiddenGemTrack[]> {
    const { limit = 20, minRating = 4.0 } = options;

    console.log('[hidden-gems] Finding hidden gems:', {
        limit,
        minRating,
    });

    // Connect to database
    const table = await getTable();
    if (!table) {
        console.warn('[hidden-gems] Database not available, returning empty results');
        return [];
    }

    try {
        // Query a large set of tracks
        // Use empty vector search to get all tracks
        const emptyVector = new Array(4).fill(0); // E/M/C/P dimensions
        const results = await table
            .search(emptyVector)
            .limit(1000) // Sample up to 1000 tracks
            .execute();

        console.log('[hidden-gems] Queried', results.length, 'tracks from database');

        const records = results.map((r) => r as DatabaseRecord);

        // Calculate play count statistics
        const playCounts = records.map((r) => r.plays ?? 0);
        playCounts.sort((a, b) => a - b);

        const getPlayPercentile = (playCount: number): number => {
            const index = playCounts.findIndex((p) => p >= playCount);
            return index / playCounts.length;
        };

        // Find hidden gems
        const gems: HiddenGemTrack[] = [];

        for (const record of records) {
            const predictedRating = predictRating(record);

            // Filter: must have high predicted rating
            if (predictedRating < minRating) {
                continue;
            }

            const playPercentile = getPlayPercentile(record.plays ?? 0);

            // Filter: must be underplayed (below 20th percentile)
            if (playPercentile > 0.2) {
                continue;
            }

            const gemScore = calculateGemScore(record, predictedRating, playPercentile);

            gems.push({
                sid_path: record.sid_path,
                e: record.e,
                m: record.m,
                c: record.c,
                p: record.p,
                likes: record.likes ?? 0,
                dislikes: record.dislikes ?? 0,
                skips: record.skips ?? 0,
                plays: record.plays ?? 0,
                predicted_rating: predictedRating,
                gem_score: gemScore,
            });
        }

        // Sort by gem score and limit
        gems.sort((a, b) => b.gem_score - a.gem_score);
        const topGems = gems.slice(0, limit);

        console.log('[hidden-gems] Found', topGems.length, 'hidden gems');

        return topGems;
    } catch (error) {
        console.error('[hidden-gems] Failed to find hidden gems:', error);
        return [];
    }
}
