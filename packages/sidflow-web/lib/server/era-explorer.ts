/**
 * Era Explorer - find tracks from specific time periods.
 */

import { connect, type Table } from 'vectordb';
import { loadConfig, getOrParseMetadata } from '@sidflow/common';
import path from 'node:path';
import { pathExists } from '@sidflow/common';
import type { DatabaseRecord } from '@sidflow/common';

export interface EraTrack {
    sid_path: string;
    e: number;
    m: number;
    c: number;
    p?: number;
    likes: number;
    dislikes: number;
    skips: number;
    plays: number;
    quality_score: number;
}

export interface EraExplorerOptions {
    yearStart: number;
    yearEnd: number;
    limit?: number;
}

/**
 * Connects to the LanceDB database and returns the sidflow table.
 */
async function getTable(): Promise<Table | null> {
    try {
        const config = await loadConfig();
        // Model path is typically data/model relative to workspace root
        const modelPath = path.join(process.cwd(), 'data', 'model');
        const dbPath = path.join(modelPath, 'lancedb');

        if (!(await pathExists(dbPath))) {
            console.warn('[era-explorer] LanceDB not found at:', dbPath);
            return null;
        }

        const db = await connect(dbPath);
        const tableNames = await db.tableNames();

        if (!tableNames.includes('sidflow')) {
            console.warn('[era-explorer] Table "sidflow" not found in database');
            return null;
        }

        return await db.openTable('sidflow');
    } catch (error) {
        console.error('[era-explorer] Failed to connect to LanceDB:', error);
        return null;
    }
}

/**
 * Extract year from SID release field.
 * Handles formats like "1987", "1987 Thalamus", "1987-1990", etc.
 */
function extractYear(releaseField: string): number | null {
    if (!releaseField) return null;

    // Try to extract first 4-digit year
    const match = releaseField.match(/\b(19\d{2}|20\d{2})\b/);
    if (match) {
        return parseInt(match[1], 10);
    }

    return null;
}

/**
 * Calculate quality score for track selection.
 * Prefers tracks with positive feedback and good ratings.
 */
function calculateQualityScore(track: DatabaseRecord): number {
    let score = 0;

    // Base score from ratings (E/M/C average)
    const ratingAvg = (track.e + track.m + track.c) / 3;
    score += ratingAvg * 10; // 10-50 points

    // Boost from likes
    score += track.likes * 5;

    // Penalty from dislikes
    score -= track.dislikes * 3;

    // Small penalty for excessive skips
    score -= Math.min(track.skips, 5) * 0.5;

    // Slight boost for having been played (discovery)
    if (track.plays > 0) {
        score += Math.min(track.plays, 10) * 0.2;
    }

    return score;
}

/**
 * Find tracks from a specific era (year range).
 * 
 * Algorithm:
 * 1. Query all tracks from database (or a large sample)
 * 2. Parse SID metadata to extract year
 * 3. Filter tracks within year range
 * 4. Sort by quality score
 * 5. Return top N tracks
 * 
 * @param options - Era options (year range, limit)
 * @returns Array of tracks from the specified era
 */
export async function findTracksInEra(
    options: EraExplorerOptions
): Promise<EraTrack[]> {
    const { yearStart, yearEnd, limit = 20 } = options;

    console.log('[era-explorer] Finding tracks for era:', {
        yearStart,
        yearEnd,
        limit,
    });

    // Connect to database
    const table = await getTable();
    if (!table) {
        console.warn('[era-explorer] Database not available, returning empty results');
        return [];
    }

    try {
        // Query a large set of tracks with decent quality
        // Filter for tracks with e,m,c >= 2 to focus on quality content
        const emptyVector = new Array(4).fill(0); // E/M/C/P dimensions
        const results = await table
            .search(emptyVector)
            .filter('e >= 2 AND m >= 2 AND c >= 2')
            .limit(500) // Sample up to 500 tracks
            .execute();

        console.log('[era-explorer] Queried', results.length, 'candidate tracks from database');

        // Load config for SID path
        const config = await loadConfig();
        const sidCollectionPath = config.sidPath ?? path.join(process.cwd(), 'workspace', 'hvsc');

        // Filter by year
        const eraTracks: EraTrack[] = [];
        let checked = 0;
        let yearParsed = 0;

        for (const result of results) {
            const record = result as DatabaseRecord;
            checked++;

            try {
                // Construct full path
                const fullPath = path.join(sidCollectionPath, record.sid_path);

                if (!(await pathExists(fullPath))) {
                    continue;
                }

                // Parse SID metadata
                const sidData = await getOrParseMetadata(fullPath);
                const year = extractYear(sidData.released);

                if (year !== null) {
                    yearParsed++;

                    if (year >= yearStart && year <= yearEnd) {
                        const qualityScore = calculateQualityScore(record);

                        eraTracks.push({
                            sid_path: fullPath,
                            e: record.e,
                            m: record.m,
                            c: record.c,
                            p: record.p,
                            likes: record.likes ?? 0,
                            dislikes: record.dislikes ?? 0,
                            skips: record.skips ?? 0,
                            plays: record.plays ?? 0,
                            quality_score: qualityScore,
                        });
                    }
                }
            } catch (error) {
                // Skip tracks that fail to parse
                continue;
            }

            // Early exit if we have enough candidates
            if (eraTracks.length >= limit * 3) {
                break;
            }
        }

        console.log('[era-explorer] Checked', checked, 'tracks, parsed', yearParsed, 'years, found', eraTracks.length, 'in era');

        // Sort by quality score and limit
        eraTracks.sort((a, b) => b.quality_score - a.quality_score);
        const topTracks = eraTracks.slice(0, limit);

        console.log('[era-explorer] Returning', topTracks.length, 'top tracks from era');

        return topTracks;
    } catch (error) {
        console.error('[era-explorer] Failed to find era tracks:', error);
        return [];
    }
}
