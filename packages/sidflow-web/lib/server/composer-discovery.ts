/**
 * Composer Discovery - find composers with similar musical styles.
 */

import { connect, type Table } from 'vectordb';
import { loadConfig, parseSidFile } from '@sidflow/common';
import path from 'node:path';
import { pathExists } from '@sidflow/common';
import type { DatabaseRecord } from '@sidflow/common';

export interface ComposerSimilarity {
    composer: string;
    similarity_score: number;
    track_count: number;
    avg_e: number;
    avg_m: number;
    avg_c: number;
}

export interface ComposerDiscoveryOptions {
    composer: string;
    limit?: number;
}

interface ComposerProfile {
    composer: string;
    tracks: DatabaseRecord[];
    avg_e: number;
    avg_m: number;
    avg_c: number;
    track_count: number;
}

/**
 * Connects to the LanceDB database and returns the sidflow table.
 */
async function getTable(): Promise<Table | null> {
    try {
        const config = await loadConfig();
        const modelPath = config.train?.modelPath ?? path.join(process.cwd(), 'data', 'model');
        const dbPath = path.join(modelPath, 'lancedb');

        if (!(await pathExists(dbPath))) {
            console.warn('[composer-discovery] LanceDB not found at:', dbPath);
            return null;
        }

        const db = await connect(dbPath);
        const tableNames = await db.tableNames();

        if (!tableNames.includes('sidflow')) {
            console.warn('[composer-discovery] Table "sidflow" not found in database');
            return null;
        }

        return await db.openTable('sidflow');
    } catch (error) {
        console.error('[composer-discovery] Failed to connect to LanceDB:', error);
        return null;
    }
}

/**
 * Extract composer name from SID path.
 * Typical path: "Rob_Hubbard/Delta.sid" or "Martin_Galway/Parallax.sid"
 */
function extractComposerFromPath(sidPath: string): string | null {
    // Remove leading ./ or /
    const normalized = sidPath.replace(/^\.?\//, '');

    // Split by / and take first component (composer directory)
    const parts = normalized.split('/');
    if (parts.length < 2) {
        return null;
    }

    // Replace underscores with spaces
    return parts[0].replace(/_/g, ' ');
}

/**
 * Normalize composer name for comparison.
 * "Rob Hubbard" and "rob_hubbard" should match.
 */
function normalizeComposer(composer: string): string {
    return composer.toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

/**
 * Calculate Euclidean distance between two composer profiles in E/M/C space.
 */
function composerDistance(a: ComposerProfile, b: ComposerProfile): number {
    const dE = a.avg_e - b.avg_e;
    const dM = a.avg_m - b.avg_m;
    const dC = a.avg_c - b.avg_c;
    return Math.sqrt(dE * dE + dM * dM + dC * dC);
}

/**
 * Build composer profiles from database records.
 */
async function buildComposerProfiles(records: DatabaseRecord[]): Promise<Map<string, ComposerProfile>> {
    const composerMap = new Map<string, ComposerProfile>();

    // Load config for SID path
    const config = await loadConfig();
    const sidCollectionPath = config.sidPath ?? path.join(process.cwd(), 'workspace', 'hvsc');

    for (const record of records) {
        try {
            // Extract composer from path
            let composer = extractComposerFromPath(record.sid_path);

            // If path-based extraction fails, try parsing SID file
            if (!composer) {
                const fullPath = path.join(sidCollectionPath, record.sid_path);
                if (await pathExists(fullPath)) {
                    const sidData = await parseSidFile(fullPath);
                    composer = sidData.author;
                }
            }

            if (!composer || composer.trim().length === 0) {
                continue;
            }

            const normalizedComposer = normalizeComposer(composer);

            // Add to composer profile
            if (!composerMap.has(normalizedComposer)) {
                composerMap.set(normalizedComposer, {
                    composer,
                    tracks: [],
                    avg_e: 0,
                    avg_m: 0,
                    avg_c: 0,
                    track_count: 0,
                });
            }

            const profile = composerMap.get(normalizedComposer)!;
            profile.tracks.push(record);
        } catch (error) {
            // Skip tracks that fail to parse
            continue;
        }
    }

    // Calculate averages for each composer
    for (const profile of composerMap.values()) {
        const tracks = profile.tracks;
        if (tracks.length === 0) continue;

        profile.avg_e = tracks.reduce((sum, t) => sum + t.e, 0) / tracks.length;
        profile.avg_m = tracks.reduce((sum, t) => sum + t.m, 0) / tracks.length;
        profile.avg_c = tracks.reduce((sum, t) => sum + t.c, 0) / tracks.length;
        profile.track_count = tracks.length;
    }

    return composerMap;
}

/**
 * Find composers with similar musical styles.
 * 
 * Algorithm:
 * 1. Query all tracks from database
 * 2. Group tracks by composer
 * 3. Calculate average E/M/C for each composer
 * 4. Find composers with similar E/M/C profiles to the target composer
 * 
 * @param options - Discovery options (composer name, limit)
 * @returns Array of similar composers sorted by similarity
 */
export async function findSimilarComposers(
    options: ComposerDiscoveryOptions
): Promise<ComposerSimilarity[]> {
    const { composer, limit = 5 } = options;

    console.log('[composer-discovery] Finding similar composers to:', composer);

    // Connect to database
    const table = await getTable();
    if (!table) {
        console.warn('[composer-discovery] Database not available, returning empty results');
        return [];
    }

    try {
        // Query all tracks (or a large sample)
        const results = await table
            .search()
            .limit(1000) // Sample up to 1000 tracks
            .execute();

        console.log('[composer-discovery] Queried', results.length, 'tracks from database');

        const records = results.map((r) => r as DatabaseRecord);

        // Build composer profiles
        const composerProfiles = await buildComposerProfiles(records);

        console.log('[composer-discovery] Built profiles for', composerProfiles.size, 'composers');

        // Find the target composer
        const normalizedTarget = normalizeComposer(composer);
        const targetProfile = composerProfiles.get(normalizedTarget);

        if (!targetProfile) {
            console.warn('[composer-discovery] Target composer not found:', composer);
            return [];
        }

        // Calculate similarity to all other composers
        const similarities: ComposerSimilarity[] = [];

        for (const [normalizedName, profile] of composerProfiles.entries()) {
            // Skip the target composer itself
            if (normalizedName === normalizedTarget) {
                continue;
            }

            // Skip composers with very few tracks (< 3)
            if (profile.track_count < 3) {
                continue;
            }

            const distance = composerDistance(targetProfile, profile);

            // Convert distance to similarity score (0-1, higher is more similar)
            // Max reasonable distance in 5-point scale E/M/C space is ~8.66
            const similarity_score = Math.max(0, 1 - distance / 8.66);

            similarities.push({
                composer: profile.composer,
                similarity_score,
                track_count: profile.track_count,
                avg_e: profile.avg_e,
                avg_m: profile.avg_m,
                avg_c: profile.avg_c,
            });
        }

        // Sort by similarity score and limit
        similarities.sort((a, b) => b.similarity_score - a.similarity_score);
        const topSimilar = similarities.slice(0, limit);

        console.log('[composer-discovery] Found', topSimilar.length, 'similar composers');

        return topSimilar;
    } catch (error) {
        console.error('[composer-discovery] Failed to find similar composers:', error);
        return [];
    }
}
