import type { FeedbackRecord } from "./jsonl-schema.js";

export const FEEDBACK_HALF_LIFE_DAYS = 90;

export interface AggregatedFeedback {
  likes: number;
  dislikes: number;
  skips: number;
  plays: number;
  recentPlays: number;
  decayedLikes: number;
  decayedDislikes: number;
  decayedSkips: number;
  decayedPlays: number;
  decayedRecentPlays: number;
  lastPlayed?: string;
}

export interface FeedbackScoreInput {
  likes: number;
  dislikes: number;
  skips: number;
  plays: number;
  decayedLikes?: number;
  decayedDislikes?: number;
  decayedSkips?: number;
  decayedPlays?: number;
}

export function calculateTemporalDecayWeight(
  timestamp: string,
  now: Date = new Date(),
  halfLifeDays = FEEDBACK_HALF_LIFE_DAYS,
): number {
  const eventTime = Date.parse(timestamp);
  if (!Number.isFinite(eventTime)) {
    return 0;
  }

  const ageDays = Math.max(0, (now.getTime() - eventTime) / (24 * 60 * 60 * 1000));
  const lambda = Math.log(2) / Math.max(1, halfLifeDays);
  return Math.exp(-lambda * ageDays);
}

function createEmptyAggregate(): AggregatedFeedback {
  return {
    likes: 0,
    dislikes: 0,
    skips: 0,
    plays: 0,
    recentPlays: 0,
    decayedLikes: 0,
    decayedDislikes: 0,
    decayedSkips: 0,
    decayedPlays: 0,
    decayedRecentPlays: 0,
  };
}

export function aggregateFeedbackRecordsByKey<Key extends string>(
  events: FeedbackRecord[],
  keySelector: (event: FeedbackRecord) => Key,
  now: Date = new Date(),
): Map<Key, AggregatedFeedback> {
  const aggregates = new Map<Key, AggregatedFeedback>();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const event of events) {
    const key = keySelector(event);
    const aggregate = aggregates.get(key) ?? createEmptyAggregate();
    const decayWeight = calculateTemporalDecayWeight(event.ts, now);

    switch (event.action) {
      case "like":
        aggregate.likes += 1;
        aggregate.decayedLikes += decayWeight;
        break;
      case "dislike":
        aggregate.dislikes += 1;
        aggregate.decayedDislikes += decayWeight;
        break;
      case "skip":
        aggregate.skips += 1;
        aggregate.decayedSkips += decayWeight;
        break;
      case "skip_early":
        aggregate.skips += 1;
        aggregate.decayedSkips += decayWeight * 1.2;
        break;
      case "skip_late":
        aggregate.skips += 1;
        aggregate.decayedSkips += decayWeight * 0.6;
        break;
      case "play":
        aggregate.plays += 1;
        aggregate.decayedPlays += decayWeight;
        if (event.ts >= sevenDaysAgo) {
          aggregate.recentPlays += 1;
          aggregate.decayedRecentPlays += decayWeight;
        }
        break;
      case "play_complete":
        aggregate.plays += 1;
        aggregate.decayedPlays += decayWeight * 1.1;
        aggregate.decayedLikes += decayWeight * 0.6;
        if (event.ts >= sevenDaysAgo) {
          aggregate.recentPlays += 1;
          aggregate.decayedRecentPlays += decayWeight;
        }
        break;
      case "replay":
        aggregate.plays += 1;
        aggregate.decayedPlays += decayWeight * 1.2;
        aggregate.decayedLikes += decayWeight * 1.2;
        if (event.ts >= sevenDaysAgo) {
          aggregate.recentPlays += 1;
          aggregate.decayedRecentPlays += decayWeight * 1.1;
        }
        break;
    }

    if (
      event.action === "play" ||
      event.action === "play_complete" ||
      event.action === "replay" ||
      event.action === "like"
    ) {
      if (!aggregate.lastPlayed || event.ts > aggregate.lastPlayed) {
        aggregate.lastPlayed = event.ts;
      }
    }

    aggregates.set(key, aggregate);
  }

  return aggregates;
}

export function aggregateFeedbackBySidPath(
  events: FeedbackRecord[],
  now: Date = new Date(),
): Map<string, AggregatedFeedback> {
  return aggregateFeedbackRecordsByKey(events, (event) => event.sid_path, now);
}

export function calculateNormalizedSongFeedback(input: FeedbackScoreInput): number {
  const likes = input.decayedLikes ?? input.likes;
  const dislikes = input.decayedDislikes ?? input.dislikes;
  const skips = input.decayedSkips ?? input.skips;
  const plays = Math.max(input.decayedPlays ?? input.plays, 1);
  const score = (likes - dislikes - 0.3 * skips) / plays;
  return Math.max(0, Math.min(1, (score + 2) / 4));
}