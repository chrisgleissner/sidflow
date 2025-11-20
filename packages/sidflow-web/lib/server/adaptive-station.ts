import { pathExists } from '@sidflow/common';
import { lookupSongLength } from '@/lib/songlengths';
import { createRateTrackInfo, resolvePlaybackEnvironment } from '@/lib/rate-playback';
import { findSimilarTracks } from '@/lib/server/similarity-search';
import type { RateTrackInfo } from '@/lib/types/rate-track';

export interface SessionAction {
    sid_path: string;
    action: 'skip' | 'like' | 'dislike' | 'play_full';
    timestamp: number;
}

export interface AdaptiveStationOptions {
    seedSidPath: string;
    sessionActions: SessionAction[];
    limit?: number;
}

export interface AdaptiveStationResult {
    tracks: RateTrackInfo[];
    stationName: string;
    adaptationSummary: {
        totalActions: number;
        skips: number;
        likes: number;
        dislikes: number;
        fullPlays: number;
        adjustedSimilarity: number;
        adjustedDiscovery: number;
    };
}

/**
 * Calculate adaptive similarity threshold based on session actions.
 */
function calculateAdaptiveSimilarity(actions: SessionAction[]): number {
    const likes = actions.filter((a) => a.action === 'like').length;
    const skips = actions.filter((a) => a.action === 'skip').length;
    const dislikes = actions.filter((a) => a.action === 'dislike').length;

    // Start with default similarity of 0.7
    let similarity = 0.7;

    // Many skips = user wants more similar tracks (less discovery)
    if (skips > 2) {
        similarity += Math.min(0.2, skips * 0.05);
    }

    // Many dislikes = tighten similarity
    if (dislikes > 1) {
        similarity += Math.min(0.15, dislikes * 0.07);
    }

    // Many likes = user is satisfied, can explore a bit more
    if (likes > 3) {
        similarity -= Math.min(0.1, (likes - 3) * 0.03);
    }

    return Math.max(0.5, Math.min(0.95, similarity));
}

/**
 * Calculate adaptive discovery factor based on session actions.
 */
function calculateAdaptiveDiscovery(actions: SessionAction[]): number {
    const fullPlays = actions.filter((a) => a.action === 'play_full').length;
    const likes = actions.filter((a) => a.action === 'like').length;
    const skips = actions.filter((a) => a.action === 'skip').length;

    // Start with default discovery of 0.5
    let discovery = 0.5;

    // Full plays and likes = user is engaged, increase discovery
    const engagement = fullPlays + likes;
    if (engagement > 3) {
        discovery += Math.min(0.3, engagement * 0.05);
    }

    // Many skips = reduce discovery
    if (skips > 2) {
        discovery -= Math.min(0.25, skips * 0.06);
    }

    return Math.max(0.2, Math.min(0.8, discovery));
}

/**
 * Create adaptive station that adjusts recommendations based on user behavior.
 */
export async function createAdaptiveStation(
    options: AdaptiveStationOptions
): Promise<AdaptiveStationResult> {
    const { seedSidPath, sessionActions, limit = 20 } = options;
    const env = await resolvePlaybackEnvironment();

    if (!(await pathExists(seedSidPath))) {
        throw new Error(`Seed track not found: ${seedSidPath}`);
    }

    // Calculate adaptive parameters
    const adaptiveSimilarity = calculateAdaptiveSimilarity(sessionActions);
    const adaptiveDiscovery = calculateAdaptiveDiscovery(sessionActions);

    // Calculate feedback boosts based on session actions
    const likedPaths = new Set(
        sessionActions.filter((a) => a.action === 'like').map((a) => a.sid_path)
    );
    const dislikedPaths = new Set(
        sessionActions.filter((a) => a.action === 'dislike').map((a) => a.sid_path)
    );

    // Use stronger boosts/penalties based on discovery setting
    const likeBoost = adaptiveDiscovery > 0.6 ? 1.3 : 1.8;
    const dislikeBoost = adaptiveDiscovery > 0.6 ? 0.6 : 0.4;

    // Find similar tracks with adaptive parameters
    const similarTracks = await findSimilarTracks({
        seedSidPath,
        limit: limit * 2,
        minSimilarity: adaptiveSimilarity,
        likeBoost,
        dislikeBoost,
    });

    // Filter out recently disliked tracks
    const filteredTracks = similarTracks.filter((track) => !dislikedPaths.has(track.sid_path));

    const tracks: RateTrackInfo[] = [];
    for (const similar of filteredTracks.slice(0, limit)) {
        if (!(await pathExists(similar.sid_path))) {
            continue;
        }

        const length = await lookupSongLength(similar.sid_path, env.sidPath, env.musicRoot);
        const trackInfo = await createRateTrackInfo({
            env,
            sidPath: similar.sid_path,
            relativeBase: 'collection',
            lengthHint: length,
        });

        tracks.push({
            ...trackInfo,
            metadata: {
                ...trackInfo.metadata,
                length,
            },
        });
    }

    const skips = sessionActions.filter((a) => a.action === 'skip').length;
    const likes = sessionActions.filter((a) => a.action === 'like').length;
    const dislikes = sessionActions.filter((a) => a.action === 'dislike').length;
    const fullPlays = sessionActions.filter((a) => a.action === 'play_full').length;

    return {
        tracks,
        stationName: 'Smart Station (Adaptive)',
        adaptationSummary: {
            totalActions: sessionActions.length,
            skips,
            likes,
            dislikes,
            fullPlays,
            adjustedSimilarity: adaptiveSimilarity,
            adjustedDiscovery: adaptiveDiscovery,
        },
    };
}
