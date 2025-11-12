import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import {
  __resetPreferencesStorageForTests,
  readPreferencesFromIndexedDb,
  storeRomBundleFile,
  writePreferencesToIndexedDb,
  loadRomBundleFile,
  removeRomBundle,
} from '@/lib/preferences/storage';
import { DEFAULT_BROWSER_PREFERENCES } from '@/lib/preferences/schema';

import 'fake-indexeddb/auto';

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
