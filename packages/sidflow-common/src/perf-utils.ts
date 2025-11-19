/**
 * Performance measurement utilities for SIDFlow
 * Provides consistent timing, memory tracking, and metrics collection across all packages
 */

import { createLogger } from "./logger.js";

const perfLogger = createLogger("perf");

export interface TimerSnapshot {
    label: string;
    startTime: number;
    startMemory?: NodeJS.MemoryUsage;
}

export interface TimingResult {
    label: string;
    durationMs: number;
    memoryDeltaMB?: number;
    heapDeltaMB?: number;
}

export interface PerformanceProfile {
    name: string;
    startTime: number;
    endTime?: number;
    durationMs?: number;
    timings: TimingResult[];
    peakMemoryMB?: number;
    metadata?: Record<string, unknown>;
}

/**
 * High-resolution timer for performance measurement
 */
export class PerfTimer {
    private snapshots = new Map<string, TimerSnapshot>();
    private results: TimingResult[] = [];
    private profileStartTime: number;
    private profileStartMemory?: NodeJS.MemoryUsage;

    constructor(
        private name: string,
        private trackMemory = false
    ) {
        this.profileStartTime = performance.now();
        if (this.trackMemory && typeof process !== "undefined") {
            this.profileStartMemory = process.memoryUsage();
        }
    }

    /**
     * Start timing a labeled operation
     */
    start(label: string): void {
        const startTime = performance.now();
        const startMemory =
            this.trackMemory && typeof process !== "undefined"
                ? process.memoryUsage()
                : undefined;

        this.snapshots.set(label, { label, startTime, startMemory });
    }

    /**
     * End timing for a labeled operation and record result
     */
    end(label: string): TimingResult | null {
        const endTime = performance.now();
        const snapshot = this.snapshots.get(label);

        if (!snapshot) {
            perfLogger.warn(`No start time found for label: ${label}`);
            return null;
        }

        const durationMs = endTime - snapshot.startTime;
        let memoryDeltaMB: number | undefined;
        let heapDeltaMB: number | undefined;

        if (this.trackMemory && snapshot.startMemory && typeof process !== "undefined") {
            const endMemory = process.memoryUsage();
            memoryDeltaMB = (endMemory.rss - snapshot.startMemory.rss) / 1024 / 1024;
            heapDeltaMB = (endMemory.heapUsed - snapshot.startMemory.heapUsed) / 1024 / 1024;
        }

        const result: TimingResult = {
            label,
            durationMs,
            memoryDeltaMB,
            heapDeltaMB,
        };

        this.results.push(result);
        this.snapshots.delete(label);

        return result;
    }

    /**
     * Record a timing without explicit start/end
     */
    record(label: string, durationMs: number, metadata?: Partial<TimingResult>): void {
        this.results.push({ label, durationMs, ...metadata });
    }

    /**
     * Get all recorded timings
     */
    getResults(): TimingResult[] {
        return [...this.results];
    }

    /**
     * Generate a complete performance profile
     */
    finish(metadata?: Record<string, unknown>): PerformanceProfile {
        const endTime = performance.now();
        const durationMs = endTime - this.profileStartTime;

        let peakMemoryMB: number | undefined;
        if (this.trackMemory && typeof process !== "undefined") {
            const currentMemory = process.memoryUsage();
            peakMemoryMB = currentMemory.rss / 1024 / 1024;
        }

        return {
            name: this.name,
            startTime: this.profileStartTime,
            endTime,
            durationMs,
            timings: this.results,
            peakMemoryMB,
            metadata,
        };
    }

    /**
     * Log all results to console
     */
    logResults(level: "debug" | "info" = "debug"): void {
        const profile = this.finish();
        const lines = [
            `Performance profile: ${this.name}`,
            `  Total duration: ${(profile.durationMs ?? 0).toFixed(2)}ms`,
        ];

        if (profile.peakMemoryMB !== undefined) {
            lines.push(`  Peak memory: ${profile.peakMemoryMB.toFixed(2)}MB`);
        }

        if (profile.timings.length > 0) {
            lines.push("  Timings:");
            for (const timing of profile.timings) {
                let line = `    ${timing.label}: ${timing.durationMs.toFixed(2)}ms`;
                if (timing.memoryDeltaMB !== undefined) {
                    line += ` (mem: ${timing.memoryDeltaMB >= 0 ? "+" : ""}${timing.memoryDeltaMB.toFixed(2)}MB)`;
                }
                lines.push(line);
            }
        }

        const message = lines.join("\n");
        if (level === "info") {
            perfLogger.info(message);
        } else {
            perfLogger.debug(message);
        }
    }
}

/**
 * Create a timer for measuring operation performance
 */
export function createPerfTimer(name: string, trackMemory = false): PerfTimer {
    return new PerfTimer(name, trackMemory);
}

/**
 * Measure the execution time of an async function
 */
export async function measureAsync<T>(
    label: string,
    fn: () => Promise<T>,
    trackMemory = false
): Promise<{ result: T; timing: TimingResult }> {
    const timer = new PerfTimer(label, trackMemory);
    timer.start(label);

    const result = await fn();

    const timing = timer.end(label);
    if (!timing) {
        throw new Error(`Failed to measure timing for: ${label}`);
    }

    return { result, timing };
}

/**
 * Measure the execution time of a sync function
 */
export function measureSync<T>(
    label: string,
    fn: () => T,
    trackMemory = false
): { result: T; timing: TimingResult } {
    const timer = new PerfTimer(label, trackMemory);
    timer.start(label);

    const result = fn();

    const timing = timer.end(label);
    if (!timing) {
        throw new Error(`Failed to measure timing for: ${label}`);
    }

    return { result, timing };
}

/**
 * Create a performance checkpoint logger with configurable intervals
 */
export class CheckpointLogger {
    private lastLog = 0;
    private startTime = performance.now();
    private count = 0;

    constructor(
        private name: string,
        private intervalMs: number = 5000
    ) { }

    /**
     * Log a checkpoint if interval has elapsed
     */
    checkpoint(message?: string): void {
        this.count++;
        const now = performance.now();
        const elapsed = now - this.lastLog;

        if (elapsed >= this.intervalMs) {
            const total = now - this.startTime;
            const msg = message ? ` - ${message}` : "";
            perfLogger.info(`[${this.name}] +${elapsed.toFixed(0)}ms (total: ${total.toFixed(0)}ms)${msg}`);
            this.lastLog = now;
        }
    }

    /**
     * Force log current state
     */
    log(message: string): void {
        const now = performance.now();
        const total = now - this.startTime;
        perfLogger.info(`[${this.name}] ${message} (${total.toFixed(0)}ms)`);
        this.lastLog = now;
    }

    /**
     * Get total elapsed time
     */
    elapsed(): number {
        return performance.now() - this.startTime;
    }

    /**
     * Get checkpoint count
     */
    getCount(): number {
        return this.count;
    }
}

/**
 * Create a checkpoint logger for periodic progress updates
 */
export function createCheckpointLogger(name: string, intervalMs = 5000): CheckpointLogger {
    return new CheckpointLogger(name, intervalMs);
}

/**
 * Batch timer for measuring repeated operations
 */
export class BatchTimer {
    private samples: number[] = [];
    private startTime?: number;

    constructor(private label: string) { }

    /**
     * Start timing a batch operation
     */
    start(): void {
        this.startTime = performance.now();
    }

    /**
     * End timing and record sample
     */
    end(): void {
        if (this.startTime === undefined) {
            perfLogger.warn(`BatchTimer ${this.label}: end() called without start()`);
            return;
        }

        const duration = performance.now() - this.startTime;
        this.samples.push(duration);
        this.startTime = undefined;
    }

    /**
     * Get statistics for all recorded samples
     */
    getStats(): {
        count: number;
        total: number;
        mean: number;
        min: number;
        max: number;
        p50: number;
        p95: number;
        p99: number;
    } | null {
        if (this.samples.length === 0) {
            return null;
        }

        const sorted = [...this.samples].sort((a, b) => a - b);
        const count = sorted.length;
        const total = sorted.reduce((sum, val) => sum + val, 0);
        const mean = total / count;

        const percentile = (p: number): number => {
            const index = Math.ceil((p / 100) * count) - 1;
            return sorted[Math.max(0, index)];
        };

        return {
            count,
            total,
            mean,
            min: sorted[0],
            max: sorted[count - 1],
            p50: percentile(50),
            p95: percentile(95),
            p99: percentile(99),
        };
    }

    /**
     * Log statistics
     */
    logStats(): void {
        const stats = this.getStats();
        if (!stats) {
            perfLogger.debug(`BatchTimer ${this.label}: No samples recorded`);
            return;
        }

        perfLogger.info(
            `BatchTimer ${this.label}: ` +
            `count=${stats.count}, ` +
            `mean=${stats.mean.toFixed(2)}ms, ` +
            `min=${stats.min.toFixed(2)}ms, ` +
            `max=${stats.max.toFixed(2)}ms, ` +
            `p50=${stats.p50.toFixed(2)}ms, ` +
            `p95=${stats.p95.toFixed(2)}ms, ` +
            `p99=${stats.p99.toFixed(2)}ms`
        );
    }

    /**
     * Reset all samples
     */
    reset(): void {
        this.samples = [];
        this.startTime = undefined;
    }
}

/**
 * Create a batch timer for measuring repeated operations
 */
export function createBatchTimer(label: string): BatchTimer {
    return new BatchTimer(label);
}
