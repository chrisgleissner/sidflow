/**
 * Lightweight IndexedDB mock for testing
 * Implements core IDB interfaces with in-memory storage
 */

interface MockStore {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  data: Map<IDBValidKey, unknown>;
  indexes: Map<string, MockIndex>;
}

interface MockIndex {
  name: string;
  keyPath: string | string[];
  unique: boolean;
  data: Map<IDBValidKey, Set<IDBValidKey>>;
}

class MockIDBRequest implements IDBRequest {
  result: unknown = undefined;
  error: DOMException | null = null;
  source: IDBObjectStore | IDBIndex | IDBCursor | null = null;
  transaction: IDBTransaction | null = null;
  readyState: IDBRequestReadyState = 'pending';
  
  onsuccess: ((this: IDBRequest, ev: Event) => void) | null = null;
  onerror: ((this: IDBRequest, ev: Event) => void) | null = null;

  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean { return true; }

  _resolve(value: unknown): void {
    this.result = value;
    this.readyState = 'done';
    if (this.onsuccess) {
      this.onsuccess.call(this, new Event('success'));
    }
  }

  _reject(error: DOMException): void {
    this.error = error;
    this.readyState = 'done';
    if (this.onerror) {
      this.onerror.call(this, new Event('error'));
    }
  }
}

class MockIDBObjectStore implements IDBObjectStore {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexNames: DOMStringList;
  transaction: IDBTransaction;

  private store: MockStore;

  constructor(store: MockStore, transaction: IDBTransaction) {
    this.store = store;
    this.name = store.name;
    this.keyPath = store.keyPath;
    this.autoIncrement = store.autoIncrement;
    this.transaction = transaction;
    this.indexNames = {
      length: store.indexes.size,
      contains: (name: string) => store.indexes.has(name),
      item: (index: number) => Array.from(store.indexes.keys())[index] ?? null,
      [Symbol.iterator]: function* () {
        yield* store.indexes.keys();
      }
    } as DOMStringList;
  }

  add(value: unknown, key?: IDBValidKey): IDBRequest {
    const request = new MockIDBRequest();
    request.source = this;
    request.transaction = this.transaction;

    setTimeout(() => {
      try {
        const finalKey = key ?? this._extractKey(value) ?? this._generateKey();
        if (this.store.data.has(finalKey)) {
          request._reject(new DOMException('Key already exists', 'ConstraintError'));
        } else {
          this.store.data.set(finalKey, value);
          this._updateIndexes(finalKey, value);
          request._resolve(finalKey);
        }
      } catch (err) {
        request._reject(new DOMException((err as Error).message, 'DataError'));
      }
    }, 0);

    return request;
  }

  put(value: unknown, key?: IDBValidKey): IDBRequest {
    const request = new MockIDBRequest();
    request.source = this;
    request.transaction = this.transaction;

    setTimeout(() => {
      try {
        const finalKey = key ?? this._extractKey(value) ?? this._generateKey();
        this.store.data.set(finalKey, value);
        this._updateIndexes(finalKey, value);
        request._resolve(finalKey);
      } catch (err) {
        request._reject(new DOMException((err as Error).message, 'DataError'));
      }
    }, 0);

    return request;
  }

  get(key: IDBValidKey): IDBRequest {
    const request = new MockIDBRequest();
    request.source = this;
    request.transaction = this.transaction;

    setTimeout(() => {
      const value = this.store.data.get(key);
      request._resolve(value);
    }, 0);

    return request;
  }

  getAll(query?: IDBValidKey | IDBKeyRange | null, count?: number): IDBRequest {
    const request = new MockIDBRequest();
    request.source = this;
    request.transaction = this.transaction;

    setTimeout(() => {
      const values = Array.from(this.store.data.values());
      const limited = count ? values.slice(0, count) : values;
      request._resolve(limited);
    }, 0);

    return request;
  }

  delete(key: IDBValidKey | IDBKeyRange): IDBRequest {
    const request = new MockIDBRequest();
    request.source = this;
    request.transaction = this.transaction;

    setTimeout(() => {
      this.store.data.delete(key as IDBValidKey);
      request._resolve(undefined);
    }, 0);

    return request;
  }

  clear(): IDBRequest {
    const request = new MockIDBRequest();
    request.source = this;
    request.transaction = this.transaction;

    setTimeout(() => {
      this.store.data.clear();
      this.store.indexes.forEach(index => index.data.clear());
      request._resolve(undefined);
    }, 0);

    return request;
  }

  createIndex(name: string, keyPath: string | string[], options?: IDBIndexParameters): IDBIndex {
    const index: MockIndex = {
      name,
      keyPath,
      unique: options?.unique ?? false,
      data: new Map()
    };
    this.store.indexes.set(name, index);
    return this.index(name);
  }

  deleteIndex(name: string): void {
    this.store.indexes.delete(name);
  }

  index(name: string): IDBIndex {
    const index = this.store.indexes.get(name);
    if (!index) {
      throw new DOMException(`Index '${name}' does not exist`, 'NotFoundError');
    }
    return new MockIDBIndex(index, this.transaction);
  }

  count(): IDBRequest {
    const request = new MockIDBRequest();
    request.source = this;
    request.transaction = this.transaction;

    setTimeout(() => {
      request._resolve(this.store.data.size);
    }, 0);

    return request;
  }

  openCursor(): IDBRequest {
    throw new Error('openCursor not implemented in mock');
  }

  openKeyCursor(): IDBRequest {
    throw new Error('openKeyCursor not implemented in mock');
  }

  getAllKeys(): IDBRequest {
    throw new Error('getAllKeys not implemented in mock');
  }

  getKey(): IDBRequest {
    throw new Error('getKey not implemented in mock');
  }

  private _extractKey(value: unknown): IDBValidKey | undefined {
    if (!this.keyPath || typeof value !== 'object' || value === null) {
      return undefined;
    }
    const path = typeof this.keyPath === 'string' ? this.keyPath : this.keyPath[0];
    return (value as Record<string, unknown>)[path] as IDBValidKey | undefined;
  }

  private _generateKey(): IDBValidKey {
    if (!this.autoIncrement) {
      throw new Error('Key required for non-autoIncrement store');
    }
    return this.store.data.size + 1;
  }

  private _updateIndexes(key: IDBValidKey, value: unknown): void {
    // Simplified: assumes value is object with index key paths
    this.store.indexes.forEach((index) => {
      const indexKey = this._extractIndexKey(value, index.keyPath);
      if (indexKey !== undefined) {
        let keys = index.data.get(indexKey);
        if (!keys) {
          keys = new Set();
          index.data.set(indexKey, keys);
        }
        keys.add(key);
      }
    });
  }

  private _extractIndexKey(value: unknown, keyPath: string | string[]): IDBValidKey | undefined {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const path = typeof keyPath === 'string' ? keyPath : keyPath[0];
    return (value as Record<string, unknown>)[path] as IDBValidKey | undefined;
  }
}

class MockIDBIndex implements IDBIndex {
  name: string;
  keyPath: string | string[];
  unique: boolean;
  objectStore: IDBObjectStore;

  private index: MockIndex;
  private transaction: IDBTransaction;

  constructor(index: MockIndex, transaction: IDBTransaction) {
    this.index = index;
    this.name = index.name;
    this.keyPath = index.keyPath;
    this.unique = index.unique;
    this.transaction = transaction;
    this.objectStore = null as unknown as IDBObjectStore; // Set externally if needed
  }

  get(key: IDBValidKey): IDBRequest {
    const request = new MockIDBRequest();
    setTimeout(() => {
      const keys = this.index.data.get(key);
      request._resolve(keys ? Array.from(keys)[0] : undefined);
    }, 0);
    return request;
  }

  getAll(): IDBRequest {
    const request = new MockIDBRequest();
    setTimeout(() => {
      const allKeys = Array.from(this.index.data.values()).flatMap(set => Array.from(set));
      request._resolve(allKeys);
    }, 0);
    return request;
  }

  count(): IDBRequest {
    throw new Error('count not implemented in MockIDBIndex');
  }

  getKey(): IDBRequest {
    throw new Error('getKey not implemented in MockIDBIndex');
  }

  getAllKeys(): IDBRequest {
    throw new Error('getAllKeys not implemented in MockIDBIndex');
  }

  openCursor(): IDBRequest {
    throw new Error('openCursor not implemented in MockIDBIndex');
  }

  openKeyCursor(): IDBRequest {
    throw new Error('openKeyCursor not implemented in MockIDBIndex');
  }
}

class MockIDBTransaction implements IDBTransaction {
  db: IDBDatabase;
  mode: IDBTransactionMode;
  objectStoreNames: DOMStringList;
  error: DOMException | null = null;
  durability: IDBTransactionDurability = 'default';

  onabort: ((this: IDBTransaction, ev: Event) => void) | null = null;
  oncomplete: ((this: IDBTransaction, ev: Event) => void) | null = null;
  onerror: ((this: IDBTransaction, ev: Event) => void) | null = null;

  private stores: Map<string, MockStore>;
  private completed = false;

  constructor(db: IDBDatabase, mode: IDBTransactionMode, storeNames: string[], stores: Map<string, MockStore>) {
    this.db = db;
    this.mode = mode;
    this.stores = stores;
    this.objectStoreNames = {
      length: storeNames.length,
      contains: (name: string) => storeNames.includes(name),
      item: (index: number) => storeNames[index] ?? null,
      [Symbol.iterator]: function* () {
        yield* storeNames;
      }
    } as DOMStringList;

    // Auto-complete after event loop
    setTimeout(() => {
      if (!this.completed) {
        this.commit();
      }
    }, 10);
  }

  objectStore(name: string): IDBObjectStore {
    const store = this.stores.get(name);
    if (!store) {
      throw new DOMException(`Object store '${name}' does not exist`, 'NotFoundError');
    }
    return new MockIDBObjectStore(store, this);
  }

  commit(): void {
    if (this.completed) return;
    this.completed = true;
    if (this.oncomplete) {
      this.oncomplete.call(this, new Event('complete'));
    }
  }

  abort(): void {
    if (this.completed) return;
    this.completed = true;
    if (this.onabort) {
      this.onabort.call(this, new Event('abort'));
    }
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean { return true; }
}

class MockIDBDatabase implements IDBDatabase {
  name: string;
  version: number;
  objectStoreNames: DOMStringList;

  onabort: ((this: IDBDatabase, ev: Event) => void) | null = null;
  onclose: ((this: IDBDatabase, ev: Event) => void) | null = null;
  onerror: ((this: IDBDatabase, ev: Event) => void) | null = null;
  onversionchange: ((this: IDBDatabase, ev: IDBVersionChangeEvent) => void) | null = null;

  private stores: Map<string, MockStore>;

  constructor(name: string, version: number) {
    this.name = name;
    this.version = version;
    this.stores = new Map();
    this.objectStoreNames = {
      length: 0,
      contains: (name: string) => this.stores.has(name),
      item: (index: number) => Array.from(this.stores.keys())[index] ?? null,
      [Symbol.iterator]: function* () {
        yield* this.stores.keys();
      }
    } as DOMStringList;
  }

  createObjectStore(name: string, options?: IDBObjectStoreParameters): IDBObjectStore {
    if (this.stores.has(name)) {
      throw new DOMException(`Object store '${name}' already exists`, 'ConstraintError');
    }

    const store: MockStore = {
      name,
      keyPath: options?.keyPath ?? null,
      autoIncrement: options?.autoIncrement ?? false,
      data: new Map(),
      indexes: new Map()
    };

    this.stores.set(name, store);
    (this.objectStoreNames as { length: number }).length = this.stores.size;

    return new MockIDBObjectStore(store, null as unknown as IDBTransaction);
  }

  deleteObjectStore(name: string): void {
    this.stores.delete(name);
    (this.objectStoreNames as { length: number }).length = this.stores.size;
  }

  transaction(storeNames: string | string[], mode: IDBTransactionMode = 'readonly'): IDBTransaction {
    const names = typeof storeNames === 'string' ? [storeNames] : storeNames;
    return new MockIDBTransaction(this, mode, names, this.stores);
  }

  close(): void {
    if (this.onclose) {
      this.onclose.call(this, new Event('close'));
    }
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean { return true; }
}

class MockIDBFactory implements IDBFactory {
  private databases: Map<string, MockIDBDatabase> = new Map();

  open(name: string, version?: number): IDBOpenDBRequest {
    const request = new MockIDBRequest() as IDBOpenDBRequest;

    setTimeout(() => {
      const existingDb = this.databases.get(name);
      const currentVersion = existingDb?.version ?? 0;
      const targetVersion = version ?? currentVersion || 1;

      if (targetVersion < currentVersion) {
        request._reject(new DOMException('Version error', 'VersionError'));
        return;
      }

      let db = existingDb;
      if (!db || targetVersion > currentVersion) {
        db = new MockIDBDatabase(name, targetVersion);
        this.databases.set(name, db);

        // Trigger upgrade
        if (request.onupgradeneeded) {
          const upgradeEvent = new Event('upgradeneeded') as IDBVersionChangeEvent;
          Object.defineProperty(upgradeEvent, 'oldVersion', { value: currentVersion });
          Object.defineProperty(upgradeEvent, 'newVersion', { value: targetVersion });
          Object.defineProperty(request, 'result', { value: db, configurable: true });
          Object.defineProperty(request, 'transaction', {
            value: db.transaction([], 'versionchange'),
            configurable: true
          });
          request.onupgradeneeded.call(request, upgradeEvent);
        }
      }

      request._resolve(db);
    }, 0);

    return request as IDBOpenDBRequest;
  }

  deleteDatabase(name: string): IDBOpenDBRequest {
    const request = new MockIDBRequest() as IDBOpenDBRequest;
    setTimeout(() => {
      this.databases.delete(name);
      request._resolve(undefined);
    }, 0);
    return request as IDBOpenDBRequest;
  }

  databases(): Promise<IDBDatabaseInfo[]> {
    return Promise.resolve(
      Array.from(this.databases.entries()).map(([name, db]) => ({
        name,
        version: db.version
      }))
    );
  }

  cmp(first: unknown, second: unknown): number {
    if (first === second) return 0;
    return first! < second! ? -1 : 1;
  }
}

/**
 * Install IndexedDB mock in global scope
 */
export function installIndexedDBMock(): MockIDBFactory {
  const mockFactory = new MockIDBFactory();
  (globalThis as typeof globalThis & { indexedDB: IDBFactory }).indexedDB = mockFactory;
  return mockFactory;
}

/**
 * Uninstall IndexedDB mock
 */
export function uninstallIndexedDBMock(): void {
  delete (globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB;
}
