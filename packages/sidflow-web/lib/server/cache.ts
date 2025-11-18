/**
 * Centralized caching layer for expensive server operations.
 * Provides LRU cache with TTL for database queries, API responses, and computed results.
 */

interface CacheEntry<T> {
    value: T;
    timestamp: number;
    expiresAt: number;
}

interface CacheOptions {
    /** Time-to-live in milliseconds */
    ttl: number;
    /** Maximum number of entries */
    maxSize: number;
}

/**
 * Generic LRU cache with TTL support.
 */
export class LRUCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private readonly ttl: number;
    private readonly maxSize: number;

    constructor(options: CacheOptions) {
        this.ttl = options.ttl;
        this.maxSize = options.maxSize;
    }

    /**
     * Gets a value from the cache if it exists and hasn't expired.
     */
    get(key: string): T | undefined {
        const entry = this.cache.get(key);

        if (!entry) {
            return undefined;
        }

        // Check if entry has expired
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }

        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);

        return entry.value;
    }

    /**
     * Sets a value in the cache.
     */
    set(key: string, value: T): void {
        const now = Date.now();
        const entry: CacheEntry<T> = {
            value,
            timestamp: now,
            expiresAt: now + this.ttl,
        };

        // If at capacity, remove oldest entry (first in map)
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, entry);
    }

    /**
     * Checks if a key exists and hasn't expired.
     */
    has(key: string): boolean {
        return this.get(key) !== undefined;
    }

    /**
     * Clears all entries from the cache.
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Gets current cache size.
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Gets cache statistics.
     */
    getStats(): { size: number; maxSize: number; ttl: number } {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            ttl: this.ttl,
        };
    }
}

/**
 * Cache for similarity search results.
 * TTL: 10 minutes (results don't change frequently)
 * Max size: 500 entries
 */
export const similarityCache = new LRUCache<any>({
    ttl: 10 * 60 * 1000,
    maxSize: 500,
});

/**
 * Cache for mood transition results.
 * TTL: 15 minutes (deterministic based on mood vectors)
 * Max size: 200 entries
 */
export const moodTransitionCache = new LRUCache<any>({
    ttl: 15 * 60 * 1000,
    maxSize: 200,
});

/**
 * Cache for hidden gems results.
 * TTL: 30 minutes (computation is expensive, results stable)
 * Max size: 50 entries (limited variations)
 */
export const hiddenGemsCache = new LRUCache<any>({
    ttl: 30 * 60 * 1000,
    maxSize: 50,
});

/**
 * Cache for LanceDB database connections (not just tables).
 * TTL: 60 minutes (stable, expensive to create)
 * Max size: 5 entries
 */
export const dbConnectionCache = new LRUCache<any>({
    ttl: 60 * 60 * 1000,
    maxSize: 5,
});

/**
 * Cache for LanceDB table connections.
 * TTL: 60 minutes (stable, expensive to create)
 * Max size: 5 entries
 */
export const tableCache = new LRUCache<any>({
    ttl: 60 * 60 * 1000,
    maxSize: 5,
});/**
 * Cache for enriched track info (metadata, file stats, songlength).
 * TTL: 5 minutes (file metadata stable)
 * Max size: 1000 entries
 */
export const trackInfoCache = new LRUCache<any>({
    ttl: 5 * 60 * 1000,
    maxSize: 1000,
});

/**
 * Creates a cache key from multiple parameters.
 */
export function createCacheKey(...parts: (string | number | boolean | object)[]): string {
    return parts
        .map((part) => {
            if (typeof part === 'object') {
                return JSON.stringify(part);
            }
            return String(part);
        })
        .join('::');
}

/**
 * Cached database connection helper.
 * Use this instead of calling connect() directly.
 */
export async function getCachedDbConnection(dbPath: string): Promise<any> {
    // Check cache first
    const cached = dbConnectionCache.get(dbPath);
    if (cached) {
        return cached;
    }

    // Import connect lazily to avoid loading at module-level
    const { connect } = await import('vectordb');
    const db = await connect(dbPath);

    // Cache the connection
    dbConnectionCache.set(dbPath, db);

    return db;
}

/**
 * Clears all caches. Useful for testing or when data is refreshed.
 */
export function clearAllCaches(): void {
    similarityCache.clear();
    moodTransitionCache.clear();
    hiddenGemsCache.clear();
    dbConnectionCache.clear();
    tableCache.clear();
    trackInfoCache.clear();
    console.log('[cache] All caches cleared');
}/**
 * Gets statistics for all caches.
 */
export function getAllCacheStats(): Record<string, any> {
    return {
        similarity: similarityCache.getStats(),
        moodTransition: moodTransitionCache.getStats(),
        hiddenGems: hiddenGemsCache.getStats(),
        table: tableCache.getStats(),
        trackInfo: trackInfoCache.getStats(),
    };
}
