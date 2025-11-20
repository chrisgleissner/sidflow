import { pathExists } from '@sidflow/common';
import { lookupSongLength } from '@/lib/songlengths';
import { createRateTrackInfo, resolvePlaybackEnvironment } from '@/lib/rate-playback';
import { findSimilarTracks } from '@/lib/server/similarity-search';
import type { RateTrackInfo } from '@/lib/types/rate-track';

export interface CollaborativeFilterOptions {
    seedSidPath: string;
    limit?: number;
    minCorrelation?: number;
}

export interface CollaborativeFilterResult {
    seedTrack: RateTrackInfo;
    tracks: RateTrackInfo[];
    stationName: string;
}

/**
 * Find tracks that users who liked the seed track also liked.
 * Uses vector similarity as a proxy for collaborative filtering.
 * In a production system, this would aggregate actual user feedback data.
 */
export async function findCollaborativeRecommendations(
    options: CollaborativeFilterOptions
): Promise<CollaborativeFilterResult> {
    const { seedSidPath, limit = 20, minCorrelation = 0.6 } = options;
    const env = await resolvePlaybackEnvironment();

    if (!(await pathExists(seedSidPath))) {
        throw new Error(`Seed track not found: ${seedSidPath}`);
    }

    const seedLength = await lookupSongLength(seedSidPath, env.sidPath, env.musicRoot);
    const seedTrack = await createRateTrackInfo({
        env,
        sidPath: seedSidPath,
        relativeBase: 'collection',
        lengthHint: seedLength,
    });

    // Find similar tracks using vector search with strong feedback signals
    const similarTracks = await findSimilarTracks({
        seedSidPath,
        limit: limit * 2,
        minSimilarity: minCorrelation,
        likeBoost: 2.0, // Strong boost for tracks users liked
        dislikeBoost: 0.3, // Strong penalty for disliked tracks
    });

    // Filter by positive feedback signals
    const collaborativeTracks = similarTracks.filter((track) => {
        // Require tracks that have been liked or played multiple times
        const hasPositiveFeedback = track.likes > 0 || track.plays > 5;
        // Exclude tracks with too many dislikes relative to likes
        const hasGoodRatio = track.dislikes === 0 || track.likes / Math.max(track.dislikes, 1) > 1.5;
        return hasPositiveFeedback && hasGoodRatio;
    });

    const tracks: RateTrackInfo[] = [];
    for (const similar of collaborativeTracks.slice(0, limit)) {
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

    return {
        seedTrack,
        tracks,
        stationName: `Listeners also enjoyed: ${seedTrack.displayName}`,
    };
}
