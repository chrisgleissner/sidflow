/**
 * Unit tests for playlist storage
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'fs';
import { join } from 'path';
import {
  listPlaylists,
  getPlaylist,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  reorderPlaylistTracks,
} from '@/lib/server/playlist-storage';
import type { CreatePlaylistRequest, UpdatePlaylistRequest } from '@/lib/types/playlist';

const TEST_PLAYLISTS_PATH = join(process.cwd(), 'test-workspace', 'playlists');

describe('Playlist Storage', () => {
  beforeEach(async () => {
    // Set test environment
    process.env.SIDFLOW_PLAYLISTS_PATH = TEST_PLAYLISTS_PATH;

    // Clean up test directory
    try {
      await fs.rm(TEST_PLAYLISTS_PATH, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up after tests
    try {
      await fs.rm(TEST_PLAYLISTS_PATH, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  describe('listPlaylists', () => {
    test('returns empty array when no playlists exist', async () => {
      const playlists = await listPlaylists();
      expect(playlists).toEqual([]);
    });

    test('lists all playlists sorted by updatedAt descending', async () => {
      // Create multiple playlists with delays
      const request1: CreatePlaylistRequest = {
        name: 'First Playlist',
        tracks: [{ sidPath: '/path/track1.sid' }],
      };
      const playlist1 = await createPlaylist(request1);

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      const request2: CreatePlaylistRequest = {
        name: 'Second Playlist',
        tracks: [{ sidPath: '/path/track2.sid' }],
      };
      const playlist2 = await createPlaylist(request2);

      const playlists = await listPlaylists();
      expect(playlists).toHaveLength(2);
      // Most recent first
      expect(playlists[0].name).toBe('Second Playlist');
      expect(playlists[1].name).toBe('First Playlist');
    });
  });

  describe('createPlaylist', () => {
    test('creates a playlist with required fields', async () => {
      const request: CreatePlaylistRequest = {
        name: 'Test Playlist',
        tracks: [
          { sidPath: '/path/track1.sid', title: 'Track 1' },
          { sidPath: '/path/track2.sid', title: 'Track 2' },
        ],
      };

      const playlist = await createPlaylist(request);

      expect(playlist.id).toBeDefined();
      expect(playlist.name).toBe('Test Playlist');
      expect(playlist.trackCount).toBe(2);
      expect(playlist.tracks).toHaveLength(2);
      expect(playlist.tracks[0].order).toBe(0);
      expect(playlist.tracks[1].order).toBe(1);
      expect(playlist.createdAt).toBeDefined();
      expect(playlist.updatedAt).toBeDefined();
    });

    test('creates a playlist with description', async () => {
      const request: CreatePlaylistRequest = {
        name: 'Test Playlist',
        description: 'My favorite tracks',
        tracks: [{ sidPath: '/path/track1.sid' }],
      };

      const playlist = await createPlaylist(request);

      expect(playlist.description).toBe('My favorite tracks');
    });

    test('calculates total duration when track lengths provided', async () => {
      const request: CreatePlaylistRequest = {
        name: 'Test Playlist',
        tracks: [
          { sidPath: '/path/track1.sid', lengthSeconds: 180 },
          { sidPath: '/path/track2.sid', lengthSeconds: 210 },
        ],
      };

      const playlist = await createPlaylist(request);

      expect(playlist.totalDuration).toBe(390); // 180 + 210
    });
  });

  describe('getPlaylist', () => {
    test('retrieves an existing playlist by ID', async () => {
      const request: CreatePlaylistRequest = {
        name: 'Test Playlist',
        tracks: [{ sidPath: '/path/track1.sid' }],
      };

      const created = await createPlaylist(request);
      const retrieved = await getPlaylist(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.name).toBe('Test Playlist');
    });

    test('returns null for non-existent playlist', async () => {
      const playlist = await getPlaylist('non-existent-id');
      expect(playlist).toBeNull();
    });
  });

  describe('updatePlaylist', () => {
    test('updates playlist name', async () => {
      const created = await createPlaylist({
        name: 'Original Name',
        tracks: [{ sidPath: '/path/track1.sid' }],
      });

      const updated = await updatePlaylist(created.id, {
        name: 'Updated Name',
      });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.updatedAt).not.toBe(created.updatedAt);
    });

    test('updates playlist tracks', async () => {
      const created = await createPlaylist({
        name: 'Test Playlist',
        tracks: [{ sidPath: '/path/track1.sid' }],
      });

      const updated = await updatePlaylist(created.id, {
        tracks: [
          { sidPath: '/path/track1.sid' },
          { sidPath: '/path/track2.sid' },
          { sidPath: '/path/track3.sid' },
        ],
      });

      expect(updated).toBeDefined();
      expect(updated?.trackCount).toBe(3);
      expect(updated?.tracks).toHaveLength(3);
    });

    test('returns null for non-existent playlist', async () => {
      const updated = await updatePlaylist('non-existent-id', {
        name: 'New Name',
      });

      expect(updated).toBeNull();
    });
  });

  describe('deletePlaylist', () => {
    test('deletes an existing playlist', async () => {
      const created = await createPlaylist({
        name: 'Test Playlist',
        tracks: [{ sidPath: '/path/track1.sid' }],
      });

      const deleted = await deletePlaylist(created.id);
      expect(deleted).toBe(true);

      const retrieved = await getPlaylist(created.id);
      expect(retrieved).toBeNull();
    });

    test('returns false for non-existent playlist', async () => {
      const deleted = await deletePlaylist('non-existent-id');
      expect(deleted).toBe(false);
    });
  });

  describe('reorderPlaylistTracks', () => {
    test('reorders tracks based on sidPath array', async () => {
      const created = await createPlaylist({
        name: 'Test Playlist',
        tracks: [
          { sidPath: '/path/track1.sid', title: 'Track 1' },
          { sidPath: '/path/track2.sid', title: 'Track 2' },
          { sidPath: '/path/track3.sid', title: 'Track 3' },
        ],
      });

      // Reorder: 3, 1, 2
      const reordered = await reorderPlaylistTracks(created.id, [
        '/path/track3.sid',
        '/path/track1.sid',
        '/path/track2.sid',
      ]);

      expect(reordered).toBeDefined();
      expect(reordered?.tracks[0].sidPath).toBe('/path/track3.sid');
      expect(reordered?.tracks[0].order).toBe(0);
      expect(reordered?.tracks[1].sidPath).toBe('/path/track1.sid');
      expect(reordered?.tracks[1].order).toBe(1);
      expect(reordered?.tracks[2].sidPath).toBe('/path/track2.sid');
      expect(reordered?.tracks[2].order).toBe(2);
    });

    test('returns null for non-existent playlist', async () => {
      const reordered = await reorderPlaylistTracks('non-existent-id', []);
      expect(reordered).toBeNull();
    });
  });
});
