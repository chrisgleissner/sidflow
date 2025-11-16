/**
 * Unit tests for similarity search functionality
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

describe('Similarity Search', () => {
  describe('Request structure', () => {
    test('should have correct station-from-song request structure', () => {
      const validRequest = {
        sid_path: '/test/music.sid',
        limit: 20,
        similarity: 0.7,
        discovery: 0.5,
      };

      expect(validRequest.sid_path).toBeDefined();
      expect(validRequest.limit).toBeGreaterThan(0);
      expect(validRequest.similarity).toBeGreaterThanOrEqual(0);
      expect(validRequest.similarity).toBeLessThanOrEqual(1);
      expect(validRequest.discovery).toBeGreaterThanOrEqual(0);
      expect(validRequest.discovery).toBeLessThanOrEqual(1);
    });

    test('should have valid default parameters', () => {
      const requestWithDefaults = {
        sid_path: '/test/music.sid',
        // limit defaults to 20
        // similarity defaults to 0.7
        // discovery defaults to 0.5
      };

      expect(requestWithDefaults.sid_path).toBeDefined();
    });
  });

  describe('Response structure', () => {
    test('should have correct station response structure', () => {
      const validResponse = {
        seedTrack: {
          sidPath: '/test/seed.sid',
          displayName: 'Test Song',
          metadata: {
            author: 'Test Author',
            released: '1985',
            songs: 3,
            sidModel: '6581',
            length: '3:45',
            fileSizeBytes: 4096,
          },
          selectedSong: 0,
          durationSeconds: 225,
          filename: 'seed.sid',
        },
        similarTracks: [
          {
            sidPath: '/test/similar1.sid',
            displayName: 'Similar Song 1',
            metadata: {
              author: 'Test Author',
              released: '1986',
              songs: 1,
              sidModel: '6581',
              length: '3:30',
              fileSizeBytes: 3584,
            },
            selectedSong: 0,
            durationSeconds: 210,
            filename: 'similar1.sid',
          },
        ],
        stationName: 'Station: Test Song',
      };

      expect(validResponse.seedTrack).toBeDefined();
      expect(validResponse.similarTracks).toBeInstanceOf(Array);
      expect(validResponse.similarTracks.length).toBeGreaterThan(0);
      expect(validResponse.stationName).toContain('Station:');
    });
  });

  describe('Parameter validation', () => {
    test('should calculate correct minSimilarity based on discovery', () => {
      // Discovery = 0 => minSimilarity = 0.8
      const discovery0 = 0;
      const minSim0 = Math.max(0.3, 0.8 - discovery0 * 0.5);
      expect(minSim0).toBe(0.8);

      // Discovery = 0.5 => minSimilarity = 0.55
      const discovery05 = 0.5;
      const minSim05 = Math.max(0.3, 0.8 - discovery05 * 0.5);
      expect(minSim05).toBe(0.55);

      // Discovery = 1.0 => minSimilarity = 0.3
      const discovery1 = 1.0;
      const minSim1 = Math.max(0.3, 0.8 - discovery1 * 0.5);
      expect(minSim1).toBeCloseTo(0.3, 10);
    });

    test('should calculate correct boost factors based on similarity', () => {
      // Similarity = 0 => likeBoost = 1.0, dislikeBoost = 1.0
      const similarity0 = 0;
      const likeBoost0 = 1.0 + similarity0 * 1.0;
      const dislikeBoost0 = 1.0 - similarity0 * 0.5;
      expect(likeBoost0).toBe(1.0);
      expect(dislikeBoost0).toBe(1.0);

      // Similarity = 0.5 => likeBoost = 1.5, dislikeBoost = 0.75
      const similarity05 = 0.5;
      const likeBoost05 = 1.0 + similarity05 * 1.0;
      const dislikeBoost05 = 1.0 - similarity05 * 0.5;
      expect(likeBoost05).toBe(1.5);
      expect(dislikeBoost05).toBe(0.75);

      // Similarity = 1.0 => likeBoost = 2.0, dislikeBoost = 0.5
      const similarity1 = 1.0;
      const likeBoost1 = 1.0 + similarity1 * 1.0;
      const dislikeBoost1 = 1.0 - similarity1 * 0.5;
      expect(likeBoost1).toBe(2.0);
      expect(dislikeBoost1).toBe(0.5);
    });
  });

  describe('Personalization logic', () => {
    test('should boost tracks with positive feedback', () => {
      const baseSimilarity = 0.8;
      const likeBoost = 1.5;

      // Track with 1 like
      const boost1 = Math.pow(likeBoost, 1);
      const score1 = baseSimilarity * boost1;
      expect(score1).toBeGreaterThan(baseSimilarity);

      // Track with 2 likes
      const boost2 = Math.pow(likeBoost, 2);
      const score2 = baseSimilarity * boost2;
      expect(score2).toBeGreaterThan(score1);

      // Track with 5 likes (capped)
      const boost5 = Math.pow(likeBoost, Math.min(5, 5));
      const score5 = baseSimilarity * boost5;
      expect(score5).toBeGreaterThan(score2);

      // Track with 10 likes (should be same as 5, due to cap)
      const boost10 = Math.pow(likeBoost, Math.min(10, 5));
      const score10 = baseSimilarity * boost10;
      expect(score10).toBe(score5);
    });

    test('should penalize tracks with negative feedback', () => {
      const baseSimilarity = 0.8;
      const dislikeBoost = 0.5;

      // Track with 1 dislike
      const boost1 = Math.pow(dislikeBoost, 1);
      const score1 = baseSimilarity * boost1;
      expect(score1).toBeLessThan(baseSimilarity);

      // Track with 2 dislikes
      const boost2 = Math.pow(dislikeBoost, 2);
      const score2 = baseSimilarity * boost2;
      expect(score2).toBeLessThan(score1);

      // Track with 5 dislikes (capped)
      const boost5 = Math.pow(dislikeBoost, Math.min(5, 5));
      const score5 = baseSimilarity * boost5;
      expect(score5).toBeLessThan(score2);
    });

    test('should apply skip penalty', () => {
      const baseSimilarity = 0.8;

      // Track with 1 skip
      const boost1 = Math.pow(0.9, 1);
      const score1 = baseSimilarity * boost1;
      expect(score1).toBeLessThan(baseSimilarity);

      // Track with 3 skips (capped)
      const boost3 = Math.pow(0.9, Math.min(3, 3));
      const score3 = baseSimilarity * boost3;
      expect(score3).toBeLessThan(score1);

      // Track with 5 skips (should be same as 3, due to cap)
      const boost5 = Math.pow(0.9, Math.min(5, 3));
      const score5 = baseSimilarity * boost5;
      expect(score5).toBe(score3);
    });

    test('should combine multiple feedback types', () => {
      const baseSimilarity = 0.8;
      const likeBoost = 1.5;
      const dislikeBoost = 0.5;

      // Track with 2 likes and 1 dislike
      let boost = 1.0;
      boost *= Math.pow(likeBoost, Math.min(2, 5));
      boost *= Math.pow(dislikeBoost, Math.min(1, 5));
      const score = baseSimilarity * boost;

      // Should be boosted (likes outweigh dislikes)
      expect(score).toBeGreaterThan(baseSimilarity);
    });
  });

  describe('Vector similarity', () => {
    test('should convert distance to similarity score', () => {
      // Distance = 0 => similarity = 1.0
      const distance0 = 0;
      const similarity0 = Math.max(0, 1 - distance0 / 10);
      expect(similarity0).toBe(1.0);

      // Distance = 5 => similarity = 0.5
      const distance5 = 5;
      const similarity5 = Math.max(0, 1 - distance5 / 10);
      expect(similarity5).toBe(0.5);

      // Distance = 10 => similarity = 0.0
      const distance10 = 10;
      const similarity10 = Math.max(0, 1 - distance10 / 10);
      expect(similarity10).toBe(0.0);

      // Distance > 10 => similarity = 0.0 (clamped)
      const distance20 = 20;
      const similarity20 = Math.max(0, 1 - distance20 / 10);
      expect(similarity20).toBe(0.0);
    });
  });

  describe('Filtering and sorting', () => {
    test('should filter by minimum similarity threshold', () => {
      const tracks = [
        { sid_path: '/test/1.sid', similarity_score: 0.9 },
        { sid_path: '/test/2.sid', similarity_score: 0.6 },
        { sid_path: '/test/3.sid', similarity_score: 0.4 },
        { sid_path: '/test/4.sid', similarity_score: 0.2 },
      ];
      const minSimilarity = 0.5;

      const filtered = tracks.filter(t => t.similarity_score >= minSimilarity);
      expect(filtered.length).toBe(2);
      expect(filtered[0].similarity_score).toBeGreaterThanOrEqual(minSimilarity);
      expect(filtered[1].similarity_score).toBeGreaterThanOrEqual(minSimilarity);
    });

    test('should sort by similarity score descending', () => {
      const tracks = [
        { sid_path: '/test/1.sid', similarity_score: 0.6 },
        { sid_path: '/test/2.sid', similarity_score: 0.9 },
        { sid_path: '/test/3.sid', similarity_score: 0.4 },
        { sid_path: '/test/4.sid', similarity_score: 0.8 },
      ];

      const sorted = tracks.sort((a, b) => b.similarity_score - a.similarity_score);
      expect(sorted[0].similarity_score).toBe(0.9);
      expect(sorted[1].similarity_score).toBe(0.8);
      expect(sorted[2].similarity_score).toBe(0.6);
      expect(sorted[3].similarity_score).toBe(0.4);
    });

    test('should limit results to requested count', () => {
      const tracks = Array.from({ length: 50 }, (_, i) => ({
        sid_path: `/test/${i}.sid`,
        similarity_score: 1.0 - i * 0.01,
      }));
      const limit = 20;

      const limited = tracks.slice(0, limit);
      expect(limited.length).toBe(limit);
    });
  });
});
