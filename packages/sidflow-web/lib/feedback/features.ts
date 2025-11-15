import type { RateTrackInfo } from '@/lib/types/rate-track';

export type TrackFeatureVector = Record<string, number>;

const HASH_PRIME = 16777619;
const HASH_OFFSET = 2166136261;

function hashStringToUnit(value: string | undefined | null): number {
  if (!value) {
    return 0;
  }
  let hash = HASH_OFFSET;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index) & 0xff;
    hash = Math.imul(hash, HASH_PRIME);
  }
  const normalized = (hash >>> 0) / 0xffffffff;
  return Number.isFinite(normalized) ? normalized : 0;
}

function booleanFlag(condition: boolean): number {
  return condition ? 1 : 0;
}

function clampFinite(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

export function extractTrackFeatures(track: RateTrackInfo): TrackFeatureVector {
  const metadata = track.metadata ?? ({} as RateTrackInfo['metadata']);
  const fileSize = metadata.fileSizeBytes ?? 0;
  const durationSeconds = clampFinite(track.durationSeconds ?? 0, 0);
  const songCount = clampFinite(metadata.songs ?? 1, 1);
  const selectedSong = clampFinite(track.selectedSong ?? metadata.startSong ?? 1, 1);
  const startSong = clampFinite(metadata.startSong ?? 1, 1);
  const version = clampFinite(metadata.version ?? 1, 1);

  const clockValue = (metadata.clock ?? '').toLowerCase();
  const clockPal = clockValue.includes('pal');
  const clockNtsc = clockValue.includes('ntsc');

  const normalizedFeatures: TrackFeatureVector = {
    duration_minutes: clampFinite(durationSeconds / 60, 0),
    log_file_size_kb: clampFinite(Math.log1p(fileSize / 1024), 0),
    song_count: songCount,
    selected_song: selectedSong,
    start_song: startSong,
    version,
    author_hash: hashStringToUnit(metadata.author),
    title_hash: hashStringToUnit(metadata.title),
    sid_model_hash: hashStringToUnit(metadata.sidModel ?? metadata.sidModelSecondary ?? metadata.sidModelTertiary),
    sid_type_hash: hashStringToUnit(metadata.sidType),
    clock_pal: booleanFlag(clockPal),
    clock_ntsc: booleanFlag(clockNtsc),
    clock_other: booleanFlag(!clockPal && !clockNtsc),
  };

  return normalizedFeatures;
}

export const FEATURE_KEYS = Object.freeze([
  'duration_minutes',
  'log_file_size_kb',
  'song_count',
  'selected_song',
  'start_song',
  'version',
  'author_hash',
  'title_hash',
  'sid_model_hash',
  'sid_type_hash',
  'clock_pal',
  'clock_ntsc',
  'clock_other',
]);
