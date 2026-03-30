import { describe, expect, test } from "bun:test";
import {
  scoreTrackForPersona,
  scoreAllPersonas,
  scoreWithFallback,
  applyRecencyPenalty,
  applyRecencyPenaltyWithTimestamp,
  type PersonaTrackContext,
} from "../src/persona-scorer.js";
import { PERSONA_IDS, type PersonaId, type PersonaMetrics } from "../src/persona.js";
import { createDefaultProfile, type PersonaProfile } from "../src/persona-profile.js";

function makeMetrics(overrides: Partial<PersonaMetrics> = {}): PersonaMetrics {
  return {
    melodicComplexity: 0.5,
    rhythmicDensity: 0.5,
    timbralRichness: 0.5,
    nostalgiaBias: 0.5,
    experimentalTolerance: 0.5,
    ...overrides,
  };
}

function makeContext(overrides: Partial<PersonaTrackContext> = {}): PersonaTrackContext {
  return {
    metrics: makeMetrics(),
    ratings: { e: 3, m: 3, c: 3 },
    ...overrides,
  };
}

describe("scoreTrackForPersona", () => {
  test("returns score between 0 and 1", () => {
    const ctx = makeContext();
    for (const id of PERSONA_IDS) {
      const { score } = scoreTrackForPersona(ctx, id);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  test("scoring is deterministic", () => {
    const ctx = makeContext({ metrics: makeMetrics({ rhythmicDensity: 0.9 }) });
    const score1 = scoreTrackForPersona(ctx, "fast_paced").score;
    const score2 = scoreTrackForPersona(ctx, "fast_paced").score;
    expect(score1).toBe(score2);
  });

  test("fast_paced prefers high rhythmic density", () => {
    const highRhythm = makeContext({ metrics: makeMetrics({ rhythmicDensity: 0.95 }) });
    const lowRhythm = makeContext({ metrics: makeMetrics({ rhythmicDensity: 0.05 }) });
    const highScore = scoreTrackForPersona(highRhythm, "fast_paced").score;
    const lowScore = scoreTrackForPersona(lowRhythm, "fast_paced").score;
    expect(highScore).toBeGreaterThan(lowScore);
  });

  test("slow_ambient prefers low rhythmic density", () => {
    const highRhythm = makeContext({ metrics: makeMetrics({ rhythmicDensity: 0.95 }) });
    const lowRhythm = makeContext({ metrics: makeMetrics({ rhythmicDensity: 0.05 }) });
    const highScore = scoreTrackForPersona(highRhythm, "slow_ambient").score;
    const lowScore = scoreTrackForPersona(lowRhythm, "slow_ambient").score;
    expect(lowScore).toBeGreaterThan(highScore);
  });

  test("melodic prefers high melodic complexity", () => {
    const highMelodic = makeContext({ metrics: makeMetrics({ melodicComplexity: 0.95 }) });
    const lowMelodic = makeContext({ metrics: makeMetrics({ melodicComplexity: 0.05 }) });
    const highScore = scoreTrackForPersona(highMelodic, "melodic").score;
    const lowScore = scoreTrackForPersona(lowMelodic, "melodic").score;
    expect(highScore).toBeGreaterThan(lowScore);
  });

  test("experimental prefers high experimental tolerance", () => {
    const highExp = makeContext({ metrics: makeMetrics({ experimentalTolerance: 0.95 }) });
    const lowExp = makeContext({ metrics: makeMetrics({ experimentalTolerance: 0.05 }) });
    const highScore = scoreTrackForPersona(highExp, "experimental").score;
    const lowScore = scoreTrackForPersona(lowExp, "experimental").score;
    expect(highScore).toBeGreaterThan(lowScore);
  });

  test("nostalgic prefers high nostalgia bias", () => {
    const highNost = makeContext({ metrics: makeMetrics({ nostalgiaBias: 0.95 }) });
    const lowNost = makeContext({ metrics: makeMetrics({ nostalgiaBias: 0.05 }) });
    const highScore = scoreTrackForPersona(highNost, "nostalgic").score;
    const lowScore = scoreTrackForPersona(lowNost, "nostalgic").score;
    expect(highScore).toBeGreaterThan(lowScore);
  });

  test("returns breakdown record", () => {
    const ctx = makeContext();
    const { breakdown } = scoreTrackForPersona(ctx, "melodic");
    expect(Object.keys(breakdown).length).toBeGreaterThan(0);
    expect(typeof breakdown.melodicComplexity).toBe("number");
  });

  test("hybrid personas respond to metadata", () => {
    const withMeta = makeContext({
      metadata: { titleThemeTags: ["love", "night", "dream"] },
    });
    const withoutMeta = makeContext();
    const withScore = scoreTrackForPersona(withMeta, "theme_hunter").score;
    const withoutScore = scoreTrackForPersona(withoutMeta, "theme_hunter").score;
    expect(withScore).toBeGreaterThan(withoutScore);
  });

  test("deep_discovery responds to rarity", () => {
    const rare = makeContext({ rarity: 0.9 });
    const common = makeContext({ rarity: 0.1 });
    const rareScore = scoreTrackForPersona(rare, "deep_discovery").score;
    const commonScore = scoreTrackForPersona(common, "deep_discovery").score;
    expect(rareScore).toBeGreaterThan(commonScore);
  });

  test("composer_focus responds to composer metadata", () => {
    const withComposer = makeContext({ metadata: { composer: "Martin Galway" } });
    const withoutComposer = makeContext();
    const withScore = scoreTrackForPersona(withComposer, "composer_focus").score;
    const withoutScore = scoreTrackForPersona(withoutComposer, "composer_focus").score;
    expect(withScore).toBeGreaterThan(withoutScore);
  });

  test("era_explorer responds to year metadata", () => {
    const withYear = makeContext({ metadata: { year: 1987 } });
    const withoutYear = makeContext();
    const withScore = scoreTrackForPersona(withYear, "era_explorer").score;
    const withoutScore = scoreTrackForPersona(withoutYear, "era_explorer").score;
    expect(withScore).toBeGreaterThan(withoutScore);
  });
});

describe("scoreAllPersonas", () => {
  test("returns scores for all 9 personas", () => {
    const ctx = makeContext();
    const scores = scoreAllPersonas(ctx);
    expect(Object.keys(scores)).toHaveLength(9);
    for (const id of PERSONA_IDS) {
      expect(typeof scores[id]).toBe("number");
      expect(scores[id]).toBeGreaterThanOrEqual(0);
      expect(scores[id]).toBeLessThanOrEqual(1);
    }
  });

  test("is deterministic", () => {
    const ctx = makeContext({ metrics: makeMetrics({ rhythmicDensity: 0.8 }) });
    const scores1 = scoreAllPersonas(ctx);
    const scores2 = scoreAllPersonas(ctx);
    for (const id of PERSONA_IDS) {
      expect(scores1[id]).toBe(scores2[id]);
    }
  });
});

describe("scoreWithFallback", () => {
  test("null profile returns base score", () => {
    const ctx = makeContext();
    const base = scoreTrackForPersona(ctx, "melodic").score;
    const fallback = scoreWithFallback(ctx, "melodic", null);
    expect(fallback).toBe(base);
  });

  test("default profile is close to base score", () => {
    const ctx = makeContext();
    const base = scoreTrackForPersona(ctx, "melodic").score;
    const profile = createDefaultProfile();
    const personalized = scoreWithFallback(ctx, "melodic", profile);
    // Should be very close since default profile has no centroid
    expect(Math.abs(personalized - base)).toBeLessThan(0.05);
  });

  test("profile with global centroid nudges scores", () => {
    const ctx = makeContext({ metrics: makeMetrics({ melodicComplexity: 0.8 }) });
    const profile: PersonaProfile = {
      ...createDefaultProfile(),
      globalTasteCentroid: makeMetrics({ melodicComplexity: 0.9 }),
    };
    const base = scoreTrackForPersona(ctx, "melodic").score;
    const personalized = scoreWithFallback(ctx, "melodic", profile);
    // The nudge should be small but present
    expect(personalized).not.toBe(base);
    // Audio-led ranking order should be preserved
    expect(personalized).toBeGreaterThan(0);
    expect(personalized).toBeLessThanOrEqual(1);
  });

  test("high skip rate penalizes score", () => {
    const ctx = makeContext();
    const profile: PersonaProfile = {
      ...createDefaultProfile(),
      perPersona: {
        ...createDefaultProfile().perPersona,
        melodic: { skipRate: 0.8, trackCount: 50, lastUsed: new Date().toISOString() },
      },
    };
    const base = scoreTrackForPersona(ctx, "melodic").score;
    const personalized = scoreWithFallback(ctx, "melodic", profile);
    expect(personalized).toBeLessThan(base);
  });
});

describe("applyRecencyPenalty", () => {
  test("no penalty for tracks not in history", () => {
    const score = applyRecencyPenalty(0.8, "track:1", []);
    expect(score).toBe(0.8);
  });

  test("40% penalty for tracks in session history", () => {
    const score = applyRecencyPenalty(1.0, "track:1", ["track:1"]);
    expect(score).toBe(0.6);
  });
});

describe("applyRecencyPenaltyWithTimestamp", () => {
  const now = Date.now();

  test("no penalty for unknown tracks", () => {
    const score = applyRecencyPenaltyWithTimestamp(0.8, "track:1", [], now);
    expect(score).toBe(0.8);
  });

  test("track played 0 minutes ago gets ~40% penalty", () => {
    const history = [{ trackId: "track:1", timestamp: now }];
    const score = applyRecencyPenaltyWithTimestamp(1.0, "track:1", history, now);
    expect(score).toBeCloseTo(0.6, 1);
  });

  test("track played 30 minutes ago gets ~20% penalty", () => {
    const history = [{ trackId: "track:1", timestamp: now - 30 * 60_000 }];
    const score = applyRecencyPenaltyWithTimestamp(1.0, "track:1", history, now);
    // At half-life, decay = 0.5, penalty = 0.4 * 0.5 = 0.2
    expect(score).toBeCloseTo(0.8, 1);
  });

  test("track played 2 hours ago gets < 3% penalty", () => {
    const history = [{ trackId: "track:1", timestamp: now - 120 * 60_000 }];
    const score = applyRecencyPenaltyWithTimestamp(1.0, "track:1", history, now);
    // After 120 min with 30 min half-life: decay = 0.5^4 = 0.0625, penalty = 0.025
    expect(score).toBeGreaterThan(0.97);
  });
});
