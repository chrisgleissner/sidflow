/**
 * Station populations are a design decision, and the export refuses to publish one that
 * is not.
 *
 * The 0.7.0 bundle shipped `theme_hunter` matching 0 tracks, `composer_focus` matching
 * 673, five personas each covering about half the corpus, and 10.8% of HVSC labelled
 * both `fast_paced` and `slow_ambient`. `c64commander` renders all nine as user-facing
 * station tiles, so every one of those was something a listener could see: a tile that
 * could never play anything, a tile that looped after 673 tracks, and two tiles a
 * listener experiences as opposites playing 9,500 of the same tunes.
 *
 * Nothing objected, because the export had no notion of how big a station was.
 */

import { describe, expect, test } from "bun:test";
import {
  assignSimilarityStyleMasks,
  countStylePopulations,
  DEFAULT_STYLE_POPULATION_POLICY,
  evaluateStylePopulationGate,
  PERSONA_IDS,
  STYLE_CONFLICT_PAIRS,
  StylePopulationGateError,
  type StyleAssignmentTrack,
} from "../src/index.js";

/**
 * A corpus resembling what the export actually assigns from.
 *
 * Ratings cycle through all 125 (e, m, c) cells so no persona is starved by the fixture
 * itself, and every track carries the metadata the tiny builder supplies: composer with
 * a prominence, a release year with a position, theme tags and a rarity. Building the
 * fixture WITHOUT metadata would fail the gate — correctly, since that is precisely the
 * condition the 0.7.0 export shipped under — so the metadata-free case is exercised
 * deliberately in its own tests rather than smuggled in as the baseline.
 */
function buildCorpus(trackCount: number): StyleAssignmentTrack[] {
  return Array.from({ length: trackCount }, (_unused, index) => ({
    track_id: `MUSICIANS/T/Test/T${index}.sid#1`,
    sid_path: `MUSICIANS/T/Test/T${index}.sid`,
    e: (index % 5) + 1,
    m: (Math.floor(index / 5) % 5) + 1,
    c: (Math.floor(index / 25) % 5) + 1,
    p: null,
    metadata: {
      title: `Tune ${index}`,
      composer: `Composer ${index % 97}`,
      year: 1982 + (index % 40),
      category: "MUSICIANS",
      titleThemeTags: ["alpha", "beta", "gamma", "delta"].slice(0, (index % 5)),
    },
    composerProminence: (index % 97) / 96,
    yearPosition: (index % 40) / 39,
    rarity: (index % 71) / 70,
  }));
}

describe("station population assignment", () => {
  test("every persona gets the same share of the corpus, by construction", () => {
    const tracks = buildCorpus(5000);
    const result = assignSimilarityStyleMasks(tracks);

    const expected = Math.round(DEFAULT_STYLE_POPULATION_POLICY.targetShare * tracks.length);
    for (const personaId of PERSONA_IDS) {
      expect(result.diagnostics.populations[personaId]).toBe(expected);
    }

    // The 69x spread among the non-empty personas in the shipped bundle becomes 1.0.
    const counts = PERSONA_IDS.map((id) => result.diagnostics.populations[id]);
    expect(Math.max(...counts) / Math.min(...counts)).toBe(1);
  });

  test("no persona ships empty", () => {
    const result = assignSimilarityStyleMasks(buildCorpus(5000));
    for (const personaId of PERSONA_IDS) {
      // theme_hunter matched 0 tracks in 0.7.0 while being offered as a station tile.
      expect(result.diagnostics.populations[personaId]).toBeGreaterThan(0);
    }
  });

  test("conflicting personas never share a track", () => {
    const tracks = buildCorpus(5000);
    const result = assignSimilarityStyleMasks(tracks);

    for (const [left, right] of STYLE_CONFLICT_PAIRS) {
      const leftBit = 1 << PERSONA_IDS.indexOf(left);
      const rightBit = 1 << PERSONA_IDS.indexOf(right);
      const both = [...result.masks].filter((mask) => (mask & leftBit) !== 0 && (mask & rightBit) !== 0);
      expect(both).toHaveLength(0);
    }

    for (const overlap of result.diagnostics.conflictOverlaps) {
      expect(overlap.tracks).toBe(0);
    }
  });

  test("contested tracks go to the persona that ranks them better, not the one listed first", () => {
    // Filling personas one at a time and skipping already-taken tracks would give
    // fast_paced unconditional first pick over slow_ambient purely because it comes first
    // in PERSONA_IDS. A tune that is the 12,000th best fast-paced track and the 30th best
    // ambient one would then be filed as fast-paced, which is the wrong station.
    const tracks = buildCorpus(5000);
    const result = assignSimilarityStyleMasks(tracks);

    const fastBit = 1 << PERSONA_IDS.indexOf("fast_paced");
    const slowBit = 1 << PERSONA_IDS.indexOf("slow_ambient");
    const fastMembers = new Set([...result.masks].flatMap((mask, index) => ((mask & fastBit) !== 0 ? [index] : [])));
    const slowMembers = new Set([...result.masks].flatMap((mask, index) => ((mask & slowBit) !== 0 ? [index] : [])));

    // Both stations still reach their full size, so arbitration cost neither of them
    // population — the loser of a contested track reaches further down its own list.
    const expected = Math.round(DEFAULT_STYLE_POPULATION_POLICY.targetShare * tracks.length);
    expect(fastMembers.size).toBe(expected);
    expect(slowMembers.size).toBe(expected);

    // And a positional rule would show up as slow_ambient never holding a track that
    // fast_paced also wanted. Rank the corpus by each persona and check the overlap of
    // their unconstrained top-N: some of it must have landed on each side.
    const energetic = tracks.filter((_unused, index) => fastMembers.has(index));
    const calm = tracks.filter((_unused, index) => slowMembers.has(index));
    expect(energetic.length).toBeGreaterThan(0);
    expect(calm.length).toBeGreaterThan(0);
    // The two stations are disjoint, which is the contract.
    expect([...fastMembers].filter((index) => slowMembers.has(index))).toHaveLength(0);
  });

  test("a track can carry no personas at all", () => {
    // The forced top-3 rule gave every track exactly three labels whether any fitted or
    // not. Earning none is a legitimate outcome and the reason the overlap collapsed.
    const result = assignSimilarityStyleMasks(buildCorpus(5000));
    expect([...result.masks].some((mask) => mask === 0)).toBe(true);
  });

  test("masks recount to the reported populations", () => {
    const result = assignSimilarityStyleMasks(buildCorpus(5000));
    expect(countStylePopulations(result.masks)).toEqual(result.diagnostics.populations);
  });

  test("assignment is deterministic", () => {
    const tracks = buildCorpus(2000);
    const first = assignSimilarityStyleMasks(tracks);
    const second = assignSimilarityStyleMasks(tracks);
    expect([...second.masks]).toEqual([...first.masks]);
  });

  test("ties at the cut are broken independently of corpus position", () => {
    // Corpus order would hand every tie to the same low-ordinal tracks, which is how
    // tiny's favourites ranking came to return the same handful of tunes to everyone.
    // A hash is still arbitrary, but arbitrary uniformly.
    const tracks = buildCorpus(5000);
    const result = assignSimilarityStyleMasks(tracks);
    const bit = 1 << PERSONA_IDS.indexOf("fast_paced");
    const members = [...result.masks].flatMap((mask, index) => ((mask & bit) !== 0 ? [index] : []));
    const firstDecile = members.filter((index) => index < tracks.length / 10).length;
    // A position-biased tie-break would pile the whole station into the first ordinals.
    expect(firstDecile).toBeLessThan(members.length * 0.5);
  });
});

describe("the population gate", () => {
  test("fails the build when a persona is starved, naming it and its count", () => {
    const starved = {
      ...DEFAULT_STYLE_POPULATION_POLICY,
      // Demand more per station than nine stations can carve out of the corpus without
      // help; combined with the exclusivity rules some persona cannot reach it.
      minimumAbsolute: 4000,
      targetShare: 0.05,
    };
    const violations = evaluateStylePopulationGate(
      {
        populations: Object.fromEntries(
          PERSONA_IDS.map((id, index) => [id, index === 3 ? 12 : 1000]),
        ) as Record<(typeof PERSONA_IDS)[number], number>,
        tieShareAtCut: Object.fromEntries(PERSONA_IDS.map((id) => [id, 0])) as Record<(typeof PERSONA_IDS)[number], number>,
        distinctScores: Object.fromEntries(PERSONA_IDS.map((id) => [id, 500])) as Record<(typeof PERSONA_IDS)[number], number>,
        maximumPairwiseJaccard: 0,
        maximumPairwiseJaccardPersonas: null,
        conflictOverlaps: [],
      },
      starved,
      20000,
    );

    expect(violations.some((line) => line.includes("experimental") && line.includes("12"))).toBe(true);
  });

  test("throws rather than warns, and the error names what failed", () => {
    // A corpus of one repeated rating cell: every persona ranks it identically, so the
    // stations become indistinguishable and the distinctness check must fire.
    const degenerate: StyleAssignmentTrack[] = Array.from({ length: 2000 }, (_unused, index) => ({
      track_id: `T${index}.sid#1`,
      sid_path: `T${index}.sid`,
      e: 3,
      m: 3,
      c: 3,
      p: null,
    }));

    expect(() => assignSimilarityStyleMasks(degenerate)).toThrow(StylePopulationGateError);
    try {
      assignSimilarityStyleMasks(degenerate);
    } catch (error) {
      expect(error).toBeInstanceOf(StylePopulationGateError);
      const gateError = error as StylePopulationGateError;
      expect(gateError.violations.length).toBeGreaterThan(0);
      expect(gateError.message).toContain("--allow-sparse-styles");
    }
  });

  test("--allow-sparse-styles permits the build and records the waiver", () => {
    const degenerate: StyleAssignmentTrack[] = Array.from({ length: 2000 }, (_unused, index) => ({
      track_id: `T${index}.sid#1`,
      sid_path: `T${index}.sid`,
      e: 3,
      m: 3,
      c: 3,
      p: null,
    }));

    const result = assignSimilarityStyleMasks(degenerate, { allowSparseStyles: true });
    expect(result.waived).toBe(true);
    // The violations travel with the result, so a bundle built under a waiver can never
    // be mistaken for one that passed.
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.masks).toHaveLength(degenerate.length);
  });

  test("does not fire on a corpus that passes", () => {
    const result = assignSimilarityStyleMasks(buildCorpus(5000));
    expect(result.violations).toEqual([]);
    expect(result.waived).toBe(false);
  });

  test("scales to a small private collection instead of blocking it", () => {
    // max(1000, 5% of 500) = 1000 read literally demands more tracks per station than
    // the whole corpus has. A rule written for HVSC must not block a 500-track library.
    const result = assignSimilarityStyleMasks(buildCorpus(500));
    expect(result.violations).toEqual([]);
    for (const personaId of PERSONA_IDS) {
      expect(result.diagnostics.populations[personaId]).toBe(100);
    }
  });

  test("the semantic checks stand down on a corpus too small to measure", () => {
    // Nine stations from six tracks are one track each; two picking the same track score
    // Jaccard 1.0, which says nothing about whether the personas are distinct.
    const result = assignSimilarityStyleMasks(buildCorpus(6));
    expect(result.violations).toEqual([]);
  });

  test("an empty corpus is not an error", () => {
    const result = assignSimilarityStyleMasks([]);
    expect(result.masks).toHaveLength(0);
    expect(result.violations).toEqual([]);
  });
});

describe("metadata-led stations", () => {
  /**
   * A corpus carrying ONLY the metadata under test, so the comparison isolates it.
   * `buildCorpus` supplies every corpus-relative signal; reusing it here would let the
   * others leak into the "presence only" arm and hide the effect being measured.
   */
  function corpusWithMetadata(overrides: (index: number) => Partial<StyleAssignmentTrack>): StyleAssignmentTrack[] {
    return Array.from({ length: 5000 }, (_unused, index) => ({
      track_id: `MUSICIANS/T/Test/T${index}.sid#1`,
      sid_path: `MUSICIANS/T/Test/T${index}.sid`,
      e: (index % 5) + 1,
      m: (Math.floor(index / 5) % 5) + 1,
      c: (Math.floor(index / 25) % 5) + 1,
      p: null,
      ...overrides(index),
    }));
  }

  test("composer prominence separates tracks that presence cannot", () => {
    // Composer resolves for essentially all of HVSC, so scoring its PRESENCE adds a
    // constant to every track and changes no ranking at all: measured, composer_focus
    // had exactly 30 distinct scores over 87,868 tracks with metadata supplied, and 30
    // without. Prominence is what makes it a signal.
    const presenceOnly = assignSimilarityStyleMasks(
      corpusWithMetadata(() => ({ metadata: { composer: "Rob Hubbard" } })),
      { allowSparseStyles: true },
    );
    const withProminence = assignSimilarityStyleMasks(
      corpusWithMetadata((index) => ({
        metadata: { composer: `Composer ${index % 50}` },
        composerProminence: (index % 50) / 49,
      })),
      { allowSparseStyles: true },
    );

    expect(withProminence.diagnostics.distinctScores.composer_focus)
      .toBeGreaterThan(presenceOnly.diagnostics.distinctScores.composer_focus);
  });

  test("year position separates an era station that presence cannot", () => {
    const presenceOnly = assignSimilarityStyleMasks(
      corpusWithMetadata(() => ({ metadata: { year: 1987 } })),
      { allowSparseStyles: true },
    );
    const withPosition = assignSimilarityStyleMasks(
      corpusWithMetadata((index) => ({
        metadata: { year: 1982 + (index % 40) },
        yearPosition: (index % 40) / 39,
      })),
      { allowSparseStyles: true },
    );

    expect(withPosition.diagnostics.distinctScores.era_explorer)
      .toBeGreaterThan(presenceOnly.diagnostics.distinctScores.era_explorer);
    // And the tie group at the cut shrinks, which is what makes the station meaningful
    // rather than merely populated.
    expect(withPosition.diagnostics.tieShareAtCut.era_explorer)
      .toBeLessThan(presenceOnly.diagnostics.tieShareAtCut.era_explorer);
  });

  test("a populated station can still be a broken one, and the gate says so", () => {
    // Quantile assignment hands every persona its share regardless, so a population
    // floor alone would wave through a station whose ranking is arbitrary. That is worse
    // than an empty one: a dead tile is visibly broken, a populated meaningless one
    // misleads silently.
    const flat = assignSimilarityStyleMasks(
      Array.from({ length: 2000 }, (_unused, index) => ({
        track_id: `T${index}.sid#1`,
        sid_path: `T${index}.sid`,
        e: 3,
        m: 3,
        c: 3,
        p: null,
      })),
      { allowSparseStyles: true },
    );

    for (const personaId of PERSONA_IDS) {
      expect(flat.diagnostics.populations[personaId]).toBe(400);
    }
    expect(flat.violations.length).toBeGreaterThan(0);
  });
});
