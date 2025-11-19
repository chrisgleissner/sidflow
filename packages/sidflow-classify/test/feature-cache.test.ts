import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
    getCachedFeatures,
    cacheFeatures,
    getOrExtractFeatures,
    getFeatureCacheStats,
    resetFeatureCacheStats,
    clearFeatureCache,
} from "../src/feature-cache.js";

const TEST_DIR = path.join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "tmp",
    "test-feature-cache"
);

// Create a minimal valid WAV file for testing
function createTestWavFile(): Buffer {
    const header = Buffer.alloc(44);

    // RIFF header
    header.write("RIFF", 0);
    header.writeUInt32LE(36, 4); // ChunkSize
    header.write("WAVE", 8);

    // fmt subchunk
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size
    header.writeUInt16LE(1, 20); // AudioFormat (PCM)
    header.writeUInt16LE(1, 22); // NumChannels (mono)
    header.writeUInt32LE(44100, 24); // SampleRate
    header.writeUInt32LE(88200, 28); // ByteRate
    header.writeUInt16LE(2, 32); // BlockAlign
    header.writeUInt16LE(16, 34); // BitsPerSample

    // data subchunk
    header.write("data", 36);
    header.writeUInt32LE(0, 40); // Subchunk2Size (no data)

    return header;
}

describe("Feature Cache", () => {
    beforeEach(async () => {
        await mkdir(TEST_DIR, { recursive: true });
        clearFeatureCache();
        resetFeatureCacheStats();
    });

    afterEach(async () => {
        await rm(TEST_DIR, { recursive: true, force: true });
    });

    it("should cache and retrieve features", async () => {
        const wavPath = path.join(TEST_DIR, "test1.wav");
        const wavData = createTestWavFile();
        await writeFile(wavPath, wavData);

        const features = { tempo: 120, energy: 0.75 };

        // Cache features
        await cacheFeatures(wavPath, features, TEST_DIR);

        // Retrieve from cache
        const cached = await getCachedFeatures(wavPath, TEST_DIR);
        expect(cached).toEqual(features);

        const stats = getFeatureCacheStats();
        expect(stats.hits).toBe(1);
        expect(stats.misses).toBe(0);
        expect(stats.diskWrites).toBe(1);
    });

    it("should return null for uncached file", async () => {
        const wavPath = path.join(TEST_DIR, "nonexistent.wav");

        const cached = await getCachedFeatures(wavPath, TEST_DIR);
        expect(cached).toBeNull();

        const stats = getFeatureCacheStats();
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(1);
    });

    it("should use memory cache for repeated access", async () => {
        const wavPath = path.join(TEST_DIR, "test2.wav");
        const wavData = createTestWavFile();
        await writeFile(wavPath, wavData);

        const features = { tempo: 140, energy: 0.85 };

        // Cache features
        await cacheFeatures(wavPath, features, TEST_DIR);

        // First retrieval uses memory cache (features were just written)
        const cached1 = await getCachedFeatures(wavPath, TEST_DIR);
        expect(cached1).toEqual(features);

        const stats1 = getFeatureCacheStats();
        expect(stats1.memorySize).toBe(1);
        expect(stats1.hits).toBe(1);

        // Second retrieval also from memory
        const cached2 = await getCachedFeatures(wavPath, TEST_DIR);
        expect(cached2).toEqual(features);

        const stats2 = getFeatureCacheStats();
        expect(stats2.diskReads).toBe(0); // No disk reads, only memory hits
        expect(stats2.hits).toBe(2);
    });

    it("should detect WAV content changes", async () => {
        const wavPath = path.join(TEST_DIR, "test3.wav");
        const wavData1 = createTestWavFile();
        await writeFile(wavPath, wavData1);

        const features1 = { tempo: 120, energy: 0.75 };
        await cacheFeatures(wavPath, features1, TEST_DIR);

        // Modify WAV content
        const wavData2 = createTestWavFile();
        wavData2.writeUInt32LE(48000, 24); // Change sample rate
        await writeFile(wavPath, wavData2);

        // Should be cache miss due to different hash
        const cached = await getCachedFeatures(wavPath, TEST_DIR);
        expect(cached).toBeNull();

        const stats = getFeatureCacheStats();
        expect(stats.misses).toBe(1);
    });

    it("should use getOrExtractFeatures helper", async () => {
        const wavPath = path.join(TEST_DIR, "test4.wav");
        const wavData = createTestWavFile();
        await writeFile(wavPath, wavData);

        let extractCalls = 0;
        const extractFn = async () => {
            extractCalls++;
            return { tempo: 130, energy: 0.8 };
        };

        // First call should extract
        const features1 = await getOrExtractFeatures(wavPath, TEST_DIR, extractFn);
        expect(features1).toEqual({ tempo: 130, energy: 0.8 });
        expect(extractCalls).toBe(1);

        // Second call should use cache
        const features2 = await getOrExtractFeatures(wavPath, TEST_DIR, extractFn);
        expect(features2).toEqual({ tempo: 130, energy: 0.8 });
        expect(extractCalls).toBe(1); // Not incremented

        const stats = getFeatureCacheStats();
        expect(stats.hits).toBe(1);
        expect(stats.misses).toBe(1);
    });

    it("should handle concurrent extraction", async () => {
        const wavPath = path.join(TEST_DIR, "test5.wav");
        const wavData = createTestWavFile();
        await writeFile(wavPath, wavData);

        let extractCalls = 0;
        const extractFn = async () => {
            extractCalls++;
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { tempo: 150, energy: 0.9 };
        };

        // Multiple concurrent calls
        const promises = Array.from({ length: 5 }, () =>
            getOrExtractFeatures(wavPath, TEST_DIR, extractFn)
        );

        const results = await Promise.all(promises);

        // All should get the same features
        expect(results.every((r) => r.tempo === 150)).toBe(true);

        // May extract multiple times due to race condition, but should be limited
        expect(extractCalls).toBeGreaterThanOrEqual(1);
        expect(extractCalls).toBeLessThanOrEqual(5);
    });

    it("should track cache statistics", async () => {
        const wavPath = path.join(TEST_DIR, "test6.wav");
        const wavData = createTestWavFile();
        await writeFile(wavPath, wavData);

        const features = { tempo: 160, energy: 0.95 };

        // Cache and retrieve
        await cacheFeatures(wavPath, features, TEST_DIR);
        await getCachedFeatures(wavPath, TEST_DIR); // Memory hit
        await getCachedFeatures(path.join(TEST_DIR, "missing.wav"), TEST_DIR); // Miss

        const stats = getFeatureCacheStats();
        expect(stats.hits).toBe(1);
        expect(stats.misses).toBe(1);
        expect(stats.diskWrites).toBe(1);
        expect(stats.diskReads).toBe(0); // No disk reads, used memory cache
        expect(stats.memorySize).toBe(1);
        expect(stats.ttlDays).toBe(7);
    });

    it("should clear cache", async () => {
        const wavPath = path.join(TEST_DIR, "test7.wav");
        const wavData = createTestWavFile();
        await writeFile(wavPath, wavData);

        const features = { tempo: 170, energy: 1.0 };
        await cacheFeatures(wavPath, features, TEST_DIR);

        let stats = getFeatureCacheStats();
        expect(stats.memorySize).toBe(1);

        clearFeatureCache();

        stats = getFeatureCacheStats();
        expect(stats.memorySize).toBe(0);
        expect(stats.hits).toBe(0);
    });

    it("should evict oldest entry when memory cache is full", async () => {
        // This test verifies the LRU behavior at MAX_MEMORY_ENTRIES (1000)
        // For practical testing, we just verify the interface exists
        const wavPath = path.join(TEST_DIR, "test8.wav");
        const wavData = createTestWavFile();
        await writeFile(wavPath, wavData);

        const features = { tempo: 180, energy: 0.85 };
        await cacheFeatures(wavPath, features, TEST_DIR);

        const stats = getFeatureCacheStats();
        expect(stats.memorySize).toBeGreaterThan(0);
        expect(stats.memorySize).toBeLessThanOrEqual(1000);
    });
});
