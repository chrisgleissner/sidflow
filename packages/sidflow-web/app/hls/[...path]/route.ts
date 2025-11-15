import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { pathExists } from '@sidflow/common';
import { resolveFromRepoRoot } from '@/lib/server-env';

const HLS_ROOT = resolveFromRepoRoot('workspace', 'hls');

function toWebPath(filePath: string): string {
    const relative = path.relative(HLS_ROOT, filePath);
    return relative.split(path.sep).join('/');
}

function resolveFilePath(segments: string[]): string {
    const safeSegments = segments.filter(Boolean);
    const resolved = path.resolve(HLS_ROOT, ...safeSegments);
    if (!resolved.startsWith(HLS_ROOT)) {
        throw new Error('Invalid HLS path');
    }
    return resolved;
}

function resolveContentType(filePath: string): string {
    if (filePath.endsWith('.m3u8')) {
        return 'application/vnd.apple.mpegurl';
    }
    if (filePath.endsWith('.ts')) {
        return 'video/mp2t';
    }
    if (filePath.endsWith('.mp4')) {
        return 'video/mp4';
    }
    if (filePath.endsWith('.aac')) {
        return 'audio/aac';
    }
    return 'application/octet-stream';
}

export async function GET(_request: NextRequest, context: { params: { path?: string[] } }): Promise<NextResponse> {
    try {
        const segments = context.params.path ?? [];
        const filePath = resolveFilePath(segments);

        if (!(await pathExists(filePath))) {
            return NextResponse.json({ success: false, error: 'HLS asset not found' }, { status: 404 });
        }

        const fileStat = await stat(filePath);
        if (fileStat.isDirectory()) {
            return NextResponse.json({ success: false, error: 'HLS asset not found' }, { status: 404 });
        }

        const nodeStream = createReadStream(filePath);
        const webStream = Readable.toWeb(nodeStream as unknown as Readable) as unknown as ReadableStream<Uint8Array>;
        const response = new NextResponse(webStream);
        response.headers.set('Content-Length', fileStat.size.toString());
        response.headers.set('Last-Modified', fileStat.mtime.toUTCString());
        response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
        response.headers.set('Content-Type', resolveContentType(filePath));
        response.headers.set('X-Hls-Asset', toWebPath(filePath));
        return response;
    } catch (error) {
        console.error('[hls-route] Failed to serve HLS asset', error);
        return NextResponse.json({ success: false, error: 'Failed to serve HLS asset' }, { status: 500 });
    }
}
