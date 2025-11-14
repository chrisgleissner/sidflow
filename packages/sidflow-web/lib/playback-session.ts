import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import type {
    PlaybackSessionDescriptor,
    PlaybackSessionScope,
    SessionRomUrls,
    SessionStreamUrls,
} from '@/lib/types/playback-session';

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

const ROM_KINDS = ['kernal', 'basic', 'chargen'] as const;
type SessionRomKind = (typeof ROM_KINDS)[number];
type SessionRomPaths = Partial<Record<SessionRomKind, string>>;

type StreamFormat = 'wav' | 'm4a' | 'flac';

export interface SessionStreamAsset {
    format: StreamFormat;
    filePath: string;
    sizeBytes: number;
    durationMs: number;
    sampleRate: number;
    channels: number;
    bitrateKbps?: number;
    codec?: string;
    publicPath?: string;
}

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
    fallbackHlsUrl?: string | null;
    streamAssets?: SessionStreamAsset[];
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

function buildStreamUrls(id: string, assets?: SessionStreamAsset[] | null | undefined): SessionStreamUrls | undefined {
    if (!assets || assets.length === 0) {
        return undefined;
    }

    const descriptors: SessionStreamUrls = {};
    for (const asset of assets) {
        descriptors[asset.format] = {
            format: asset.format,
            url: `/api/playback/${id}/${asset.format}`,
            sizeBytes: asset.sizeBytes,
            durationMs: asset.durationMs,
            sampleRate: asset.sampleRate,
            channels: asset.channels,
            bitrateKbps: asset.bitrateKbps,
            codec: asset.codec,
            publicPath: asset.publicPath,
        };
    }

    return Object.keys(descriptors).length > 0 ? descriptors : undefined;
}

export function createPlaybackSession(options: {
    scope: PlaybackSessionScope;
    sidPath: string;
    track: RateTrackInfo;
    durationSeconds: number;
    selectedSong: number;
    romPaths?: Partial<Record<SessionRomKind, string | null>> | null;
    fallbackHlsUrl?: string | null;
    streamAssets?: SessionStreamAsset[];
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
        fallbackHlsUrl: options.fallbackHlsUrl ?? null,
        streamAssets: options.streamAssets,
    };
    sessions.set(id, record);

    const romUrls = buildRomUrls(id, romPaths);
    const streamUrls = buildStreamUrls(id, options.streamAssets);

    return {
        sessionId: id,
        sidUrl: `/api/playback/${id}/sid`,
        scope: options.scope,
        durationSeconds: options.durationSeconds,
        selectedSong: options.selectedSong,
        expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
        romUrls,
        fallbackHlsUrl: options.fallbackHlsUrl ?? null,
        streamUrls,
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

export async function streamSessionAssetFile(
    request: NextRequest,
    id: string,
    format: StreamFormat
): Promise<NextResponse> {
    const session = getPlaybackSession(id);
    if (!session) {
        return NextResponse.json({ success: false, error: 'Playback session not found or expired' }, { status: 404 });
    }

    const asset = session.streamAssets?.find((entry) => entry.format === format);
    if (!asset) {
        return NextResponse.json(
            { success: false, error: `${format.toUpperCase()} asset not available for this session` },
            { status: 404 }
        );
    }

    const stats = await stat(asset.filePath).catch(() => null);
    if (!stats || stats.size === 0) {
        return NextResponse.json(
            { success: false, error: 'Asset file missing or unreadable for this session' },
            { status: 410 }
        );
    }

    const range = parseRange(request.headers.get('range'), stats.size);
    if (range === 'invalid') {
        return NextResponse.json({ success: false, error: 'Invalid Range header' }, { status: 416 });
    }

    const { start, end } = range ?? { start: 0, end: stats.size - 1 };
    const chunkSize = end - start + 1;
    const stream = createReadStream(asset.filePath, { start, end });
    const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;

    const headers = new Headers({
        'Content-Type': getMimeType(format),
        'Cache-Control': 'private, max-age=300',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Disposition': `inline; filename="${encodeURIComponent(path.basename(asset.filePath))}"`,
    });

    if (range) {
        headers.set('Content-Range', `bytes ${start}-${end}/${stats.size}`);
    }

    return new NextResponse(body, {
        status: range ? 206 : 200,
        headers,
    });
}

type ParsedRange = { start: number; end: number } | null | 'invalid';

function parseRange(header: string | null, size: number): ParsedRange {
    if (!header) {
        return null;
    }
    if (!header.toLowerCase().startsWith('bytes=')) {
        return 'invalid';
    }

    const rangeValue = header.slice(6).split(',')[0]?.trim();
    if (!rangeValue) {
        return 'invalid';
    }

    const [startPart, endPart] = rangeValue.split('-', 2);
    let start: number;
    let end: number;

    if (!startPart) {
        const suffix = Number(endPart);
        if (!Number.isFinite(suffix) || suffix <= 0) {
            return 'invalid';
        }
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = Number(startPart);
        if (!Number.isFinite(start) || start < 0) {
            return 'invalid';
        }
        if (endPart) {
            end = Number(endPart);
            if (!Number.isFinite(end) || end < 0) {
                return 'invalid';
            }
        } else {
            end = size - 1;
        }
    }

    start = Math.min(start, size - 1);
    end = Math.min(end, size - 1);
    if (start > end) {
        return 'invalid';
    }

    return { start, end };
}

function getMimeType(format: StreamFormat): string {
    switch (format) {
        case 'wav':
            return 'audio/wav';
        case 'm4a':
            return 'audio/mp4';
        case 'flac':
            return 'audio/flac';
        default:
            return 'application/octet-stream';
    }
}

export type {
    PlaybackSessionDescriptor,
    PlaybackSessionScope,
    SessionRomUrls,
    SessionStreamUrls,
} from '@/lib/types/playback-session';
