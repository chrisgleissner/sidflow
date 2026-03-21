import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import {
  __resetPreferencesStorageForTests,
  readPreferencesFromIndexedDb,
  storeRomBundleFile,
  writePreferencesToIndexedDb,
  loadRomBundleFile,
  removeRomBundle,
  readPreferencesFromLocalStorage,
  writePreferencesToLocalStorage,
  clearLocalStoragePreferences,
  enqueuePlaybackQueueRecord,
  getPlaybackQueueRecords,
  updatePlaybackQueueRecord,
  deletePlaybackQueueRecord,
  writePlaybackCacheRecord,
  readPlaybackCacheRecord,
  listPlaybackCacheRecords,
  deletePlaybackCacheRecord,
  prunePlaybackCache,
} from '@/lib/preferences/storage';
import { DEFAULT_BROWSER_PREFERENCES } from '@/lib/preferences/schema';
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

describe('preferences storage', () => {
  it('reads null preferences when nothing stored', async () => {
    const loaded = await readPreferencesFromIndexedDb();
    expect(loaded).toBeNull();
  });

  it('round trips preferences through indexeddb', async () => {
    const preference = { ...DEFAULT_BROWSER_PREFERENCES, theme: 'c64-dark' as const };
    await writePreferencesToIndexedDb(preference);
    const loaded = await readPreferencesFromIndexedDb();
    expect(loaded?.theme).toBe('c64-dark');
  });

  it('stores and loads rom bundle files', async () => {
    const payload = new TextEncoder().encode('test');
    await storeRomBundleFile('bundle-a', 'song.sid', payload.buffer, 'abc123');
    const record = await loadRomBundleFile('bundle-a', 'song.sid');
    expect(record?.bundleId).toBe('bundle-a');
    expect(record?.hash).toBe('abc123');
    expect(new Uint8Array(record?.bytes ?? []).length).toBe(payload.length);
  });

  it('removes rom bundle data by bundle id', async () => {
    const payload = new TextEncoder().encode('test');
    await storeRomBundleFile('bundle-a', 'song.sid', payload.buffer, 'abc123');
    await removeRomBundle('bundle-a');
    const record = await loadRomBundleFile('bundle-a', 'song.sid');
    expect(record).toBeNull();
  });
});

// ─── localStorage helpers ────────────────────────────────────────────────────

describe('localStorage preferences', () => {
  it('returns null when nothing stored in localStorage', () => {
    expect(readPreferencesFromLocalStorage()).toBeNull();
  });

  it('round-trips preferences through localStorage', () => {
    const prefs = { ...DEFAULT_BROWSER_PREFERENCES, theme: 'c64-dark' as const };
    writePreferencesToLocalStorage(prefs);
    const loaded = readPreferencesFromLocalStorage() as typeof prefs;
    expect(loaded?.theme).toBe('c64-dark');
  });

  it('clearLocalStoragePreferences removes persisted data', () => {
    writePreferencesToLocalStorage(DEFAULT_BROWSER_PREFERENCES);
    clearLocalStoragePreferences();
    expect(readPreferencesFromLocalStorage()).toBeNull();
  });

  it('loadRomBundleFile returns null when file not stored', async () => {
    const result = await loadRomBundleFile('nonexistent-bundle', 'missing.sid');
    expect(result).toBeNull();
  });
});

// ─── playback queue ───────────────────────────────────────────────────────────

describe('playback queue', () => {
  it('returns empty array when no records', async () => {
    const records = await getPlaybackQueueRecords();
    expect(records).toHaveLength(0);
  });

  it('enqueues and retrieves a record', async () => {
    const id = await enqueuePlaybackQueueRecord({
      kind: 'play-next',
      payload: { sidPath: '/test.sid' },
    });
    expect(typeof id).toBe('number');
    const records = await getPlaybackQueueRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.kind).toBe('play-next');
    expect(records[0]?.status).toBe('pending');
    expect(records[0]?.attempts).toBe(0);
  });

  it('enqueues a rebuild-playlist record', async () => {
    await enqueuePlaybackQueueRecord({
      kind: 'rebuild-playlist',
      payload: { seed: 'energetic' },
    });
    const records = await getPlaybackQueueRecords();
    expect(records[0]?.kind).toBe('rebuild-playlist');
  });

  it('updates a playback queue record', async () => {
    const id = await enqueuePlaybackQueueRecord({
      kind: 'play-next',
      payload: {},
    });
    const records = await getPlaybackQueueRecords();
    const record = records.find((r) => r.id === id);
    expect(record).toBeDefined();
    if (!record) return;
    record.status = 'failed';
    record.attempts = 1;
    record.lastError = 'test error';
    await updatePlaybackQueueRecord(record);
    const updated = await getPlaybackQueueRecords();
    const found = updated.find((r) => r.id === id);
    expect(found?.status).toBe('failed');
    expect(found?.attempts).toBe(1);
    expect(found?.lastError).toBe('test error');
  });

  it('throws when updating a record without an id', async () => {
    const record = {
      kind: 'play-next' as const,
      payload: {},
      status: 'pending' as const,
      enqueuedAt: Date.now(),
      attempts: 0,
    };
    await expect(updatePlaybackQueueRecord(record)).rejects.toThrow('must have an id');
  });

  it('deletes a playback queue record by id', async () => {
    const id = await enqueuePlaybackQueueRecord({
      kind: 'play-next',
      payload: {},
    });
    await deletePlaybackQueueRecord(id);
    const records = await getPlaybackQueueRecords();
    expect(records.find((r) => r.id === id)).toBeUndefined();
  });

  it('enqueues multiple records and retrieves all', async () => {
    await enqueuePlaybackQueueRecord({ kind: 'play-next', payload: { a: 1 } });
    await enqueuePlaybackQueueRecord({ kind: 'rebuild-playlist', payload: { b: 2 } });
    const records = await getPlaybackQueueRecords();
    expect(records).toHaveLength(2);
  });
});

// ─── playback cache ───────────────────────────────────────────────────────────

describe('playback cache', () => {
  it('returns null when cache miss', async () => {
    const result = await readPlaybackCacheRecord('/missing.sid');
    expect(result).toBeNull();
  });

  it('returns empty array when no cache entries', async () => {
    const records = await listPlaybackCacheRecords();
    expect(records).toHaveLength(0);
  });

  it('round-trips a cache record', async () => {
    await writePlaybackCacheRecord({
      sidPath: '/hvsc/Test/Song.sid',
      data: { duration: 180 },
      updatedAt: 1000,
    });
    const record = await readPlaybackCacheRecord<{ duration: number }>('/hvsc/Test/Song.sid');
    expect(record?.sidPath).toBe('/hvsc/Test/Song.sid');
    expect((record?.data as Record<string, unknown>)?.duration).toBe(180);
  });

  it('lists multiple cache records', async () => {
    await writePlaybackCacheRecord({ sidPath: '/a.sid', data: 'a', updatedAt: 1 });
    await writePlaybackCacheRecord({ sidPath: '/b.sid', data: 'b', updatedAt: 2 });
    const records = await listPlaybackCacheRecords();
    expect(records).toHaveLength(2);
  });

  it('overwrites an existing cache record', async () => {
    await writePlaybackCacheRecord({ sidPath: '/x.sid', data: 'v1', updatedAt: 100 });
    await writePlaybackCacheRecord({ sidPath: '/x.sid', data: 'v2', updatedAt: 200 });
    const record = await readPlaybackCacheRecord<string>('/x.sid');
    expect(record?.data).toBe('v2');
  });

  it('deletes a cache record', async () => {
    await writePlaybackCacheRecord({ sidPath: '/del.sid', data: 'delete-me', updatedAt: 1 });
    await deletePlaybackCacheRecord('/del.sid');
    const result = await readPlaybackCacheRecord('/del.sid');
    expect(result).toBeNull();
  });

  it('prunePlaybackCache clears all entries when maxEntries is 0', async () => {
    await writePlaybackCacheRecord({ sidPath: '/a.sid', data: 'a', updatedAt: 1 });
    await writePlaybackCacheRecord({ sidPath: '/b.sid', data: 'b', updatedAt: 2 });
    await prunePlaybackCache(0);
    const records = await listPlaybackCacheRecords();
    expect(records).toHaveLength(0);
  });

  it('prunePlaybackCache keeps the newest entries up to maxEntries', async () => {
    for (let i = 0; i < 5; i++) {
      await writePlaybackCacheRecord({ sidPath: `/t${i}.sid`, data: i, updatedAt: i });
    }
    await prunePlaybackCache(2);
    const records = await listPlaybackCacheRecords();
    expect(records).toHaveLength(2);
    // The two most recent (updatedAt 4, 3) should remain
    const paths = records.map((r) => r.sidPath).sort();
    expect(paths).toContain('/t4.sid');
    expect(paths).toContain('/t3.sid');
  });

  it('prunePlaybackCache is a no-op when entries <= maxEntries', async () => {
    await writePlaybackCacheRecord({ sidPath: '/only.sid', data: 42, updatedAt: 1 });
    await prunePlaybackCache(5);
    const records = await listPlaybackCacheRecords();
    expect(records).toHaveLength(1);
  });

  it('stores an expiresAt value and returns it', async () => {
    const future = Date.now() + 3600 * 1000;
    await writePlaybackCacheRecord({ sidPath: '/exp.sid', data: 'test', updatedAt: Date.now(), expiresAt: future });
    const record = await readPlaybackCacheRecord('/exp.sid');
    expect(record?.expiresAt).toBe(future);
  });
});
