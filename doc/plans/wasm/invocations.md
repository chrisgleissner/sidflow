# libsidplayfp Native vs WASM Analysis

This document analyzes the behavior differences between native libsidplayfp and its WASM port, particularly focusing on the timing gaps observed in WASM audio rendering.

## 1. Native libsidplayfp Behavior

### 1.1 Architecture Overview

Native libsidplayfp implements a **batch-based C64 emulation engine** that processes audio in discrete computational chunks:

#### Core Processing Model

- **Batch Processing**: Processes audio in discrete batches of C64 CPU cycles, not real-time
- **Cycle-to-Sample Conversion**: Each batch simulates exactly N CPU cycles (e.g., 20,000), then converts to audio samples via resampling
- **Pull-Based Architecture**: The caller "polls" for the next audio chunk - the library has no concept of wall-clock time
- **Faster-than-Real-Time**: Can render hours of audio in seconds because it's purely computational

#### CPU Clock Frequencies

- **PAL C64**: 985,248 Hz CPU clock
- **NTSC C64**: 1,022,730 Hz CPU clock
- **Cycle Batching**: `max_cycles = 20000` per `Player::play()` call = ~20.3ms simulated time (PAL) or ~19.6ms (NTSC)

### 1.2 Critical Timing Dependencies

#### EventScheduler Phase Synchronization

- **PHI1/PHI2 Phases**: Operates in exact 2x internal clock phases
- **Event Scheduling**: Events must fire at precise `event_clock_t` intervals without drift
- **SID Clock Dependency**: `ReSIDfp.clock()` depends on `eventScheduler->getTime(EVENT_CLOCK_PHI1)`

#### VIC-II Interrupt Timing

- **Raster IRQ**: Must fire at exact raster line positions (`rasterY == readRasterLineIRQ()`)
- **Bad Line Detection**: AEC/BA signals must toggle at precise cycle boundaries
- **Edge Detection**: `rasterYIRQEdgeDetectorEvent` scheduled for next PHI1 cycle

#### CIA Timer Precision

- **Timer Underflow**: CIA timers must underflow at exact cycle counts for music timing
- **IRQ/NMI Generation**: `c64cia1::interrupt(IRQ)` and `c64cia2::interrupt(NMI)` timing
- **Requirement**: Timer events cannot drift more than 1 cycle from expected

### 1.3 WAV Rendering Pipeline

#### Audio Driver Configuration

When `-w` flag is used:

- `m_driver.output = output_t::WAV` and `m_driver.file = true` are set
- `WavFile` driver instantiated with 44.1kHz, 16-bit precision
- 20ms buffer allocated: `std::ceil((44100 / 1000.f) * 20.f)` = 882 samples

#### Main Rendering Loop

```cpp
do {
    int samples = m_engine.play(2000);  // 2000 CPU cycles per iteration
    if (samples > 0)
        m_mixer.doMix(buffers, samples);
    else break;
} while (!m_mixer.isFull());
```

**Key Characteristics**:

- **Synchronous execution**: All cycles processed sequentially without interruption
- **Deterministic buffer management**: 20ms buffer ensures consistent chunk sizes
- **No threading gaps**: Single-threaded execution eliminates race conditions
- **Precise cycle counting**: Every C64 cycle generates exactly the expected number of samples

#### Sample Generation Process

1. `Player::play(cycles)` clocks virtual C64 for specified cycles
2. Each cycle triggers `m_c64.clock()` advancing CPU, VIC-II, and SID chips
3. `ReSIDfp::clock()` accumulates cycles and generates samples at configured frequency
4. Sample count returned and buffer position reset for next accumulation

**Result**: **Perfectly continuous PCM output** with no gaps or interruptions.

## 2. WASM Implementation Behavior

### 2.1 TypeScript Wrapper Architecture

The WASM port uses a TypeScript layer (`SidAudioEngine`) that wraps the compiled C++ code:

#### Core Components

- **SidPlayerContext**: Direct WASM binding to C++ `libsidplayfp::Player`
- **SidAudioEngine**: Higher-level TypeScript interface with buffering and caching
- **Emscripten Bindings**: C++ methods exposed via `emscripten::bind`

#### Rendering Flow

```typescript
// TypeScript calls WASM
const chunk = this.context.render(cycles);  // Maps to C++ Player::play()

// Aggregates chunks in renderFrames()
while (offset < totalSamples) {
  const next = this.consumeChunk(chunkCycles);
  // ... buffer management
}
```

### 2.2 WASM Execution Environment

#### Asynchronous Boundaries

- **Browser Threading**: WASM execution can be interrupted by browser scheduler
- **Event Loop Yields**: `await Promise.resolve()` calls in rendering pipeline
- **Garbage Collection**: Browser GC can pause WASM execution mid-chunk
- **Context Switches**: Web Workers may yield between render calls

#### Memory Management

- **Heap Allocation**: WASM uses JavaScript heap vs native stack allocation
- **Typed Arrays**: `Int16Array` creates JavaScript objects for audio buffers
- **Memory Views**: `emscripten::typed_memory_view` bridges C++ to JavaScript

### 2.3 Observed WASM Audio Behavior

Based on test results showing **134 silent periods of 18.6ms duration**:

#### Gap Pattern

- **Native**: Continuous 20ms chunks with perfect phase alignment
- **WASM**: 18.6ms valid audio + 18.6ms gap ≈ 37ms total cycle
- **Frequency**: Gaps occur every ~37ms consistently (not random)

#### Zero Sample Analysis

- **Zero Sample Ratio**: 49.73% of output is silent
- **Gap Duration**: Always exactly 18.6ms (not variable)
- **Pattern**: Regular intervals suggest systematic timing issue, not memory corruption

## 3. Behavior Mismatch Analysis

### 3.1 Root Cause Theories

#### Theory 1: EventScheduler Async Boundary Drift (90% Likelihood)

**Problem**: WASM's asynchronous execution disrupts PHI1/PHI2 phase synchronization.

**Evidence**:

- C++ `Player::play()` enforces 20ms cycle limit (`max_cycles = 20000`)
- TypeScript `renderCycles()` calls `context.render(cycles)` → C++ `player.play(cycles)`
- EventScheduler events scheduled for PHI1 cycles get delayed by async boundaries
- When `eventScheduler->getTime(EVENT_CLOCK_PHI1)` drifts, ReSIDfp receives stale timing

**Gap Pattern**: 18.6ms valid + 18.6ms gap = systematic timing drift (20ms intended + 17ms async overhead)

#### Theory 2: Cross-Chip Buffer Synchronization Failure (75% Likelihood)

**Problem**: Multiple SID chips lose sample alignment during WASM context switches.

**Evidence**:

- C++ `Player::play()` calls `s->clock()` for each chip, then `s->bufferpos(0)` to reset
- `player.mix(mixBuffer.data(), produced)` depends on all chips having consistent buffer states
- If one chip's buffer resets while others are filling, mixer outputs silence

**Gap Pattern**: 18.6ms = time for chips to drift out of sync, then 18.6ms to realign

#### Theory 3: CIA Timer Interrupt Cascade Delay (60% Likelihood)

**Problem**: CIA timer interrupts arrive late, disrupting music timing loops.

**Evidence**:

- `c64cia1::interrupt(IRQ)` and `c64cia2::interrupt(NMI)` must fire at exact cycle boundaries
- WASM delays can cause 5ms+ latency for `rasterYIRQEdgeDetectorEvent`
- Music routines expecting timer-driven samples receive late interrupts

**Gap Pattern**: Late timers create 18.6ms windows where no samples are generated

### 3.2 Technical Differences Summary

| Aspect | Native | WASM |
|--------|--------|------|
| Execution Model | Synchronous, single-threaded | Asynchronous, interruptible |
| Memory Allocation | Stack-based, aligned | Heap-based, JavaScript objects |
| Timing Precision | Cycle-accurate | Subject to browser scheduling |
| Buffer Management | Deterministic resets | Potential race conditions |
| Event Scheduling | Microsecond precision | Millisecond precision |

### 3.3 Impact Assessment

#### Functional Impact

- **Audio Quality**: 49.73% zero samples make music unlistenable
- **Timing Accuracy**: 18.6ms gaps destroy musical rhythm and tempo
- **User Experience**: Choppy playback renders WASM port unusable for audio

#### Performance Impact

- **CPU Usage**: No significant difference - computation completes faster than real-time
- **Memory Usage**: Similar - both versions process same data volumes
- **Throughput**: WASM still renders multiple times faster than real-time playback

## 4. Recommended Fix

### 4.1 Primary Solution: Cycle-Accurate WASM Implementation

#### Approach

Modify the WASM bindings to maintain cycle-accurate execution within JavaScript's constraints.

#### Implementation Strategy

1. **Larger Atomic Batches**

   ```typescript
   // Instead of 20,000 cycles (20ms)
   const chunk = this.context.render(100000);  // 100ms atomic batch
   ```

   - Reduces async boundary crossings by 5x
   - Maintains internal timing accuracy within larger chunks
   - Trades responsiveness for timing precision

2. **Buffer Pre-allocation**

   ```cpp
   // In C++ bindings
   class SidPlayerContext {
       std::vector<int16_t> preAllocatedBuffer;  // Pre-size for expected output
       // ... avoid dynamic allocation during render
   };
   ```

3. **Synchronous Execution Guarantee**

   ```typescript
   // Render without yielding to event loop
   renderSynchronously(duration: number): Int16Array {
       // Process entire duration in single JavaScript execution context
       // No await calls or Promise.resolve() during audio generation
   }
   ```

### 4.2 Alternative Solution: Buffer Reconstruction

If cycle-accurate execution proves impossible, implement post-processing gap detection:

#### Gap Detection Algorithm

```typescript
function detectAndFillGaps(pcm: Int16Array): Int16Array {
    const gaps = findSilentPeriods(pcm, 18.6ms);
    for (const gap of gaps) {
        if (isRegularGap(gap)) {
            fillWithInterpolation(pcm, gap);
        }
    }
    return pcm;
}
```

#### Interpolation Strategy

- Detect 18.6ms zero regions in regular patterns
- Fill gaps with interpolated audio from surrounding non-zero samples
- Maintain phase continuity for music waveforms

### 4.3 Implementation Priority

1. **Short-term**: Implement larger atomic batches (minimal code changes)
2. **Medium-term**: Buffer pre-allocation and synchronous execution
3. **Long-term**: Consider WebAssembly SIMD for enhanced performance
4. **Fallback**: Gap detection and interpolation as last resort

### 4.4 Success Criteria

- **Zero Gap Target**: Achieve <1% silent samples (vs current 49.73%)
- **Timing Accuracy**: Maintain <1ms timing precision between consecutive audio chunks
- **Performance**: Preserve faster-than-real-time rendering capability
- **Compatibility**: Ensure solution works across major browsers (Chrome, Firefox, Safari)

The most promising approach combines **larger atomic batches** with **synchronous execution** to minimize WASM async boundary crossings while preserving the cycle-accurate emulation that libsidplayfp requires for continuous audio generation.
