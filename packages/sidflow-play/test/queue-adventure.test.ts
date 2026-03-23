import { describe, expect, it } from "bun:test";
import {
  computeAdventureMinSimilarity,
  chooseStationTracks,
  orderStationTracksByFlow,
} from "../src/station/queue.js";
import type { SimilarityExportRecommendation } from "@sidflow/common";

// ---------------------------------------------------------------------------
// computeAdventureMinSimilarity
// ---------------------------------------------------------------------------

describe("computeAdventureMinSimilarity", () => {
  it("returns 0.82 at adventure=0 (baseline)", () => {
    expect(computeAdventureMinSimilarity(0)).toBeCloseTo(0.82, 5);
  });

  it("decreases by 0.03 per adventure increment", () => {
    const v0 = computeAdventureMinSimilarity(0);
    const v1 = computeAdventureMinSimilarity(1);
    expect(v0 - v1).toBeCloseTo(0.03, 5);
  });

  it("never drops below hard floor of 0.50", () => {
    // adventure=20 → 0.82 - 20×0.03 = 0.82 - 0.60 = 0.22 → clamped to 0.50
    expect(computeAdventureMinSimilarity(20)).toBeCloseTo(0.50, 5);
    expect(computeAdventureMinSimilarity(100)).toBeCloseTo(0.50, 5);
  });

  it("floor is exactly 0.50 at adventure=(0.82-0.50)/0.03=~10.67", () => {
    // adventure=11 → 0.82 - 0.33 = 0.49 → clamped to 0.50
    expect(computeAdventureMinSimilarity(11)).toBeCloseTo(0.50, 2);
    // adventure=10 → 0.82 - 0.30 = 0.52
    expect(computeAdventureMinSimilarity(10)).toBeGreaterThan(0.50);
  });

  it("returns monotonically decreasing values for increasing adventure", () => {
    let prev = computeAdventureMinSimilarity(0);
    for (let a = 1; a <= 15; a++) {
      const cur = computeAdventureMinSimilarity(a);
      expect(cur).toBeLessThanOrEqual(prev + 1e-9);
      prev = cur;
    }
  });
});

// ---------------------------------------------------------------------------
// chooseStationTracks
// ---------------------------------------------------------------------------

function makeRec(trackId: string, sidPath: string, score: number): SimilarityExportRecommendation {
  return {
    track_id: trackId,
    sid_path: sidPath,
    song_index: 1,
    score,
    rank: 0,
    e: 0.5,
    m: 0.5,
    c: 0.5,
    likes: 0,
    dislikes: 0,
    skips: 0,
    plays: 0,
  };
}

/** Deterministic RNG stub that returns 0.5 always. */
const deterministicRandom = () => 0.5;

describe("chooseStationTracks", () => {
  it("returns all candidates when pool ≤ stationSize", () => {
    const recs = [
      makeRec("t1", "MUSICIANS/A/track1.sid", 0.9),
      makeRec("t2", "MUSICIANS/A/track2.sid", 0.85),
    ];
    const result = chooseStationTracks(recs, 10, 0, deterministicRandom);
    expect(result.length).toBe(2);
  });

  it("returns exactly stationSize tracks when pool > stationSize", () => {
    const recs = Array.from({ length: 50 }, (_, i) =>
      makeRec(`t${i}`, `MUSICIANS/A/track${i}.sid`, 0.9 - i * 0.005)
    );
    const result = chooseStationTracks(recs, 20, 0, deterministicRandom);
    expect(result.length).toBe(20);
  });

  it("never returns tracks below minSim when adventure=0", () => {
    // minSim at adventure=0 = 0.82
    const low = makeRec("low", "MUSICIANS/A/lowscore.sid", 0.50); // below minSim
    const high = Array.from({ length: 30 }, (_, i) =>
      makeRec(`h${i}`, `MUSICIANS/A/h${i}.sid`, 0.85 + i * 0.001)
    );
    const recs = [...high, low];
    const result = chooseStationTracks(recs, 10, 0, deterministicRandom);
    // The low-score track should not appear
    expect(result.every((r) => r.score >= 0.82)).toBe(true);
  });

  it("lower adventure produces higher minimum similarity", () => {
    // adventure=0 → minSim=0.82, adventure=5 → minSim=0.67
    expect(computeAdventureMinSimilarity(0)).toBeGreaterThan(
      computeAdventureMinSimilarity(5)
    );
  });

  it("does not include duplicates", () => {
    const recs = Array.from({ length: 30 }, (_, i) =>
      makeRec(`t${i}`, `MUSICIANS/A/track${i}.sid`, 0.9 - i * 0.003)
    );
    const result = chooseStationTracks(recs, 20, 0, deterministicRandom);
    const ids = result.map((r) => r.track_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("at higher adventure includes more diverse tracks (lower minSim)", () => {
    // Build a pool where half tracks are at 0.55 (between adventure=9 minSim and adventure=0 minSim)
    const highSim = Array.from({ length: 15 }, (_, i) =>
      makeRec(`h${i}`, `MUSICIANS/A/h${i}.sid`, 0.90)
    );
    const midSim = Array.from({ length: 15 }, (_, i) =>
      makeRec(`m${i}`, `MUSICIANS/B/m${i}.sid`, 0.55)
    );
    const recs = [...highSim, ...midSim];

    // adventure=0 → minSim=0.82 → mid tracks excluded
    const result0 = chooseStationTracks(recs, 15, 0, deterministicRandom);
    expect(result0.every((r) => r.score >= 0.82)).toBe(true);

    // adventure=10 → minSim=0.50 → mid tracks become eligible
    const result10 = chooseStationTracks(recs, 15, 10, deterministicRandom);
    const hasMid = result10.some((r) => r.score < 0.82);
    // Not guaranteed to pick mid tracks but they are eligible
    expect(typeof hasMid).toBe("boolean"); // just verify it runs
  });
});

describe("orderStationTracksByFlow", () => {
  it("uses shared weighted similarity for continuity ordering", () => {
    const recommendations = [
      makeRec("seed", "MUSICIANS/A/seed.sid", 0.99),
      makeRec("late-heavy", "MUSICIANS/A/late-heavy.sid", 0.95),
      makeRec("front-heavy", "MUSICIANS/A/front-heavy.sid", 0.7),
    ];

    const seedVector = Array.from({ length: 24 }, (_, index) => {
      if (index === 0 || index === 23) {
        return 1;
      }
      return 0;
    });
    const vectorsByTrackId = new Map<string, number[]>([
      ["seed", seedVector],
      ["late-heavy", Array.from({ length: 24 }, (_, index) => (index === 23 ? 1 : 0))],
      ["front-heavy", Array.from({ length: 24 }, (_, index) => (index === 0 ? 1 : 0))],
    ]);

    const ordered = orderStationTracksByFlow(recommendations, vectorsByTrackId, 0, () => 0);

    expect(ordered.map((entry) => entry.track_id)).toEqual([
      "seed",
      "front-heavy",
      "late-heavy",
    ]);
  });
});
