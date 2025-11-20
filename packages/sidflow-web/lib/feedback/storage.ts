import type { FeedbackAction } from '@sidflow/common';
import type { TagRatings } from '@sidflow/common';

const DB_NAME = 'sidflow-feedback';
const DB_VERSION = 1;

const STORE_RATINGS = 'ratings';
const STORE_IMPLICIT_EVENTS = 'implicit-events';
const STORE_MODEL_SNAPSHOTS = 'model-snapshots';

interface StoreIndexDefinition {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
}

export type FeedbackSyncStatus = 'pending' | 'processing' | 'synced' | 'failed';

export interface RatingEventRecord {
  id?: number;
  uuid: string;
  sidPath: string;
  songIndex?: number | null;
  timestamp: number;
  ratings: TagRatings;
  source: 'explicit' | 'implicit';
  modelVersion?: string | null;
  metadata?: Record<string, unknown> | null;
  syncStatus: FeedbackSyncStatus;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: number;
}

export interface ImplicitFeedbackRecord {
  id?: number;
  uuid: string;
  sidPath: string;
  songIndex?: number | null;
  timestamp: number;
  action: FeedbackAction;
  metadata?: Record<string, unknown> | null;
  syncStatus: FeedbackSyncStatus;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: number;
}

export interface ModelSnapshotRecord {
  id?: number;
  modelVersion: string;
  createdAt: number;
  metadata?: Record<string, unknown> | null;
  weights?: ArrayBuffer;
}

export type RatingEventInsert = Omit<RatingEventRecord, 'id' | 'syncStatus' | 'attempts' | 'lastError' | 'lastAttemptAt'> &
  Partial<Pick<RatingEventRecord, 'syncStatus' | 'attempts' | 'lastError' | 'lastAttemptAt'>>;

export type ImplicitEventInsert = Omit<ImplicitFeedbackRecord, 'id' | 'syncStatus' | 'attempts' | 'lastError' | 'lastAttemptAt'> &
  Partial<Pick<ImplicitFeedbackRecord, 'syncStatus' | 'attempts' | 'lastError' | 'lastAttemptAt'>>;

export type FeedbackSyncStatusCounts = Record<FeedbackSyncStatus, number>;

export type ModelSnapshotInsert = Omit<ModelSnapshotRecord, 'id' | 'createdAt'> & Partial<Pick<ModelSnapshotRecord, 'createdAt'>>;

let dbPromise: Promise<IDBDatabase> | null = null;

function resolveIndexedDb(): IDBFactory | null {
  if (typeof indexedDB !== 'undefined' && indexedDB) {
    return indexedDB;
  }
  if (typeof window !== 'undefined' && window.indexedDB) {
    return window.indexedDB;
  }
  return null;
}

function hasIndexedDb(): boolean {
  return resolveIndexedDb() !== null;
}

function createIndexes(store: IDBObjectStore, indexes: StoreIndexDefinition[]): void {
  for (const index of indexes) {
    if (!store.indexNames.contains(index.name)) {
      store.createIndex(index.name, index.keyPath, { unique: index.unique ?? false });
    }
  }
}

async function openDatabase(): Promise<IDBDatabase> {
  const indexedDb = resolveIndexedDb();
  if (!indexedDb) {
    throw new Error('IndexedDB is unavailable in this environment');
  }
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_RATINGS)) {
        const store = db.createObjectStore(STORE_RATINGS, { keyPath: 'id', autoIncrement: true });
        createIndexes(store, [
          { name: 'uuid', keyPath: 'uuid', unique: true },
          { name: 'sidPath', keyPath: 'sidPath' },
          { name: 'timestamp', keyPath: 'timestamp' },
          { name: 'syncStatus', keyPath: 'syncStatus' },
        ]);
      }
      if (!db.objectStoreNames.contains(STORE_IMPLICIT_EVENTS)) {
        const store = db.createObjectStore(STORE_IMPLICIT_EVENTS, { keyPath: 'id', autoIncrement: true });
        createIndexes(store, [
          { name: 'uuid', keyPath: 'uuid', unique: true },
          { name: 'sidPath', keyPath: 'sidPath' },
          { name: 'timestamp', keyPath: 'timestamp' },
          { name: 'syncStatus', keyPath: 'syncStatus' },
        ]);
      }
      if (!db.objectStoreNames.contains(STORE_MODEL_SNAPSHOTS)) {
        const store = db.createObjectStore(STORE_MODEL_SNAPSHOTS, { keyPath: 'id', autoIncrement: true });
        createIndexes(store, [
          { name: 'modelVersion', keyPath: 'modelVersion' },
          { name: 'createdAt', keyPath: 'createdAt' },
        ]);
      }
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open feedback IndexedDB'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });

  return dbPromise;
}

async function runTransaction<T>(storeName: string, mode: IDBTransactionMode, handler: (store: IDBObjectStore) => T | Promise<T>): Promise<T> {
  const db = await openDatabase();
  return await new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let finished = false;

    const finish = (result: T) => {
      if (!finished) {
        finished = true;
        resolve(result);
      }
    };

    const fail = (error: unknown) => {
      if (!finished) {
        finished = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    transaction.oncomplete = () => {
      if (!finished) {
        finished = true;
        resolve(undefined as unknown as T);
      }
    };
    transaction.onerror = () => {
      fail(transaction.error ?? new Error('IndexedDB transaction error'));
    };
    transaction.onabort = () => {
      fail(transaction.error ?? new Error('IndexedDB transaction aborted'));
    };

    Promise.resolve(handler(store)).then(finish).catch(fail);
  });
}

function mapRatingInsert(input: RatingEventInsert): RatingEventRecord {
  return {
    uuid: input.uuid,
    sidPath: input.sidPath,
    songIndex: input.songIndex ?? null,
    timestamp: input.timestamp ?? Date.now(),
    ratings: input.ratings,
    source: input.source ?? 'explicit',
    modelVersion: input.modelVersion ?? null,
    metadata: input.metadata ?? null,
    syncStatus: input.syncStatus ?? 'pending',
    attempts: input.attempts ?? 0,
    lastError: input.lastError,
    lastAttemptAt: input.lastAttemptAt,
  };
}

function mapImplicitInsert(input: ImplicitEventInsert): ImplicitFeedbackRecord {
  return {
    uuid: input.uuid,
    sidPath: input.sidPath,
    songIndex: input.songIndex ?? null,
    timestamp: input.timestamp ?? Date.now(),
    action: input.action,
    metadata: input.metadata ?? null,
    syncStatus: input.syncStatus ?? 'pending',
    attempts: input.attempts ?? 0,
    lastError: input.lastError,
    lastAttemptAt: input.lastAttemptAt,
  };
}

export async function enqueueRatingEvents(records: RatingEventInsert[]): Promise<number[]> {
  if (records.length === 0) {
    return [];
  }
  const ids: number[] = [];
  await runTransaction(STORE_RATINGS, 'readwrite', (store) => {
    for (const record of records) {
      const mapped = mapRatingInsert(record);
      const request = store.add(mapped);
      request.onsuccess = () => {
        ids.push(request.result as number);
      };
    }
  });
  return ids;
}

export async function enqueueImplicitEvents(records: ImplicitEventInsert[]): Promise<number[]> {
  if (records.length === 0) {
    return [];
  }
  const ids: number[] = [];
  await runTransaction(STORE_IMPLICIT_EVENTS, 'readwrite', (store) => {
    for (const record of records) {
      const mapped = mapImplicitInsert(record);
      const request = store.add(mapped);
      request.onsuccess = () => {
        ids.push(request.result as number);
      };
    }
  });
  return ids;
}

export async function listRatingEventsByStatus(statuses: FeedbackSyncStatus[], limit?: number): Promise<RatingEventRecord[]> {
  if (statuses.length === 0) {
    return [];
  }
  const db = await openDatabase();
  return await new Promise<RatingEventRecord[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_RATINGS, 'readonly');
    const store = transaction.objectStore(STORE_RATINGS);
    const index = store.index('syncStatus');
    const results: RatingEventRecord[] = [];

    const iterate = (statusIndex: number) => {
      if (statusIndex >= statuses.length) {
        resolve(results);
        return;
      }
      const status = statuses[statusIndex];
      const request = index.openCursor(IDBKeyRange.only(status));
      request.onerror = () => reject(request.error ?? new Error('Failed to iterate rating events'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          iterate(statusIndex + 1);
          return;
        }
        results.push(cursor.value as RatingEventRecord);
        if (typeof limit === 'number' && results.length >= limit) {
          resolve(results.slice(0, limit));
          return;
        }
        cursor.continue();
      };
    };

    iterate(0);
  });
}

export async function listImplicitEventsByStatus(statuses: FeedbackSyncStatus[], limit?: number): Promise<ImplicitFeedbackRecord[]> {
  if (statuses.length === 0) {
    return [];
  }
  const db = await openDatabase();
  return await new Promise<ImplicitFeedbackRecord[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_IMPLICIT_EVENTS, 'readonly');
    const store = transaction.objectStore(STORE_IMPLICIT_EVENTS);
    const index = store.index('syncStatus');
    const results: ImplicitFeedbackRecord[] = [];

    const iterate = (statusIndex: number) => {
      if (statusIndex >= statuses.length) {
        resolve(results);
        return;
      }
      const status = statuses[statusIndex];
      const request = index.openCursor(IDBKeyRange.only(status));
      request.onerror = () => reject(request.error ?? new Error('Failed to iterate implicit events'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          iterate(statusIndex + 1);
          return;
        }
        results.push(cursor.value as ImplicitFeedbackRecord);
        if (typeof limit === 'number' && results.length >= limit) {
          resolve(results.slice(0, limit));
          return;
        }
        cursor.continue();
      };
    };

    iterate(0);
  });
}

async function updateRecord<T extends RatingEventRecord | ImplicitFeedbackRecord>(storeName: string, record: T): Promise<void> {
  if (typeof record.id !== 'number') {
    throw new Error('Record must have an id to update');
  }
  await runTransaction(storeName, 'readwrite', (store) => {
    const request = store.put(record);
    request.onerror = () => {
      throw request.error ?? new Error('Failed to update record');
    };
  });
}

export async function updateRatingEvent(record: RatingEventRecord): Promise<void> {
  await updateRecord(STORE_RATINGS, record);
}

export async function updateImplicitEvent(record: ImplicitFeedbackRecord): Promise<void> {
  await updateRecord(STORE_IMPLICIT_EVENTS, record);
}

async function deleteRecord(storeName: string, id: number): Promise<void> {
  await runTransaction(storeName, 'readwrite', (store) => {
    const request = store.delete(id);
    request.onerror = () => {
      throw request.error ?? new Error('Failed to delete record');
    };
  });
}

export async function deleteRatingEvent(id: number): Promise<void> {
  await deleteRecord(STORE_RATINGS, id);
}

export async function deleteImplicitEvent(id: number): Promise<void> {
  await deleteRecord(STORE_IMPLICIT_EVENTS, id);
}

export async function listRatingEventCountByStatus(): Promise<FeedbackSyncStatusCounts> {
  const db = await openDatabase();
  return await new Promise<FeedbackSyncStatusCounts>((resolve, reject) => {
    const transaction = db.transaction(STORE_RATINGS, 'readonly');
    const index = transaction.objectStore(STORE_RATINGS).index('syncStatus');
    const counts: FeedbackSyncStatusCounts = { pending: 0, processing: 0, synced: 0, failed: 0 };
    let remaining = 4;

    (Object.keys(counts) as FeedbackSyncStatus[]).forEach((status) => {
      const request = index.count(IDBKeyRange.only(status));
      request.onerror = () => reject(request.error ?? new Error('Failed to count rating events'));
      request.onsuccess = () => {
        counts[status] = request.result;
        remaining -= 1;
        if (remaining === 0) {
          resolve(counts);
        }
      };
    });
  });
}

export async function listImplicitEventCountByStatus(): Promise<FeedbackSyncStatusCounts> {
  const db = await openDatabase();
  return await new Promise<FeedbackSyncStatusCounts>((resolve, reject) => {
    const transaction = db.transaction(STORE_IMPLICIT_EVENTS, 'readonly');
    const index = transaction.objectStore(STORE_IMPLICIT_EVENTS).index('syncStatus');
    const counts: FeedbackSyncStatusCounts = { pending: 0, processing: 0, synced: 0, failed: 0 };
    let remaining = 4;

    (Object.keys(counts) as FeedbackSyncStatus[]).forEach((status) => {
      const request = index.count(IDBKeyRange.only(status));
      request.onerror = () => reject(request.error ?? new Error('Failed to count implicit events'));
      request.onsuccess = () => {
        counts[status] = request.result;
        remaining -= 1;
        if (remaining === 0) {
          resolve(counts);
        }
      };
    });
  });
}

export async function listRatingEventsForTraining(sidPath?: string, limit = 500): Promise<RatingEventRecord[]> {
  const db = await openDatabase();
  return await new Promise<RatingEventRecord[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_RATINGS, 'readonly');
    const index = transaction.objectStore(STORE_RATINGS).index('timestamp');
    const results: RatingEventRecord[] = [];
    const request = index.openCursor(null, 'prev');

    request.onerror = () => reject(request.error ?? new Error('Failed to read rating events for training'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(results);
        return;
      }
      const value = cursor.value as RatingEventRecord;
      if (!sidPath || value.sidPath === sidPath) {
        results.push(value);
        if (results.length >= limit) {
          resolve(results.slice(0, limit));
          return;
        }
      }
      cursor.continue();
    };
  });
}

export async function storeModelSnapshot(snapshot: ModelSnapshotInsert): Promise<number> {
  let insertedId = -1;
  await runTransaction(STORE_MODEL_SNAPSHOTS, 'readwrite', (store) => {
    const record: ModelSnapshotRecord = {
      modelVersion: snapshot.modelVersion,
      createdAt: snapshot.createdAt ?? Date.now(),
      metadata: snapshot.metadata ?? null,
      weights: snapshot.weights,
    };

    return new Promise<void>((resolve, reject) => {
      const index = store.index('modelVersion');
      const cursorRequest = index.openCursor(IDBKeyRange.only(record.modelVersion));

      cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Failed to prepare model snapshot insert'));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          const deleteRequest = cursor.delete();
          deleteRequest.onerror = () => reject(deleteRequest.error ?? new Error('Failed to clear previous model snapshot'));
          deleteRequest.onsuccess = () => {
            cursor.continue();
          };
          return;
        }
        const addRequest = store.add(record);
        addRequest.onerror = () => reject(addRequest.error ?? new Error('Failed to store model snapshot'));
        addRequest.onsuccess = () => {
          insertedId = addRequest.result as number;
          resolve();
        };
      };
    });
  });
  return insertedId;
}

export async function readLatestModelSnapshot(): Promise<ModelSnapshotRecord | null> {
  const db = await openDatabase();
  return await new Promise<ModelSnapshotRecord | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_MODEL_SNAPSHOTS, 'readonly');
    const index = transaction.objectStore(STORE_MODEL_SNAPSHOTS).index('createdAt');
    const request = index.openCursor(null, 'prev');
    request.onerror = () => reject(request.error ?? new Error('Failed to read latest model snapshot'));
    request.onsuccess = () => {
      const cursor = request.result;
      resolve(cursor ? (cursor.value as ModelSnapshotRecord) : null);
    };
  });
}

async function deleteDatabase(): Promise<void> {
  const indexedDb = resolveIndexedDb();
  if (!indexedDb) {
    return;
  }
  await new Promise<void>((resolve) => {
    const request = indexedDb.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export async function __resetFeedbackStorageForTests(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // ignore
    }
  }
  dbPromise = null;
  await deleteDatabase();
}
