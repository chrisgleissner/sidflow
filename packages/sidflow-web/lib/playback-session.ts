import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import type { PlaybackSessionDescriptor, PlaybackSessionScope } from '@/lib/types/playback-session';

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface PlaybackSessionRecord {
    id: string;
    scope: PlaybackSessionScope;
    sidPath: string;
    track: RateTrackInfo;
    durationSeconds: number;
    selectedSong: number;
    createdAt: number;
    lastAccessedAt: number;
}

const sessions = new Map<string, PlaybackSessionRecord>();

function pruneExpiredSessions(now: number = Date.now()): void {
    for (const [id, session] of sessions.entries()) {
        if (now - session.lastAccessedAt > SESSION_TTL_MS) {
            sessions.delete(id);
        }
    }
}

export function createPlaybackSession(options: {
    scope: PlaybackSessionScope;
    sidPath: string;
    track: RateTrackInfo;
    durationSeconds: number;
    selectedSong: number;
}): PlaybackSessionDescriptor {
    const now = Date.now();
    pruneExpiredSessions(now);

    const id = randomUUID();
    const record: PlaybackSessionRecord = {
        id,
        scope: options.scope,
        sidPath: options.sidPath,
        track: options.track,
        durationSeconds: options.durationSeconds,
        selectedSong: options.selectedSong,
        createdAt: now,
        lastAccessedAt: now,
    };
    sessions.set(id, record);

    return {
        sessionId: id,
        sidUrl: `/api/playback/${id}/sid`,
        scope: options.scope,
        durationSeconds: options.durationSeconds,
        selectedSong: options.selectedSong,
        expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    };
}

export function getPlaybackSession(id: string): PlaybackSessionRecord | null {
    pruneExpiredSessions();
    const record = sessions.get(id);
    if (!record) {
        return null;
    }
    record.lastAccessedAt = Date.now();
    return record;
}

export function findLatestSessionByScope(scope: PlaybackSessionScope): PlaybackSessionRecord | null {
    pruneExpiredSessions();
    let candidate: PlaybackSessionRecord | null = null;
    for (const session of sessions.values()) {
        if (session.scope !== scope) {
            continue;
        }
        if (!candidate || session.lastAccessedAt > candidate.lastAccessedAt) {
            candidate = session;
        }
    }
    return candidate;
}

export async function streamSessionSidFile(id: string): Promise<NextResponse> {
    const session = getPlaybackSession(id);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Playback session not found or expired' }, { status: 404 });
    }
    try {
        const data = await readFile(session.sidPath);
        const filename = session.track.filename ?? 'track.sid';
        return new NextResponse(new Uint8Array(data), {
            status: 200,
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(data.byteLength),
                'Cache-Control': 'private, max-age=30',
                'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
                'Cross-Origin-Resource-Policy': 'same-origin',
            },
        });
    } catch (error) {
        console.error('[playback-session] Failed to read SID file', error);
        return NextResponse.json({ success: false, error: 'Failed to read SID file for session' }, { status: 500 });
    }
}

export type { PlaybackSessionDescriptor, PlaybackSessionScope } from '@/lib/types/playback-session';
