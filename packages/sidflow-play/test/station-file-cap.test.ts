/**
 * Tests for the per-file cap on station candidates.
 *
 * Subsongs of one SID file are near-identical by every similarity measure, so an
 * unconstrained neighbour list stacks them. Measured on held-out data, 59.4% of
 * 20-track stations contained a repeated file and the worst case put 14 of 20 slots
 * on a single tune. The retrieval metric cannot see this — it already excludes
 * same-file siblings of the seed, so it never counts duplicates among neighbours —
 * which is exactly why it needs its own test.
 */

import { describe, expect, test } from "bun:test";

import { limitCandidatesPerFile } from "../src/station/queue.js";

const track = (sidPath: string, songIndex: number) => ({ sid_path: sidPath, song_index: songIndex });

describe("limitCandidatesPerFile", () => {
  test("keeps one subsong per file when there is enough material", () => {
    const candidates = [
      track("A.sid", 1),
      track("A.sid", 2),
      track("A.sid", 3),
      track("B.sid", 1),
      track("C.sid", 1),
      track("C.sid", 2),
      track("D.sid", 1),
    ];
    const kept = limitCandidatesPerFile(candidates, 4);
    expect(kept.map((c) => c.sid_path)).toEqual(["A.sid", "B.sid", "C.sid", "D.sid"]);
  });

  test("keeps the highest-ranked subsong of each file", () => {
    // Candidates arrive in descending score order, so the first occurrence is the
    // best-matching subsong of that tune.
    const kept = limitCandidatesPerFile(
      [track("A.sid", 7), track("A.sid", 1), track("B.sid", 4), track("B.sid", 2)],
      2,
    );
    expect(kept).toEqual([track("A.sid", 7), track("B.sid", 4)]);
  });

  test("relaxes the cap rather than starving a station", () => {
    // Only two files available but eight slots wanted: a hard cap of one would
    // return two tracks and the station would refuse to build. Better to serve a
    // second subsong than an error.
    const candidates = [
      track("A.sid", 1),
      track("A.sid", 2),
      track("A.sid", 3),
      track("A.sid", 4),
      track("B.sid", 1),
      track("B.sid", 2),
      track("B.sid", 3),
      track("B.sid", 4),
    ];
    const kept = limitCandidatesPerFile(candidates, 4);
    expect(kept.length).toBeGreaterThanOrEqual(4);
    // Relaxed to 2 per file, which is the least relaxation that reaches the target.
    const perFile = new Map<string, number>();
    for (const c of kept) perFile.set(c.sid_path, (perFile.get(c.sid_path) ?? 0) + 1);
    expect(Math.max(...perFile.values())).toBe(2);
  });

  test("returns everything when even the loosest cap cannot reach the target", () => {
    const candidates = [track("A.sid", 1), track("A.sid", 2), track("A.sid", 3), track("A.sid", 4)];
    expect(limitCandidatesPerFile(candidates, 20)).toEqual(candidates);
  });

  test("preserves order and never invents or drops a track it kept", () => {
    const candidates = Array.from({ length: 40 }, (_, i) => track(`F${i % 9}.sid`, Math.floor(i / 9) + 1));
    const kept = limitCandidatesPerFile(candidates, 9);
    const positions = kept.map((c) => candidates.indexOf(c));
    for (let i = 1; i < positions.length; i++) expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    for (const c of kept) expect(candidates).toContain(c);
  });

  test("is a no-op when every candidate is already a distinct file", () => {
    const candidates = Array.from({ length: 12 }, (_, i) => track(`U${i}.sid`, 1));
    expect(limitCandidatesPerFile(candidates, 12)).toEqual(candidates);
  });

  test("handles an empty candidate list", () => {
    expect(limitCandidatesPerFile([], 10)).toEqual([]);
  });
});
