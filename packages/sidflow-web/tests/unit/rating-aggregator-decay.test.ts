import { describe, expect, it } from 'bun:test';
import { aggregateFeedback, calculateAverageRating, calculateTemporalDecayWeight, calculateTrendingScore } from '@/lib/server/rating-aggregator';
import type { FeedbackRecord } from '@sidflow/common';

describe('rating aggregator temporal decay', () => {
  it('decays older events more strongly than recent ones', () => {
    const now = new Date('2026-03-22T12:00:00.000Z');
    const recent = calculateTemporalDecayWeight('2026-03-21T12:00:00.000Z', now);
    const old = calculateTemporalDecayWeight('2025-09-22T12:00:00.000Z', now);

    expect(recent).toBeGreaterThan(old);
    expect(recent).toBeLessThanOrEqual(1);
    expect(old).toBeGreaterThan(0);
  });

  it('applies stronger negative weight to early skips and positive reinforcement to replay/play_complete', () => {
    const now = new Date('2026-03-22T12:00:00.000Z');
    const events: FeedbackRecord[] = [
      { ts: '2026-03-22T11:59:00.000Z', sid_path: 'track.sid', action: 'play_complete' },
      { ts: '2026-03-22T11:58:00.000Z', sid_path: 'track.sid', action: 'replay' },
      { ts: '2026-03-22T11:57:00.000Z', sid_path: 'track.sid', action: 'skip_early' },
      { ts: '2026-03-22T11:56:00.000Z', sid_path: 'track.sid', action: 'skip_late' },
    ];

    const aggregate = aggregateFeedback(events, now).get('track.sid');
    expect(aggregate).toBeDefined();
    if (!aggregate) {
      throw new Error('expected aggregate');
    }

    expect(aggregate.decayedLikes).toBeGreaterThan(0);
    expect(aggregate.decayedSkips).toBeGreaterThan(0);
    expect(aggregate.decayedPlays).toBeGreaterThan(0);

    const average = calculateAverageRating(aggregate);
    const trending = calculateTrendingScore(aggregate);

    expect(average.average).toBeGreaterThan(2.5);
    expect(trending.score).toBeGreaterThan(0);
  });
});