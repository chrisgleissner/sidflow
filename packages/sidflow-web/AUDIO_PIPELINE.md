# Real-Time Audio Pipeline

SIDFlow web uses a high-performance, glitch-free audio pipeline based on AudioWorklet and SharedArrayBuffer for real-time SID music playback.

## Architecture Overview

The audio pipeline consists of three main components:

1. **Web Worker Producer** (`lib/audio/worker/sid-producer.worker.ts`)
   - Hosts the libsidplayfp WASM engine
   - Renders PCM audio at the target sample rate
   - Writes to SharedArrayBuffer ring buffer
   - Handles backpressure when buffer is full

2. **SharedArrayBuffer Ring Buffer** (`lib/audio/shared/sab-ring-buffer.ts`)
   - Lock-free circular buffer using Atomics
   - 128-frame aligned operations (AudioWorklet quantum)
   - ~370ms capacity (16384 frames at 44.1kHz)
   - Single producer → single consumer

3. **AudioWorklet Renderer** (`lib/audio/worklet/sid-renderer.worklet.ts`)
   - Pulls audio from ring buffer
   - Runs on audio thread (no main thread blocking)
   - Handles underruns gracefully (outputs silence)
   - Tracks telemetry (underruns, occupancy)

```
┌──────────────────┐       ┌─────────────────────┐       ┌──────────────────┐
│  Web Worker      │       │  SharedArrayBuffer  │       │  AudioWorklet    │
│  (sid-producer)  │──────▶│  Ring Buffer        │──────▶│  (sid-renderer)  │
│                  │ Write │  (lock-free)        │ Read  │                  │
│  WASM Engine     │       │  128-frame aligned  │       │  128-frame pulls │
│  PCM Render      │       │  ~370ms capacity    │       │  Audio Thread    │
└──────────────────┘       └─────────────────────┘       └──────────────────┘
        │                                                          │
        │                                                          ▼
        │                                               ┌──────────────────┐
        └──────── Telemetry & Control ────────────────▶│  AudioContext    │
                                                        │  Output Device   │
                                                        └──────────────────┘
```

## Cross-Origin Isolation

The pipeline requires `crossOriginIsolated` mode for SharedArrayBuffer support.

### Required Headers

The Next.js middleware (`middleware.ts`) sets:

```typescript
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### Verification

The app checks on startup:

```typescript
if (!window.crossOriginIsolated) {
  // Shows error banner with instructions
}
```

## Data Flow

### Initialization

1. `WorkletPlayer` creates:
   - AudioContext at browser's native sample rate (typically 44.1kHz or 48kHz)
   - SharedArrayBuffer ring buffer (16384 frames, stereo)
   - AudioWorkletNode connected to destination

2. Web Worker initializes:
   - libsidplayfp WASM engine
   - Configures for target sample rate
   - Sets up message handlers

### Playback

1. **Pre-roll Phase**:
   - Worker renders 4096 frames (~93ms at 44.1kHz)
   - Fills ring buffer before starting playback
   - Signals "ready" when pre-roll complete

2. **Active Playback**:
   - Worker renders in 2048-frame chunks
   - Writes to ring buffer (with backpressure handling)
   - Worklet pulls exactly 128 frames per quantum
   - Continues until track ends or stopped

3. **Telemetry**:
   - Worker tracks: frames produced, backpressure stalls, occupancy
   - Worklet tracks: frames consumed, underruns, buffer occupancy
   - Sent periodically via `postMessage`

## Observability

### Telemetry Counters

Both worker and worklet track:

- **framesProduced**: Total frames rendered by WASM engine
- **framesConsumed**: Total frames pulled by worklet
- **underruns**: Count of worklet pulling from empty buffer
- **backpressureStalls**: Count of worker unable to write (buffer full)
- **minOccupancy**: Minimum buffer occupancy (frames)
- **maxOccupancy**: Maximum buffer occupancy (frames)

### Accessing Telemetry

```typescript
const telemetry = player.getTelemetry();
console.log('Underruns:', telemetry.underruns);
console.log('Occupancy range:', telemetry.minOccupancy, '-', telemetry.maxOccupancy);
```

### Ideal Metrics

For glitch-free playback:
- `underruns`: **0** (any non-zero indicates audible glitches)
- `backpressureStalls`: Low (< 10 per second indicates healthy flow)
- `minOccupancy`: > 1024 (>23ms buffer at 44.1kHz provides safety margin)
- `maxOccupancy`: < 15360 (< 95% full indicates room for bursts)

## Troubleshooting

### "crossOriginIsolated is false"

**Symptom**: Error banner on page load

**Cause**: Server not sending COOP/COEP headers

**Fix**:
1. Verify `middleware.ts` exists in project root
2. Check headers in browser DevTools (Network tab)
3. Restart dev server: `bun run dev`

**Production**: Ensure reverse proxy/CDN preserves headers

### Audio Dropouts / Glitches

**Symptom**: Clicks, pops, or silence during playback

**Diagnosis**:
```typescript
const telemetry = player.getTelemetry();
console.log('Underruns:', telemetry.underruns);
```

**Common Causes**:

1. **High Underruns** (`underruns` > 0):
   - CPU overload (WASM rendering too slow)
   - Main thread blocking (heavy rendering, long tasks)
   - Buffer too small (increase `RING_BUFFER_CAPACITY_FRAMES`)

2. **High Backpressure** (`backpressureStalls` > 100):
   - Worker producing faster than worklet consuming (shouldn't happen)
   - Check sample rate mismatch

3. **Low Min Occupancy** (`minOccupancy` < 512):
   - Pre-roll insufficient
   - Increase `PRE_ROLL_FRAMES` in worker

**Fix**:
```typescript
// In worklet-player.ts
private readonly RING_BUFFER_CAPACITY_FRAMES = 32768; // Double capacity
private readonly PRE_ROLL_FRAMES = 8192; // Double pre-roll
```

### Sample Rate Mismatch

**Symptom**: Playback pitch is wrong, or buffer fills/drains constantly

**Diagnosis**:
```typescript
console.log('Context sample rate:', audioContext.sampleRate);
console.log('WASM sample rate:', engine.getSampleRate());
```

**Fix**: The worker should auto-detect `audioContext.sampleRate` and configure WASM engine to match. If not:

1. Check worker initialization message includes `targetSampleRate`
2. Verify engine is created with correct rate
3. Implement resampler if needed (currently assumes 44.1kHz)

### Worker or Worklet Not Loading

**Symptom**: No audio, console errors about missing files

**Diagnosis**:
```bash
# Check built files exist
ls public/audio/worker/
ls public/audio/worklet/
```

**Fix**:
```bash
# Rebuild audio components
bun run build:worklet
```

**Note**: These files are auto-generated and gitignored. Build script runs automatically with `bun run dev` and `bun run build`.

### Insufficient Pre-Roll

**Symptom**: Audio starts immediately but has dropout in first ~100ms

**Fix**: Increase pre-roll frames:
```typescript
// In sid-producer.worker.ts
private readonly PRE_ROLL_FRAMES = 8192; // ~185ms at 44.1kHz
```

### Memory Issues

**Symptom**: Browser slows down, "Out of memory" errors

**Cause**: SAB buffer too large, or too many player instances

**Fix**:
1. Only create one player instance per page
2. Call `player.destroy()` when done
3. Reduce buffer capacity if needed (minimum ~2048 frames)

## Testing

### Unit Tests

```bash
# Test ring buffer
bun test tests/unit/sab-ring-buffer.test.ts

# All unit tests
bun test tests/unit/
```

### E2E Tests

```bash
# Audio fidelity tests (requires Playwright)
bun run test:e2e tests/e2e/audio-fidelity.spec.ts
```

E2E tests verify:
- Cross-origin isolation enabled
- Worklet and worker load successfully
- Basic playback works
- No underruns during playback
- (Future) Frequency accuracy, dropout detection, RMS stability

## Performance Considerations

### CPU Usage

- **WASM Engine**: Typically 10-30% of one core during rendering
- **Worker**: Minimal overhead beyond WASM
- **Worklet**: < 1% (just copying data)
- **Main Thread**: Zero audio processing

### Memory Usage

- **Ring Buffer**: ~1.2 MB (16384 frames × 2 channels × 4 bytes)
- **Worker Context**: ~5-10 MB (WASM module + heap)
- **Worklet Context**: < 1 MB

### Latency

- **Pre-roll**: ~93ms (4096 frames at 44.1kHz)
- **Buffer**: ~370ms capacity (safety margin)
- **Total**: ~100ms from `play()` call to first audio

## Browser Compatibility

### Required Features

- ✅ AudioWorklet (Chrome 66+, Firefox 76+, Safari 14.1+)
- ✅ SharedArrayBuffer (requires cross-origin isolation)
- ✅ WebAssembly (Chrome 57+, Firefox 52+, Safari 11+)
- ✅ Web Workers (universal)

### Tested Browsers

- Chrome/Edge 90+ ✅
- Firefox 90+ ✅
- Safari 15+ ✅ (with cross-origin isolation)

### Not Supported

- Internet Explorer (lacks AudioWorklet, SAB, WASM)
- Mobile browsers without SAB support

## Migration from Legacy Pipeline

The old pipeline (pre-AudioWorklet) rendered entire tracks upfront and used `AudioBufferSourceNode`. This had:

- ❌ Long load times for long tracks
- ❌ Main thread blocking during PCM conversion
- ❌ No streaming capability
- ✅ But guaranteed glitch-free playback (if load succeeds)

The new pipeline:

- ✅ Near-instant start (pre-roll only)
- ✅ Zero main thread blocking
- ✅ Real-time streaming
- ⚠️ Requires careful buffer management

To disable the new pipeline (fallback to legacy):

```typescript
// In lib/player/sidflow-player.ts
const USE_WORKLET_PLAYER = false;
```

## Future Enhancements

### Planned

- [ ] Dynamic sample rate resampling
- [ ] Adjustable buffer size via config
- [ ] Seek support (currently disabled)
- [ ] PCM capture for analysis/export
- [ ] Sub-song selection without reload

### Considered

- Stereo width control
- EQ/effects via AudioNodes
- Visualizer integration
- Multi-track playback

## References

- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
- [SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
- [Cross-Origin Isolation](https://web.dev/coop-coep/)
- [libsidplayfp](https://github.com/libsidplayfp/libsidplayfp)
