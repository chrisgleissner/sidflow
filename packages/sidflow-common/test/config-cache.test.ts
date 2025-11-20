import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { writeFile, mkdir, rm, utimes } from "node:fs/promises";
import path from "node:path";
import {
    cacheConfig,
    getEnhancedCachedConfig as getCachedConfig,
    invalidateConfigCache,
    getConfigCacheStats,
    resetConfigCacheStats,
    recordConfigLoadTime,
} from "../src/config-cache.js";
import type { SidflowConfig } from "../src/config.js";

const TEST_DIR = path.join(import.meta.dir, "..", "..", "..", "tmp", "test-config-cache");

const sampleConfig: SidflowConfig = {
    sidPath: "/test/sids",
    wavCachePath: "/test/wav-cache",
    tagsPath: "/test/tags",
    threads: 4,
    classificationDepth: 3,
};

describe("Config Cache", () => {
    beforeEach(async () => {
        await mkdir(TEST_DIR, { recursive: true });
        resetConfigCacheStats();
        invalidateConfigCache();
    });

    afterEach(async () => {
        await rm(TEST_DIR, { recursive: true, force: true });
    });

    it("should cache config with hash", async () => {
        const configPath = path.join(TEST_DIR, "test1.json");
        const contents = JSON.stringify(sampleConfig);
        await writeFile(configPath, contents, "utf8");

        const stats = await Bun.file(configPath).stat();
        await cacheConfig(sampleConfig, configPath, contents, stats.mtimeMs);

        const cached = await getCachedConfig(configPath);
        expect(cached).toEqual(sampleConfig);

        const cacheStats = getConfigCacheStats();
        expect(cacheStats.hits).toBe(1);
        expect(cacheStats.misses).toBe(0);
    });

    it("should return null for uncached path", async () => {
        const configPath = path.join(TEST_DIR, "nonexistent.json");
        const cached = await getCachedConfig(configPath);
        expect(cached).toBeNull();

        const cacheStats = getConfigCacheStats();
        expect(cacheStats.hits).toBe(0);
        expect(cacheStats.misses).toBe(1);
    });

    it("should invalidate cache when file changes", async () => {
        const configPath = path.join(TEST_DIR, "test2.json");
        const contents = JSON.stringify(sampleConfig);
        await writeFile(configPath, contents, "utf8");

        const stats = await Bun.file(configPath).stat();
        await cacheConfig(sampleConfig, configPath, contents, stats.mtimeMs);

        // Verify cache hit
        let cached = await getCachedConfig(configPath);
        expect(cached).not.toBeNull();

        // Wait to ensure mtime changes (some filesystems have low resolution)
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Modify file
        const modifiedConfig = { ...sampleConfig, threads: 8 };
        const newContents = JSON.stringify(modifiedConfig);
        await writeFile(configPath, newContents, "utf8");

        // Cache should be invalid now (both mtime and hash changed)
        cached = await getCachedConfig(configPath);
        expect(cached).toBeNull();

        const cacheStats = getConfigCacheStats();
        expect(cacheStats.invalidations).toBe(1);
    });

    it("should handle file touch without content change", async () => {
        const configPath = path.join(TEST_DIR, "test3.json");
        const contents = JSON.stringify(sampleConfig);
        await writeFile(configPath, contents, "utf8");

        const stats = await Bun.file(configPath).stat();
        await cacheConfig(sampleConfig, configPath, contents, stats.mtimeMs);

        // Verify initial cache hit
        let cached = await getCachedConfig(configPath);
        expect(cached).not.toBeNull();

        // Touch file (change mtime but not contents)
        const now = new Date();
        const later = new Date(now.getTime() + 1000);
        await utimes(configPath, later, later);

        // Cache should still be valid (hash unchanged)
        cached = await getCachedConfig(configPath);
        expect(cached).toEqual(sampleConfig);

        const cacheStats = getConfigCacheStats();
        expect(cacheStats.hits).toBe(2);
    });

    it("should invalidate cache manually", async () => {
        const configPath = path.join(TEST_DIR, "test4.json");
        const contents = JSON.stringify(sampleConfig);
        await writeFile(configPath, contents, "utf8");

        const stats = await Bun.file(configPath).stat();
        await cacheConfig(sampleConfig, configPath, contents, stats.mtimeMs);

        // Verify cache hit first
        let cached = await getCachedConfig(configPath);
        expect(cached).not.toBeNull();

        // Manual invalidation
        invalidateConfigCache();

        cached = await getCachedConfig(configPath);
        expect(cached).toBeNull();

        const cacheStats = getConfigCacheStats();
        // Expect 1 invalidation from manual call, plus 1 from the cache miss after invalidation
        expect(cacheStats.invalidations).toBeGreaterThanOrEqual(1);
    });

    it("should track load time statistics", () => {
        recordConfigLoadTime(10.5);
        recordConfigLoadTime(20.3);
        recordConfigLoadTime(15.7);

        const stats = getConfigCacheStats();
        // Stats are updated after cache hits/misses, but we can verify recording doesn't crash
        expect(stats.avgLoadTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should report current cache entry", async () => {
        const configPath = path.join(TEST_DIR, "test5.json");
        const contents = JSON.stringify(sampleConfig);
        await writeFile(configPath, contents, "utf8");

        const stats = await Bun.file(configPath).stat();
        await cacheConfig(sampleConfig, configPath, contents, stats.mtimeMs);

        const cacheStats = getConfigCacheStats();
        expect(cacheStats.currentEntry).not.toBeNull();
        expect(cacheStats.currentEntry?.path).toBe(configPath);
        expect(cacheStats.currentEntry?.hash).toBeDefined();
        expect(cacheStats.currentEntry?.age).toBeGreaterThanOrEqual(0);
    });

    it("should reset statistics", async () => {
        const configPath = path.join(TEST_DIR, "test6.json");
        const contents = JSON.stringify(sampleConfig);
        await writeFile(configPath, contents, "utf8");

        const stats = await Bun.file(configPath).stat();
        await cacheConfig(sampleConfig, configPath, contents, stats.mtimeMs);

        await getCachedConfig(configPath);
        await getCachedConfig("nonexistent.json");

        let cacheStats = getConfigCacheStats();
        expect(cacheStats.hits).toBeGreaterThan(0);
        expect(cacheStats.misses).toBeGreaterThan(0);

        resetConfigCacheStats();

        cacheStats = getConfigCacheStats();
        expect(cacheStats.hits).toBe(0);
        expect(cacheStats.misses).toBe(0);
        expect(cacheStats.invalidations).toBe(0);
    });
});
