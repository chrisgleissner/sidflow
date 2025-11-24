import { describe, expect, test } from "bun:test";
import { clampRating, RATING_MIN, RATING_MAX, DEFAULT_RATING } from "../src/ratings.js";

describe("ratings", () => {
  test("clampRating returns value within range", () => {
    expect(clampRating(3)).toBe(3);
    expect(clampRating(1)).toBe(RATING_MIN);
    expect(clampRating(5)).toBe(RATING_MAX);
  });

  test("clampRating clamps values below minimum", () => {
    expect(clampRating(0)).toBe(RATING_MIN);
    expect(clampRating(-5)).toBe(RATING_MIN);
  });

  test("clampRating clamps values above maximum", () => {
    expect(clampRating(6)).toBe(RATING_MAX);
    expect(clampRating(100)).toBe(RATING_MAX);
  });

  test("clampRating returns default for NaN", () => {
    expect(clampRating(NaN)).toBe(DEFAULT_RATING);
  });

  test("clampRating handles decimal values", () => {
    expect(clampRating(2.5)).toBe(2.5);
    expect(clampRating(4.7)).toBe(4.7);
  });

  test("clampRating handles boundary values exactly", () => {
    expect(clampRating(RATING_MIN)).toBe(RATING_MIN);
    expect(clampRating(RATING_MAX)).toBe(RATING_MAX);
  });

  test("clampRating handles infinity", () => {
    expect(clampRating(Infinity)).toBe(RATING_MAX);
    expect(clampRating(-Infinity)).toBe(RATING_MIN);
  });

  test("clampRating handles zero", () => {
    expect(clampRating(0)).toBe(RATING_MIN);
  });

  test("clampRating handles negative decimals", () => {
    expect(clampRating(-0.5)).toBe(RATING_MIN);
  });

  test("clampRating handles large positive decimals", () => {
    expect(clampRating(5.9)).toBe(RATING_MAX);
    expect(clampRating(10.5)).toBe(RATING_MAX);
  });
});
