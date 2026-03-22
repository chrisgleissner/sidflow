import { describe, expect, it, mock } from 'bun:test';
import { preparePlaybackSessionStreams } from '@/lib/server/playback-stream-prep';
import type { SessionStreamAsset } from '@/lib/playback-session';
import type { RateTrackInfo } from '@/lib/types/rate-track';

function createTrack(overrides: Partial<RateTrackInfo> = {}): RateTrackInfo {
  return {
    sidPath: '/tmp/Test_Artist/Ambient_Dream.sid',
    relativePath: 'Test_Artist/Ambient_Dream.sid',
    filename: 'Ambient_Dream.sid',
    displayName: 'Ambient Dream',
    selectedSong: 1,
    durationSeconds: 180,
    metadata: {
      title: 'Ambient Dream',
      author: 'Test Artist',
      released: '1990',
      songs: 1,
      startSong: 1,
      sidType: 'PSID',
      version: 2,
      sidModel: 'MOS6581',
      sidModelSecondary: undefined,
      sidModelTertiary: undefined,
      clock: 'PAL',
      length: '180',
      fileSizeBytes: 1234,
    },
    ...overrides,
  };
}

describe('preparePlaybackSessionStreams', () => {
  it('returns existing stream assets without warming HLS on the request path', async () => {
    const track = createTrack();
    const streamAssets: SessionStreamAsset[] = [
      {
        format: 'wav',
        filePath: '/tmp/Ambient_Dream.wav',
        sizeBytes: 4096,
        durationMs: 180000,
        sampleRate: 44100,
        channels: 2,
      },
    ];
    const ensureHlsForTrack = mock(async () => '/hls/test/index.m3u8');

    const prepared = await preparePlaybackSessionStreams(track, {
      resolveSessionStreamAssets: async () => streamAssets,
      ensureHlsForTrack,
      logError: mock(() => {}),
    });

    expect(prepared).toEqual({
      fallbackHlsUrl: null,
      streamAssets,
    });
    expect(ensureHlsForTrack).not.toHaveBeenCalled();
  });

  it('starts HLS warming in the background when no immediate stream assets exist', async () => {
    const track = createTrack();
    let warmed = false;

    const prepared = await preparePlaybackSessionStreams(track, {
      resolveSessionStreamAssets: async () => [],
      ensureHlsForTrack: async () => {
        warmed = true;
        return '/hls/test/index.m3u8';
      },
      logError: mock(() => {}),
    });

    expect(prepared).toEqual({
      fallbackHlsUrl: null,
      streamAssets: [],
    });

    await Promise.resolve();
    expect(warmed).toBe(true);
  });

  it('logs background HLS warming failures without failing session preparation', async () => {
    const track = createTrack();
    const error = new Error('ffmpeg failed');
    const logError = mock(() => {});

    const prepared = await preparePlaybackSessionStreams(track, {
      resolveSessionStreamAssets: async () => [],
      ensureHlsForTrack: async () => {
        throw error;
      },
      logError,
    });

    expect(prepared).toEqual({
      fallbackHlsUrl: null,
      streamAssets: [],
    });

    await Promise.resolve();
    expect(logError).toHaveBeenCalledWith(
      '[playback-stream-prep] Failed to warm HLS assets',
      expect.objectContaining({
        sidPath: track.sidPath,
        error,
      })
    );
  });
});