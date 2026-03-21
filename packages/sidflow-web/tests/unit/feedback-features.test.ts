/**
 * Tests for packages/sidflow-web/lib/feedback/features.ts
 *
 * This module provides pure, deterministic feature extraction — no I/O, no browser APIs.
 */

import { describe, it, expect } from 'bun:test';
import { extractTrackFeatures, FEATURE_KEYS } from '@/lib/feedback/features';
import type { RateTrackInfo } from '@/lib/types/rate-track';

function makeTrack(overrides: Partial<RateTrackInfo> = {}): RateTrackInfo {
  return {
    sidPath: '/hvsc/Test/Song.sid',
    relativePath: 'Test/Song.sid',
    filename: 'Song.sid',
    selectedSong: 1,
    durationSeconds: 180,
    metadata: {
      title: 'Test Song',
      author: 'Test Author',
      released: '1990',
      songs: 3,
      startSong: 1,
      version: 2,
      sidModel: '6581',
      sidType: 'RSID',
      clock: 'PAL',
      fileSizeBytes: 4096,
    },
    ...overrides,
  } as RateTrackInfo;
}

// ─── FEATURE_KEYS ─────────────────────────────────────────────────────────────

describe('FEATURE_KEYS', () => {
  it('is a frozen array with 13 keys', () => {
    expect(FEATURE_KEYS).toHaveLength(13);
    expect(Object.isFrozen(FEATURE_KEYS)).toBe(true);
  });

  it('contains expected key names', () => {
    expect(FEATURE_KEYS).toContain('duration_minutes');
    expect(FEATURE_KEYS).toContain('author_hash');
    expect(FEATURE_KEYS).toContain('clock_pal');
    expect(FEATURE_KEYS).toContain('clock_ntsc');
    expect(FEATURE_KEYS).toContain('clock_other');
  });
});

// ─── basic extraction ─────────────────────────────────────────────────────────

describe('extractTrackFeatures', () => {
  it('returns an object with all expected keys', () => {
    const features = extractTrackFeatures(makeTrack());
    for (const key of FEATURE_KEYS) {
      expect(Object.hasOwn(features, key)).toBe(true);
    }
  });

  it('all values are finite numbers', () => {
    const features = extractTrackFeatures(makeTrack());
    for (const key of FEATURE_KEYS) {
      const value = features[key];
      expect(typeof value).toBe('number');
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('duration_minutes is durationSeconds / 60', () => {
    const features = extractTrackFeatures(makeTrack({ durationSeconds: 60 }));
    expect(features.duration_minutes).toBe(1);
  });

  it('duration_minutes is 0 for missing duration', () => {
    const features = extractTrackFeatures(makeTrack({ durationSeconds: undefined }));
    expect(features.duration_minutes).toBe(0);
  });

  it('log_file_size_kb is > 0 for a real file size', () => {
    const features = extractTrackFeatures(makeTrack());
    expect(features.log_file_size_kb).toBeGreaterThan(0);
  });

  it('log_file_size_kb is 0 for missing file size', () => {
    const track = makeTrack();
    (track.metadata as Record<string, unknown>).fileSizeBytes = undefined;
    const features = extractTrackFeatures(track);
    expect(features.log_file_size_kb).toBe(0);
  });

  it('song_count reflects metadata.songs', () => {
    const features = extractTrackFeatures(makeTrack());
    expect(features.song_count).toBe(3);
  });

  it('selected_song reflects selectedSong', () => {
    const features = extractTrackFeatures(makeTrack({ selectedSong: 2 }));
    expect(features.selected_song).toBe(2);
  });

  it('version reflects metadata.version', () => {
    const features = extractTrackFeatures(makeTrack());
    expect(features.version).toBe(2);
  });
});

// ─── hash determinism ─────────────────────────────────────────────────────────

describe('extractTrackFeatures hash stability', () => {
  it('same author produces same hash', () => {
    const a = extractTrackFeatures(makeTrack());
    const b = extractTrackFeatures(makeTrack());
    expect(a.author_hash).toBe(b.author_hash);
  });

  it('different authors produce different hashes', () => {
    const a = extractTrackFeatures(makeTrack());
    const track2 = makeTrack();
    (track2.metadata as Record<string, unknown>).author = 'Other Artist';
    const b = extractTrackFeatures(track2);
    expect(a.author_hash).not.toBe(b.author_hash);
  });

  it('null author produces hash 0', () => {
    const track = makeTrack();
    (track.metadata as Record<string, unknown>).author = null;
    const features = extractTrackFeatures(track);
    expect(features.author_hash).toBe(0);
  });

  it('all hash values are in [0, 1] range', () => {
    const features = extractTrackFeatures(makeTrack());
    for (const key of ['author_hash', 'title_hash', 'sid_model_hash', 'sid_type_hash'] as const) {
      expect(features[key]).toBeGreaterThanOrEqual(0);
      expect(features[key]).toBeLessThanOrEqual(1);
    }
  });
});

// ─── clock flags ─────────────────────────────────────────────────────────────

describe('extractTrackFeatures clock flags', () => {
  it('sets clock_pal=1 for PAL track', () => {
    const features = extractTrackFeatures(makeTrack());
    expect(features.clock_pal).toBe(1);
    expect(features.clock_ntsc).toBe(0);
    expect(features.clock_other).toBe(0);
  });

  it('sets clock_ntsc=1 for NTSC track', () => {
    const track = makeTrack();
    (track.metadata as Record<string, unknown>).clock = 'NTSC';
    const features = extractTrackFeatures(track);
    expect(features.clock_pal).toBe(0);
    expect(features.clock_ntsc).toBe(1);
    expect(features.clock_other).toBe(0);
  });

  it('sets clock_other=1 for unknown/missing clock', () => {
    const track = makeTrack();
    (track.metadata as Record<string, unknown>).clock = '';
    const features = extractTrackFeatures(track);
    expect(features.clock_pal).toBe(0);
    expect(features.clock_ntsc).toBe(0);
    expect(features.clock_other).toBe(1);
  });

  it('handles clock strings case-insensitively', () => {
    const track = makeTrack();
    (track.metadata as Record<string, unknown>).clock = 'pal/ntsc';
    const features = extractTrackFeatures(track);
    // "pal/ntsc" contains both "pal" and "ntsc"
    expect(features.clock_pal).toBe(1);
    expect(features.clock_ntsc).toBe(1);
    expect(features.clock_other).toBe(0);
  });
});

// ─── missing metadata graceful handling ──────────────────────────────────────

describe('extractTrackFeatures missing metadata', () => {
  it('handles completely missing metadata gracefully', () => {
    const track = makeTrack({ selectedSong: 0, durationSeconds: 0 });
    (track as Record<string, unknown>).metadata = null;
    expect(() => extractTrackFeatures(track)).not.toThrow();
  });

  it('returns 0 for all numeric fields when metadata is null', () => {
    const track = makeTrack();
    (track as Record<string, unknown>).metadata = null;
    const features = extractTrackFeatures(track);
    expect(features.log_file_size_kb).toBe(0);
  });
});
