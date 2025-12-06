/**
 * Classification Pipeline Metrics
 * 
 * Collects and exposes metrics for the classification pipeline:
 * - Counter: Files processed, rendered, skipped, errors
 * - Timer: Per-phase durations (render, extract, predict)
 * - Gauge: Current thread status, queue depth
 * 
 * Compatible with Prometheus exposition format.
 */

import { createLogger } from "@sidflow/common";

const logger = createLogger("classify-metrics");

/**
 * Counter metric - monotonically increasing value
 */
export interface Counter {
  name: string;
  value: number;
  labels: Record<string, string>;
}

/**
 * Timer metric - distribution of durations
 */
export interface Timer {
  name: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  labels: Record<string, string>;
}

/**
 * Gauge metric - current value that can go up or down
 */
export interface Gauge {
  name: string;
  value: number;
  labels: Record<string, string>;
}

/**
 * Classification metrics snapshot
 */
export interface ClassificationMetrics {
  counters: Map<string, Counter>;
  timers: Map<string, Timer>;
  gauges: Map<string, Gauge>;
  startedAt: number;
  lastUpdatedAt: number;
}

// Global metrics state
let metrics: ClassificationMetrics = createEmptyMetrics();

/**
 * Create empty metrics structure
 */
function createEmptyMetrics(): ClassificationMetrics {
  return {
    counters: new Map(),
    timers: new Map(),
    gauges: new Map(),
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
  };
}

/**
 * Get metric key including labels
 */
function getMetricKey(name: string, labels: Record<string, string>): string {
  const labelStr = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
  return labelStr ? `${name}{${labelStr}}` : name;
}

/**
 * Increment a counter metric
 */
export function incrementCounter(
  name: string,
  amount = 1,
  labels: Record<string, string> = {}
): void {
  const key = getMetricKey(name, labels);
  const existing = metrics.counters.get(key);
  
  if (existing) {
    existing.value += amount;
  } else {
    metrics.counters.set(key, {
      name,
      value: amount,
      labels,
    });
  }
  metrics.lastUpdatedAt = Date.now();
}

/**
 * Record a timer observation
 */
export function recordTimer(
  name: string,
  durationMs: number,
  labels: Record<string, string> = {}
): void {
  const key = getMetricKey(name, labels);
  const existing = metrics.timers.get(key);
  
  if (existing) {
    existing.count += 1;
    existing.sum += durationMs;
    existing.min = Math.min(existing.min, durationMs);
    existing.max = Math.max(existing.max, durationMs);
    existing.mean = existing.sum / existing.count;
  } else {
    metrics.timers.set(key, {
      name,
      count: 1,
      sum: durationMs,
      min: durationMs,
      max: durationMs,
      mean: durationMs,
      labels,
    });
  }
  metrics.lastUpdatedAt = Date.now();
}

/**
 * Set a gauge metric value
 */
export function setGauge(
  name: string,
  value: number,
  labels: Record<string, string> = {}
): void {
  const key = getMetricKey(name, labels);
  
  metrics.gauges.set(key, {
    name,
    value,
    labels,
  });
  metrics.lastUpdatedAt = Date.now();
}

/**
 * Get current metrics snapshot (deep copy)
 */
export function getMetrics(): ClassificationMetrics {
  // Deep copy counters
  const countersCopy = new Map<string, Counter>();
  for (const [key, value] of metrics.counters) {
    countersCopy.set(key, { ...value, labels: { ...value.labels } });
  }
  
  // Deep copy timers
  const timersCopy = new Map<string, Timer>();
  for (const [key, value] of metrics.timers) {
    timersCopy.set(key, { ...value, labels: { ...value.labels } });
  }
  
  // Deep copy gauges
  const gaugesCopy = new Map<string, Gauge>();
  for (const [key, value] of metrics.gauges) {
    gaugesCopy.set(key, { ...value, labels: { ...value.labels } });
  }
  
  return {
    ...metrics,
    counters: countersCopy,
    timers: timersCopy,
    gauges: gaugesCopy,
  };
}

/**
 * Reset all metrics
 */
export function resetMetrics(): void {
  metrics = createEmptyMetrics();
}

/**
 * Format metrics in Prometheus exposition format
 */
export function formatPrometheusMetrics(): string {
  const lines: string[] = [];
  const now = Date.now();
  
  // Add uptime gauge
  const uptimeMs = now - metrics.startedAt;
  lines.push("# HELP sidflow_classify_uptime_seconds Classification pipeline uptime in seconds");
  lines.push("# TYPE sidflow_classify_uptime_seconds gauge");
  lines.push(`sidflow_classify_uptime_seconds ${(uptimeMs / 1000).toFixed(3)}`);
  lines.push("");
  
  // Add counters
  if (metrics.counters.size > 0) {
    const counterNames = new Set([...metrics.counters.values()].map(c => c.name));
    for (const name of counterNames) {
      lines.push(`# HELP ${name} Classification counter`);
      lines.push(`# TYPE ${name} counter`);
      for (const [key, counter] of metrics.counters) {
        if (counter.name === name) {
          lines.push(`${key} ${counter.value}`);
        }
      }
      lines.push("");
    }
  }
  
  // Add timers (as histogram-style metrics)
  if (metrics.timers.size > 0) {
    const timerNames = new Set([...metrics.timers.values()].map(t => t.name));
    for (const name of timerNames) {
      lines.push(`# HELP ${name}_seconds Classification timer in seconds`);
      lines.push(`# TYPE ${name}_seconds summary`);
      for (const [key, timer] of metrics.timers) {
        if (timer.name === name) {
          const baseKey = key.replace(name, `${name}_seconds`);
          const labelPart = baseKey.includes("{") 
            ? baseKey.substring(baseKey.indexOf("{"))
            : "";
          const baseName = `${name}_seconds`;
          lines.push(`${baseName}_count${labelPart} ${timer.count}`);
          lines.push(`${baseName}_sum${labelPart} ${(timer.sum / 1000).toFixed(6)}`);
          lines.push(`${baseName}_min${labelPart} ${(timer.min / 1000).toFixed(6)}`);
          lines.push(`${baseName}_max${labelPart} ${(timer.max / 1000).toFixed(6)}`);
          lines.push(`${baseName}_mean${labelPart} ${(timer.mean / 1000).toFixed(6)}`);
        }
      }
      lines.push("");
    }
  }
  
  // Add gauges
  if (metrics.gauges.size > 0) {
    const gaugeNames = new Set([...metrics.gauges.values()].map(g => g.name));
    for (const name of gaugeNames) {
      lines.push(`# HELP ${name} Classification gauge`);
      lines.push(`# TYPE ${name} gauge`);
      for (const [key, gauge] of metrics.gauges) {
        if (gauge.name === name) {
          lines.push(`${key} ${gauge.value}`);
        }
      }
      lines.push("");
    }
  }
  
  return lines.join("\n");
}

/**
 * Log metrics summary at INFO level
 */
export function logMetricsSummary(): void {
  const m = getMetrics();
  
  // Extract key counters
  const filesProcessed = [...m.counters.values()]
    .filter(c => c.name === "sidflow_classify_files_total")
    .reduce((sum, c) => sum + c.value, 0);
  
  const filesRendered = [...m.counters.values()]
    .filter(c => c.name === "sidflow_classify_rendered_total")
    .reduce((sum, c) => sum + c.value, 0);
  
  const filesSkipped = [...m.counters.values()]
    .filter(c => c.name === "sidflow_classify_skipped_total")
    .reduce((sum, c) => sum + c.value, 0);
  
  const errors = [...m.counters.values()]
    .filter(c => c.name === "sidflow_classify_errors_total")
    .reduce((sum, c) => sum + c.value, 0);
  
  // Extract key timers
  const renderTimer = [...m.timers.values()].find(t => t.name === "sidflow_classify_render");
  const extractTimer = [...m.timers.values()].find(t => t.name === "sidflow_classify_extract");
  
  const uptimeMs = Date.now() - m.startedAt;
  
  logger.info(`Classification metrics summary:`);
  logger.info(`  Uptime: ${(uptimeMs / 1000).toFixed(1)}s`);
  logger.info(`  Files processed: ${filesProcessed} (rendered: ${filesRendered}, skipped: ${filesSkipped})`);
  logger.info(`  Errors: ${errors}`);
  
  if (renderTimer) {
    logger.info(`  Render: ${renderTimer.count} ops, mean ${renderTimer.mean.toFixed(0)}ms, max ${renderTimer.max.toFixed(0)}ms`);
  }
  
  if (extractTimer) {
    logger.info(`  Extract: ${extractTimer.count} ops, mean ${extractTimer.mean.toFixed(0)}ms, max ${extractTimer.max.toFixed(0)}ms`);
  }
}

// Pre-defined metric names for consistency
export const METRIC_NAMES = {
  FILES_TOTAL: "sidflow_classify_files_total",
  RENDERED_TOTAL: "sidflow_classify_rendered_total",
  SKIPPED_TOTAL: "sidflow_classify_skipped_total",
  ERRORS_TOTAL: "sidflow_classify_errors_total",
  RENDER_DURATION: "sidflow_classify_render",
  EXTRACT_DURATION: "sidflow_classify_extract",
  PREDICT_DURATION: "sidflow_classify_predict",
  JSONL_WRITES: "sidflow_classify_jsonl_writes",
  THREAD_STATUS: "sidflow_classify_thread_status",
  QUEUE_DEPTH: "sidflow_classify_queue_depth",
} as const;
