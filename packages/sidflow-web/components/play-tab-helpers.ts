import { type RateTrackInfo } from '@/lib/api-client';

export interface PlaylistTrack extends RateTrackInfo {
  playlistNumber: number;
}

export function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.max(0, Math.floor(seconds % 60));
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function parseLengthSeconds(length?: string): number {
  if (!length) {
    return 180;
  }

  if (length.includes(':')) {
    const [minutes, secondsPart] = length.split(':');
    const mins = Number(minutes);
    const secs = Number(secondsPart);
    if (!Number.isNaN(mins) && !Number.isNaN(secs)) {
      return Math.max(15, mins * 60 + secs);
    }
  }

  const numeric = Number(length);
  if (!Number.isNaN(numeric) && numeric > 0) {
    return Math.max(15, numeric);
  }

  return 180;
}

export function dedupeBySidPath(tracks: PlaylistTrack[]): PlaylistTrack[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (seen.has(track.sidPath)) {
      return false;
    }
    seen.add(track.sidPath);
    return true;
  });
}
