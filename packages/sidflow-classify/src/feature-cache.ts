/**
 * @fileoverview Cache for audio feature extraction results
 * Eliminates repeated Essentia.js processing for the same WAV files
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { pathExists } from "@sidflow/common";
import path from "node:path";

interface FeatureCacheEntry {
    wavHash: string;
    features: Record<string, number>;
    timestamp: number;
}

interface CacheStats {
    hits: number;
    misses: number;
    diskReads: number;
    diskWrites: number;
}

// In-memory cache
const memoryCache = new Map<string, FeatureCacheEntry>();

// Statistics
let stats: CacheStats = {
    hits: 0,
    misses: 0,
    diskReads: 0,
    diskWrites: 0,
};

// Configuration
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_MEMORY_ENTRIES = 1000; // Keep hot entries in memory

/**
 * Compute SHA256 hash of WAV file contents
 */
async function computeWavHash(wavPath: string): Promise<string | null> {
    try {
        const content = await readFile(wavPath);
        return createHash("sha256").update(content).digest("hex").substring(0, 16);
    } catch {
        return null;
    }
}

/**
 * Get cache file path for a WAV hash
 */
function getCachePath(cacheDir: string, wavHash: string): string {
    // Organize by first 2 chars for directory sharding (256 subdirs max)
    const subdir = wavHash.substring(0, 2);
    return path.join(cacheDir, "features", subdir, `${wavHash}.json`);
}

/**
 * Get cached features if valid
 */
export async function getCachedFeatures(
    wavPath: string,
    cacheDir: string
): Promise<Record<string, number> | null> {
    const wavHash = await computeWavHash(wavPath);
    if (!wavHash) {
        stats.misses++;
        return null;
    }

    // Check memory cache first
    const memEntry = memoryCache.get(wavHash);
    if (memEntry) {
        // Verify not stale
        const age = Date.now() - memEntry.timestamp;
        if (age < CACHE_TTL_MS) {
            stats.hits++;
            return memEntry.features;
        } else {
            memoryCache.delete(wavHash);
        }
    }

    // Check disk cache
    const cachePath = getCachePath(cacheDir, wavHash);
    if (await pathExists(cachePath)) {
        try {
            stats.diskReads++;
            const content = await readFile(cachePath, "utf8");
            const entry: FeatureCacheEntry = JSON.parse(content);

            // Verify not stale
            const age = Date.now() - entry.timestamp;
            if (age < CACHE_TTL_MS && entry.wavHash === wavHash) {
                // Promote to memory cache
                if (memoryCache.size >= MAX_MEMORY_ENTRIES) {
                    // Evict oldest entry
                    const oldestKey = memoryCache.keys().next().value;
                    if (oldestKey) {
                        memoryCache.delete(oldestKey);
                    }
                }
                memoryCache.set(wavHash, entry);

                stats.hits++;
                return entry.features;
            }
        } catch {
            // Invalid cache file, treat as miss
        }
    }

    stats.misses++;
    return null;
}

/**
 * Store features in cache
 */
export async function cacheFeatures(
    wavPath: string,
    features: Record<string, number>,
    cacheDir: string
): Promise<void> {
    const wavHash = await computeWavHash(wavPath);
    if (!wavHash) {
        return; // Can't cache if file doesn't exist
    }

    const entry: FeatureCacheEntry = {
        wavHash,
        features,
        timestamp: Date.now(),
    };

    // Write to memory cache
    if (memoryCache.size >= MAX_MEMORY_ENTRIES) {
        const oldestKey = memoryCache.keys().next().value;
        if (oldestKey) {
            memoryCache.delete(oldestKey);
        }
    }
    memoryCache.set(wavHash, entry);

    // Write to disk cache
    const cachePath = getCachePath(cacheDir, wavHash);
    await mkdir(path.dirname(cachePath), { recursive: true });
    stats.diskWrites++;
    await writeFile(cachePath, JSON.stringify(entry), "utf8");
}

/**
 * Get or compute features with caching
 */
export async function getOrExtractFeatures(
    wavPath: string,
    cacheDir: string,
    extractFn: (wavPath: string) => Promise<Record<string, number>>
): Promise<Record<string, number>> {
    const cached = await getCachedFeatures(wavPath, cacheDir);
    if (cached) {
        return cached;
    }

    // Cache miss - extract features
    const features = await extractFn(wavPath);
    await cacheFeatures(wavPath, features, cacheDir);
    return features;
}

/**
 * Invalidate cache entries older than TTL
 */
export async function cleanupStaleCache(cacheDir: string): Promise<number> {
    let cleaned = 0;
    const featuresDir = path.join(cacheDir, "features");

    if (!(await pathExists(featuresDir))) {
        return 0;
    }

    const { readdir } = await import("node:fs/promises");

    // Iterate through subdirectories
    const subdirs = await readdir(featuresDir);
    for (const subdir of subdirs) {
        const subdirPath = path.join(featuresDir, subdir);
        const files = await readdir(subdirPath);

        for (const file of files) {
            if (!file.endsWith(".json")) continue;

            const filePath = path.join(subdirPath, file);
            try {
                const fileStat = await stat(filePath);
                const age = Date.now() - fileStat.mtimeMs;

                if (age > CACHE_TTL_MS) {
                    const { unlink } = await import("node:fs/promises");
                    await unlink(filePath);
                    cleaned++;
                }
            } catch {
                // Skip files that can't be accessed
            }
        }
    }

    return cleaned;
}

/**
 * Get cache statistics
 */
export function getFeatureCacheStats(): CacheStats & {
    memorySize: number;
    ttlDays: number;
} {
    return {
        ...stats,
        memorySize: memoryCache.size,
        ttlDays: CACHE_TTL_MS / (24 * 60 * 60 * 1000),
    };
}

/**
 * Reset statistics (for testing)
 */
export function resetFeatureCacheStats(): void {
    stats = {
        hits: 0,
        misses: 0,
        diskReads: 0,
        diskWrites: 0,
    };
}

/**
 * Clear all caches (for testing)
 */
export function clearFeatureCache(): void {
    memoryCache.clear();
    resetFeatureCacheStats();
}
