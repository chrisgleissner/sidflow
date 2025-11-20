import { describe, expect, it } from "bun:test";
import {
    BatchTimer,
    CheckpointLogger,
    PerfTimer,
    createBatchTimer,
    createCheckpointLogger,
    createPerfTimer,
    measureAsync,
    measureSync,
    type PerformanceProfile,
    type TimingResult
} from "../src/perf-utils.js";

describe("PerfTimer", () => {
    it("should measure elapsed time", () => {
        const timer = new PerfTimer("test");
        timer.start("operation");

        // Simulate work
        const start = Date.now();
        while (Date.now() - start < 10) {
            // busy wait
        }

        const result = timer.end("operation");
        expect(result).toBeDefined();
        expect(result!.label).toBe("operation");
        expect(result!.durationMs).toBeGreaterThanOrEqual(8); // Allow 2ms tolerance
    });

    it("should track memory when enabled", () => {
        const timer = new PerfTimer("test", true);
        timer.start("operation");

        // Allocate some memory
        const data = new Array(10000).fill(Math.random());

        const result = timer.end("operation");
        expect(result).toBeDefined();
        expect(result!.memoryDeltaMB).toBeDefined();
        expect(result!.heapDeltaMB).toBeDefined();

        // Keep data in scope to prevent optimization
        expect(data.length).toBe(10000);
    });

    it("should return null for unknown labels", () => {
        const timer = new PerfTimer("test");
        const result = timer.end("nonexistent");
        expect(result).toBeNull();
    });

    it("should record manual timings", () => {
        const timer = new PerfTimer("test");
        timer.record("manual-op", 123.45);

        const results = timer.getResults();
        expect(results).toHaveLength(1);
        expect(results[0].label).toBe("manual-op");
        expect(results[0].durationMs).toBe(123.45);
    });

    it("should generate complete profile", () => {
        const timer = new PerfTimer("test-profile", true);
        timer.start("step1");
        timer.end("step1");
        timer.start("step2");
        timer.end("step2");

        const profile = timer.finish({ foo: "bar" });
        expect(profile.name).toBe("test-profile");
        expect(profile.durationMs).toBeGreaterThan(0);
        expect(profile.timings).toHaveLength(2);
        expect(profile.metadata).toEqual({ foo: "bar" });
        expect(profile.peakMemoryMB).toBeDefined();
    });

    it("should handle multiple operations", () => {
        const timer = new PerfTimer("multi");
        timer.start("op1");
        timer.end("op1");
        timer.start("op2");
        timer.end("op2");
        timer.start("op3");
        timer.end("op3");

        const results = timer.getResults();
        expect(results).toHaveLength(3);
        expect(results[0].label).toBe("op1");
        expect(results[1].label).toBe("op2");
        expect(results[2].label).toBe("op3");
    });
});

describe("measureAsync", () => {
    it("should measure async function execution", async () => {
        const { result, timing } = await measureAsync("async-test", async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return 42;
        });

        expect(result).toBe(42);
        expect(timing.label).toBe("async-test");
        expect(timing.durationMs).toBeGreaterThanOrEqual(10);
    });

    it("should track memory for async functions", async () => {
        const { result, timing } = await measureAsync(
            "async-mem",
            async () => {
                const data = new Array(10000).fill(Math.random());
                await Promise.resolve();
                return data.length;
            },
            true
        );

        expect(result).toBe(10000);
        expect(timing.memoryDeltaMB).toBeDefined();
        expect(timing.heapDeltaMB).toBeDefined();
    });

    it("should propagate errors", async () => {
        await expect(
            measureAsync("error-test", async () => {
                throw new Error("test error");
            })
        ).rejects.toThrow("test error");
    });
});

describe("measureSync", () => {
    it("should measure sync function execution", () => {
        const { result, timing } = measureSync("sync-test", () => {
            const start = Date.now();
            while (Date.now() - start < 10) {
                // busy wait
            }
            return 123;
        });

        expect(result).toBe(123);
        expect(timing.label).toBe("sync-test");
        expect(timing.durationMs).toBeGreaterThanOrEqual(8); // Allow 2ms tolerance
    });

    it("should track memory for sync functions", () => {
        const { result, timing } = measureSync(
            "sync-mem",
            () => {
                const data = new Array(10000).fill(Math.random());
                return data.length;
            },
            true
        );

        expect(result).toBe(10000);
        expect(timing.memoryDeltaMB).toBeDefined();
        expect(timing.heapDeltaMB).toBeDefined();
    });
});

describe("CheckpointLogger", () => {
    it("should track elapsed time", () => {
        const logger = new CheckpointLogger("test", 100);
        const start = Date.now();

        while (Date.now() - start < 10) {
            // busy wait
        }

        const elapsed = logger.elapsed();
        expect(elapsed).toBeGreaterThanOrEqual(8); // Allow 2ms tolerance
    });

    it("should count checkpoints", () => {
        const logger = new CheckpointLogger("test", 1000);
        logger.checkpoint();
        logger.checkpoint();
        logger.checkpoint();

        expect(logger.getCount()).toBe(3);
    });

    it("should log at intervals", () => {
        const logger = new CheckpointLogger("test", 5); // 5ms interval
        logger.checkpoint("first");

        // Wait for interval
        const start = Date.now();
        while (Date.now() - start < 10) {
            // busy wait
        }

        logger.checkpoint("second");
        expect(logger.getCount()).toBe(2);
    });
});

describe("BatchTimer", () => {
    it("should collect samples", () => {
        const timer = new BatchTimer("test-batch");

        for (let i = 0; i < 5; i++) {
            timer.start();
            const start = Date.now();
            while (Date.now() - start < 5) {
                // busy wait
            }
            timer.end();
        }

        const stats = timer.getStats();
        expect(stats).toBeDefined();
        expect(stats!.count).toBe(5);
        expect(stats!.mean).toBeGreaterThanOrEqual(4); // Allow 1ms tolerance
        expect(stats!.min).toBeLessThanOrEqual(stats!.mean);
        expect(stats!.max).toBeGreaterThanOrEqual(stats!.mean);
    });

    it("should calculate percentiles correctly", () => {
        const timer = new BatchTimer("percentile-test");

        // Add samples with known distribution
        const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        for (const duration of samples) {
            timer.start();
            // Simulate duration (fake internal state for testing)
            (timer as any).startTime = performance.now() - duration;
            timer.end();
        }

        const stats = timer.getStats();
        expect(stats).toBeDefined();
        expect(stats!.count).toBe(10);
        // Verify min/max are in expected range (allow for timing precision)
        expect(stats!.min).toBeGreaterThanOrEqual(9);
        expect(stats!.min).toBeLessThan(11);
        expect(stats!.max).toBeGreaterThanOrEqual(99);
        expect(stats!.max).toBeLessThan(101);
        // Verify percentiles are in expected ranges
        expect(stats!.p50).toBeGreaterThanOrEqual(49);
        expect(stats!.p50).toBeLessThan(51);
        expect(stats!.p95).toBeGreaterThanOrEqual(94);
        expect(stats!.p95).toBeLessThan(101); // p95 can be max value
        expect(stats!.p99).toBeGreaterThanOrEqual(99);
        expect(stats!.p99).toBeLessThan(101);
    });

    it("should return null stats when empty", () => {
        const timer = new BatchTimer("empty");
        const stats = timer.getStats();
        expect(stats).toBeNull();
    });

    it("should reset samples", () => {
        const timer = new BatchTimer("reset-test");
        timer.start();
        timer.end();

        expect(timer.getStats()!.count).toBe(1);

        timer.reset();
        expect(timer.getStats()).toBeNull();
    });

    it("should handle end without start gracefully", () => {
        const timer = new BatchTimer("no-start");
        timer.end(); // Should not throw

        const stats = timer.getStats();
        expect(stats).toBeNull();
    });
});

describe("Factory functions", () => {
    it("should create PerfTimer via factory", () => {
        const timer = createPerfTimer("factory-test", true);
        expect(timer).toBeInstanceOf(PerfTimer);
        timer.start("op");
        timer.end("op");
        const results = timer.getResults();
        expect(results).toHaveLength(1);
    });

    it("should create CheckpointLogger via factory", () => {
        const logger = createCheckpointLogger("factory-test", 1000);
        expect(logger).toBeInstanceOf(CheckpointLogger);
        logger.checkpoint();
        expect(logger.getCount()).toBe(1);
    });

    it("should create BatchTimer via factory", () => {
        const timer = createBatchTimer("factory-test");
        expect(timer).toBeInstanceOf(BatchTimer);
        timer.start();
        timer.end();
        expect(timer.getStats()!.count).toBe(1);
    });
});
