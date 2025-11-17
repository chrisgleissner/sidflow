/**
 * Global test setup for sidflow-web tests
 * This file is executed before all tests to ensure consistent environment
 */

// Import fake-indexedDB globally for all tests
import 'fake-indexeddb/auto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

// Ensure window object exists for Node/Bun test environment
if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

// Ensure indexedDB and IDBKeyRange are available on window and global
if (!globalThis.window.indexedDB) {
  (globalThis.window as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
}
if (!globalThis.IDBKeyRange) {
  (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;
}

// Setup localStorage if not present
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

if (!globalThis.window.localStorage) {
  (globalThis.window as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
}
