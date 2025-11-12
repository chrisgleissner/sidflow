import { describe, expect, it, mock } from 'bun:test';
import type { PlaybackAdapter, PlaybackAdapterController, PlaybackRuntimeContext } from '@/lib/player/playback-facade';
import { AdapterUnavailableError, PlaybackFacade } from '@/lib/player/playback-facade';

const baseContext: PlaybackRuntimeContext = {
  target: 'browser',
  crossOriginIsolated: true,
  hasSharedArrayBuffer: true,
  networkOnline: true,
};

function createController(id: string, kind: PlaybackAdapterController['kind']): PlaybackAdapterController {
  return {
    id,
    kind,
    getState: () => 'idle',
    load: mock(async () => undefined),
    play: mock(async () => undefined),
    pause: mock(async () => undefined),
    stop: mock(async () => undefined),
    teardown: mock(async () => undefined),
    getTelemetry: () => ({
      framesProduced: 0,
      framesConsumed: 0,
      underruns: 0,
      backpressureStalls: 0,
      minOccupancy: 0,
      maxOccupancy: 0,
      zeroByteFrames: 0,
      missedQuanta: 0,
      avgDriftMs: 0,
      maxDriftMs: 0,
      contextSuspendCount: 0,
      contextResumeCount: 0,
      renderMaxDurationMs: 0,
      renderAvgDurationMs: 0,
      ringBufferCapacityFrames: 0,
       adapterKind: kind,
      adapterId: id,
      lastUpdated: Date.now(),
    }),
  };
}

function createAdapter(id: string, available: boolean, priority: number): PlaybackAdapter {
  const kind: PlaybackAdapter['kind'] = available ? 'wasm' : 'streaming-wav';
  return {
    id,
    kind,
    label: `${id}-label`,
    description: `${id}-desc`,
    priority,
    checkAvailability: mock(async () => ({
      available,
      reasons: available ? undefined : [`${id}-unavailable`],
    })),
    createController: mock(async () => createController(id, kind)),
  };
}

describe('PlaybackFacade', () => {
  it('registers adapters and sets preferred adapter automatically', () => {
    const facade = new PlaybackFacade();
    const adapter = createAdapter('wasm', true, 10);
    facade.registerAdapter(adapter, { preferred: true });

    expect(facade.getActiveAdapterId()).toBeNull();
    expect(() => facade.setPreferredAdapter('missing')).toThrow();
    expect(() => facade.registerAdapter(adapter)).toThrow();
  });

  it('chooses preferred adapter when available', async () => {
    const facade = new PlaybackFacade();
    const wasmAdapter = createAdapter('wasm', true, 5);
    const streamingAdapter = createAdapter('streaming', true, 1);

    facade.registerAdapter(streamingAdapter);
    facade.registerAdapter(wasmAdapter, { preferred: true });

    const selection = await facade.load(
      {
        session: {
          sessionId: 'abc',
          sidUrl: '/sid',
          romUrls: {},
          expiresAt: Date.now() + 1000,
        },
        track: {
          sidPath: '/music.sid',
          durationSeconds: 120,
          metadata: { title: 'Test' },
        },
      },
      baseContext
    );

    expect(selection.adapterId).toBe('wasm');
    expect(facade.getActiveAdapterId()).toBe('wasm');
  });

  it('falls back to next adapter when preferred is unavailable', async () => {
    const facade = new PlaybackFacade();
    const flakyAdapter = createAdapter('cli', false, 10);
    const wasmAdapter = createAdapter('wasm', true, 5);

    facade.registerAdapter(flakyAdapter, { preferred: true });
    facade.registerAdapter(wasmAdapter);

    const selection = await facade.load(
      {
        session: {
          sessionId: 'abc',
          sidUrl: '/sid',
          romUrls: {},
          expiresAt: Date.now() + 1000,
        },
        track: {
          sidPath: '/music.sid',
          durationSeconds: 120,
          metadata: { title: 'Test' },
        },
      },
      baseContext
    );

    expect(selection.adapterId).toBe('wasm');
    expect(facade.getActiveAdapterId()).toBe('wasm');
  });

  it('throws when no adapters are available', async () => {
    const facade = new PlaybackFacade();
    const unavailableA = createAdapter('cli', false, 5);
    const unavailableB = createAdapter('stream', false, 1);

    facade.registerAdapter(unavailableA);
    facade.registerAdapter(unavailableB);

    await expect(
      facade.load(
        {
          session: {
            sessionId: 'abc',
            sidUrl: '/sid',
            romUrls: {},
            expiresAt: Date.now() + 1000,
          },
          track: {
            sidPath: '/music.sid',
            durationSeconds: 120,
            metadata: { title: 'Test' },
          },
        },
        baseContext
      )
    ).rejects.toBeInstanceOf(AdapterUnavailableError);
  });

  it('tears down active controller when changing preferred adapter', async () => {
    const facade = new PlaybackFacade();
    const wasmAdapter = createAdapter('wasm', true, 10);
    const streamingAdapter = createAdapter('streaming', true, 5);

    facade.registerAdapter(wasmAdapter, { preferred: true });
    facade.registerAdapter(streamingAdapter);

    await facade.load(
      {
        session: {
          sessionId: 'abc',
          sidUrl: '/sid',
          romUrls: {},
          expiresAt: Date.now() + 1000,
        },
        track: {
          sidPath: '/music.sid',
          durationSeconds: 120,
          metadata: { title: 'Test' },
        },
      },
      baseContext
    );

    facade.setPreferredAdapter('streaming');
    expect(facade.getActiveAdapterId()).toBeNull();
  });
});
