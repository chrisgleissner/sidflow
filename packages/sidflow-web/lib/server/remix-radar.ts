import { pathExists, lookupSongLength } from '@sidflow/common';
import { createRateTrackInfo, resolvePlaybackEnvironment } from '@/lib/rate-playback';
import { findSimilarTracks, type SimilarTrack } from '@/lib/server/similarity-search';
import type { RateTrackInfo } from '@/lib/types/rate-track';

export interface RemixRadarOptions {
    sidPath: string;
    limit?: number;
    minTitleSimilarity?: number;
}

export interface RemixRadarResult {
    seedTrack: RateTrackInfo;
    tracks: RateTrackInfo[];
    stationName: string;
    explanations: RemixCandidateExplanation[];
}

export interface RemixCandidateExplanation {
    sidPath: string;
    titleSimilarity: number;
    styleMatch: number;
    remixScore: number;
}

const STOP_WORDS = new Set([
    'sid',
    'mix',
    'remix',
    'version',
    'extended',
    'ost',
    'theme',
    'live',
    'edit',
    'feat',
    'featuring',
    'game',
    'c64',
    'the',
    'a',
    'an',
    'and',
    'or',
    'of',
    'in',
    'on',
]);

/**
 * Normalize a title into a sorted token array for similarity checks.
 */
export function tokenizeTitle(title: string): string[] {
    const normalized = title
        .toLowerCase()
        .replace(/[()\[\]{}]/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    if (!normalized) {
        return [];
    }

    return normalized
        .split(/\s+/)
        .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
        .sort();
}

/**
 * Calculate token-based similarity between two titles using Jaccard.
 */
export function calculateTitleSimilarity(a: string, b: string): number {
    const tokensA = tokenizeTitle(a);
    const tokensB = tokenizeTitle(b);

    if (tokensA.length === 0 || tokensB.length === 0) {
        return 0;
    }

    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    let intersection = 0;
    for (const token of setA) {
        if (setB.has(token)) {
            intersection += 1;
        }
    }
    const union = new Set([...tokensA, ...tokensB]).size;
    const jaccard = intersection / union;

    // Boost when one normalized title fully contains the other.
    const normalizedA = tokensA.join(' ');
    const normalizedB = tokensB.join(' ');
    const shorter = normalizedA.length <= normalizedB.length ? normalizedA : normalizedB;
    const longer = shorter === normalizedA ? normalizedB : normalizedA;
    const containment = longer.includes(shorter) && shorter.length >= 4 ? shorter.length / longer.length : 0;

    return Math.min(1, Math.max(jaccard, containment));
}

/**
 * Normalize composer names for comparison.
 */
export function normalizeComposerName(value?: string | null): string {
    if (!value) {
        return '';
    }
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function clamp(value: number, min = 0, max = 1): number {
    return Math.max(min, Math.min(max, value));
}

function computeFeedbackBoost(track: SimilarTrack): number {
    const likes = clamp((track.likes ?? 0) / 10, 0, 1);
    const plays = clamp((track.plays ?? 0) / 50, 0, 1);
    const dislikesPenalty = clamp((track.dislikes ?? 0) / 10, 0, 1);
    return Math.max(0, likes * 0.6 + plays * 0.4 - dislikesPenalty * 0.7);
}

export function computeRemixScore(titleSimilarity: number, styleMatch: number, feedbackBoost: number): number {
    return titleSimilarity * 0.7 + styleMatch * 0.25 + feedbackBoost * 0.05;
}

export async function findRemixRadarTracks(options: RemixRadarOptions): Promise<RemixRadarResult> {
    const { sidPath, limit = 12, minTitleSimilarity = 0.55 } = options;
    const env = await resolvePlaybackEnvironment();

    if (!(await pathExists(sidPath))) {
        throw new Error(`Seed track not found: ${sidPath}`);
    }

    const seedLength = await lookupSongLength(sidPath, env.sidPath, env.musicRoot);
    const seedTrack = await createRateTrackInfo({
        env,
        sidPath,
        relativeBase: 'collection',
        lengthHint: seedLength,
    });

    const rawSimilar = await findSimilarTracks({
        seedSidPath: sidPath,
        limit: limit * 4,
        minSimilarity: 0.35,
    });

    const normalizedSeedTitle = seedTrack.metadata.title || seedTrack.displayName;
    const normalizedSeedComposer = normalizeComposerName(seedTrack.metadata.author);

    const candidates: Array<{
        track: RateTrackInfo;
        titleSimilarity: number;
        styleMatch: number;
        remixScore: number;
    }> = [];

    for (const similar of rawSimilar) {
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

        const composer = normalizeComposerName(trackInfo.metadata.author);
        if (normalizedSeedComposer && composer && composer === normalizedSeedComposer) {
            continue; // Require different composer for remix discovery
        }

        const titleSimilarity = calculateTitleSimilarity(
            normalizedSeedTitle,
            trackInfo.metadata.title || trackInfo.displayName
        );

        if (titleSimilarity < minTitleSimilarity) {
            continue;
        }

        const styleMatch = clamp(similar.similarity_score ?? 0);
        const feedbackBoost = computeFeedbackBoost(similar);
        const remixScore = computeRemixScore(titleSimilarity, styleMatch, feedbackBoost);

        candidates.push({
            track: {
                ...trackInfo,
                metadata: {
                    ...trackInfo.metadata,
                    length,
                },
            },
            titleSimilarity,
            styleMatch,
            remixScore,
        });
    }

    candidates.sort((a, b) => b.remixScore - a.remixScore);
    const topCandidates = candidates.slice(0, limit);

    return {
        seedTrack,
        tracks: topCandidates.map((c) => c.track),
        stationName: `Remix Radar: ${seedTrack.displayName}`,
        explanations: topCandidates.map((c) => ({
            sidPath: c.track.sidPath,
            titleSimilarity: Number(c.titleSimilarity.toFixed(3)),
            styleMatch: Number(c.styleMatch.toFixed(3)),
            remixScore: Number(c.remixScore.toFixed(3)),
        })),
    };
}
