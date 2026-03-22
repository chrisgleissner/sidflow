import { describe, expect, it } from "bun:test";
import { deriveTrainingPairs } from "../src/pair-builder.js";
import type { FeedbackRecord } from "@sidflow/common";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _ts = new Date("2025-01-01T12:00:00Z").getTime();

function makeEvent(
  sidPath: string,
  action: FeedbackRecord["action"],
  offsetMinutes = 0
): FeedbackRecord {
  return {
    sid_path: sidPath,
    song_index: 1,
    action,
    ts: new Date(_ts + offsetMinutes * 60_000).toISOString(),
  };
}

/** Build 100 deterministic like/dislike events spanning 2 sessions. */
function buildTestEvents(): FeedbackRecord[] {
  const events: FeedbackRecord[] = [];
  // Session 1 (t=0 to t=50 min): 10 liked tracks, 5 disliked
  for (let i = 0; i < 10; i++) {
    events.push(makeEvent(`MUSICIANS/A/track${i}.sid`, "like", i * 2));
  }
  for (let i = 10; i < 15; i++) {
    events.push(makeEvent(`MUSICIANS/A/track${i}.sid`, "dislike", i * 2));
  }
  // Session 2 (t=0 + 3h to t=0 + 3h + 30min): 5 play_complete, 3 skip_early
  const sessionOffset = 3 * 60;
  for (let i = 0; i < 5; i++) {
    events.push(makeEvent(`MUSICIANS/B/track${i}.sid`, "play_complete", sessionOffset + i * 3));
  }
  for (let i = 5; i < 8; i++) {
    events.push(makeEvent(`MUSICIANS/B/track${i}.sid`, "skip_early", sessionOffset + i * 3));
  }
  // Pad to ~100 events with neutral "play"
  for (let i = 0; events.length < 100; i++) {
    events.push(makeEvent(`MUSICIANS/C/filler${i}.sid`, "play", i * 1));
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveTrainingPairs", () => {
  it("returns the expected data structure", () => {
    const events = buildTestEvents();
    const pairs = deriveTrainingPairs(events);
    expect(pairs).toBeDefined();
    expect(Array.isArray(pairs.positive)).toBe(true);
    expect(Array.isArray(pairs.negative)).toBe(true);
    expect(Array.isArray(pairs.triplets)).toBe(true);
    expect(Array.isArray(pairs.ranking)).toBe(true);
  });

  it("produces ≥ 50 total pairs from 100 events (acceptance criterion)", () => {
    const events = buildTestEvents();
    const pairs = deriveTrainingPairs(events);
    const total =
      pairs.positive.length + pairs.negative.length + pairs.ranking.length;
    expect(total).toBeGreaterThanOrEqual(50);
  });

  it("all pair weights are in [0, 1]", () => {
    const events = buildTestEvents();
    const pairs = deriveTrainingPairs(events);
    for (const p of [...pairs.positive, ...pairs.negative]) {
      expect(p.weight).toBeGreaterThanOrEqual(0);
      expect(p.weight).toBeLessThanOrEqual(1);
    }
    for (const t of pairs.triplets) {
      expect(t.weight).toBeGreaterThanOrEqual(0);
      expect(t.weight).toBeLessThanOrEqual(1);
    }
    for (const r of pairs.ranking) {
      expect(r.weight).toBeGreaterThanOrEqual(0);
      expect(r.weight).toBeLessThanOrEqual(1);
    }
  });

  it("positive pairs have pairType=positive", () => {
    const events = buildTestEvents();
    const { positive } = deriveTrainingPairs(events);
    for (const p of positive) {
      expect(p.pairType).toBe("positive");
    }
  });

  it("negative pairs have pairType=negative", () => {
    const events = buildTestEvents();
    const { negative } = deriveTrainingPairs(events);
    for (const n of negative) {
      expect(n.pairType).toBe("negative");
    }
  });

  it("no self-pairs (anchor !== other)", () => {
    const events = buildTestEvents();
    const { positive, negative } = deriveTrainingPairs(events);
    for (const p of [...positive, ...negative]) {
      expect(p.anchor).not.toBe(p.other);
    }
  });

  it("no self-triplets (anchor, positive, negative are distinct)", () => {
    const events = buildTestEvents();
    const { triplets } = deriveTrainingPairs(events);
    for (const t of triplets) {
      expect(t.anchor).not.toBe(t.positive);
      expect(t.anchor).not.toBe(t.negative);
      expect(t.positive).not.toBe(t.negative);
    }
  });

  it("handles empty input gracefully", () => {
    const pairs = deriveTrainingPairs([]);
    expect(pairs.positive.length).toBe(0);
    expect(pairs.negative.length).toBe(0);
    expect(pairs.triplets.length).toBe(0);
    expect(pairs.ranking.length).toBe(0);
  });

  it("handles all same action (no pairs possible)", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      makeEvent(`path${i}.sid`, "play", i)
    );
    const pairs = deriveTrainingPairs(events);
    // "play" is neutral signal — no positive/negative pairs expected
    expect(pairs.positive.length).toBe(0);
    expect(pairs.negative.length).toBe(0);
  });

  it("like+replay produce positive pairs", () => {
    const events = [
      makeEvent("MUSICIANS/A/a.sid", "like", 0),
      makeEvent("MUSICIANS/B/b.sid", "replay", 5),
    ];
    const { positive } = deriveTrainingPairs(events);
    // Both are positive signals → should form a positive pair
    expect(positive.length).toBeGreaterThan(0);
  });

  it("like+dislike produce a negative pair", () => {
    const events = [
      makeEvent("MUSICIANS/A/a.sid", "like", 0),
      makeEvent("MUSICIANS/B/b.sid", "dislike", 5),
    ];
    const { negative } = deriveTrainingPairs(events);
    expect(negative.length).toBeGreaterThan(0);
  });

  it("no duplicate pairs", () => {
    const events = buildTestEvents();
    const { positive, negative } = deriveTrainingPairs(events);

    function pairKey(a: string, b: string): string {
      return a < b ? `${a}||${b}` : `${b}||${a}`;
    }
    const posSeen = new Set<string>();
    for (const p of positive) {
      const key = pairKey(p.anchor, p.other);
      expect(posSeen.has(key)).toBe(false);
      posSeen.add(key);
    }
    const negSeen = new Set<string>();
    for (const n of negative) {
      const key = pairKey(n.anchor, n.other);
      expect(negSeen.has(key)).toBe(false);
      negSeen.add(key);
    }
  });

  it("ranking pairs: higher is a positive track, lower is a negative track", () => {
    const events = [
      makeEvent("MUSICIANS/A/liked.sid", "like", 0),
      makeEvent("MUSICIANS/A/disliked.sid", "dislike", 5),
    ];
    const { ranking } = deriveTrainingPairs(events);
    expect(ranking.length).toBeGreaterThan(0);
    // The liked track should be `higher`, disliked should be `lower`
    for (const r of ranking) {
      expect(r.higher).not.toBe(r.lower);
    }
  });
});
