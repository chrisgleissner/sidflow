import { describe, expect, test } from 'bun:test';

describe('Collaborative Discovery', () => {
    test('feedback filtering logic for positive signals', () => {
        const track1 = { likes: 5, dislikes: 1, plays: 10, skips: 2 };
        const track2 = { likes: 0, dislikes: 0, plays: 8, skips: 1 };
        const track3 = { likes: 1, dislikes: 5, plays: 15, skips: 10 };

        // Track 1: Good - has likes and good ratio
        const hasPositiveFeedback1 = track1.likes > 0 || track1.plays > 5;
        const hasGoodRatio1 = track1.dislikes === 0 || track1.likes / Math.max(track1.dislikes, 1) > 1.5;
        expect(hasPositiveFeedback1 && hasGoodRatio1).toBe(true);

        // Track 2: Good - no likes but many plays
        const hasPositiveFeedback2 = track2.likes > 0 || track2.plays > 5;
        const hasGoodRatio2 = track2.dislikes === 0 || track2.likes / Math.max(track2.dislikes, 1) > 1.5;
        expect(hasPositiveFeedback2 && hasGoodRatio2).toBe(true);

        // Track 3: Bad - poor like/dislike ratio
        const hasPositiveFeedback3 = track3.likes > 0 || track3.plays > 5;
        const hasGoodRatio3 = track3.dislikes === 0 || track3.likes / Math.max(track3.dislikes, 1) > 1.5;
        expect(hasPositiveFeedback3 && hasGoodRatio3).toBe(false);
    });

    test('like boost calculation', () => {
        const likeBoost = 2.0;

        // Track with 1 like
        const boost1 = Math.pow(likeBoost, Math.min(1, 5));
        expect(boost1).toBe(2.0);

        // Track with 3 likes
        const boost3 = Math.pow(likeBoost, Math.min(3, 5));
        expect(boost3).toBe(8.0);

        // Track with 5 likes (capped at 5)
        const boost5 = Math.pow(likeBoost, Math.min(5, 5));
        expect(boost5).toBe(32.0);

        // Track with 10 likes (still capped at 5)
        const boost10 = Math.pow(likeBoost, Math.min(10, 5));
        expect(boost10).toBe(32.0);
    });

    test('dislike penalty calculation', () => {
        const dislikeBoost = 0.3;

        // Track with 1 dislike
        const penalty1 = Math.pow(dislikeBoost, Math.min(1, 5));
        expect(penalty1).toBe(0.3);

        // Track with 2 dislikes
        const penalty2 = Math.pow(dislikeBoost, Math.min(2, 5));
        expect(penalty2).toBeCloseTo(0.09, 2);

        // Track with 5 dislikes (capped at 5)
        const penalty5 = Math.pow(dislikeBoost, Math.min(5, 5));
        expect(penalty5).toBeCloseTo(0.00243, 5);
    });
});
