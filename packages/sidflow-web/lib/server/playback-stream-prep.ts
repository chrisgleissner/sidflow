import type { SessionStreamAsset } from '@/lib/playback-session';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { resolveSessionStreamAssets } from '@/lib/server/availability-service';
import { ensureHlsForTrack } from '@/lib/server/hls-service';

export interface PlaybackStreamPreparation {
  fallbackHlsUrl: string | null;
  streamAssets: SessionStreamAsset[];
}

interface PlaybackStreamPreparationDeps {
  resolveSessionStreamAssets: (track: RateTrackInfo) => Promise<SessionStreamAsset[]>;
  ensureHlsForTrack: (track: RateTrackInfo) => Promise<string | null>;
  logError: (message: string, details: { sidPath: string; error: unknown }) => void;
}

const defaultDeps: PlaybackStreamPreparationDeps = {
  resolveSessionStreamAssets,
  ensureHlsForTrack,
  logError: (message, details) => {
    console.error(message, details);
  },
};

export async function preparePlaybackSessionStreams(
  track: RateTrackInfo,
  deps: PlaybackStreamPreparationDeps = defaultDeps
): Promise<PlaybackStreamPreparation> {
  const streamAssets = await deps.resolveSessionStreamAssets(track);

  if (streamAssets.length === 0) {
    void deps.ensureHlsForTrack(track).catch((error) => {
      deps.logError('[playback-stream-prep] Failed to warm HLS assets', {
        sidPath: track.sidPath,
        error,
      });
    });
  }

  return {
    fallbackHlsUrl: null,
    streamAssets,
  };
}