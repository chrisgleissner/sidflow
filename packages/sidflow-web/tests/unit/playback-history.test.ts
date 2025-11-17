import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  getPlaybackHistory,
  addToPlaybackHistory,
  clearPlaybackHistory,
  getRecentHistory,
  removeFromHistory,
  isInHistory,
  getHistoryCount,
  type PlaybackHistoryEntry,
} from '@/lib/playback-history';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

describe('Playback History', () => {
  beforeEach(() => {
    // Setup localStorage mock
    Object.defineProperty(global, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
    localStorageMock.clear();
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  describe('getPlaybackHistory', () => {
    it('should return empty array initially', () => {
      const history = getPlaybackHistory();
      expect(history).toEqual([]);
    });

    it('should return stored history', () => {
      const mockHistory: PlaybackHistoryEntry[] = [
        {
          sidPath: 'MUSICIANS/Hubbard_Rob/Delta.sid',
          displayName: 'Delta',
          timestamp: Date.now(),
        },
      ];
      localStorage.setItem('sidflow-playback-history', JSON.stringify(mockHistory));

      const history = getPlaybackHistory();
      expect(history).toHaveLength(1);
      expect(history[0].sidPath).toBe('MUSICIANS/Hubbard_Rob/Delta.sid');
    });

    it('should handle corrupted storage gracefully', () => {
      localStorage.setItem('sidflow-playback-history', 'invalid-json');
      const history = getPlaybackHistory();
      expect(history).toEqual([]);
    });
  });

  describe('addToPlaybackHistory', () => {
    it('should add a track to history', () => {
      addToPlaybackHistory({
        sidPath: 'MUSICIANS/Hubbard_Rob/Delta.sid',
        displayName: 'Delta',
      });

      const history = getPlaybackHistory();
      expect(history).toHaveLength(1);
      expect(history[0].sidPath).toBe('MUSICIANS/Hubbard_Rob/Delta.sid');
      expect(history[0].displayName).toBe('Delta');
      expect(history[0].timestamp).toBeGreaterThan(0);
    });

    it('should add track with metadata', () => {
      addToPlaybackHistory({
        sidPath: 'MUSICIANS/Hubbard_Rob/Delta.sid',
        displayName: 'Delta',
        metadata: {
          author: 'Rob Hubbard',
          released: '1987',
          length: '3:00',
        },
      });

      const history = getPlaybackHistory();
      expect(history[0].metadata?.author).toBe('Rob Hubbard');
      expect(history[0].metadata?.released).toBe('1987');
    });

    it('should add new tracks at the beginning', () => {
      addToPlaybackHistory({
        sidPath: 'track1.sid',
        displayName: 'Track 1',
      });
      addToPlaybackHistory({
        sidPath: 'track2.sid',
        displayName: 'Track 2',
      });

      const history = getPlaybackHistory();
      expect(history).toHaveLength(2);
      expect(history[0].sidPath).toBe('track2.sid');
      expect(history[1].sidPath).toBe('track1.sid');
    });

    it('should remove duplicates and keep most recent', () => {
      addToPlaybackHistory({
        sidPath: 'track1.sid',
        displayName: 'Track 1',
      });
      addToPlaybackHistory({
        sidPath: 'track2.sid',
        displayName: 'Track 2',
      });
      addToPlaybackHistory({
        sidPath: 'track1.sid',
        displayName: 'Track 1',
      });

      const history = getPlaybackHistory();
      expect(history).toHaveLength(2);
      expect(history[0].sidPath).toBe('track1.sid');
      expect(history[1].sidPath).toBe('track2.sid');
    });

    it('should limit history to 100 entries', () => {
      // Add 150 tracks
      for (let i = 0; i < 150; i++) {
        addToPlaybackHistory({
          sidPath: `track${i}.sid`,
          displayName: `Track ${i}`,
        });
      }

      const history = getPlaybackHistory();
      expect(history).toHaveLength(100);
      expect(history[0].sidPath).toBe('track149.sid');
      expect(history[99].sidPath).toBe('track50.sid');
    });
  });

  describe('clearPlaybackHistory', () => {
    it('should clear all history', () => {
      addToPlaybackHistory({
        sidPath: 'track1.sid',
        displayName: 'Track 1',
      });
      addToPlaybackHistory({
        sidPath: 'track2.sid',
        displayName: 'Track 2',
      });

      clearPlaybackHistory();

      const history = getPlaybackHistory();
      expect(history).toEqual([]);
    });
  });

  describe('getRecentHistory', () => {
    beforeEach(() => {
      // Add 30 tracks
      for (let i = 0; i < 30; i++) {
        addToPlaybackHistory({
          sidPath: `track${i}.sid`,
          displayName: `Track ${i}`,
        });
      }
    });

    it('should return last 20 tracks by default', () => {
      const recent = getRecentHistory();
      expect(recent).toHaveLength(20);
      expect(recent[0].sidPath).toBe('track29.sid');
      expect(recent[19].sidPath).toBe('track10.sid');
    });

    it('should respect custom limit', () => {
      const recent = getRecentHistory(5);
      expect(recent).toHaveLength(5);
      expect(recent[0].sidPath).toBe('track29.sid');
      expect(recent[4].sidPath).toBe('track25.sid');
    });
  });

  describe('removeFromHistory', () => {
    beforeEach(() => {
      addToPlaybackHistory({
        sidPath: 'track1.sid',
        displayName: 'Track 1',
      });
      addToPlaybackHistory({
        sidPath: 'track2.sid',
        displayName: 'Track 2',
      });
      addToPlaybackHistory({
        sidPath: 'track3.sid',
        displayName: 'Track 3',
      });
    });

    it('should remove specific track from history', () => {
      removeFromHistory('track2.sid');

      const history = getPlaybackHistory();
      expect(history).toHaveLength(2);
      expect(history.some(h => h.sidPath === 'track2.sid')).toBe(false);
      expect(history.some(h => h.sidPath === 'track1.sid')).toBe(true);
      expect(history.some(h => h.sidPath === 'track3.sid')).toBe(true);
    });

    it('should handle removing non-existent track', () => {
      removeFromHistory('nonexistent.sid');
      const history = getPlaybackHistory();
      expect(history).toHaveLength(3);
    });
  });

  describe('isInHistory', () => {
    beforeEach(() => {
      addToPlaybackHistory({
        sidPath: 'track1.sid',
        displayName: 'Track 1',
      });
    });

    it('should return true for tracks in history', () => {
      expect(isInHistory('track1.sid')).toBe(true);
    });

    it('should return false for tracks not in history', () => {
      expect(isInHistory('nonexistent.sid')).toBe(false);
    });
  });

  describe('getHistoryCount', () => {
    it('should return 0 for empty history', () => {
      expect(getHistoryCount()).toBe(0);
    });

    it('should return correct count', () => {
      addToPlaybackHistory({
        sidPath: 'track1.sid',
        displayName: 'Track 1',
      });
      addToPlaybackHistory({
        sidPath: 'track2.sid',
        displayName: 'Track 2',
      });

      expect(getHistoryCount()).toBe(2);
    });
  });
});
