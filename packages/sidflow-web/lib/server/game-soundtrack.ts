import { pathExists } from '@sidflow/common';
import { lookupSongLength } from '@/lib/songlengths';
import { createRateTrackInfo, resolvePlaybackEnvironment } from '@/lib/rate-playback';
import { findSimilarTracks, type SimilarTrack } from '@/lib/server/similarity-search';
import type { RateTrackInfo } from '@/lib/types/rate-track';

export interface GameSoundtrackOptions {
    gameTitle?: string;
    seedSidPath?: string;
    limit?: number;
}

export interface GameSoundtrackResult {
    tracks: RateTrackInfo[];
    stationName: string;
    gameTitle: string;
}

/**
 * Normalize game title for comparison.
 */
export function normalizeGameTitle(value?: string | null): string {
    if (!value) {
        return '';
    }
    return value
        .toLowerCase()
        .replace(/[()\[\]{}]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * Extract game title from SID metadata or path.
 */
export function extractGameTitle(metadata: RateTrackInfo['metadata'], sidPath: string): string {
    // Try metadata title first
    if (metadata.title) {
        return metadata.title;
    }

    // Extract from path - typically /path/to/Game_Name/file.sid
    const parts = sidPath.split('/');
    if (parts.length >= 2) {
        const gameFolder = parts[parts.length - 2];
        // Clean up folder name
        return gameFolder.replace(/_/g, ' ').replace(/[^a-zA-Z0-9\s]/g, '');
    }

    return '';
}

/**
 * Find tracks from the same game or similar game soundtracks.
 */
export async function findGameSoundtracks(options: GameSoundtrackOptions): Promise<GameSoundtrackResult> {
    const { gameTitle, seedSidPath, limit = 20 } = options;
    const env = await resolvePlaybackEnvironment();

    let targetGameTitle = gameTitle;
    let similarTracks: SimilarTrack[] = [];

    // If we have a seed path, use it to find similar tracks
    if (seedSidPath) {
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

        targetGameTitle = extractGameTitle(seedTrack.metadata, seedSidPath);

        // Find similar tracks using vector search
        similarTracks = await findSimilarTracks({
            seedSidPath,
            limit: limit * 2,
            minSimilarity: 0.5,
        });
    }

    if (!targetGameTitle) {
        throw new Error('No game title provided and unable to extract from seed track');
    }

    const normalizedGameTitle = normalizeGameTitle(targetGameTitle);
    const tracks: RateTrackInfo[] = [];
    const seenPaths = new Set<string>();

    // Process similar tracks, filtering by game title match
    for (const similar of similarTracks) {
        if (seenPaths.has(similar.sid_path)) {
            continue;
        }

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

        const trackGameTitle = extractGameTitle(trackInfo.metadata, similar.sid_path);
        const normalizedTrackGame = normalizeGameTitle(trackGameTitle);

        // Check if game titles match or are very similar
        if (normalizedTrackGame.includes(normalizedGameTitle) || normalizedGameTitle.includes(normalizedTrackGame)) {
            tracks.push({
                ...trackInfo,
                metadata: {
                    ...trackInfo.metadata,
                    length,
                },
            });
            seenPaths.add(similar.sid_path);

            if (tracks.length >= limit) {
                break;
            }
        }
    }

    return {
        tracks,
        stationName: `Game Radio: ${targetGameTitle}`,
        gameTitle: targetGameTitle,
    };
}
