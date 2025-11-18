/**
 * Mood transition logic for finding tracks that smoothly bridge two mood states.
 */

import { connect, type Table } from 'vectordb';
import { loadConfig } from '@sidflow/common';
import path from 'node:path';
import { pathExists } from '@sidflow/common';
import type { DatabaseRecord } from '@sidflow/common';
import { moodTransitionCache, tableCache, getCachedDbConnection, createCacheKey } from './cache';

export interface MoodVector {
    e: number; // Energy (1-5)
    m: number; // Mood (1-5)
    c: number; // Complexity (1-5)
}

export interface TransitionTrack {
    sid_path: string;
    e: number;
    m: number;
    c: number;
    p?: number;
    likes: number;
    dislikes: number;
    skips: number;
    plays: number;
    distance_from_target: number;
}

export interface MoodTransitionOptions {
    startMood: MoodVector;
    endMood: MoodVector;
    steps?: number; // Number of tracks in the transition (default: 7)
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
            console.warn('[mood-transition] LanceDB not found at:', dbPath);
            return null;
        }

        const db = await getCachedDbConnection(dbPath);
        const tableNames = await db.tableNames();

        if (!tableNames.includes('sidflow')) {
            console.warn('[mood-transition] Table "sidflow" not found in database');
            return null;
        }

        const table = await db.openTable('sidflow');

        // Cache the table connection
        tableCache.set(cacheKey, table);

        return table;
    } catch (error) {
        console.error('[mood-transition] Failed to connect to LanceDB:', error);
        return null;
    }
}

/**
 * Calculate Euclidean distance between two mood vectors in E/M/C space.
 */
function moodDistance(a: MoodVector, b: MoodVector): number {
    const dE = a.e - b.e;
    const dM = a.m - b.m;
    const dC = a.c - b.c;
    return Math.sqrt(dE * dE + dM * dM + dC * dC);
}

/**
 * Linearly interpolate between two mood vectors.
 */
function interpolateMood(start: MoodVector, end: MoodVector, t: number): MoodVector {
    return {
        e: start.e + (end.e - start.e) * t,
        m: start.m + (end.m - start.m) * t,
        c: start.c + (end.c - start.c) * t,
    };
}

/**
 * Find tracks near a target mood in the database.
 */
async function findTracksNearMood(
    table: Table,
    targetMood: MoodVector,
    limit: number
): Promise<TransitionTrack[]> {
    try {
        // Query tracks within a reasonable range of the target mood
        // Use a box filter to narrow search space before distance calculation
        const tolerance = 1.0; // Search within ±1.0 on each dimension
        const minE = Math.max(1, targetMood.e - tolerance);
        const maxE = Math.min(5, targetMood.e + tolerance);
        const minM = Math.max(1, targetMood.m - tolerance);
        const maxM = Math.min(5, targetMood.m + tolerance);
        const minC = Math.max(1, targetMood.c - tolerance);
        const maxC = Math.min(5, targetMood.c + tolerance);

        const filter = `e >= ${minE} AND e <= ${maxE} AND m >= ${minM} AND m <= ${maxM} AND c >= ${minC} AND c <= ${maxC}`;

        // Perform vector search with target mood vector
        const targetVector = [targetMood.e, targetMood.m, targetMood.c, 0]; // E/M/C/P dimensions
        const results = await table.search(targetVector).filter(filter).limit(limit * 5).execute();

        // Calculate distance from target and sort
        const tracks: TransitionTrack[] = results.map((record) => {
            const dbRecord = record as DatabaseRecord;
            const distance = moodDistance(
                { e: dbRecord.e, m: dbRecord.m, c: dbRecord.c },
                targetMood
            );

            return {
                sid_path: dbRecord.sid_path,
                e: dbRecord.e,
                m: dbRecord.m,
                c: dbRecord.c,
                p: dbRecord.p,
                likes: dbRecord.likes ?? 0,
                dislikes: dbRecord.dislikes ?? 0,
                skips: dbRecord.skips ?? 0,
                plays: dbRecord.plays ?? 0,
                distance_from_target: distance,
            };
        });

        // Sort by distance (closest first) and apply quality boost
        tracks.sort((a, b) => {
            // Prefer tracks with positive feedback
            const scoreA = 1 / (a.distance_from_target + 0.1) + a.likes * 0.1 - a.dislikes * 0.05;
            const scoreB = 1 / (b.distance_from_target + 0.1) + b.likes * 0.1 - b.dislikes * 0.05;
            return scoreB - scoreA;
        });

        return tracks.slice(0, limit);
    } catch (error) {
        console.error('[mood-transition] Failed to find tracks near mood:', error);
        return [];
    }
}

/**
 * Find tracks that form a smooth transition between two moods.
 * 
 * Algorithm:
 * 1. Divide the mood space between start and end into N steps
 * 2. For each step, find the best track closest to that intermediate mood
 * 3. Ensure smooth progression with no large jumps between consecutive tracks
 * 
 * @param options - Transition options (start/end mood, number of steps)
 * @returns Array of tracks forming a smooth transition path
 */
export async function findMoodTransitionTracks(
    options: MoodTransitionOptions
): Promise<TransitionTrack[]> {
    const { startMood, endMood, steps = 7 } = options;

    // Check cache first
    const cacheKey = createCacheKey('mood-transition', startMood, endMood, steps);
    const cached = moodTransitionCache.get(cacheKey);
    if (cached) {
        console.log('[mood-transition] Cache hit');
        return cached;
    }

    console.log('[mood-transition] Creating transition:', {
        startMood,
        endMood,
        steps,
    });

    // Connect to database
    const table = await getTable();
    if (!table) {
        console.warn('[mood-transition] Database not available, returning empty results');
        return [];
    }

    // Generate intermediate mood targets
    const transitionSteps: MoodVector[] = [];
    for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1); // Normalize to 0..1
        transitionSteps.push(interpolateMood(startMood, endMood, t));
    }

    console.log('[mood-transition] Transition steps:', transitionSteps);

    // Find best track for each step
    const transitionTracks: TransitionTrack[] = [];
    const usedTracks = new Set<string>(); // Avoid duplicates

    for (let i = 0; i < transitionSteps.length; i++) {
        const targetMood = transitionSteps[i];
        const candidates = await findTracksNearMood(table, targetMood, 20);

        // Find best unused candidate
        let bestTrack: TransitionTrack | null = null;
        let bestScore = -Infinity;

        for (const candidate of candidates) {
            if (usedTracks.has(candidate.sid_path)) {
                continue;
            }

            // Score based on:
            // 1. Distance from target mood
            // 2. Smoothness (distance from previous track)
            // 3. User feedback
            let score = 1 / (candidate.distance_from_target + 0.1);

            // Penalize large jumps from previous track
            if (transitionTracks.length > 0) {
                const prevTrack = transitionTracks[transitionTracks.length - 1];
                const jumpDistance = moodDistance(
                    { e: candidate.e, m: candidate.m, c: candidate.c },
                    { e: prevTrack.e, m: prevTrack.m, c: prevTrack.c }
                );
                score -= jumpDistance * 0.5; // Penalize large jumps
            }

            // Boost with user feedback
            score += candidate.likes * 0.1;
            score -= candidate.dislikes * 0.05;

            if (score > bestScore) {
                bestScore = score;
                bestTrack = candidate;
            }
        }

        if (bestTrack) {
            transitionTracks.push(bestTrack);
            usedTracks.add(bestTrack.sid_path);
        } else {
            console.warn('[mood-transition] No suitable track found for step', i, targetMood);
        }
    }

    console.log('[mood-transition] Transition created:', {
        tracksFound: transitionTracks.length,
        path: transitionTracks.map((t) => ({ e: t.e, m: t.m, c: t.c })),
    });

    // Cache the result
    moodTransitionCache.set(cacheKey, transitionTracks);

    return transitionTracks;
}
