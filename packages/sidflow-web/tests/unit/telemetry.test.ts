/**
 * Unit tests for the telemetry service.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { telemetry } from '../../lib/telemetry';

describe('TelemetryService', () => {
  beforeEach(() => {
    // Reset telemetry mode before each test
    telemetry.setMode('disabled');
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
    
    delete (globalThis as any).window;
  });
});
