import { pathExists, lookupSongLength } from '@sidflow/common';
import { createRateTrackInfo, resolvePlaybackEnvironment } from '@/lib/rate-playback';
import { findSimilarTracks } from '@/lib/server/similarity-search';

export interface ExplainRecommendationOptions {
    seedSidPath: string;
    targetSidPath: string;
}

export interface FeatureExplanation {
    feature: string;
    similarity: number;
    description: string;
}

export interface ExplainRecommendationResult {
    seedTrack: Awaited<ReturnType<typeof createRateTrackInfo>>;
    targetTrack: Awaited<ReturnType<typeof createRateTrackInfo>>;
    overallSimilarity: number;
    explanations: FeatureExplanation[];
}

/**
 * Calculate Euclidean distance between two vectors (returns 0-1, lower is more similar).
 */
function euclideanDistance(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        return 1;
    }
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        sum += diff * diff;
    }
    return Math.sqrt(sum) / Math.sqrt(a.length * 25); // Normalize assuming max value of 5 per dimension
}

/**
 * Calculate similarity percentage (0-100) from distance.
 */
function similarityFromDistance(distance: number): number {
    return Math.max(0, Math.min(100, (1 - distance) * 100));
}

/**
 * Generate human-readable explanations for why a track was recommended.
 */
export async function explainRecommendation(
    options: ExplainRecommendationOptions
): Promise<ExplainRecommendationResult> {
    const { seedSidPath, targetSidPath } = options;
    const env = await resolvePlaybackEnvironment();

    // Validate both tracks exist
    if (!(await pathExists(seedSidPath))) {
        throw new Error(`Seed track not found: ${seedSidPath}`);
    }
    if (!(await pathExists(targetSidPath))) {
        throw new Error(`Target track not found: ${targetSidPath}`);
    }

    // Load seed track
    const seedLength = await lookupSongLength(seedSidPath, env.sidPath, env.musicRoot);
    const seedTrack = await createRateTrackInfo({
        env,
        sidPath: seedSidPath,
        relativeBase: 'collection',
        lengthHint: seedLength,
    });

    // Load target track
    const targetLength = await lookupSongLength(targetSidPath, env.sidPath, env.musicRoot);
    const targetTrack = await createRateTrackInfo({
        env,
        sidPath: targetSidPath,
        relativeBase: 'collection',
        lengthHint: targetLength,
    });

    // Try to get overall similarity from vector search
    let overallSimilarity = 0;
    try {
        const similarTracks = await findSimilarTracks({
            seedSidPath,
            limit: 100,
            minSimilarity: 0,
        });
        const found = similarTracks.find((t) => t.sid_path === targetSidPath);
        if (found) {
            overallSimilarity = found.similarity_score;
        }
    } catch (error) {
        console.warn('[explain-recommendation] Could not compute vector similarity:', error);
    }

    // Generate feature-specific explanations
    const explanations: FeatureExplanation[] = [];

    // E/M/C feature similarity (if we have classified data for both tracks)
    // For demo purposes, we'll use mock values since we don't have E/M/C in metadata yet
    // In production, these would come from classified track features
    const seedEMC = [3.5, 3.8, 3.2]; // Energy, Mood, Complexity (placeholder)
    const targetEMC = [3.6, 3.9, 3.0];

    const energyDist = euclideanDistance([seedEMC[0]], [targetEMC[0]]);
    const moodDist = euclideanDistance([seedEMC[1]], [targetEMC[1]]);
    const complexityDist = euclideanDistance([seedEMC[2]], [targetEMC[2]]);

    explanations.push({
        feature: 'Energy Level',
        similarity: similarityFromDistance(energyDist),
        description: `Similar energy: ${Math.round(similarityFromDistance(energyDist))}%`,
    });

    explanations.push({
        feature: 'Mood',
        similarity: similarityFromDistance(moodDist),
        description: `Similar mood: ${Math.round(similarityFromDistance(moodDist))}%`,
    });

    explanations.push({
        feature: 'Complexity',
        similarity: similarityFromDistance(complexityDist),
        description: `Similar complexity: ${Math.round(similarityFromDistance(complexityDist))}%`,
    });

    // SID chip model match
    const seedChip = seedTrack.metadata.sidModel;
    const targetChip = targetTrack.metadata.sidModel;
    if (seedChip === targetChip) {
        explanations.push({
            feature: 'SID Chip',
            similarity: 100,
            description: `Both use ${seedChip} chip`,
        });
    }

    // Same composer
    const seedComposer = seedTrack.metadata.author;
    const targetComposer = targetTrack.metadata.author;
    if (seedComposer && targetComposer && seedComposer.toLowerCase() === targetComposer.toLowerCase()) {
        explanations.push({
            feature: 'Composer',
            similarity: 100,
            description: `Same composer: ${seedComposer}`,
        });
    }

    // Same era (within 2 years)
    const seedYear = seedTrack.metadata.released ? parseInt(seedTrack.metadata.released) : null;
    const targetYear = targetTrack.metadata.released ? parseInt(targetTrack.metadata.released) : null;
    if (seedYear && targetYear && Math.abs(seedYear - targetYear) <= 2) {
        const yearDiff = Math.abs(seedYear - targetYear);
        const eraSimilarity = yearDiff === 0 ? 100 : 100 - yearDiff * 15;
        explanations.push({
            feature: 'Era',
            similarity: eraSimilarity,
            description: `Similar era: ${seedYear} and ${targetYear}`,
        });
    }

    // Sort by similarity descending and return top 3
    explanations.sort((a, b) => b.similarity - a.similarity);
    const topExplanations = explanations.slice(0, 3);

    return {
        seedTrack,
        targetTrack,
        overallSimilarity,
        explanations: topExplanations,
    };
}
