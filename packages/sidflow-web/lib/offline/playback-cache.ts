import type { RateTrackInfo } from '@/lib/api-client';
import type { PlaybackSessionDescriptor } from '@/lib/types/playback-session';
import {
  listPlaybackCacheRecords,
  prunePlaybackCache,
  type PlaybackCacheRecord,
  writePlaybackCacheRecord,
} from '@/lib/preferences/storage';

export interface CachedTrackEntry {
  track: RateTrackInfo;
  session: PlaybackSessionDescriptor | null;
  storedAt: number;
}

// Keep timestamps strictly increasing so LRU pruning never drops the newest entry
let lastCacheTimestamp = 0;

export async function cacheTrack(
  track: RateTrackInfo,
  session: PlaybackSessionDescriptor | null,
  maxEntries: number
): Promise<void> {
  if (maxEntries <= 0) {
    return;
  }
  const now = Date.now();
  const jitter = typeof performance !== 'undefined' ? performance.now() % 1 : Math.random();
  const baseTimestamp = now + jitter;
  const MIN_INCREMENT = 1e-3;
  const timestamp = Math.max(baseTimestamp, lastCacheTimestamp + MIN_INCREMENT);
  lastCacheTimestamp = timestamp;
  const record: PlaybackCacheRecord<CachedTrackEntry> = {
    sidPath: track.sidPath,
    data: {
      track,
      session,
      storedAt: timestamp,
    },
    updatedAt: timestamp,
    expiresAt: null,
  };
  await writePlaybackCacheRecord(record);
  await prunePlaybackCache(maxEntries);
}

export async function listCachedTracks(limit: number): Promise<CachedTrackEntry[]> {
  const records = await listPlaybackCacheRecords<CachedTrackEntry>();
  if (!records.length) {
    return [];
  }
  const sorted = records
    .filter((entry) => Boolean(entry?.data?.track))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((entry) => ({
      track: entry.data.track,
      session: entry.data.session ?? null,
      storedAt: entry.data.storedAt ?? entry.updatedAt,
    }));
  if (limit > 0) {
    return sorted.slice(0, limit);
  }
  return sorted;
}
