# Audio Capture for Testing

This document describes the audio capture implementation for end-to-end testing of the AudioWorklet pipeline.

## Overview

The audio capture system allows E2E tests to record and analyze the **exact audio heard by the user**, not just internal state or telemetry. This provides true end-to-end verification of audio fidelity.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Web Worker                                                   │
│  (sid-producer)                                              │
│         │                                                     │
│         ▼                                                     │
│  ┌─────────────┐                                            │
│  │ WASM Engine │                                            │
│  │ Rendering   │                                            │
│  └─────────────┘                                            │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ SharedArrayBuffer      │
│ Ring Buffer            │
└─────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  AudioWorklet                                                 │
│  (sid-renderer)                                              │
│         │                                                     │
│         ▼                                                     │
│  ┌──────────────────┐                                       │
│  │ AudioWorkletNode │───────┬────────────────────────────┐  │
│  └──────────────────┘       │                            │  │
└─────────────────────────────┼────────────────────────────┼──┘
                              │                            │
                              ▼                            ▼
                    ┌──────────────────┐       ┌──────────────────────┐
                    │ GainNode         │       │ MediaStreamAudio     │
                    │                  │       │ DestinationNode      │
                    │ (audible)        │       │ (capture)            │
                    └──────────────────┘       └──────────────────────┘
                              │                            │
                              ▼                            ▼
                    ┌──────────────────┐       ┌──────────────────────┐
                    │ Audio Output     │       │ MediaRecorder        │
                    │ Device           │       │ (WebM/Opus)          │
                    └──────────────────┘       └──────────────────────┘
                                                          │
                                                          ▼
                                               ┌──────────────────────┐
                                               │ Blob                 │
                                               │ (WebM audio)         │
                                               └──────────────────────┘
                                                          │
                                                          ▼
                                               ┌──────────────────────┐
                                               │ decodeAudioData()    │
                                               └──────────────────────┘
                                                          │
                                                          ▼
                                               ┌──────────────────────┐
                                               │ Float32Array PCM     │
                                               │ (for analysis)       │
                                               └──────────────────────┘
```

## API

### Enable Capture

Capture must be enabled **before** calling `play()`:

```typescript
const player = new SidflowPlayer();
player.enableCapture();
await player.load({ session, track });
await player.play();

// Wait for playback to complete
await new Promise(resolve => setTimeout(resolve, durationMs));

player.stop();
```

### Get Captured Audio

#### As Blob (WebM/Opus)

```typescript
const blob = player.getCapturedAudio();
if (blob) {
  // Save to file, upload, etc.
  const url = URL.createObjectURL(blob);
}
```

#### As PCM Arrays

```typescript
const pcm = await player.getCapturedPCM();
if (pcm) {
  console.log('Left channel:', pcm.left);
  console.log('Right channel:', pcm.right);
  console.log('Sample rate:', pcm.sampleRate);
}
```

The PCM arrays are `Float32Array` with values in the range [-1, 1].

## E2E Testing

### Test Page

Navigate to `/test/audio-capture` to access the test helper page. This page:

- Creates a `SidflowPlayer` instance
- Exposes it as `window.__testPlayer`
- Sets `window.__testPlayerReady = true` when ready

### Example Test

```typescript
test('C4 fidelity test', async ({ page }) => {
  await page.goto('/test/audio-capture');
  await page.waitForFunction(() => (window as any).__testPlayerReady === true);

  const { capturedLeft, sampleRate, telemetry } = await page.evaluate(async () => {
    const player = (window as any).__testPlayer;
    
    // Create test session
    const session = {
      sessionId: 'test-c4',
      sidUrl: '/test-tone-c4.sid',
      scope: 'test' as const,
      durationSeconds: 3.0,
      selectedSong: 0,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };

    const track = {
      sidPath: '/test-tone-c4.sid',
      relativePath: 'test-tone-c4.sid',
      filename: 'test-tone-c4.sid',
      displayName: 'Test Tone C4',
      selectedSong: 0,
      metadata: { /* ... */ },
      durationSeconds: 3.0,
    };

    // Enable capture, load, and play
    player.enableCapture();
    await player.load({ session, track });
    await player.play();

    // Wait for playback
    await new Promise(resolve => setTimeout(resolve, 4000));
    player.stop();

    // Get captured audio
    const pcm = await player.getCapturedPCM();
    const telemetry = player.getTelemetry();

    return {
      capturedLeft: Array.from(pcm!.left),
      sampleRate: pcm!.sampleRate,
      telemetry,
    };
  });

  // Analyze audio
  const frequency = measureFrequency(capturedLeft, sampleRate);
  expect(frequency).toBeGreaterThan(261.43);
  expect(frequency).toBeLessThan(261.83);
  expect(telemetry.underruns).toBe(0);
});
```

## Analysis Functions

### Frequency Analysis (Zero-Crossing)

```typescript
function measureFrequency(samples: number[], sampleRate: number): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1] < 0 && samples[i] >= 0) || 
        (samples[i - 1] >= 0 && samples[i] < 0)) {
      crossings++;
    }
  }
  const duration = samples.length / sampleRate;
  return crossings / duration / 2; // Divide by 2 for +/- crossings
}
```

### Dropout Detection

```typescript
function detectDropouts(
  samples: number[], 
  threshold = 1e-6, 
  minLength = 129
): number {
  let dropoutCount = 0;
  let silentRun = 0;

  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) <= threshold) {
      silentRun++;
    } else {
      if (silentRun >= minLength) {
        dropoutCount++;
      }
      silentRun = 0;
    }
  }

  if (silentRun >= minLength) {
    dropoutCount++;
  }

  return dropoutCount;
}
```

### RMS Stability

```typescript
function measureRmsStability(
  samples: number[], 
  sampleRate: number, 
  windowSeconds = 0.1
): number {
  const windowSize = Math.floor(sampleRate * windowSeconds);
  const rmsValues: number[] = [];

  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(start + windowSize, samples.length);
    let sumSquares = 0;

    for (let i = start; i < end; i++) {
      sumSquares += samples[i] * samples[i];
    }

    const rms = Math.sqrt(sumSquares / (end - start));
    rmsValues.push(rms);
  }

  // Calculate coefficient of variation (std dev / mean)
  const mean = rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length;
  const variance = rmsValues.reduce(
    (sum, val) => sum + Math.pow(val - mean, 2), 
    0
  ) / rmsValues.length;
  const stdDev = Math.sqrt(variance);

  return (stdDev / mean) * 100; // Return as percentage
}
```

## Limitations

### Browser Compatibility

- **Chrome/Edge 90+**: ✅ Full support
- **Firefox 90+**: ✅ Full support
- **Safari 15+**: ✅ Full support (with COOP/COEP)

### Audio Format

- Captured as **WebM/Opus** (lossy compression)
- Decoded back to PCM for analysis
- Some high-frequency content may be affected by Opus encoding
- For critical frequency analysis, use middle frequency ranges (100Hz - 5kHz)

### Performance

- MediaRecorder adds ~1-2% CPU overhead
- Decoding adds ~50-100ms delay after capture
- Memory: ~1MB per 10 seconds of captured audio

### Timing

- Capture starts when `MediaRecorder.start()` is called
- There may be a small (~10-50ms) delay before first samples are captured
- For critical timing tests, skip the first 250ms of captured audio

## Troubleshooting

### No Audio Captured

1. Check that `enableCapture()` was called **before** `play()`
2. Verify `crossOriginIsolated === true`
3. Check browser console for MediaRecorder errors
4. Ensure playback duration is sufficient (>500ms)

### Incorrect Frequency

1. Skip first and last 250ms to avoid transients
2. Use middle section of audio for analysis
3. Check sample rate matches expectations
4. Consider Opus codec artifacts for very high frequencies

### Empty PCM Arrays

1. Verify `stop()` was called before `getCapturedPCM()`
2. Wait for `MediaRecorder` to finish (add 100ms delay after stop)
3. Check that audio actually played (check telemetry)

## Test SID File

The C4 test SID is available at `/test-tone-c4.sid`:

- **Frequency**: 261.63 Hz (middle C)
- **Duration**: 3.0 seconds
- **Waveform**: Pure tone (deterministic)
- **File size**: 380 bytes

Expected results:
- Frequency: 261.63 ± 0.2 Hz
- Duration: 3.0s ± 1 frame
- No dropouts (silence runs ≥129 samples)
- RMS stability: <10% variation
- No underruns

## Future Enhancements

- [ ] Raw PCM capture (bypass MediaRecorder)
- [ ] Real-time spectrum analysis
- [ ] Cross-correlation for quality comparison
- [ ] FFT with parabolic peak interpolation
- [ ] Visual waveform display in test page

## References

- [MediaStream Recording API](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream_Recording_API)
- [MediaStreamAudioDestinationNode](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamAudioDestinationNode)
- [AudioContext.decodeAudioData()](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)
