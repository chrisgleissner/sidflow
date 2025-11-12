import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import type {
    PlaybackSessionDescriptor,
    PlaybackSessionScope,
    SessionRomUrls,
} from '@/lib/types/playback-session';

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

const ROM_KINDS = ['kernal', 'basic', 'chargen'] as const;
type SessionRomKind = (typeof ROM_KINDS)[number];
type SessionRomPaths = Partial<Record<SessionRomKind, string>>;

interface PlaybackSessionRecord {
    id: string;
    scope: PlaybackSessionScope;
    sidPath: string;
    track: RateTrackInfo;
    durationSeconds: number;
    selectedSong: number;
    createdAt: number;
    lastAccessedAt: number;
    romPaths?: SessionRomPaths;
}

const sessions = new Map<string, PlaybackSessionRecord>();

function pruneExpiredSessions(now: number = Date.now()): void {
    for (const [id, session] of sessions.entries()) {
        if (now - session.lastAccessedAt > SESSION_TTL_MS) {
            sessions.delete(id);
        }
    }
}

function normalizeRomPaths(input?: Partial<Record<SessionRomKind, string | null>> | null): SessionRomPaths | undefined {
    if (!input) {
        return undefined;
    }
    const result: SessionRomPaths = {};
    for (const kind of ROM_KINDS) {
        const value = input[kind];
        if (typeof value === 'string' && value.length > 0) {
            result[kind] = value;
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function buildRomUrls(id: string, romPaths?: SessionRomPaths): SessionRomUrls | undefined {
    if (!romPaths) {
        return undefined;
    }
    const urls: SessionRomUrls = {};
    let hasAny = false;
    for (const kind of ROM_KINDS) {
        const romPath = romPaths[kind];
        if (!romPath) {
            continue;
        }
        urls[kind] = `/api/playback/${id}/rom/${kind}`;
        hasAny = true;
    }
    return hasAny ? urls : undefined;
}

export function createPlaybackSession(options: {
    scope: PlaybackSessionScope;
    sidPath: string;
    track: RateTrackInfo;
    durationSeconds: number;
    selectedSong: number;
    romPaths?: Partial<Record<SessionRomKind, string | null>> | null;
}): PlaybackSessionDescriptor {
    const now = Date.now();
    pruneExpiredSessions(now);

    const id = randomUUID();
    const romPaths = normalizeRomPaths(options.romPaths);
    const record: PlaybackSessionRecord = {
        id,
        scope: options.scope,
        sidPath: options.sidPath,
        track: options.track,
        durationSeconds: options.durationSeconds,
        selectedSong: options.selectedSong,
        createdAt: now,
        lastAccessedAt: now,
        romPaths,
    };
    sessions.set(id, record);

    const romUrls = buildRomUrls(id, romPaths);

    return {
        sessionId: id,
        sidUrl: `/api/playback/${id}/sid`,
        scope: options.scope,
        durationSeconds: options.durationSeconds,
        selectedSong: options.selectedSong,
        expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
        romUrls,
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

export async function streamSessionRomFile(id: string, kind: SessionRomKind): Promise<NextResponse> {
    const session = getPlaybackSession(id);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Playback session not found or expired' }, { status: 404 });
    }

    const romPath = session.romPaths?.[kind];
    if (!romPath) {
        return NextResponse.json(
            { success: false, error: `${kind.toUpperCase()} ROM not configured for this session` },
            { status: 404 }
        );
    }

    try {
        const data = await readFile(romPath);
        const filename = path.basename(romPath);
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
        console.error('[playback-session] Failed to read ROM file', error);
        return NextResponse.json({ success: false, error: 'Failed to read ROM file for session' }, { status: 500 });
    }
}

export type { PlaybackSessionDescriptor, PlaybackSessionScope, SessionRomUrls } from '@/lib/types/playback-session';
