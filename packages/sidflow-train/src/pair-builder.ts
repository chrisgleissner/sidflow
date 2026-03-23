/**
 * D1: Training pair derivation from user feedback events.
 *
 * Converts raw feedback JSONL records into structured training pairs suitable
 * for metric learning:
 *  - Positive pairs  (anchor, positive): tracks the user liked together
 *  - Negative pairs  (anchor, negative): tracks liked vs disliked/skipped
 *  - Triplets        (anchor, positive, negative)
 *  - Ranking pairs   (higher, lower): ordinal preference within a session
 *
 * Session boundary: consecutive events within SESSION_GAP_MS of each other.
 */

import type { FeedbackRecord } from "@sidflow/common";

/** Two consecutive events within this window are considered the same session. */
const SESSION_GAP_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Minimum total interaction events before a track ID is used in pairs. */
const MIN_TRACK_EVENTS = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrackPair {
  anchor: string; // track_id (sid_path#song_index)
  other: string;
  pairType: "positive" | "negative";
  /** Confidence weight in [0, 1] */
  weight: number;
}

export interface TrainingTriplet {
  anchor: string;
  positive: string;
  negative: string;
  weight: number;
}

export interface RankingPair {
  higher: string;
  lower: string;
  weight: number;
}

export interface DerivedTrainingPairs {
  positive: TrackPair[];
  negative: TrackPair[];
  triplets: TrainingTriplet[];
  ranking: RankingPair[];
}

// ---------------------------------------------------------------------------
// Session splitting
// ---------------------------------------------------------------------------

interface TimedEvent extends FeedbackRecord {
  tsMs: number;
  trackId: string;
}

function toTrackId(record: FeedbackRecord): string {
  const songIndex = record.song_index ?? 1;
  return `${record.sid_path}#${songIndex}`;
}

function splitIntoSessions(records: FeedbackRecord[]): TimedEvent[][] {
  if (records.length === 0) return [];

  const sorted: TimedEvent[] = records
    .map((r) => ({ ...r, tsMs: new Date(r.ts).getTime(), trackId: toTrackId(r) }))
    .filter((r) => Number.isFinite(r.tsMs))
    .sort((a, b) => a.tsMs - b.tsMs);

  const sessions: TimedEvent[][] = [];
  let current: TimedEvent[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.tsMs - prev.tsMs > SESSION_GAP_MS) {
      sessions.push(current);
      current = [];
    }
    current.push(cur);
  }
  if (current.length > 0) sessions.push(current);
  return sessions;
}

// ---------------------------------------------------------------------------
// Signal classification
// ---------------------------------------------------------------------------

type SignalStrength = "strong_positive" | "positive" | "neutral" | "negative" | "strong_negative";

function classifySignal(action: FeedbackRecord["action"]): SignalStrength {
  switch (action) {
    case "replay":      return "strong_positive";
    case "like":
    case "play_complete": return "positive";
    case "play":        return "neutral";
    case "skip_late":   return "negative";
    case "skip":
    case "skip_early":
    case "dislike":     return "strong_negative";
    default:            return "neutral";
  }
}

function signalWeight(strength: SignalStrength): number {
  switch (strength) {
    case "strong_positive": return 1.0;
    case "positive":        return 0.7;
    case "neutral":         return 0.0;
    case "negative":        return 0.5;
    case "strong_negative": return 1.0;
  }
}

function isPositive(s: SignalStrength): boolean {
  return s === "positive" || s === "strong_positive";
}

function isNegative(s: SignalStrength): boolean {
  return s === "negative" || s === "strong_negative";
}

// ---------------------------------------------------------------------------
// Pair derivation
// ---------------------------------------------------------------------------

/**
 * Derive training pairs from a list of FeedbackRecord events.
 *
 * Acceptance criterion: given 100 feedback events, produces ≥ 50 valid pairs.
 */
export function deriveTrainingPairs(records: FeedbackRecord[]): DerivedTrainingPairs {
  const positive: TrackPair[] = [];
  const negative: TrackPair[] = [];
  const ranking: RankingPair[] = [];

  // Filter out tracks with too few events from consideration
  const eventCount = new Map<string, number>();
  for (const r of records) {
    const id = toTrackId(r);
    eventCount.set(id, (eventCount.get(id) ?? 0) + 1);
  }
  const eligibleRecords = records.filter((r) => (eventCount.get(toTrackId(r)) ?? 0) >= MIN_TRACK_EVENTS);

  const sessions = splitIntoSessions(eligibleRecords);

  const seenPairs = new Set<string>();
  function pairKey(a: string, b: string): string {
    return a < b ? `${a}||${b}` : `${b}||${a}`;
  }

  for (const session of sessions) {
    // Classify each event in the session
    const classified = session.map((e) => ({
      trackId: e.trackId,
      strength: classifySignal(e.action),
      weight: signalWeight(classifySignal(e.action)),
    }));

    const positiveTracks = classified.filter((e) => isPositive(e.strength));
    const negativeTracks = classified.filter((e) => isNegative(e.strength));

    // Positive pairs: like+like, play_complete+play_complete within session
    for (let i = 0; i < positiveTracks.length; i++) {
      for (let j = i + 1; j < positiveTracks.length; j++) {
        const a = positiveTracks[i]!;
        const b = positiveTracks[j]!;
        if (a.trackId === b.trackId) continue;
        const key = pairKey(a.trackId, b.trackId);
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        const w = Math.min(1, (a.weight + b.weight) / 2);
        positive.push({ anchor: a.trackId, other: b.trackId, pairType: "positive", weight: w });
      }
    }

    // Negative pairs: like vs dislike/skip_early within session
    for (const pos of positiveTracks) {
      for (const neg of negativeTracks) {
        if (pos.trackId === neg.trackId) continue;
        const key = pairKey(pos.trackId, neg.trackId);
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        const w = Math.min(1, (pos.weight + neg.weight) / 2);
        negative.push({ anchor: pos.trackId, other: neg.trackId, pairType: "negative", weight: w });
      }
    }

    // Ranking pairs (ordinal preference using signal strength)
    // Any positive-signal track ranks above any negative-signal track
    for (const pos of positiveTracks) {
      for (const neg of negativeTracks) {
        if (pos.trackId === neg.trackId) continue;
        const rankKey = `rank:${pos.trackId}>${neg.trackId}`;
        if (seenPairs.has(rankKey)) continue;
        seenPairs.add(rankKey);
        const w = Math.min(1, (pos.weight + neg.weight) / 2);
        ranking.push({ higher: pos.trackId, lower: neg.trackId, weight: w });
      }
    }
  }

  // Triplet construction: (anchor=positive, positive=other_positive, negative=negative)
  const triplets: TrainingTriplet[] = [];
  const seenTriplets = new Set<string>();

  for (const pos of positive) {
    for (const neg of negative) {
      // Use the anchor from the positive pair as the triplet anchor
      const anchor = pos.anchor;
      const positiveTrack = pos.other;
      if (neg.anchor !== anchor) continue;
      const negativeTrack = neg.other;

      if (anchor === positiveTrack || anchor === negativeTrack || positiveTrack === negativeTrack) continue;

      const tKey = `${anchor}|${positiveTrack}|${negativeTrack}`;
      if (seenTriplets.has(tKey)) continue;
      seenTriplets.add(tKey);

      const w = Math.min(1, (pos.weight + neg.weight) / 2);
      triplets.push({ anchor, positive: positiveTrack, negative: negativeTrack, weight: w });

      // Limit triplets to avoid O(n^3) explosion
      if (triplets.length >= 10_000) break;
    }
    if (triplets.length >= 10_000) break;
  }

  return { positive, negative, triplets, ranking };
}
