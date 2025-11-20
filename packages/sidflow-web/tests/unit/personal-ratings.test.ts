/**
 * Unit tests for personal ratings (localStorage-based)
 */
import { describe, test, expect, beforeEach } from 'bun:test';

// Mock localStorage for testing
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  
  return {
    getItem(key: string) {
      return store[key] || null;
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
    removeItem(key: string) {
      delete store[key];
    },
    clear() {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, 'window', {
  value: {},
  writable: true,
});

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

import {
  getPersonalRating,
  setPersonalRating,
  removePersonalRating,
  getAllRatedTracks,
  clearAllRatings,
} from '@/lib/personal-ratings';

describe('Personal Ratings', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('setPersonalRating and getPersonalRating', () => {
    test('should store and retrieve a personal rating', () => {
      const sidPath = '/test/music.sid';
      const rating = 5;
      
      setPersonalRating(sidPath, rating);
      const retrieved = getPersonalRating(sidPath);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved?.rating).toBe(rating);
      expect(retrieved?.timestamp).toBeDefined();
    });

    test('should store rating with dimensions', () => {
      const sidPath = '/test/music.sid';
      const rating = 4;
      const dimensions = { e: 5, m: 4, c: 3 };
      
      setPersonalRating(sidPath, rating, dimensions);
      const retrieved = getPersonalRating(sidPath);
      
      expect(retrieved?.rating).toBe(rating);
      expect(retrieved?.dimensions).toEqual(dimensions);
    });

    test('should return null for non-existent rating', () => {
      const retrieved = getPersonalRating('/nonexistent/track.sid');
      expect(retrieved).toBeNull();
    });

    test('should overwrite existing rating', () => {
      const sidPath = '/test/music.sid';
      
      setPersonalRating(sidPath, 3);
      let retrieved = getPersonalRating(sidPath);
      expect(retrieved?.rating).toBe(3);
      
      setPersonalRating(sidPath, 5);
      retrieved = getPersonalRating(sidPath);
      expect(retrieved?.rating).toBe(5);
    });

    test('should have valid timestamp format', () => {
      const sidPath = '/test/music.sid';
      setPersonalRating(sidPath, 4);
      
      const retrieved = getPersonalRating(sidPath);
      expect(retrieved?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('removePersonalRating', () => {
    test('should remove a rating', () => {
      const sidPath = '/test/music.sid';
      
      setPersonalRating(sidPath, 5);
      expect(getPersonalRating(sidPath)).not.toBeNull();
      
      removePersonalRating(sidPath);
      expect(getPersonalRating(sidPath)).toBeNull();
    });

    test('should not error when removing non-existent rating', () => {
      expect(() => {
        removePersonalRating('/nonexistent/track.sid');
      }).not.toThrow();
    });
  });

  describe('getAllRatedTracks', () => {
    test('should return empty array when no ratings exist', () => {
      const tracks = getAllRatedTracks();
      expect(tracks).toBeInstanceOf(Array);
      expect(tracks.length).toBe(0);
    });

    test('should return all rated tracks', () => {
      setPersonalRating('/test/track1.sid', 5);
      setPersonalRating('/test/track2.sid', 3);
      setPersonalRating('/test/track3.sid', 4);
      
      const tracks = getAllRatedTracks();
      expect(tracks.length).toBe(3);
      
      const paths = tracks.map(t => t.sidPath);
      expect(paths).toContain('/test/track1.sid');
      expect(paths).toContain('/test/track2.sid');
      expect(paths).toContain('/test/track3.sid');
    });

    test('should include rating details for each track', () => {
      setPersonalRating('/test/track.sid', 4, { e: 5, m: 4, c: 3 });
      
      const tracks = getAllRatedTracks();
      expect(tracks.length).toBe(1);
      expect(tracks[0].rating.rating).toBe(4);
      expect(tracks[0].rating.dimensions).toEqual({ e: 5, m: 4, c: 3 });
    });
  });

  describe('clearAllRatings', () => {
    test('should remove all ratings', () => {
      setPersonalRating('/test/track1.sid', 5);
      setPersonalRating('/test/track2.sid', 3);
      setPersonalRating('/test/track3.sid', 4);
      
      expect(getAllRatedTracks().length).toBe(3);
      
      clearAllRatings();
      expect(getAllRatedTracks().length).toBe(0);
    });

    test('should not error when clearing empty storage', () => {
      expect(() => {
        clearAllRatings();
      }).not.toThrow();
    });
  });

  describe('Rating validation', () => {
    test('should accept valid rating values (1-5)', () => {
      for (let rating = 1; rating <= 5; rating++) {
        setPersonalRating(`/test/track${rating}.sid`, rating);
        const retrieved = getPersonalRating(`/test/track${rating}.sid`);
        expect(retrieved?.rating).toBe(rating);
      }
    });

    test('should reject rating below 1', () => {
      const sidPath = '/test/invalid.sid';
      setPersonalRating(sidPath, 0);
      expect(getPersonalRating(sidPath)).toBeNull();
      
      setPersonalRating(sidPath, -1);
      expect(getPersonalRating(sidPath)).toBeNull();
    });

    test('should reject rating above 5', () => {
      const sidPath = '/test/invalid.sid';
      setPersonalRating(sidPath, 6);
      expect(getPersonalRating(sidPath)).toBeNull();
      
      setPersonalRating(sidPath, 10);
      expect(getPersonalRating(sidPath)).toBeNull();
    });

    test('should reject non-finite numbers', () => {
      const sidPath = '/test/invalid.sid';
      setPersonalRating(sidPath, NaN);
      expect(getPersonalRating(sidPath)).toBeNull();
      
      setPersonalRating(sidPath, Infinity);
      expect(getPersonalRating(sidPath)).toBeNull();
      
      setPersonalRating(sidPath, -Infinity);
      expect(getPersonalRating(sidPath)).toBeNull();
    });

    test('should reject non-number types', () => {
      const sidPath = '/test/invalid.sid';
      setPersonalRating(sidPath, '3' as any);
      expect(getPersonalRating(sidPath)).toBeNull();
      
      setPersonalRating(sidPath, null as any);
      expect(getPersonalRating(sidPath)).toBeNull();
      
      setPersonalRating(sidPath, undefined as any);
      expect(getPersonalRating(sidPath)).toBeNull();
    });
  });

  describe('localStorage persistence', () => {
    test('should persist ratings across instances', () => {
      const sidPath = '/test/music.sid';
      const rating = 4;
      
      setPersonalRating(sidPath, rating);
      
      // Simulate a new instance by reading directly from localStorage
      const stored = localStorage.getItem('sidflow-personal-ratings');
      expect(stored).not.toBeNull();
      
      const parsed = JSON.parse(stored!);
      expect(parsed[sidPath]).toBeDefined();
      expect(parsed[sidPath].rating).toBe(rating);
    });

    test('should handle multiple tracks in localStorage', () => {
      setPersonalRating('/test/track1.sid', 5);
      setPersonalRating('/test/track2.sid', 3);
      
      const stored = localStorage.getItem('sidflow-personal-ratings');
      const parsed = JSON.parse(stored!);
      
      expect(Object.keys(parsed).length).toBe(2);
      expect(parsed['/test/track1.sid'].rating).toBe(5);
      expect(parsed['/test/track2.sid'].rating).toBe(3);
    });
  });
});
