import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createPlaybackSession,
  findLatestSessionByScope,
  getPlaybackSession,
  resetPlaybackSessionStoreForTests,
} from '@/lib/playback-session';
import { resetServerEnvCacheForTests } from '@/lib/server-env';
import type { RateTrackInfo } from '@/lib/types/rate-track';

function createTrackInfo(sidPath: string): RateTrackInfo {
  return {
    sidPath,
    relativePath: 'C64Music/Test/Track.sid',
    filename: 'Track.sid',
    displayName: 'Track',
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
});