import type { BrowserPreferences } from './schema';

const PREFERENCES_LOCAL_STORAGE_KEY = 'sidflow.preferences';
const DB_NAME = 'sidflow-local';
const DB_VERSION = 1;

const STORE_PREFERENCES = 'preferences';
const STORE_ROM_BUNDLES = 'rom-bundles';
const STORE_PLAYBACK_QUEUE = 'playback-queue';
const STORE_PLAYBACK_CACHE = 'playback-cache';

interface PreferencesRecord {
  key: 'current';
  data: BrowserPreferences;
  updatedAt: number;
}

interface RomBundleRecord {
  key: string;
  bundleId: string;
  fileName: string;
  hash: string;
  bytes: ArrayBuffer;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function hasIndexedDb(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

async function openDatabase(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) {
    throw new Error('IndexedDB is unavailable in this environment');
  }
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PREFERENCES)) {
        db.createObjectStore(STORE_PREFERENCES, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_ROM_BUNDLES)) {
        db.createObjectStore(STORE_ROM_BUNDLES, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_PLAYBACK_QUEUE)) {
        db.createObjectStore(STORE_PLAYBACK_QUEUE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_PLAYBACK_CACHE)) {
        db.createObjectStore(STORE_PLAYBACK_CACHE, { keyPath: 'sidPath' });
      }
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });

  return dbPromise;
}

export function readPreferencesFromLocalStorage(): unknown {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(PREFERENCES_LOCAL_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function deleteDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export async function __resetPreferencesStorageForTests(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // ignore
    }
  }
  dbPromise = null;
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(PREFERENCES_LOCAL_STORAGE_KEY);
  }
  await deleteDatabase();
}

export function writePreferencesToLocalStorage(preferences: BrowserPreferences): void {
  if (typeof window === 'undefined') {
    return;
  }
  const payload = JSON.stringify(preferences);
  window.localStorage.setItem(PREFERENCES_LOCAL_STORAGE_KEY, payload);
}

export async function readPreferencesFromIndexedDb(): Promise<BrowserPreferences | null> {
  try {
    const db = await openDatabase();
    return await new Promise<BrowserPreferences | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_PREFERENCES, 'readonly');
      const store = transaction.objectStore(STORE_PREFERENCES);
      const request = store.get('current');
      request.onerror = () => reject(request.error ?? new Error('Failed to read preferences'));
      request.onsuccess = () => {
        const record = request.result as PreferencesRecord | undefined;
        resolve(record ? record.data : null);
      };
    });
  } catch {
    return null;
  }
}

export async function writePreferencesToIndexedDb(preferences: BrowserPreferences): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_PREFERENCES, 'readwrite');
    const store = transaction.objectStore(STORE_PREFERENCES);
    const record: PreferencesRecord = {
      key: 'current',
      data: preferences,
      updatedAt: Date.now(),
    };
    const request = store.put(record);
    request.onerror = () => reject(request.error ?? new Error('Failed to write preferences'));
    request.onsuccess = () => resolve();
  });
}

function buildRomKey(bundleId: string, fileName: string): string {
  return `${bundleId}::${fileName}`;
}

export async function storeRomBundleFile(
  bundleId: string,
  fileName: string,
  bytes: ArrayBuffer,
  hash: string
): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_ROM_BUNDLES, 'readwrite');
    const store = transaction.objectStore(STORE_ROM_BUNDLES);
    const record: RomBundleRecord = {
      key: buildRomKey(bundleId, fileName),
      bundleId,
      fileName,
      bytes,
      hash,
      updatedAt: Date.now(),
    };
    const request = store.put(record);
    request.onerror = () => reject(request.error ?? new Error('Failed to store ROM bundle file'));
    request.onsuccess = () => resolve();
  });
}

export async function loadRomBundleFile(
  bundleId: string,
  fileName: string
): Promise<RomBundleRecord | null> {
  try {
    const db = await openDatabase();
    return await new Promise<RomBundleRecord | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_ROM_BUNDLES, 'readonly');
      const store = transaction.objectStore(STORE_ROM_BUNDLES);
      const request = store.get(buildRomKey(bundleId, fileName));
      request.onerror = () => reject(request.error ?? new Error('Failed to read ROM bundle file'));
      request.onsuccess = () => {
        resolve((request.result as RomBundleRecord | undefined) ?? null);
      };
    });
  } catch {
    return null;
  }
}

export async function removeRomBundle(bundleId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_ROM_BUNDLES, 'readwrite');
    const store = transaction.objectStore(STORE_ROM_BUNDLES);
    const request = store.openCursor();
    request.onerror = () => reject(request.error ?? new Error('Failed to iterate ROM bundle store'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const record = cursor.value as RomBundleRecord;
      if (record.bundleId === bundleId) {
        cursor.delete();
      }
      cursor.continue();
    };
  });
}

export function clearLocalStoragePreferences(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(PREFERENCES_LOCAL_STORAGE_KEY);
}
