/**
 * Chip Model Stations - find tracks from specific SID chip models.
 */

import { connect, type Table } from 'vectordb';
import { loadConfig, parseSidFile } from '@sidflow/common';
import path from 'node:path';
import { pathExists } from '@sidflow/common';
import type { DatabaseRecord } from '@sidflow/common';

export interface ChipTrack {
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

export interface ChipModelStationsOptions {
    chipModel: '6581' | '8580' | '8580r5';
    limit?: number;
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
            console.warn('[chip-model-stations] LanceDB not found at:', dbPath);
            return null;
        }

        const db = await connect(dbPath);
        const tableNames = await db.tableNames();

        if (!tableNames.includes('sidflow')) {
            console.warn('[chip-model-stations] Table "sidflow" not found in database');
            return null;
        }

        return await db.openTable('sidflow');
    } catch (error) {
        console.error('[chip-model-stations] Failed to connect to LanceDB:', error);
        return null;
    }
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
 * Normalize chip model name for comparison.
 * Handles variations like "6581", "MOS6581", "6581R4", etc.
 */
function normalizeChipModel(sidModel: string): string {
    const normalized = sidModel.toUpperCase().replace(/[^0-9A-Z]/g, '');

    if (normalized.includes('6581')) return '6581';
    if (normalized.includes('8580R5')) return '8580r5';
    if (normalized.includes('8580')) return '8580';

    return normalized;
}

/**
 * Find tracks from a specific chip model.
 * 
 * Algorithm:
 * 1. Query all tracks from database (or a large sample)
 * 2. Parse SID metadata to extract chip model
 * 3. Filter tracks by chip model
 * 4. Sort by quality score
 * 5. Return top N tracks
 * 
 * @param options - Chip model options (model type, limit)
 * @returns Array of tracks from the specified chip model
 */
export async function findTracksWithChipModel(
    options: ChipModelStationsOptions
): Promise<ChipTrack[]> {
    const { chipModel, limit = 20 } = options;

    console.log('[chip-model-stations] Finding tracks for chip model:', {
        chipModel,
        limit,
    });

    // Connect to database
    const table = await getTable();
    if (!table) {
        console.warn('[chip-model-stations] Database not available, returning empty results');
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

        console.log('[chip-model-stations] Queried', results.length, 'candidate tracks from database');

        // Load config for SID path
        const config = await loadConfig();
        const sidCollectionPath = config.sidPath ?? path.join(process.cwd(), 'workspace', 'hvsc');

        // Filter by chip model
        const chipTracks: ChipTrack[] = [];
        let checked = 0;
        let chipParsed = 0;

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
                const sidData = await parseSidFile(fullPath);
                const normalizedModel = normalizeChipModel(sidData.sidModel);

                if (normalizedModel) {
                    chipParsed++;

                    if (normalizedModel === chipModel) {
                        const qualityScore = calculateQualityScore(record);

                        chipTracks.push({
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
            if (chipTracks.length >= limit * 3) {
                break;
            }
        }

        console.log('[chip-model-stations] Checked', checked, 'tracks, parsed', chipParsed, 'chip models, found', chipTracks.length, 'matching');

        // Sort by quality score and limit
        chipTracks.sort((a, b) => b.quality_score - a.quality_score);
        const topTracks = chipTracks.slice(0, limit);

        console.log('[chip-model-stations] Returning', topTracks.length, 'top tracks for', chipModel);

        return topTracks;
    } catch (error) {
        console.error('[chip-model-stations] Failed to find chip model tracks:', error);
        return [];
    }
}
