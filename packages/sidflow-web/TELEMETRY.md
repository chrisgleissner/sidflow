# Audio Telemetry System

The SIDFlow audio telemetry system provides production-grade monitoring of audio playback health without impacting performance.

## Features

### Metrics Tracked

1. **Underruns**: Count of audio buffer underruns (playback stalls)
2. **Zero-byte Frames**: Frames that are completely silent (potential dropouts)
3. **Missed Quanta**: AudioWorklet process() calls that couldn't fulfill the request
4. **Timing Drift**: Average and maximum callback timing drift in milliseconds
5. **Buffer Occupancy**: Min/max buffer fill levels (in frames)
6. **Frame Counters**: Frames consumed (worklet) and produced (worker)
7. **Backpressure Stalls**: Producer stalls when buffer is full
8. **Audio Context Events**: Suspend and resume event counts

### Performance Characteristics

- **Zero allocations** on the audio thread (worklet)
- **Atomic operations** only for metric updates
- **Background sampling** every ~3.6 seconds (128 audio quanta)
- **Async telemetry** using `navigator.sendBeacon` (non-blocking)
- **< 1% CPU overhead** under normal operation

## Usage

### In Production

Telemetry is automatically enabled in production mode and sends data to the analytics endpoint via `navigator.sendBeacon`:

```typescript
// Telemetry is automatically tracked during playback
const player = new WorkletPlayer();
await player.load({ session, track });
await player.play();

// Get current metrics
const telemetry = player.getTelemetry();
console.log('Underruns:', telemetry.underruns);
console.log('Avg drift:', telemetry.avgDriftMs, 'ms');
```

### In Tests (Playwright E2E)

For E2E tests, set telemetry to test mode to redirect events to an in-memory sink:

```typescript
// In Playwright test
await page.evaluate(() => {
  (window as any).NEXT_PUBLIC_TELEMETRY_MODE = 'test';
  (window as any).telemetrySink = [];
});

// Trigger playback...

// Verify telemetry
const events = await page.evaluate(() => (window as any).telemetrySink);
expect(events.length).toBeGreaterThan(0);

// Or get telemetry directly from player
const telemetry = await page.evaluate(() => {
  const player = (window as any).__sidflowPlayer;
  return player?.getTelemetry();
});
expect(telemetry.underruns).toBe(0);
```

### Configuration

Set the telemetry mode via environment variable:

```bash
# Production mode (default) - sends to analytics service
NEXT_PUBLIC_TELEMETRY_MODE=production

# Test mode - redirects to window.telemetrySink
NEXT_PUBLIC_TELEMETRY_MODE=test

# Disabled - no recording
NEXT_PUBLIC_TELEMETRY_MODE=disabled
```

Or programmatically:

```typescript
import { telemetry } from '@/lib/telemetry';

telemetry.setMode('test');
```

## Telemetry Dashboard

A lightweight dashboard component displays real-time telemetry during development:

```tsx
import { TelemetryDashboard } from '@/components/TelemetryDashboard';
import { useTelemetry } from '@/lib/hooks/useTelemetry';

function MyComponent() {
  const player = usePlayer();
  const telemetry = useTelemetry(player);
  
  return (
    <div>
      {/* Your UI */}
      <TelemetryDashboard telemetry={telemetry} />
    </div>
  );
}
```

To enable the dashboard:
1. Set `localStorage.showTelemetry = 'true'` in browser console
2. Refresh the page
3. Dashboard appears in bottom-right corner

## Architecture

### Audio Thread (Hot Path)

The AudioWorklet processor (`sid-renderer.worklet.ts`) updates metrics using simple counters:

```typescript
// ✓ No allocations
this.underruns++;
this.zeroByteFrames++;

// ✓ No logging in production
// ✓ No JSON encoding
// ✓ No network calls
```

Metrics are sent off-thread every ~3.6 seconds via `postMessage`.

### Main Thread (Background)

The `WorkletPlayer` receives telemetry messages and updates its internal state:

```typescript
private handleWorkletMessage(data: unknown): void {
  if (message.type === 'telemetry') {
    this.telemetry.underruns = tel.underruns;
    this.telemetry.avgDriftMs = tel.totalDriftMs;
    // ...
  }
}
```

The telemetry service batches and sends data asynchronously:

```typescript
// Non-blocking beacon API
const blob = new Blob([JSON.stringify(event)], { type: 'application/json' });
navigator.sendBeacon('/api/telemetry', blob);
```

### React Components

Components use the `useTelemetry` hook which polls every 3 seconds to minimize re-renders:

```typescript
const telemetry = useTelemetry(player); // Updates every 3s
```

## Metrics Interpretation

### Healthy Playback
- **Underruns**: 0
- **Zero-byte frames**: < 1% of total frames
- **Avg drift**: < 0.5ms
- **Max drift**: < 2.0ms
- **Min occupancy**: > 0 frames
- **Max occupancy**: < 90% of buffer capacity

### Warning Signs
- **Underruns > 0**: Buffer starvation, CPU too slow, or network issues
- **High zero-byte rate**: Possible WASM renderer issues or silence in audio
- **High drift**: Scheduling issues, background CPU load
- **Low min occupancy**: Producer not keeping up with consumer
- **High max occupancy**: Consumer not keeping up with producer

### Induced Failures
To test telemetry, you can artificially induce failures:

```typescript
// Slow down producer to cause underruns
// (for testing only!)
await new Promise(resolve => setTimeout(resolve, 100));
```

## E2E Testing

See `tests/e2e/telemetry-validation.spec.ts` for comprehensive validation tests:

- No underruns during normal playback
- Zero-byte frames stay minimal
- Timing drift within bounds
- Buffer occupancy remains healthy
- Telemetry sink captures events in test mode

## API Reference

### TelemetryData

```typescript
interface TelemetryData {
  underruns: number;              // Count of buffer underruns
  framesConsumed: number;         // Total frames consumed by worklet
  framesProduced: number;         // Total frames produced by worker
  backpressureStalls: number;     // Producer stalls (buffer full)
  minOccupancy: number;           // Min buffer fill level (frames)
  maxOccupancy: number;           // Max buffer fill level (frames)
  zeroByteFrames: number;         // Completely silent frames
  missedQuanta: number;           // Failed process() calls
  avgDriftMs: number;             // Average timing drift (ms)
  maxDriftMs: number;             // Maximum timing drift (ms)
  contextSuspendCount: number;    // AudioContext suspensions
  contextResumeCount: number;     // AudioContext resumptions
}
```

### TelemetryService Methods

```typescript
// Set telemetry mode
telemetry.setMode('production' | 'test' | 'disabled');

// Get current mode
const mode = telemetry.getMode();

// Track events
telemetry.trackPlaybackLoad({ sessionId, sidPath, status });
telemetry.trackPlaybackStateChange({ sessionId, oldState, newState });
telemetry.trackPlaybackError({ sessionId, error });
telemetry.trackAudioMetrics({ sessionId, metrics });
```

### WorkletPlayer Methods

```typescript
// Get current telemetry snapshot
const telemetry = player.getTelemetry();
```

## Best Practices

1. **Never** perform heavy operations in telemetry path
2. **Always** use atomic counters on audio thread
3. **Defer** all logging, encoding, and network to background thread
4. **Sample** metrics periodically, not on every frame
5. **Drop** telemetry data under load rather than blocking playback
6. **Test** with induced failures to verify detection works

## Troubleshooting

### Dashboard not showing
- Check `localStorage.showTelemetry` is set to `'true'`
- Verify you're in development mode or have explicitly enabled it
- Refresh the page after setting localStorage

### Telemetry always shows 0
- Ensure playback has started
- Wait at least 3-4 seconds for first telemetry update
- Check browser console for errors

### Tests failing with high underruns
> **Note:** The end-to-end (E2E) tests expect exactly **zero** underruns. Any non-zero underrun count will cause the test to fail.
>
> If you are running tests on a resource-constrained system or in a noisy environment, underruns may occur. In such cases, consider:
- Verifying your system has enough CPU/memory
- Checking for background processes that may interfere with audio processing
- Increasing the test timeout if needed
- Running tests serially (`workers: 1`)

If you believe underruns are unavoidable in your environment and want to relax the test, you may need to adjust the test assertions or consult the test configuration to allow a non-zero underrun threshold.
### Beacon sending fails
- Check `/api/telemetry` endpoint exists
- Verify CORS settings allow beacons
- Check browser console for network errors
- Telemetry failures are silent by design
