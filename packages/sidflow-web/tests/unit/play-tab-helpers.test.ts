import { describe, expect, it } from 'bun:test';
import {
  dedupeBySidPath,
  formatSeconds,
  parseLengthSeconds,
  type PlaylistTrack,
} from '@/components/play-tab-helpers';

describe('PlayTab helpers', () => {
  const buildTrack = (sidPath: string, overrides: Partial<PlaylistTrack> = {}): PlaylistTrack => {
    const baseMetadata = {
      title: 'Sample',
      author: 'Composer',
      released: '1987',
      songs: 1,
      startSong: 1,
      sidType: 'PSID',
      version: 2,
      sidModel: '6581',
      clock: 'PAL',
      fileSizeBytes: 1024,
      ...overrides.metadata,
    } satisfies PlaylistTrack['metadata'];

    const base: PlaylistTrack = {
      sidPath,
      relativePath: overrides.relativePath ?? `${sidPath}.sid`,
      filename: overrides.filename ?? `${sidPath.split('/').pop() ?? 'track'}.sid`,
      displayName: overrides.displayName ?? sidPath,
      selectedSong: overrides.selectedSong ?? 1,
      metadata: baseMetadata,
      durationSeconds: overrides.durationSeconds ?? 120,
      playlistNumber: overrides.playlistNumber ?? 1,
    };

    return {
      ...base,
      ...overrides,
      metadata: { ...baseMetadata, ...overrides.metadata },
    };
  };

  it('formats seconds into mm:ss', () => {
    expect(formatSeconds(0)).toBe('0:00');
    expect(formatSeconds(65)).toBe('1:05');
    expect(formatSeconds(125)).toBe('2:05');
  });

  it('parses mixed length strings safely', () => {
    expect(parseLengthSeconds('2:34')).toBe(154);
    expect(parseLengthSeconds('12')).toBe(15);
    expect(parseLengthSeconds('')).toBe(180);
    expect(parseLengthSeconds(undefined)).toBe(180);
    expect(parseLengthSeconds('not-a-number')).toBe(180);
  });

  it('deduplicates playlist entries by sidPath while preserving first occurrences', () => {
    const first = buildTrack('MUS/CoolTune', { playlistNumber: 1 });
    const second = buildTrack('MUS/Another', { playlistNumber: 2 });
    const duplicate = buildTrack('MUS/CoolTune', { playlistNumber: 99 });

    const result = dedupeBySidPath([first, second, duplicate]);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(first);
    expect(result[1]).toBe(second);
  });
});
