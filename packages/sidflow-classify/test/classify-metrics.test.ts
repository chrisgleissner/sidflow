/**
 * Unit tests for Classification Pipeline Metrics
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  incrementCounter,
  recordTimer,
  setGauge,
  getMetrics,
  resetMetrics,
  formatPrometheusMetrics,
  METRIC_NAMES,
} from "../src/classify-metrics.js";

describe("Classification Pipeline Metrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe("Counter metrics", () => {
    test("increments counter by 1 by default", () => {
      incrementCounter(METRIC_NAMES.FILES_TOTAL);
      
      const metrics = getMetrics();
      const counter = metrics.counters.get(METRIC_NAMES.FILES_TOTAL);
      
      expect(counter).toBeDefined();
      expect(counter?.value).toBe(1);
    });

    test("increments counter by specified amount", () => {
      incrementCounter(METRIC_NAMES.FILES_TOTAL, 5);
      incrementCounter(METRIC_NAMES.FILES_TOTAL, 3);
      
      const metrics = getMetrics();
      const counter = metrics.counters.get(METRIC_NAMES.FILES_TOTAL);
      
      expect(counter?.value).toBe(8);
    });

    test("tracks counters with different labels separately", () => {
      incrementCounter(METRIC_NAMES.FILES_TOTAL, 1, { phase: "render" });
      incrementCounter(METRIC_NAMES.FILES_TOTAL, 2, { phase: "extract" });
      incrementCounter(METRIC_NAMES.FILES_TOTAL, 1, { phase: "render" });
      
      const metrics = getMetrics();
      
      expect(metrics.counters.size).toBe(2);
      
      const renderCounter = metrics.counters.get(`${METRIC_NAMES.FILES_TOTAL}{phase="render"}`);
      const extractCounter = metrics.counters.get(`${METRIC_NAMES.FILES_TOTAL}{phase="extract"}`);
      
      expect(renderCounter?.value).toBe(2);
      expect(extractCounter?.value).toBe(2);
    });
  });

  describe("Timer metrics", () => {
    test("records single timer observation", () => {
      recordTimer(METRIC_NAMES.RENDER_DURATION, 150);
      
      const metrics = getMetrics();
      const timer = metrics.timers.get(METRIC_NAMES.RENDER_DURATION);
      
      expect(timer).toBeDefined();
      expect(timer?.count).toBe(1);
      expect(timer?.sum).toBe(150);
      expect(timer?.min).toBe(150);
      expect(timer?.max).toBe(150);
      expect(timer?.mean).toBe(150);
    });

    test("computes timer statistics correctly", () => {
      recordTimer(METRIC_NAMES.RENDER_DURATION, 100);
      recordTimer(METRIC_NAMES.RENDER_DURATION, 200);
      recordTimer(METRIC_NAMES.RENDER_DURATION, 300);
      
      const metrics = getMetrics();
      const timer = metrics.timers.get(METRIC_NAMES.RENDER_DURATION);
      
      expect(timer?.count).toBe(3);
      expect(timer?.sum).toBe(600);
      expect(timer?.min).toBe(100);
      expect(timer?.max).toBe(300);
      expect(timer?.mean).toBe(200);
    });

    test("tracks timers with different labels separately", () => {
      recordTimer(METRIC_NAMES.RENDER_DURATION, 100, { engine: "wasm" });
      recordTimer(METRIC_NAMES.RENDER_DURATION, 200, { engine: "cli" });
      recordTimer(METRIC_NAMES.RENDER_DURATION, 150, { engine: "wasm" });
      
      const metrics = getMetrics();
      
      expect(metrics.timers.size).toBe(2);
      
      const wasmTimer = metrics.timers.get(`${METRIC_NAMES.RENDER_DURATION}{engine="wasm"}`);
      const cliTimer = metrics.timers.get(`${METRIC_NAMES.RENDER_DURATION}{engine="cli"}`);
      
      expect(wasmTimer?.count).toBe(2);
      expect(wasmTimer?.mean).toBe(125);
      expect(cliTimer?.count).toBe(1);
    });
  });

  describe("Gauge metrics", () => {
    test("sets gauge value", () => {
      setGauge(METRIC_NAMES.QUEUE_DEPTH, 5);
      
      const metrics = getMetrics();
      const gauge = metrics.gauges.get(METRIC_NAMES.QUEUE_DEPTH);
      
      expect(gauge).toBeDefined();
      expect(gauge?.value).toBe(5);
    });

    test("overwrites previous gauge value", () => {
      setGauge(METRIC_NAMES.QUEUE_DEPTH, 5);
      setGauge(METRIC_NAMES.QUEUE_DEPTH, 3);
      setGauge(METRIC_NAMES.QUEUE_DEPTH, 10);
      
      const metrics = getMetrics();
      const gauge = metrics.gauges.get(METRIC_NAMES.QUEUE_DEPTH);
      
      expect(gauge?.value).toBe(10);
    });

    test("tracks gauges with different labels separately", () => {
      setGauge(METRIC_NAMES.THREAD_STATUS, 1, { thread: "1", status: "working" });
      setGauge(METRIC_NAMES.THREAD_STATUS, 0, { thread: "2", status: "idle" });
      
      const metrics = getMetrics();
      
      expect(metrics.gauges.size).toBe(2);
    });
  });

  describe("Prometheus format", () => {
    test("formats empty metrics", () => {
      const output = formatPrometheusMetrics();
      
      expect(output).toContain("sidflow_classify_uptime_seconds");
    });

    test("formats counters correctly", () => {
      incrementCounter(METRIC_NAMES.FILES_TOTAL, 10);
      incrementCounter(METRIC_NAMES.ERRORS_TOTAL, 2);
      
      const output = formatPrometheusMetrics();
      
      expect(output).toContain("# TYPE sidflow_classify_files_total counter");
      expect(output).toContain("sidflow_classify_files_total 10");
      expect(output).toContain("sidflow_classify_errors_total 2");
    });

    test("formats timers correctly", () => {
      recordTimer(METRIC_NAMES.RENDER_DURATION, 1000);
      recordTimer(METRIC_NAMES.RENDER_DURATION, 2000);
      
      const output = formatPrometheusMetrics();
      
      expect(output).toContain("# TYPE sidflow_classify_render_seconds summary");
      expect(output).toContain("sidflow_classify_render_seconds_count 2");
      expect(output).toContain("sidflow_classify_render_seconds_sum 3.000");
    });

    test("formats gauges correctly", () => {
      setGauge(METRIC_NAMES.QUEUE_DEPTH, 5);
      
      const output = formatPrometheusMetrics();
      
      expect(output).toContain("# TYPE sidflow_classify_queue_depth gauge");
      expect(output).toContain("sidflow_classify_queue_depth 5");
    });

    test("formats labels correctly", () => {
      incrementCounter(METRIC_NAMES.FILES_TOTAL, 3, { phase: "render", engine: "wasm" });
      
      const output = formatPrometheusMetrics();
      
      // Labels should be sorted alphabetically
      expect(output).toContain(`sidflow_classify_files_total{engine="wasm",phase="render"} 3`);
    });
  });

  describe("Reset", () => {
    test("resetMetrics clears all metrics", () => {
      incrementCounter(METRIC_NAMES.FILES_TOTAL, 10);
      recordTimer(METRIC_NAMES.RENDER_DURATION, 100);
      setGauge(METRIC_NAMES.QUEUE_DEPTH, 5);
      
      resetMetrics();
      
      const metrics = getMetrics();
      
      expect(metrics.counters.size).toBe(0);
      expect(metrics.timers.size).toBe(0);
      expect(metrics.gauges.size).toBe(0);
    });

    test("resetMetrics resets startedAt", () => {
      const before = getMetrics().startedAt;
      
      // Wait a tiny bit
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }
      
      resetMetrics();
      
      const after = getMetrics().startedAt;
      
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  describe("Snapshot isolation", () => {
    test("getMetrics returns a copy", () => {
      incrementCounter(METRIC_NAMES.FILES_TOTAL, 5);
      
      const snapshot1 = getMetrics();
      
      incrementCounter(METRIC_NAMES.FILES_TOTAL, 3);
      
      const snapshot2 = getMetrics();
      
      // Original snapshot should be unchanged
      expect(snapshot1.counters.get(METRIC_NAMES.FILES_TOTAL)?.value).toBe(5);
      expect(snapshot2.counters.get(METRIC_NAMES.FILES_TOTAL)?.value).toBe(8);
    });
  });
});
