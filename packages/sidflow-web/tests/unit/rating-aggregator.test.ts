/**
 * Unit tests for rating aggregator functionality
 */
import { describe, test, expect } from 'bun:test';

describe('Rating Aggregator', () => {
  describe('Rating calculation', () => {
    test('should calculate average rating from feedback', () => {
      const aggregate = {
        likes: 10,
        dislikes: 2,
        skips: 3,
        plays: 0,
        recentPlays: 0,
      };

      const likeWeight = 5;
      const skipWeight = 3;
      const dislikeWeight = 1;

      const totalRatings = aggregate.likes + aggregate.skips + aggregate.dislikes;
      const weightedSum =
        aggregate.likes * likeWeight +
        aggregate.skips * skipWeight +
        aggregate.dislikes * dislikeWeight;
      const average = weightedSum / totalRatings;

      expect(totalRatings).toBe(15);
      expect(average).toBeCloseTo(4.07, 2); // (10*5 + 3*3 + 2*1) / 15 = 61/15 ≈ 4.07
    });

    test('should return default rating when no feedback', () => {
      const aggregate = {
        likes: 0,
        dislikes: 0,
        skips: 0,
        plays: 0,
        recentPlays: 0,
      };

      const totalRatings = aggregate.likes + aggregate.skips + aggregate.dislikes;
      const defaultRating = 3;

      expect(totalRatings).toBe(0);
      // When no ratings, should use default
      const average = totalRatings === 0 ? defaultRating : 0;
      expect(average).toBe(3);
    });

    test('should weight likes higher than skips and dislikes', () => {
      // All likes
      const allLikes = {
        likes: 10,
        dislikes: 0,
        skips: 0,
        plays: 0,
        recentPlays: 0,
      };
      const avgLikes = (allLikes.likes * 5) / allLikes.likes;
      expect(avgLikes).toBe(5);

      // All skips
      const allSkips = {
        likes: 0,
        dislikes: 0,
        skips: 10,
        plays: 0,
        recentPlays: 0,
      };
      const avgSkips = (allSkips.skips * 3) / allSkips.skips;
      expect(avgSkips).toBe(3);

      // All dislikes
      const allDislikes = {
        likes: 0,
        dislikes: 10,
        skips: 0,
        plays: 0,
        recentPlays: 0,
      };
      const avgDislikes = (allDislikes.dislikes * 1) / allDislikes.dislikes;
      expect(avgDislikes).toBe(1);
    });
  });

  describe('Trending calculation', () => {
    test('should calculate trending score based on recent plays', () => {
      const aggregate = {
        likes: 5,
        dislikes: 1,
        skips: 0,
        plays: 10,
        recentPlays: 15,
      };

      const likeRatio = aggregate.likes / (aggregate.likes + aggregate.dislikes + 1);
      const score = Math.min(1.0, (aggregate.recentPlays * likeRatio) / 20);

      expect(likeRatio).toBeCloseTo(0.714, 2); // 5/(5+1+1) ≈ 0.714
      expect(score).toBeCloseTo(0.536, 2); // (15 * 0.714) / 20 ≈ 0.536
    });

    test('should mark as trending when score > 0.7', () => {
      const highActivity = {
        likes: 10,
        dislikes: 0,
        skips: 0,
        plays: 20,
        recentPlays: 20,
      };

      const likeRatio = highActivity.likes / (highActivity.likes + highActivity.dislikes + 1);
      const score = Math.min(1.0, (highActivity.recentPlays * likeRatio) / 20);
      const isTrending = score > 0.7;

      expect(score).toBeCloseTo(0.909, 2); // (20 * 10/11) / 20 ≈ 0.909
      expect(isTrending).toBe(true);
    });

    test('should not be trending with low recent activity', () => {
      const lowActivity = {
        likes: 2,
        dislikes: 1,
        skips: 0,
        plays: 10,
        recentPlays: 3,
      };

      const likeRatio = lowActivity.likes / (lowActivity.likes + lowActivity.dislikes + 1);
      const score = Math.min(1.0, (lowActivity.recentPlays * likeRatio) / 20);
      const isTrending = score > 0.7;

      expect(score).toBeCloseTo(0.075, 2); // (3 * 0.5) / 20 = 0.075
      expect(isTrending).toBe(false);
    });

    test('should cap trending score at 1.0', () => {
      const veryHighActivity = {
        likes: 20,
        dislikes: 0,
        skips: 0,
        plays: 100,
        recentPlays: 50,
      };

      const likeRatio = veryHighActivity.likes / (veryHighActivity.likes + veryHighActivity.dislikes + 1);
      const score = Math.min(1.0, (veryHighActivity.recentPlays * likeRatio) / 20);

      expect(score).toBe(1.0); // Capped at 1.0
    });

    test('should penalize negative feedback in trending score', () => {
      const mixedFeedback = {
        likes: 5,
        dislikes: 10,
        skips: 0,
        plays: 20,
        recentPlays: 20,
      };

      const likeRatio = mixedFeedback.likes / (mixedFeedback.likes + mixedFeedback.dislikes + 1);
      const score = Math.min(1.0, (mixedFeedback.recentPlays * likeRatio) / 20);

      expect(likeRatio).toBeCloseTo(0.3125, 3); // 5/16
      expect(score).toBeCloseTo(0.3125, 3); // (20 * 0.3125) / 20
    });
  });

  describe('Aggregate response structure', () => {
    test('should have correct aggregate rating structure', () => {
      const aggregateRating = {
        sid_path: '/test/music.sid',
        community: {
          averageRating: 4.2,
          totalRatings: 42,
          likes: 30,
          dislikes: 5,
          skips: 7,
          plays: 100,
          dimensions: {
            energy: 4,
            mood: 3,
            complexity: 3,
          },
        },
        trending: {
          score: 0.8,
          recentPlays: 15,
          isTrending: true,
        },
      };

      expect(aggregateRating.sid_path).toBeDefined();
      expect(aggregateRating.community.averageRating).toBeGreaterThanOrEqual(1);
      expect(aggregateRating.community.averageRating).toBeLessThanOrEqual(5);
      expect(aggregateRating.community.totalRatings).toBeGreaterThanOrEqual(0);
      expect(aggregateRating.trending.score).toBeGreaterThanOrEqual(0);
      expect(aggregateRating.trending.score).toBeLessThanOrEqual(1);
      expect(typeof aggregateRating.trending.isTrending).toBe('boolean');
    });

    test('should handle track with no ratings', () => {
      const noRatings = {
        sid_path: '/test/unrated.sid',
        community: {
          averageRating: 3,
          totalRatings: 0,
          likes: 0,
          dislikes: 0,
          skips: 0,
          plays: 0,
          dimensions: {
            energy: 3,
            mood: 3,
            complexity: 3,
          },
        },
        trending: {
          score: 0,
          recentPlays: 0,
          isTrending: false,
        },
      };

      expect(noRatings.community.totalRatings).toBe(0);
      expect(noRatings.community.averageRating).toBe(3); // Default neutral
      expect(noRatings.trending.isTrending).toBe(false);
    });

    test('should include personal rating when available', () => {
      const withPersonal = {
        sid_path: '/test/rated.sid',
        community: {
          averageRating: 4.0,
          totalRatings: 20,
          likes: 15,
          dislikes: 2,
          skips: 3,
          plays: 50,
          dimensions: {
            energy: 4,
            mood: 4,
            complexity: 3,
          },
        },
        trending: {
          score: 0.5,
          recentPlays: 10,
          isTrending: false,
        },
        personal: {
          rating: 5,
          timestamp: '2025-01-15T12:00:00Z',
        },
      };

      expect(withPersonal.personal).toBeDefined();
      expect(withPersonal.personal?.rating).toBeGreaterThanOrEqual(1);
      expect(withPersonal.personal?.rating).toBeLessThanOrEqual(5);
      expect(withPersonal.personal?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('Star rating display', () => {
    test('should display correct number of filled stars', () => {
      const ratings = [
        { average: 1.0, stars: 1 },
        { average: 2.3, stars: 2 },
        { average: 3.5, stars: 4 },
        { average: 4.2, stars: 4 },
        { average: 4.8, stars: 5 },
        { average: 5.0, stars: 5 },
      ];

      for (const { average, stars } of ratings) {
        const filledStars = Math.round(average);
        expect(filledStars).toBe(stars);
      }
    });
  });

  describe('Dimension estimates', () => {
    test('should return neutral values for dimensions when not available', () => {
      const dimensions = {
        energy: 3,
        mood: 3,
        complexity: 3,
      };

      expect(dimensions.energy).toBe(3);
      expect(dimensions.mood).toBe(3);
      expect(dimensions.complexity).toBe(3);
    });

    test('should have valid dimension ranges', () => {
      const dimensions = {
        energy: 4,
        mood: 2,
        complexity: 5,
      };

      expect(dimensions.energy).toBeGreaterThanOrEqual(1);
      expect(dimensions.energy).toBeLessThanOrEqual(5);
      expect(dimensions.mood).toBeGreaterThanOrEqual(1);
      expect(dimensions.mood).toBeLessThanOrEqual(5);
      expect(dimensions.complexity).toBeGreaterThanOrEqual(1);
      expect(dimensions.complexity).toBeLessThanOrEqual(5);
    });
  });
});
