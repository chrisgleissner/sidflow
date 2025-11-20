/**
 * @fileoverview In-memory cache for parsed SID metadata
 * Eliminates repeated parseSidFile calls for frequently accessed tracks
 */

import { parseSidFile, type SidFileMetadata } from "./sid-parser.js";
import { stat } from "node:fs/promises";

interface CacheEntry {
    metadata: SidFileMetadata;
    mtimeMs: number;
    cachedAt: number;
}

interface CacheStats {
    hits: number;
    misses: number;
    invalidations: number;
    evictions: number;
    currentSize: number;
    maxSize: number;
    avgLoadTimeMs: number;
}

// LRU cache with mtime-based invalidation
const cache = new Map<string, CacheEntry>();
const accessOrder: string[] = []; // Track LRU order

// Configuration
const MAX_CACHE_SIZE = 10000; // Typical collection size
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// Statistics
let stats: CacheStats = {
    hits: 0,
    misses: 0,
    invalidations: 0,
    evictions: 0,
    currentSize: 0,
    maxSize: MAX_CACHE_SIZE,
    avgLoadTimeMs: 0,
};
const loadTimes: number[] = [];

/**
 * Get cached metadata with automatic invalidation
 */
export async function getCachedMetadata(
    sidPath: string
): Promise<SidFileMetadata | null> {
    const entry = cache.get(sidPath);

    if (!entry) {
        stats.misses++;
        return null;
    }

    // Check staleness (time-based)
    const age = Date.now() - entry.cachedAt;
    if (age > STALE_THRESHOLD_MS) {
        cache.delete(sidPath);
        removeFromAccessOrder(sidPath);
        stats.invalidations++;
        stats.currentSize--;
        stats.misses++;
        return null;
    }

    // Verify file hasn't changed (mtime-based)
    try {
        const fileStat = await stat(sidPath);
        if (fileStat.mtimeMs !== entry.mtimeMs) {
            cache.delete(sidPath);
            removeFromAccessOrder(sidPath);
            stats.invalidations++;
            stats.currentSize--;
            stats.misses++;
            return null;
        }
    } catch {
        // File doesn't exist or not accessible
        cache.delete(sidPath);
        removeFromAccessOrder(sidPath);
        stats.invalidations++;
        stats.currentSize--;
        stats.misses++;
        return null;
    }

    // Cache hit - update LRU order
    updateAccessOrder(sidPath);
    stats.hits++;
    return entry.metadata;
}

/**
 * Cache metadata for a file
 */
export async function cacheMetadata(
    sidPath: string,
    metadata: SidFileMetadata,
    mtimeMs: number
): Promise<void> {
    // Evict LRU entry if cache is full
    if (cache.size >= MAX_CACHE_SIZE && !cache.has(sidPath)) {
        const evictPath = accessOrder[0];
        if (evictPath) {
            cache.delete(evictPath);
            accessOrder.shift();
            stats.evictions++;
            stats.currentSize--;
        }
    }

    const wasNew = !cache.has(sidPath);
    cache.set(sidPath, {
        metadata,
        mtimeMs,
        cachedAt: Date.now(),
    });

    updateAccessOrder(sidPath);

    if (wasNew) {
        stats.currentSize++;
    }
}

/**
 * Get metadata with automatic caching
 * This is the main entry point for callers
 */
export async function getOrParseMetadata(
    sidPath: string
): Promise<SidFileMetadata> {
    // Try cache first
    const cached = await getCachedMetadata(sidPath);
    if (cached) {
        return cached;
    }

    // Cache miss - parse file
    const startTime = performance.now();
    const metadata = await parseSidFile(sidPath);
    const endTime = performance.now();

    // Record load time
    const loadTime = endTime - startTime;
    loadTimes.push(loadTime);
    if (loadTimes.length > 100) {
        loadTimes.shift();
    }
    stats.avgLoadTimeMs =
        loadTimes.reduce((sum, t) => sum + t, 0) / loadTimes.length;

    // Cache the result
    try {
        const fileStat = await stat(sidPath);
        await cacheMetadata(sidPath, metadata, fileStat.mtimeMs);
    } catch {
        // If stat fails, cache without mtime (will use time-based invalidation only)
        await cacheMetadata(sidPath, metadata, 0);
    }

    return metadata;
}

/**
 * Invalidate specific entry or entire cache
 */
export function invalidateMetadataCache(sidPath?: string): void {
    if (sidPath) {
        if (cache.delete(sidPath)) {
            removeFromAccessOrder(sidPath);
            stats.invalidations++;
            stats.currentSize--;
        }
    } else {
        const count = cache.size;
        cache.clear();
        accessOrder.length = 0;
        stats.invalidations += count;
        stats.currentSize = 0;
    }
}

/**
 * Get cache statistics
 */
export function getMetadataCacheStats(): CacheStats {
    return {
        ...stats,
        currentSize: cache.size,
    };
}

/**
 * Reset statistics (for testing)
 */
export function resetMetadataCacheStats(): void {
    stats = {
        hits: 0,
        misses: 0,
        invalidations: 0,
        evictions: 0,
        currentSize: cache.size,
        maxSize: MAX_CACHE_SIZE,
        avgLoadTimeMs: 0,
    };
    loadTimes.length = 0;
}

// LRU order management helpers

function updateAccessOrder(sidPath: string): void {
    removeFromAccessOrder(sidPath);
    accessOrder.push(sidPath);
}

function removeFromAccessOrder(sidPath: string): void {
    const index = accessOrder.indexOf(sidPath);
    if (index !== -1) {
        accessOrder.splice(index, 1);
    }
}
