import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { cacheTrack, listCachedTracks } from '@/lib/offline/playback-cache';
import {
  countPendingPlaybackRequests,
  enqueuePlayNext,
  enqueuePlaylistRebuild,
  flushPlaybackQueue,
} from '@/lib/offline/playback-queue';
import {
  __resetPreferencesStorageForTests,
  getPlaybackQueueRecords,
} from '@/lib/preferences/storage';
import type { RateTrackInfo } from '@/lib/api-client';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

beforeAll(() => {
  if (typeof globalThis.window === 'undefined') {
    (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
  }
  if (!globalThis.window.indexedDB) {
    (globalThis.window as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  }
  if (!globalThis.IDBKeyRange) {
    (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;
  }
  if (!globalThis.window.localStorage) {
    (globalThis.window as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
  }
});

beforeEach(async () => {
  await __resetPreferencesStorageForTests();
  const storage = globalThis.window?.localStorage as MemoryStorage | undefined;
  storage?.clear();
});

function createTrack(seed: number): RateTrackInfo {
  return {
    sidPath: `MUSICIANS/S/Seed_${seed}.sid`,
    relativePath: `Seed_${seed}.sid`,
    filename: `Seed_${seed}.sid`,
    displayName: `Seed Track ${seed}`,
    selectedSong: 1,
    metadata: {
      title: `Seed Track ${seed}`,
      author: 'Demo Author',
      released: '1986',
      songs: 1,
      startSong: 1,
      sidType: 'PSID',
      version: 2,
      sidModel: '6581',
      clock: 'PAL',
      length: '3:00',
      fileSizeBytes: 4096,
    },
    durationSeconds: 180,
  };
}

describe('playback cache', () => {
  it('stores and lists cached tracks in most-recent order', async () => {
    const trackA = createTrack(1);
    const trackB = createTrack(2);
  await cacheTrack(trackA, null, 10);
  await cacheTrack(trackB, null, 10);

    const results = await listCachedTracks(5);
    expect(results.map((entry) => entry.track.sidPath)).toEqual([
      trackB.sidPath,
      trackA.sidPath,
    ]);
  });

  it('prunes cached tracks beyond max entries', async () => {
    const trackA = createTrack(1);
    const trackB = createTrack(2);
  await cacheTrack(trackA, null, 1);
  await cacheTrack(trackB, null, 1);

    const results = await listCachedTracks(5);
    expect(results).toHaveLength(1);
    expect(results[0]?.track.sidPath).toBe(trackB.sidPath);
  });
});

describe('playback queue', () => {
  it('deduplicates rebuild requests and tracks counts', async () => {
    await enqueuePlaylistRebuild('energetic');
    await enqueuePlaylistRebuild('ambient');
    await enqueuePlayNext();

    const pending = await countPendingPlaybackRequests();
    expect(pending).toBe(2);

    const records = await getPlaybackQueueRecords();
  const rebuild = records.find((record) => record.kind === 'rebuild-playlist');
  const payload = rebuild?.payload as { preset?: string } | undefined;
  expect(payload?.preset).toBe('ambient');
  });

  it('flushes queue entries and keeps failures for retry', async () => {
    await enqueuePlaylistRebuild('dark');
    await enqueuePlayNext();

    const processedKinds: string[] = [];
    await flushPlaybackQueue(async (record) => {
      processedKinds.push(record.kind);
      if (record.kind === 'play-next') {
        throw new Error('still offline');
      }
    });

    const afterFailure = await getPlaybackQueueRecords();
    const failed = afterFailure.find((record) => record.kind === 'play-next');
    expect(failed?.status).toBe('failed');
    expect(failed?.attempts).toBe(1);
    expect(afterFailure.filter((record) => record.kind === 'rebuild-playlist')).toHaveLength(0);

    await flushPlaybackQueue(async (record) => {
      processedKinds.push(record.kind);
    });

    const remaining = await getPlaybackQueueRecords();
    expect(remaining).toHaveLength(0);
    expect(processedKinds).toContain('play-next');
    expect(processedKinds).toContain('rebuild-playlist');
  });
});
