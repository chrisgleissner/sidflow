import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  createPlaybackSession,
  findLatestSessionByScope,
  getPlaybackSession,
  resetPlaybackSessionStoreForTests,
  streamSessionSidFile,
  streamSessionRomFile,
  streamSessionAssetFile,
} from '@/lib/playback-session';
import { resetServerEnvCacheForTests } from '@/lib/server-env';
import type { RateTrackInfo } from '@/lib/types/rate-track';

function createTrackInfo(sidPath: string, displayName = 'Track'): RateTrackInfo {
  return {
    sidPath,
    relativePath: 'C64Music/Test/Track.sid',
    filename: 'Track.sid',
    displayName,
    selectedSong: 1,
    durationSeconds: 180,
    metadata: {
      songs: 1,
      startSong: 1,
      sidType: 'PSID',
      version: 2,
      sidModel: '6581',
      clock: 'PAL',
      fileSizeBytes: 1024,
    },
  };
}

describe('playback-session persistence', () => {
  let tempRoot: string;
  let originalSidflowRoot: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-playback-session-'));
    await mkdir(path.join(tempRoot, 'data'), { recursive: true });
    originalSidflowRoot = process.env.SIDFLOW_ROOT;
    process.env.SIDFLOW_ROOT = tempRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
  });

  afterEach(async () => {
    if (originalSidflowRoot === undefined) {
      delete process.env.SIDFLOW_ROOT;
    } else {
      process.env.SIDFLOW_ROOT = originalSidflowRoot;
    }
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test('persists and reloads playback sessions across store resets', async () => {
    const sidPath = path.join(tempRoot, 'Track.sid');
    await writeFile(sidPath, 'dummy sid data', 'utf8');

    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 180,
      selectedSong: 1,
      fallbackHlsUrl: '/api/hls/test.m3u8',
      streamAssets: [],
    });

    resetPlaybackSessionStoreForTests();

    const loaded = await getPlaybackSession(created.sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded?.sidPath).toBe(sidPath);
    expect(loaded?.track.displayName).toBe('Track');

    const latest = await findLatestSessionByScope('rate');
    expect(latest).not.toBeNull();
    expect(latest?.id).toBe(created.sessionId);
  });

  test('getPlaybackSession returns null for unknown session id', async () => {
    const result = await getPlaybackSession('nonexistent-session-id');
    expect(result).toBeNull();
  });

  test('findLatestSessionByScope returns null when no sessions exist', async () => {
    const result = await findLatestSessionByScope('rate');
    expect(result).toBeNull();
  });

  test('findLatestSessionByScope returns null for a scope with no sessions', async () => {
    const sidPath = path.join(tempRoot, 'Track.sid');
    await writeFile(sidPath, 'dummy sid data', 'utf8');
    await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 180,
      selectedSong: 1,
      fallbackHlsUrl: '/api/hls/test.m3u8',
      streamAssets: [],
    });
    // Created rate session, but asking for station
    const result = await findLatestSessionByScope('station');
    expect(result).toBeNull();
  });

  test('creates session with station scope', async () => {
    const sidPath = path.join(tempRoot, 'Station.sid');
    await writeFile(sidPath, 'dummy sid data', 'utf8');
    const created = await createPlaybackSession({
      scope: 'station',
      sidPath,
      track: createTrackInfo(sidPath, 'StationTrack'),
      durationSeconds: 90,
      selectedSong: 2,
      fallbackHlsUrl: '/api/hls/station.m3u8',
      streamAssets: [],
    });
    expect(created.sessionId).toBeTruthy();
    const loaded = await getPlaybackSession(created.sessionId);
    expect(loaded?.scope).toBe('station');
    expect(loaded?.selectedSong).toBe(2);
  });

  test('findLatestSessionByScope returns latest when multiple sessions exist', async () => {
    const sidPath1 = path.join(tempRoot, 'Track1.sid');
    const sidPath2 = path.join(tempRoot, 'Track2.sid');
    await writeFile(sidPath1, 'dummy', 'utf8');
    await writeFile(sidPath2, 'dummy', 'utf8');

    const first = await createPlaybackSession({
      scope: 'rate',
      sidPath: sidPath1,
      track: createTrackInfo(sidPath1, 'First'),
      durationSeconds: 60,
      selectedSong: 1,
      fallbackHlsUrl: '/api/hls/first.m3u8',
      streamAssets: [],
    });

    const second = await createPlaybackSession({
      scope: 'rate',
      sidPath: sidPath2,
      track: createTrackInfo(sidPath2, 'Second'),
      durationSeconds: 120,
      selectedSong: 1,
      fallbackHlsUrl: '/api/hls/second.m3u8',
      streamAssets: [],
    });

    // Access second session to update its lastAccessedAt
    await getPlaybackSession(second.sessionId);

    const latest = await findLatestSessionByScope('rate');
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(latest?.id).toBe(second.sessionId);
  });

  test('session includes correct durationSeconds', async () => {
    const sidPath = path.join(tempRoot, 'Track.sid');
    await writeFile(sidPath, 'x', 'utf8');
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 255,
      selectedSong: 1,
      fallbackHlsUrl: '/api/hls/x.m3u8',
      streamAssets: [],
    });
    const loaded = await getPlaybackSession(created.sessionId);
    expect(loaded?.durationSeconds).toBe(255);
  });
});

// ─── ROM paths ───────────────────────────────────────────────────────────────

describe('playback-session ROM paths', () => {
  let tempRoot: string;
  let originalSidflowRoot: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-ps-rom-'));
    await mkdir(path.join(tempRoot, 'data'), { recursive: true });
    originalSidflowRoot = process.env.SIDFLOW_ROOT;
    process.env.SIDFLOW_ROOT = tempRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
  });

  afterEach(async () => {
    if (originalSidflowRoot === undefined) delete process.env.SIDFLOW_ROOT;
    else process.env.SIDFLOW_ROOT = originalSidflowRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test('romUrls are undefined when no romPaths provided', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    await writeFile(sidPath, 'x', 'utf8');
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
    });
    expect(created.romUrls).toBeUndefined();
  });

  test('romUrls reflect provided kernal path', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    const kernalPath = path.join(tempRoot, 'kernal.rom');
    await writeFile(sidPath, 'x', 'utf8');
    await writeFile(kernalPath, Buffer.alloc(8192), undefined);
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
      romPaths: { kernal: kernalPath },
    });
    expect(created.romUrls).toBeDefined();
    expect(created.romUrls?.kernal).toBe(`/api/playback/${created.sessionId}/rom/kernal`);
    expect(created.romUrls?.basic).toBeUndefined();
  });

  test('null romPath entries are ignored', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    await writeFile(sidPath, 'x', 'utf8');
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
      romPaths: { kernal: null, basic: null, chargen: null },
    });
    expect(created.romUrls).toBeUndefined();
  });

  test('multiple ROM paths produce multiple URLs', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    const kernalPath = path.join(tempRoot, 'kernal.rom');
    const basicPath = path.join(tempRoot, 'basic.rom');
    await writeFile(sidPath, 'x', 'utf8');
    await writeFile(kernalPath, Buffer.alloc(8192), undefined);
    await writeFile(basicPath, Buffer.alloc(4096), undefined);
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
      romPaths: { kernal: kernalPath, basic: basicPath },
    });
    expect(created.romUrls?.kernal).toBeTruthy();
    expect(created.romUrls?.basic).toBeTruthy();
    expect(created.romUrls?.chargen).toBeUndefined();
  });
});

// ─── stream assets ────────────────────────────────────────────────────────────

describe('playback-session stream assets', () => {
  let tempRoot: string;
  let originalSidflowRoot: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-ps-stream-'));
    await mkdir(path.join(tempRoot, 'data'), { recursive: true });
    originalSidflowRoot = process.env.SIDFLOW_ROOT;
    process.env.SIDFLOW_ROOT = tempRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
  });

  afterEach(async () => {
    if (originalSidflowRoot === undefined) delete process.env.SIDFLOW_ROOT;
    else process.env.SIDFLOW_ROOT = originalSidflowRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test('streamUrls undefined when no stream assets', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    await writeFile(sidPath, 'x', 'utf8');
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
    });
    expect(created.streamUrls).toBeUndefined();
  });

  test('streamUrls contain wav URL when wav asset provided', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    const wavPath = path.join(tempRoot, 'T.wav');
    await writeFile(sidPath, 'x', 'utf8');
    await writeFile(wavPath, Buffer.alloc(44100 * 4), undefined);
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
      streamAssets: [{
        format: 'wav',
        filePath: wavPath,
        sizeBytes: 44100 * 4,
        durationMs: 60000,
        sampleRate: 44100,
        channels: 2,
      }],
    });
    expect(created.streamUrls?.wav?.url).toBe(`/api/playback/${created.sessionId}/wav`);
    expect(created.streamUrls?.wav?.sizeBytes).toBe(44100 * 4);
    expect(created.streamUrls?.wav?.sampleRate).toBe(44100);
  });

  test('streamUrls support m4a and flac formats', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    const m4aPath = path.join(tempRoot, 'T.m4a');
    await writeFile(sidPath, 'x', 'utf8');
    await writeFile(m4aPath, Buffer.alloc(8000), undefined);
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
      streamAssets: [{
        format: 'm4a',
        filePath: m4aPath,
        sizeBytes: 8000,
        durationMs: 60000,
        sampleRate: 44100,
        channels: 2,
        bitrateKbps: 192,
        codec: 'aac',
      }],
    });
    expect(created.streamUrls?.m4a?.url).toBe(`/api/playback/${created.sessionId}/m4a`);
    expect(created.streamUrls?.m4a?.bitrateKbps).toBe(192);
    expect(created.streamUrls?.m4a?.codec).toBe('aac');
  });
});

// ─── streamSessionSidFile ────────────────────────────────────────────────────

describe('streamSessionSidFile', () => {
  let tempRoot: string;
  let originalSidflowRoot: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-ps-sid-'));
    await mkdir(path.join(tempRoot, 'data'), { recursive: true });
    originalSidflowRoot = process.env.SIDFLOW_ROOT;
    process.env.SIDFLOW_ROOT = tempRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
  });

  afterEach(async () => {
    if (originalSidflowRoot === undefined) delete process.env.SIDFLOW_ROOT;
    else process.env.SIDFLOW_ROOT = originalSidflowRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test('returns 404 for nonexistent session', async () => {
    const response = await streamSessionSidFile('nonexistent-id');
    expect(response.status).toBe(404);
  });

  test('returns 200 with SID data for valid session', async () => {
    const sidContent = 'PSID binary data here';
    const sidPath = path.join(tempRoot, 'Track.sid');
    await writeFile(sidPath, sidContent, 'utf8');
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 120,
      selectedSong: 1,
    });
    const response = await streamSessionSidFile(created.sessionId);
    expect(response.status).toBe(200);
    const ct = response.headers.get('Content-Type');
    expect(ct).toBe('application/octet-stream');
  });

  test('returns 500 when SID file is missing from disk', async () => {
    const sidPath = path.join(tempRoot, 'Missing.sid');
    await writeFile(sidPath, 'x', 'utf8');
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
    });
    // Delete the file after session creation
    const { unlink } = await import('node:fs/promises');
    await unlink(sidPath);
    const response = await streamSessionSidFile(created.sessionId);
    expect(response.status).toBe(500);
  });
});

// ─── streamSessionRomFile ─────────────────────────────────────────────────────

describe('streamSessionRomFile', () => {
  let tempRoot: string;
  let originalSidflowRoot: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-ps-rom2-'));
    await mkdir(path.join(tempRoot, 'data'), { recursive: true });
    originalSidflowRoot = process.env.SIDFLOW_ROOT;
    process.env.SIDFLOW_ROOT = tempRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
  });

  afterEach(async () => {
    if (originalSidflowRoot === undefined) delete process.env.SIDFLOW_ROOT;
    else process.env.SIDFLOW_ROOT = originalSidflowRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test('returns 404 for nonexistent session', async () => {
    const response = await streamSessionRomFile('nonexistent', 'kernal');
    expect(response.status).toBe(404);
  });

  test('returns 404 when requested ROM kind not configured', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    await writeFile(sidPath, 'x', 'utf8');
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
    });
    const response = await streamSessionRomFile(created.sessionId, 'kernal');
    expect(response.status).toBe(404);
  });

  test('returns 200 with ROM data for valid session', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    const kernalPath = path.join(tempRoot, 'kernal.rom');
    await writeFile(sidPath, 'x', 'utf8');
    await writeFile(kernalPath, Buffer.alloc(8192), undefined);
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
      romPaths: { kernal: kernalPath },
    });
    const response = await streamSessionRomFile(created.sessionId, 'kernal');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  test('returns 500 when ROM file missing from disk', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    const kernalPath = path.join(tempRoot, 'kernal.rom');
    await writeFile(sidPath, 'x', 'utf8');
    await writeFile(kernalPath, Buffer.alloc(8192), undefined);
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
      romPaths: { kernal: kernalPath },
    });
    const { unlink } = await import('node:fs/promises');
    await unlink(kernalPath);
    const response = await streamSessionRomFile(created.sessionId, 'kernal');
    expect(response.status).toBe(500);
  });
});

// ─── streamSessionAssetFile ───────────────────────────────────────────────────

describe('streamSessionAssetFile', () => {
  let tempRoot: string;
  let originalSidflowRoot: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-ps-asset-'));
    await mkdir(path.join(tempRoot, 'data'), { recursive: true });
    originalSidflowRoot = process.env.SIDFLOW_ROOT;
    process.env.SIDFLOW_ROOT = tempRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
  });

  afterEach(async () => {
    if (originalSidflowRoot === undefined) delete process.env.SIDFLOW_ROOT;
    else process.env.SIDFLOW_ROOT = originalSidflowRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function createSessionWithWav(wavContent = Buffer.alloc(44100)) {
    const sidPath = path.join(tempRoot, 'T.sid');
    const wavPath = path.join(tempRoot, 'T.wav');
    await writeFile(sidPath, 'x', 'utf8');
    await writeFile(wavPath, wavContent, undefined);
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
      streamAssets: [{
        format: 'wav',
        filePath: wavPath,
        sizeBytes: wavContent.length,
        durationMs: 60000,
        sampleRate: 44100,
        channels: 2,
      }],
    });
    return { created, wavPath };
  }

  test('returns 404 for nonexistent session', async () => {
    const req = new NextRequest('http://localhost/api/test/wav');
    const response = await streamSessionAssetFile(req, 'nonexistent', 'wav');
    expect(response.status).toBe(404);
  });

  test('returns 404 when format not in session assets', async () => {
    const { created } = await createSessionWithWav();
    const req = new NextRequest('http://localhost/');
    const response = await streamSessionAssetFile(req, created.sessionId, 'flac');
    expect(response.status).toBe(404);
  });

  test('returns 200 for full asset (no Range header)', async () => {
    const { created } = await createSessionWithWav();
    const req = new NextRequest('http://localhost/');
    const response = await streamSessionAssetFile(req, created.sessionId, 'wav');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/wav');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
  });

  test('returns 206 for Range request', async () => {
    const { created } = await createSessionWithWav(Buffer.alloc(10000));
    const req = new NextRequest('http://localhost/', { headers: { range: 'bytes=0-999' } });
    const response = await streamSessionAssetFile(req, created.sessionId, 'wav');
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toContain('bytes 0-999/');
  });

  test('returns 416 for invalid Range header', async () => {
    const { created } = await createSessionWithWav();
    const req = new NextRequest('http://localhost/', { headers: { range: 'invalid-range-value' } });
    const response = await streamSessionAssetFile(req, created.sessionId, 'wav');
    expect(response.status).toBe(416);
  });

  test('returns 410 when asset file missing', async () => {
    const { created, wavPath } = await createSessionWithWav();
    const { unlink } = await import('node:fs/promises');
    await unlink(wavPath);
    const req = new NextRequest('http://localhost/');
    const response = await streamSessionAssetFile(req, created.sessionId, 'wav');
    expect(response.status).toBe(410);
  });

  test('m4a format returns audio/mp4 MIME type', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    const m4aPath = path.join(tempRoot, 'T.m4a');
    await writeFile(sidPath, 'x', 'utf8');
    await writeFile(m4aPath, Buffer.alloc(8000), undefined);
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
      streamAssets: [{
        format: 'm4a',
        filePath: m4aPath,
        sizeBytes: 8000,
        durationMs: 60000,
        sampleRate: 44100,
        channels: 2,
      }],
    });
    const req = new NextRequest('http://localhost/');
    const response = await streamSessionAssetFile(req, created.sessionId, 'm4a');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/mp4');
  });

  test('flac format returns audio/flac MIME type', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    const flacPath = path.join(tempRoot, 'T.flac');
    await writeFile(sidPath, 'x', 'utf8');
    await writeFile(flacPath, Buffer.alloc(5000), undefined);
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
      streamAssets: [{
        format: 'flac',
        filePath: flacPath,
        sizeBytes: 5000,
        durationMs: 60000,
        sampleRate: 44100,
        channels: 2,
      }],
    });
    const req = new NextRequest('http://localhost/');
    const response = await streamSessionAssetFile(req, created.sessionId, 'flac');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/flac');
  });

  test('suffix Range header (no start part)', async () => {
    const { created } = await createSessionWithWav(Buffer.alloc(10000));
    const req = new NextRequest('http://localhost/', { headers: { range: 'bytes=-1000' } });
    const response = await streamSessionAssetFile(req, created.sessionId, 'wav');
    expect(response.status).toBe(206);
  });

  test('Range start > end returns 416', async () => {
    const { created } = await createSessionWithWav(Buffer.alloc(10000));
    const req = new NextRequest('http://localhost/', { headers: { range: 'bytes=5000-1000' } });
    const response = await streamSessionAssetFile(req, created.sessionId, 'wav');
    expect(response.status).toBe(416);
  });
});

// ─── TTL expiry ───────────────────────────────────────────────────────────────

describe('playback-session TTL expiry', () => {
  let tempRoot: string;
  let originalSidflowRoot: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-ps-ttl-'));
    await mkdir(path.join(tempRoot, 'data'), { recursive: true });
    originalSidflowRoot = process.env.SIDFLOW_ROOT;
    process.env.SIDFLOW_ROOT = tempRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
  });

  afterEach(async () => {
    if (originalSidflowRoot === undefined) delete process.env.SIDFLOW_ROOT;
    else process.env.SIDFLOW_ROOT = originalSidflowRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test('expired sessions are not returned by getPlaybackSession', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    await writeFile(sidPath, 'x', 'utf8');
    const { writeFile: wf } = await import('node:fs/promises');

    // Manually write a manifest with an expired session (lastAccessedAt far in the past)
    const manifestPath = path.join(tempRoot, 'data', 'playback-sessions.json');
    const expiredSession = {
      id: 'expired-id',
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
      createdAt: Date.now() - 20 * 60 * 1000,       // 20 minutes ago
      lastAccessedAt: Date.now() - 20 * 60 * 1000,  // 20 minutes ago (TTL is 15 min)
    };
    await wf(manifestPath, JSON.stringify({ version: '1.0.0', updatedAt: new Date().toISOString(), sessions: [expiredSession] }), 'utf8');

    const result = await getPlaybackSession('expired-id');
    expect(result).toBeNull();
  });

  test('valid sessions are retained alongside expired ones in manifest', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    await writeFile(sidPath, 'x', 'utf8');

    const manifestPath = path.join(tempRoot, 'data', 'playback-sessions.json');
    const now = Date.now();
    const expiredSession = {
      id: 'expired-id',
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 60,
      selectedSong: 1,
      createdAt: now - 20 * 60 * 1000,
      lastAccessedAt: now - 20 * 60 * 1000,
    };
    const activeSession = {
      id: 'active-id',
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 120,
      selectedSong: 1,
      createdAt: now - 60 * 1000,
      lastAccessedAt: now - 60 * 1000,  // 1 minute ago - still valid
    };
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(manifestPath, JSON.stringify({ version: '1.0.0', updatedAt: new Date(now).toISOString(), sessions: [expiredSession, activeSession] }), 'utf8');

    const expired = await getPlaybackSession('expired-id');
    const active = await getPlaybackSession('active-id');
    expect(expired).toBeNull();
    expect(active).not.toBeNull();
  });
});

// ─── load from file ───────────────────────────────────────────────────────────

describe('playback-session load from manifest', () => {
  let tempRoot: string;
  let originalSidflowRoot: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-ps-load-'));
    await mkdir(path.join(tempRoot, 'data'), { recursive: true });
    originalSidflowRoot = process.env.SIDFLOW_ROOT;
    process.env.SIDFLOW_ROOT = tempRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
  });

  afterEach(async () => {
    if (originalSidflowRoot === undefined) delete process.env.SIDFLOW_ROOT;
    else process.env.SIDFLOW_ROOT = originalSidflowRoot;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test('handles missing manifest file gracefully', async () => {
    const result = await getPlaybackSession('any-id');
    expect(result).toBeNull();
  });

  test('loads session created in different store instance', async () => {
    const sidPath = path.join(tempRoot, 'T.sid');
    await writeFile(sidPath, 'loaded-sid', 'utf8');
    const created = await createPlaybackSession({
      scope: 'rate',
      sidPath,
      track: createTrackInfo(sidPath),
      durationSeconds: 90,
      selectedSong: 1,
    });
    // Reset and reload
    resetPlaybackSessionStoreForTests();
    const loaded = await getPlaybackSession(created.sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded?.sidPath).toBe(sidPath);
    expect(loaded?.durationSeconds).toBe(90);
  });

  test('custom manifest path via SIDFLOW_PLAYBACK_SESSION_MANIFEST env var', async () => {
    const customPath = path.join(tempRoot, 'custom-sessions.json');
    process.env.SIDFLOW_PLAYBACK_SESSION_MANIFEST = customPath;
    resetServerEnvCacheForTests();
    resetPlaybackSessionStoreForTests();
    const sidPath = path.join(tempRoot, 'T.sid');
    await writeFile(sidPath, 'x', 'utf8');
    try {
      const created = await createPlaybackSession({
        scope: 'rate',
        sidPath,
        track: createTrackInfo(sidPath),
        durationSeconds: 60,
        selectedSong: 1,
      });
      resetPlaybackSessionStoreForTests();
      const loaded = await getPlaybackSession(created.sessionId);
      expect(loaded).not.toBeNull();
    } finally {
      delete process.env.SIDFLOW_PLAYBACK_SESSION_MANIFEST;
      resetServerEnvCacheForTests();
      resetPlaybackSessionStoreForTests();
    }
  });
});