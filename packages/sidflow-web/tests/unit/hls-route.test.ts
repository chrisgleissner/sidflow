import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET } from '@/app/hls/[...path]/route';
import { resolveFromRepoRoot } from '@/lib/server-env';

const HLS_ROOT = resolveFromRepoRoot('workspace', 'hls');
const TEST_DIR = path.join(HLS_ROOT, 'test-suite');
const MANIFEST_PATH = path.join(TEST_DIR, 'index.m3u8');
const SEGMENT_PATH = path.join(TEST_DIR, 'segment-000.ts');

beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(MANIFEST_PATH, '#EXTM3U\n#EXT-X-VERSION:3\n');
    await writeFile(SEGMENT_PATH, Buffer.alloc(16));
});

afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
});

function buildRequest(pathname: string): NextRequest {
    const url = new URL(`http://localhost${pathname}`);
    const request = new Request(url);
    return new NextRequest(request);
}

describe('HLS route', () => {
    it('streams manifest assets with cache headers', async () => {
        const request = buildRequest('/hls/test-suite/index.m3u8');
        const response = await GET(request, { params: { path: ['test-suite', 'index.m3u8'] } });
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/vnd.apple.mpegurl');
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
        expect(response.headers.get('X-Hls-Asset')).toBe('test-suite/index.m3u8');
    });

    it('serves .ts segment with video/mp2t content type', async () => {
        const request = buildRequest('/hls/test-suite/segment-000.ts');
        const response = await GET(request, { params: { path: ['test-suite', 'segment-000.ts'] } });
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('video/mp2t');
    });

    it('serves .mp4 file with video/mp4 content type', async () => {
        const mp4Path = path.join(TEST_DIR, 'clip.mp4');
        await writeFile(mp4Path, Buffer.alloc(8));
        const request = buildRequest('/hls/test-suite/clip.mp4');
        const response = await GET(request, { params: { path: ['test-suite', 'clip.mp4'] } });
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('video/mp4');
    });

    it('serves .aac file with audio/aac content type', async () => {
        const aacPath = path.join(TEST_DIR, 'audio.aac');
        await writeFile(aacPath, Buffer.alloc(8));
        const request = buildRequest('/hls/test-suite/audio.aac');
        const response = await GET(request, { params: { path: ['test-suite', 'audio.aac'] } });
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('audio/aac');
    });

    it('serves unknown extension with application/octet-stream', async () => {
        const binPath = path.join(TEST_DIR, 'data.bin');
        await writeFile(binPath, Buffer.alloc(4));
        const request = buildRequest('/hls/test-suite/data.bin');
        const response = await GET(request, { params: { path: ['test-suite', 'data.bin'] } });
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    });

    it('returns 404 for unknown assets', async () => {
        const request = buildRequest('/hls/does-not-exist/index.m3u8');
        const response = await GET(request, { params: { path: ['does-not-exist', 'index.m3u8'] } });
        expect(response.status).toBe(404);
    });

    it('returns 404 when path resolves to a directory', async () => {
        const request = buildRequest('/hls/test-suite');
        const response = await GET(request, { params: { path: ['test-suite'] } });
        expect(response.status).toBe(404);
    });

    it('returns 500 for path traversal attempt', async () => {
        // Path traversal: '..', '..', 'etc', 'passwd' would resolve outside HLS_ROOT
        const request = buildRequest('/hls/../../etc/passwd');
        const response = await GET(request, { params: { path: ['..', '..', 'etc', 'passwd'] } });
        expect(response.status).toBe(500);
    });
});
