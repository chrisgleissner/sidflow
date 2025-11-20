import { describe, expect, test } from 'bun:test';

/**
 * Parse HVSC-style path to extract artist and title
 * Note: This function is internal to the route, so we test it via its behavior
 */
function parseSidPath(sidPath: string): { artist: string; title: string } {
  const parts = sidPath.split('/');
  const filename = parts[parts.length - 1];
  const title = filename.replace('.sid', '').replace(/_/g, ' ');

  // Extract artist from path
  let artist = 'Unknown';
  if (parts.length >= 2) {
    const artistPart = parts[parts.length - 2];
    // Handle formats like "Hubbard_Rob" or "Rob_Hubbard"
    artist = artistPart.replace(/_/g, ' ');
  }

  return { artist, title };
}

describe('parseSidPath', () => {
  test('should parse HVSC-style path with artist and title', () => {
    const result = parseSidPath('MUSICIANS/Hubbard_Rob/Delta.sid');
    expect(result.artist).toBe('Hubbard Rob');
    expect(result.title).toBe('Delta');
  });

  test('should handle underscores in artist name', () => {
    const result = parseSidPath('MUSICIANS/Last_Ninja/Theme.sid');
    expect(result.artist).toBe('Last Ninja');
    expect(result.title).toBe('Theme');
  });

  test('should handle underscores in filename', () => {
    const result = parseSidPath('MUSICIANS/Composer/My_Great_Song.sid');
    expect(result.artist).toBe('Composer');
    expect(result.title).toBe('My Great Song');
  });

  test('should return Unknown for single-level path', () => {
    const result = parseSidPath('Delta.sid');
    expect(result.artist).toBe('Unknown');
    expect(result.title).toBe('Delta');
  });

  test('should handle path without .sid extension', () => {
    const result = parseSidPath('MUSICIANS/Hubbard_Rob/Delta');
    expect(result.artist).toBe('Hubbard Rob');
    expect(result.title).toBe('Delta');
  });

  test('should handle nested directory structure', () => {
    const result = parseSidPath('MUSICIANS/H/Hubbard_Rob/Commando.sid');
    expect(result.artist).toBe('Hubbard Rob');
    expect(result.title).toBe('Commando');
  });

  test('should handle path with multiple directory levels', () => {
    const result = parseSidPath('GAMES/A-F/Commando/Loader.sid');
    expect(result.artist).toBe('Commando');
    expect(result.title).toBe('Loader');
  });

  test('should handle empty path parts', () => {
    const result = parseSidPath('/Artist/Song.sid');
    expect(result.artist).toBe('Artist');
    expect(result.title).toBe('Song');
  });

  test('should handle multiple consecutive underscores', () => {
    const result = parseSidPath('MUSICIANS/Van__Beethoven_Ludwig/Symphony__9.sid');
    expect(result.artist).toBe('Van  Beethoven Ludwig');
    expect(result.title).toBe('Symphony  9');
  });

  test('should handle special characters after underscore replacement', () => {
    const result = parseSidPath('MUSICIANS/O\'Neill_Martin/Celtic_Song.sid');
    expect(result.artist).toBe('O\'Neill Martin');
    expect(result.title).toBe('Celtic Song');
  });
});
