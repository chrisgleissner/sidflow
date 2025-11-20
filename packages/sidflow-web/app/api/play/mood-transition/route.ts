import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { findMoodTransitionTracks } from '@/lib/server/mood-transition';
import { resolvePlaybackEnvironment, createRateTrackInfo } from '@/lib/rate-playback';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { pathExists } from '@sidflow/common';
import { stat } from 'node:fs/promises';
import { lookupSongLength } from '@/lib/songlengths';

interface MoodTransitionRequest {
    start_mood: { e: number; m: number; c: number };
    end_mood: { e: number; m: number; c: number };
    limit?: number;
}

interface MoodTransitionResponse {
    tracks: RateTrackInfo[];
    transitionPath: Array<{ e: number; m: number; c: number }>;
    stationName: string;
}

/**
 * POST /api/play/mood-transition
 * 
 * Creates a smooth transition playlist between two moods.
 * Uses E/M/C dimensions to find tracks that gradually bridge the gap
 * between start and end mood states.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as MoodTransitionRequest;
        const { start_mood, end_mood, limit = 7 } = body;

        console.log('[API] /api/play/mood-transition - Request:', {
            start_mood,
            end_mood,
            limit,
            timestamp: new Date().toISOString(),
        });

        // Validate moods
        if (!start_mood || !end_mood) {
            const response: ApiResponse = {
                success: false,
                error: 'Missing mood parameters',
                details: 'Both start_mood and end_mood are required',
            };
            return NextResponse.json(response, { status: 400 });
        }

        if (!isValidMood(start_mood) || !isValidMood(end_mood)) {
            const response: ApiResponse = {
                success: false,
                error: 'Invalid mood values',
                details: 'Mood values must have e, m, c between 1-5',
            };
            return NextResponse.json(response, { status: 400 });
        }

        const env = await resolvePlaybackEnvironment();

        // Find tracks that form a smooth transition
        const transitionTracks = await findMoodTransitionTracks({
            startMood: start_mood,
            endMood: end_mood,
            steps: limit,
        });

        // Enrich tracks with full metadata
        const enrichedTracks: RateTrackInfo[] = [];
        for (const track of transitionTracks) {
            try {
                if (!(await pathExists(track.sid_path))) {
                    continue;
                }

                const fileStats = await stat(track.sid_path);
                const length = await lookupSongLength(track.sid_path, env.sidPath, env.musicRoot);

                const rateTrackInfo = await createRateTrackInfo({
                    env,
                    sidPath: track.sid_path,
                    relativeBase: 'collection',
                    lengthHint: length,
                });

                const enrichedTrack: RateTrackInfo = {
                    ...rateTrackInfo,
                    metadata: {
                        ...rateTrackInfo.metadata,
                        length,
                        fileSizeBytes: fileStats.size,
                    },
                };

                enrichedTracks.push(enrichedTrack);
            } catch (error) {
                console.warn('[API] Failed to load transition track:', track.sid_path, error);
                continue;
            }
        }

        // Build transition path for visualization
        const transitionPath = transitionTracks.map((t) => ({
            e: t.e,
            m: t.m,
            c: t.c,
        }));

        const stationName = `Mood Transition: ${moodLabel(start_mood)} → ${moodLabel(end_mood)}`;

        console.log('[API] /api/play/mood-transition - Success:', {
            tracksFound: enrichedTracks.length,
            stationName,
        });

        const response: ApiResponse<MoodTransitionResponse> = {
            success: true,
            data: {
                tracks: enrichedTracks,
                transitionPath,
                stationName,
            },
        };
        return NextResponse.json(response, {
            status: 200,
            headers: {
                'Cache-Control': 'public, max-age=600, s-maxage=900', // 10min client, 15min CDN
            },
        });
    } catch (error) {
        console.error('[API] /api/play/mood-transition - Error:', error);
        const response: ApiResponse = {
            success: false,
            error: 'Failed to create mood transition',
            details: error instanceof Error ? error.message : String(error),
        };
        return NextResponse.json(response, { status: 500 });
    }
}

function isValidMood(mood: { e: number; m: number; c: number }): boolean {
    return (
        typeof mood.e === 'number' &&
        typeof mood.m === 'number' &&
        typeof mood.c === 'number' &&
        mood.e >= 1 &&
        mood.e <= 5 &&
        mood.m >= 1 &&
        mood.m <= 5 &&
        mood.c >= 1 &&
        mood.c <= 5
    );
}

function moodLabel(mood: { e: number; m: number; c: number }): string {
    // Create human-readable label based on E/M/C values
    const energy = mood.e >= 4 ? 'Energetic' : mood.e >= 2.5 ? 'Moderate' : 'Calm';
    const moodVal = mood.m >= 4 ? 'Uplifting' : mood.m >= 2.5 ? 'Neutral' : 'Melancholic';
    const complexity = mood.c >= 4 ? 'Complex' : mood.c >= 2.5 ? 'Balanced' : 'Simple';

    return `${energy} ${moodVal}`;
}
