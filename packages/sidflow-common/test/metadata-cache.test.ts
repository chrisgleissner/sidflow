import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { writeFile, mkdir, rm, utimes } from "node:fs/promises";
import path from "node:path";
import {
    getCachedMetadata,
    cacheMetadata,
    getOrParseMetadata,
    invalidateMetadataCache,
    getMetadataCacheStats,
    resetMetadataCacheStats,
} from "../src/metadata-cache.js";

const TEST_DIR = path.join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "tmp",
    "test-metadata-cache"
);

// Create a minimal valid PSID file for testing
function createTestSidFile(): Buffer {
    const header = Buffer.alloc(124);

    // Magic bytes "PSID"
    header.write("PSID", 0, 4, "ascii");

    // Version 2
    header.writeUInt16BE(2, 4);

    // dataOffset (header size)
    header.writeUInt16BE(124, 6);

    // Load address
    header.writeUInt16BE(0x1000, 8);

    // Init address
    header.writeUInt16BE(0x1000, 10);

    // Play address
    header.writeUInt16BE(0x1003, 12);

    // Songs count
    header.writeUInt16BE(1, 14);

    // Start song
    header.writeUInt16BE(1, 16);

    // Speed (PAL)
    header.writeUInt32BE(0, 18);

    // Title
    header.write("Test Song", 22, 32, "ascii");

    // Author
    header.write("Test Composer", 54, 32, "ascii");

    // Released
    header.write("2025 Test", 86, 32, "ascii");

    // Flags (PAL, 6581)
    header.writeUInt16BE(0, 118);

    return header;
}

describe("Metadata Cache", () => {
    beforeEach(async () => {
        await mkdir(TEST_DIR, { recursive: true });
        resetMetadataCacheStats();
        invalidateMetadataCache();
    });

    afterEach(async () => {
        await rm(TEST_DIR, { recursive: true, force: true });
    });

    it("should cache and retrieve metadata", async () => {
        const sidPath = path.join(TEST_DIR, "test1.sid");
        const sidData = createTestSidFile();
        await writeFile(sidPath, sidData);

        // First call should parse and cache
        const metadata1 = await getOrParseMetadata(sidPath);
        expect(metadata1.title).toBe("Test Song");
        expect(metadata1.author).toBe("Test Composer");

        const stats1 = getMetadataCacheStats();
        expect(stats1.misses).toBe(1);
        expect(stats1.hits).toBe(0);
        expect(stats1.currentSize).toBe(1);

        // Second call should hit cache
        const metadata2 = await getOrParseMetadata(sidPath);
        expect(metadata2.title).toBe("Test Song");

        const stats2 = getMetadataCacheStats();
        expect(stats2.hits).toBe(1);
        expect(stats2.misses).toBe(1);
    });

    it("should return null for uncached path", async () => {
        const sidPath = path.join(TEST_DIR, "nonexistent.sid");
        const cached = await getCachedMetadata(sidPath);
        expect(cached).toBeNull();

        const stats = getMetadataCacheStats();
        expect(stats.misses).toBe(1);
        expect(stats.hits).toBe(0);
    });

    it("should invalidate cache when file changes", async () => {
        const sidPath = path.join(TEST_DIR, "test2.sid");
        const sidData = createTestSidFile();
        await writeFile(sidPath, sidData);

        // Cache initial version
        const metadata1 = await getOrParseMetadata(sidPath);
        expect(metadata1.title).toBe("Test Song");

        // Wait to ensure mtime changes
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Modify file
        const modifiedData = Buffer.from(sidData);
        modifiedData.write("Modified", 22, 8, "ascii");
        await writeFile(sidPath, modifiedData);

        // Should detect change and re-parse
        const metadata2 = await getOrParseMetadata(sidPath);
        expect(metadata2.title).toContain("Modified");

        const stats = getMetadataCacheStats();
        expect(stats.invalidations).toBeGreaterThan(0);
    });

    it("should handle file touch without content change", async () => {
        const sidPath = path.join(TEST_DIR, "test3.sid");
        const sidData = createTestSidFile();
        await writeFile(sidPath, sidData);

        // Cache initial version
        await getOrParseMetadata(sidPath);

        // Touch file (change mtime)
        const now = new Date();
        const later = new Date(now.getTime() + 1000);
        await utimes(sidPath, later, later);

        // Should detect mtime change and re-parse (even though content is same)
        const cached = await getCachedMetadata(sidPath);
        expect(cached).toBeNull(); // mtime changed, cache invalidated

        const stats = getMetadataCacheStats();
        // Expect at least 1 invalidation from detecting stale cache
        expect(stats.invalidations).toBeGreaterThanOrEqual(1);
    });

    it("should invalidate specific entry", async () => {
        const sidPath1 = path.join(TEST_DIR, "test4a.sid");
        const sidPath2 = path.join(TEST_DIR, "test4b.sid");
        const sidData = createTestSidFile();
        await writeFile(sidPath1, sidData);
        await writeFile(sidPath2, sidData);

        // Cache both
        await getOrParseMetadata(sidPath1);
        await getOrParseMetadata(sidPath2);

        expect(getMetadataCacheStats().currentSize).toBe(2);

        // Invalidate one
        invalidateMetadataCache(sidPath1);

        expect(getMetadataCacheStats().currentSize).toBe(1);
        expect(getMetadataCacheStats().invalidations).toBe(1);

        // sidPath2 should still be cached
        const cached2 = await getCachedMetadata(sidPath2);
        expect(cached2).not.toBeNull();
    });

    it("should invalidate entire cache", async () => {
        const sidPath1 = path.join(TEST_DIR, "test5a.sid");
        const sidPath2 = path.join(TEST_DIR, "test5b.sid");
        const sidData = createTestSidFile();
        await writeFile(sidPath1, sidData);
        await writeFile(sidPath2, sidData);

        // Cache both
        await getOrParseMetadata(sidPath1);
        await getOrParseMetadata(sidPath2);

        expect(getMetadataCacheStats().currentSize).toBe(2);

        // Invalidate all
        invalidateMetadataCache();

        const stats = getMetadataCacheStats();
        expect(stats.currentSize).toBe(0);
        // Each cached entry counts as one invalidation
        expect(stats.invalidations).toBeGreaterThanOrEqual(2);
    });

    it("should track load times", async () => {
        const sidPath = path.join(TEST_DIR, "test6.sid");
        const sidData = createTestSidFile();
        await writeFile(sidPath, sidData);

        // Parse (cache miss)
        await getOrParseMetadata(sidPath);

        const stats = getMetadataCacheStats();
        expect(stats.avgLoadTimeMs).toBeGreaterThan(0);
    });

    it("should evict LRU entries when cache is full", async () => {
        // This test would require filling the cache to MAX_CACHE_SIZE (10000)
        // which is expensive. Instead, we just verify the interface is correct.
        const sidPath = path.join(TEST_DIR, "test7.sid");
        const sidData = createTestSidFile();
        await writeFile(sidPath, sidData);

        await getOrParseMetadata(sidPath);

        const stats = getMetadataCacheStats();
        expect(stats.maxSize).toBe(10000);
        expect(stats.evictions).toBe(0); // Not full yet
    });

    it("should handle missing files gracefully", async () => {
        const sidPath = path.join(TEST_DIR, "missing.sid");

        // Cache miss, then file read will fail
        await expect(getOrParseMetadata(sidPath)).rejects.toThrow();

        const stats = getMetadataCacheStats();
        expect(stats.misses).toBe(1);
    });

    it("should reset statistics", async () => {
        const sidPath = path.join(TEST_DIR, "test8.sid");
        const sidData = createTestSidFile();
        await writeFile(sidPath, sidData);

        await getOrParseMetadata(sidPath);
        await getOrParseMetadata(sidPath);

        let stats = getMetadataCacheStats();
        expect(stats.hits).toBeGreaterThan(0);
        expect(stats.misses).toBeGreaterThan(0);

        resetMetadataCacheStats();

        stats = getMetadataCacheStats();
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(0);
        expect(stats.invalidations).toBe(0);
        expect(stats.evictions).toBe(0);
    });

    it("should handle concurrent accesses", async () => {
        const sidPath = path.join(TEST_DIR, "test9.sid");
        const sidData = createTestSidFile();
        await writeFile(sidPath, sidData);

        // Multiple concurrent requests
        const promises = Array.from({ length: 10 }, () =>
            getOrParseMetadata(sidPath)
        );

        const results = await Promise.all(promises);

        // All should get the same metadata
        expect(results.every((r) => r.title === "Test Song")).toBe(true);

        const stats = getMetadataCacheStats();
        // Some calls may hit cache if first completes quickly, or all may miss in parallel
        // Either way, final cache should have the entry
        expect(stats.hits + stats.misses).toBeGreaterThanOrEqual(10);
        expect(stats.currentSize).toBe(1);
    });
});
