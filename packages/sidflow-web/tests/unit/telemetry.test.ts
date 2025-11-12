/**
 * Unit tests for the telemetry service.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { telemetry } from '../../lib/telemetry';

describe('TelemetryService', () => {
  beforeEach(() => {
    // Reset telemetry mode before each test
    telemetry.setMode('disabled');
  });

  afterEach(() => {
    delete (globalThis as any).navigator;
    delete (globalThis as any).window;
  });

  it('should have default mode', () => {
    const mode = telemetry.getMode();
    expect(['production', 'test', 'disabled']).toContain(mode);
  });

  it('should allow setting mode', () => {
    telemetry.setMode('test');
    expect(telemetry.getMode()).toBe('test');

    telemetry.setMode('production');
    expect(telemetry.getMode()).toBe('production');

    telemetry.setMode('disabled');
    expect(telemetry.getMode()).toBe('disabled');
  });

  it('should track events in test mode', () => {
    telemetry.setMode('test');
    
    // Set up test sink
    (globalThis as any).window = { telemetrySink: [] };
    
    telemetry.trackPlaybackLoad({
      sessionId: 'test-session',
      sidPath: 'test.sid',
      status: 'start',
    });

    const sink = (globalThis as any).window.telemetrySink;
    expect(sink).toBeDefined();
    expect(sink.length).toBe(1);
    expect(sink[0].type).toBe('playback.load.start');
    expect(sink[0].sessionId).toBe('test-session');
    expect(sink[0].sidPath).toBe('test.sid');
    
    // Clean up
    delete (globalThis as any).window;
  });

  it('should not track events in disabled mode', () => {
    telemetry.setMode('disabled');
    
    // Set up test sink
    (globalThis as any).window = { telemetrySink: [] };
    
    telemetry.trackPlaybackLoad({
      sessionId: 'test-session',
      sidPath: 'test.sid',
      status: 'start',
    });

    const sink = (globalThis as any).window.telemetrySink;
    expect(sink.length).toBe(0);
    
    // Clean up
    delete (globalThis as any).window;
  });

  it('should track playback state changes', () => {
    telemetry.setMode('test');
    (globalThis as any).window = { telemetrySink: [] };

    telemetry.trackPlaybackStateChange({
      sessionId: 'test-session',
      oldState: 'idle',
      newState: 'playing',
      positionSeconds: 0,
    });

    const sink = (globalThis as any).window.telemetrySink;
    expect(sink.length).toBe(1);
    expect(sink[0].type).toBe('playback.state.change');
    expect(sink[0].metadata?.oldState).toBe('idle');
    expect(sink[0].metadata?.newState).toBe('playing');
    
    delete (globalThis as any).window;
  });

  it('should track audio metrics', () => {
    telemetry.setMode('test');
    (globalThis as any).window = { telemetrySink: [] };

    const metrics = {
      underruns: 5,
      zeroByteFrames: 10,
      missedQuanta: 2,
      avgDriftMs: 0.5,
      maxDriftMs: 1.2,
      minOccupancy: 100,
      maxOccupancy: 500,
      framesConsumed: 10000,
      framesProduced: 10000,
      backpressureStalls: 0,
      contextSuspendCount: 1,
      contextResumeCount: 1,
    };

    telemetry.trackAudioMetrics({
      sessionId: 'test-session',
      sidPath: 'test.sid',
      metrics,
    });

    const sink = (globalThis as any).window.telemetrySink;
    expect(sink.length).toBe(1);
    expect(sink[0].type).toBe('playback.audio.metrics');
    expect(sink[0].metadata?.underruns).toBe(5);
    expect(sink[0].metadata?.zeroByteFrames).toBe(10);
    expect(sink[0].metadata?.avgDriftMs).toBe(0.5);
    
    delete (globalThis as any).window;
  });

  it('should track performance metrics', () => {
    telemetry.setMode('test');
    (globalThis as any).window = { telemetrySink: [] };

    telemetry.trackPerformance({
      sessionId: 'perf-session',
      sidPath: 'perf.sid',
      metrics: {
        renderDurationMs: 42,
        loadDurationMs: 77,
        trackDurationSeconds: 180,
        fileSizeBytes: 1024,
      },
    });

    const sink = (globalThis as any).window.telemetrySink;
    expect(sink.length).toBe(1);
    expect(sink[0].type).toBe('playback.performance');
    expect(sink[0].metadata?.renderDurationMs).toBe(42);
    expect(sink[0].metadata?.loadDurationMs).toBe(77);
    expect(sink[0].metadata?.trackDurationSeconds).toBe(180);
    expect(sink[0].metadata?.fileSizeBytes).toBe(1024);

    delete (globalThis as any).window;
  });

  it('should track errors', () => {
    telemetry.setMode('test');
    (globalThis as any).window = { telemetrySink: [] };

    const error = new Error('Test error');
    telemetry.trackPlaybackError({
      sessionId: 'test-session',
      error,
      context: { test: true },
    });

    const sink = (globalThis as any).window.telemetrySink;
    expect(sink.length).toBe(1);
    expect(sink[0].type).toBe('playback.error');
    expect(sink[0].metadata?.error).toBeDefined();
    expect((sink[0].metadata?.error as any).message).toBe('Test error');
  });

  it('sends beacons in production mode when available', async () => {
    telemetry.setMode('production');

    const beacons: Array<{ url: string; blob: Blob }> = [];
    (globalThis as any).navigator = {
      sendBeacon: (url: string, blob: Blob) => {
        beacons.push({ url, blob });
        return true;
      },
    };

    telemetry.trackPlaybackLoad({
      sessionId: 'prod-session',
      sidPath: 'production.sid',
      status: 'success',
      metrics: { loadDurationMs: 123 },
    });

    expect(beacons).toHaveLength(1);
    expect(beacons[0].url).toBe('/api/telemetry');

    const payloadText = await beacons[0].blob.text();
    const payload = JSON.parse(payloadText);

    expect(payload.type).toBe('playback.load.success');
    expect(payload.sessionId).toBe('prod-session');
    expect(payload.sidPath).toBe('production.sid');
    expect(payload.metadata.metrics.loadDurationMs).toBe(123);
  });

  it('warns in development when sendBeacon throws', () => {
  const env = process.env as any;
    const originalEnv = env.NODE_ENV;
    const originalWarn = console.warn;

    telemetry.setMode('production');
    (globalThis as any).navigator = {
      sendBeacon: () => {
        throw new Error('boom');
      },
    };

  env.NODE_ENV = 'development';
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    telemetry.trackPlaybackLoad({
      sessionId: 'dev-warn',
      sidPath: 'warn.sid',
      status: 'success',
    });

    expect(warnings.some(([msg]) => typeof msg === 'string' && msg.includes('Failed to send beacon'))).toBe(true);

    console.warn = originalWarn;
    if (originalEnv === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = originalEnv;
    }
  });
});
