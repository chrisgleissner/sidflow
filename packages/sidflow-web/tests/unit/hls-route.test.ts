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

    it('returns 404 for unknown assets', async () => {
        const request = buildRequest('/hls/does-not-exist/index.m3u8');
        const response = await GET(request, { params: { path: ['does-not-exist', 'index.m3u8'] } });
        expect(response.status).toBe(404);
    });
});
