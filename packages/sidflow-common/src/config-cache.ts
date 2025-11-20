/**
 * Enhanced config caching with hash-based invalidation
 * Avoids repeated file system calls and provides cache statistics
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createLogger } from "./logger.js";
import type { SidflowConfig } from "./config.js";

const cacheLogger = createLogger("config-cache");

interface ConfigCacheEntry {
    config: SidflowConfig;
    path: string;
    hash: string;
    mtime: number;
    loadedAt: number;
    hits: number;
}

let cacheEntry: ConfigCacheEntry | null = null;
let cacheStats = {
    hits: 0,
    misses: 0,
    invalidations: 0,
    totalLoadTimeMs: 0,
};

/**
 * Compute SHA256 hash of file contents
 */
async function computeFileHash(filePath: string, contents: string): Promise<string> {
    return createHash("sha256").update(contents).digest("hex").slice(0, 16);
}

/**
 * Check if cached config is still valid by comparing file mtime and hash
 */
async function isCacheValid(filePath: string): Promise<boolean> {
    if (!cacheEntry || cacheEntry.path !== filePath) {
        return false;
    }

    try {
        const stats = await stat(filePath);
        const currentMtime = stats.mtimeMs;

        // Fast path: if mtime unchanged, cache is valid
        if (currentMtime === cacheEntry.mtime) {
            return true;
        }

        // Slow path: mtime changed, check hash to detect false positives
        const contents = await readFile(filePath, "utf8");
        const currentHash = await computeFileHash(filePath, contents);

        if (currentHash === cacheEntry.hash) {
            // False alarm - file touched but not changed
            // Update mtime to avoid repeated hash checks
            cacheEntry.mtime = currentMtime;
            return true;
        }

        // Hash changed - cache invalid
        cacheLogger.debug(`Config file changed: ${filePath} (hash: ${cacheEntry.hash} → ${currentHash})`);
        return false;
    } catch (error) {
        cacheLogger.warn(`Failed to validate config cache for ${filePath}:`, error);
        return false;
    }
}

/**
 * Store config in cache with hash
 */
export async function cacheConfig(
    config: SidflowConfig,
    path: string,
    contents: string,
    mtime: number
): Promise<void> {
    const hash = await computeFileHash(path, contents);

    cacheEntry = {
        config,
        path,
        hash,
        mtime,
        loadedAt: Date.now(),
        hits: 0,
    };

    cacheLogger.debug(`Config cached: ${path} (hash: ${hash})`);
}

/**
 * Get enhanced cached config if valid, null otherwise
 */
export async function getEnhancedCachedConfig(path: string): Promise<SidflowConfig | null> {
    if (!cacheEntry || cacheEntry.path !== path) {
        cacheStats.misses++;
        return null;
    }

    const valid = await isCacheValid(path);

    if (!valid) {
        cacheStats.invalidations++;
        cacheStats.misses++;
        cacheEntry = null;
        return null;
    }

    cacheStats.hits++;
    cacheEntry.hits++;
    return cacheEntry.config;
}

/**
 * Invalidate cache (called by resetConfigCache)
 */
export function invalidateConfigCache(): void {
    if (cacheEntry) {
        cacheLogger.debug(`Config cache invalidated: ${cacheEntry.path}`);
        cacheStats.invalidations++;
    }
    cacheEntry = null;
}

/**
 * Get cache statistics
 */
export function getConfigCacheStats(): {
    hits: number;
    misses: number;
    invalidations: number;
    avgLoadTimeMs: number;
    currentEntry: {
        path: string;
        hash: string;
        age: number;
        hits: number;
    } | null;
} {
    const avgLoadTimeMs =
        cacheStats.hits + cacheStats.misses > 0
            ? cacheStats.totalLoadTimeMs / (cacheStats.hits + cacheStats.misses)
            : 0;

    return {
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        invalidations: cacheStats.invalidations,
        avgLoadTimeMs,
        currentEntry: cacheEntry
            ? {
                path: cacheEntry.path,
                hash: cacheEntry.hash,
                age: Date.now() - cacheEntry.loadedAt,
                hits: cacheEntry.hits,
            }
            : null,
    };
}

/**
 * Record load time for statistics
 */
export function recordConfigLoadTime(durationMs: number): void {
    cacheStats.totalLoadTimeMs += durationMs;
}

/**
 * Reset all cache statistics
 */
export function resetConfigCacheStats(): void {
    cacheStats = {
        hits: 0,
        misses: 0,
        invalidations: 0,
        totalLoadTimeMs: 0,
    };
}
