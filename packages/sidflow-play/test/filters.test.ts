/**
 * Tests for filter parsing.
 */

import { describe, expect, test } from "bun:test";
import { parseFilters, formatFilters } from "../src/filters.js";

describe("parseFilters", () => {
  test("parses empty string", () => {
    const filters = parseFilters("");
    expect(filters).toEqual({});
  });

  test("parses single >= expression", () => {
    const filters = parseFilters("e>=4");
    expect(filters.energyRange).toEqual([4, 999]);
  });

  test("parses single <= expression", () => {
    const filters = parseFilters("m<=2");
    expect(filters.moodRange).toEqual([0, 2]);
  });

  test("parses single = expression", () => {
    const filters = parseFilters("c=5");
    expect(filters.complexityRange).toEqual([5, 5]);
  });

  test("parses BPM range", () => {
    const filters = parseFilters("bpm=120-140");
    expect(filters.bpmRange).toEqual([120, 140]);
  });

  test("parses multiple filters", () => {
    const filters = parseFilters("e>=4,m>=3,c<=2");
    expect(filters.energyRange).toEqual([4, 999]);
    expect(filters.moodRange).toEqual([3, 999]);
    expect(filters.complexityRange).toEqual([0, 2]);
  });

  test("parses complex filter expression", () => {
    const filters = parseFilters("e=5,m=3-4,bpm=120-140");
    expect(filters.energyRange).toEqual([5, 5]);
    expect(filters.moodRange).toEqual([3, 4]);
    expect(filters.bpmRange).toEqual([120, 140]);
  });

  test("parses preference filter", () => {
    const filters = parseFilters("p>=4");
    expect(filters.preferenceRange).toEqual([4, 999]);
  });

  test("throws error for invalid expression", () => {
    expect(() => parseFilters("invalid")).toThrow("Invalid filter expression");
  });

  test("throws error for unknown dimension", () => {
    expect(() => parseFilters("x>=3")).toThrow("Invalid filter expression");
  });

  test("handles whitespace", () => {
    const filters = parseFilters(" e >= 4 , m <= 2 ");
    expect(filters.energyRange).toEqual([4, 999]);
    expect(filters.moodRange).toEqual([0, 2]);
  });
});

describe("formatFilters", () => {
  test("formats empty filters", () => {
    const expr = formatFilters({});
    expect(expr).toBe("");
  });

  test("formats single range", () => {
    const expr = formatFilters({ energyRange: [4, 999] });
    expect(expr).toBe("e>=4");
  });

  test("formats exact value", () => {
    const expr = formatFilters({ complexityRange: [5, 5] });
    expect(expr).toBe("c=5");
  });

  test("formats range expression", () => {
    const expr = formatFilters({ bpmRange: [120, 140] });
    expect(expr).toBe("bpm=120-140");
  });

  test("formats multiple filters", () => {
    const expr = formatFilters({
      energyRange: [4, 999],
      moodRange: [0, 2],
      complexityRange: [3, 4]
    });
    expect(expr).toContain("e>=4");
    expect(expr).toContain("m<=2");
    expect(expr).toContain("c=3-4");
  });

  test("round-trip formatting", () => {
    const original = "e>=4,m<=2,bpm=120-140";
    const parsed = parseFilters(original);
    const formatted = formatFilters(parsed);
    const reparsed = parseFilters(formatted);
    
    expect(reparsed).toEqual(parsed);
  });
});
