/**
 * Tests for station/screen.ts pure utility functions
 */
import { describe, expect, it } from "bun:test";
import {
  moveSelectionInMatches,
  moveCurrentInMatches,
  resolvePlaylistWindowStart,
  resolvePlaylistWindowRows,
} from "../src/station/screen.js";

describe("moveSelectionInMatches", () => {
  it("returns null for empty matches array", () => {
    expect(moveSelectionInMatches([], 0, 1)).toBeNull();
  });

  it("moves forward by delta", () => {
    expect(moveSelectionInMatches([0, 2, 5], 0, 1)).toBe(2);
    expect(moveSelectionInMatches([0, 2, 5], 0, 2)).toBe(5);
  });

  it("moves backward by delta", () => {
    expect(moveSelectionInMatches([0, 2, 5], 5, -1)).toBe(2);
    expect(moveSelectionInMatches([0, 2, 5], 2, -1)).toBe(0);
  });

  it("clamps at end of matches list", () => {
    expect(moveSelectionInMatches([0, 2, 5], 5, 10)).toBe(5);
  });

  it("clamps at start of matches list", () => {
    expect(moveSelectionInMatches([0, 2, 5], 0, -10)).toBe(0);
  });

  it("starts from position 0 when selectedIndex is not in matches", () => {
    // currentPosition = -1, so startPosition = 0, delta = 1 → position 1 = matches[1] = 2
    expect(moveSelectionInMatches([0, 2, 5], 99, 1)).toBe(2);
  });

  it("returns first element when selectedIndex not in matches and delta 0", () => {
    expect(moveSelectionInMatches([3, 7, 12], 99, 0)).toBe(3);
  });
});

describe("moveCurrentInMatches", () => {
  it("returns null for empty matches array", () => {
    expect(moveCurrentInMatches([], 0, 1)).toBeNull();
  });

  it("moves forward to next index greater than current", () => {
    expect(moveCurrentInMatches([0, 2, 5], 0, 1)).toBe(2);
    expect(moveCurrentInMatches([0, 2, 5], 2, 1)).toBe(5);
  });

  it("returns last element when moving forward past end", () => {
    expect(moveCurrentInMatches([0, 2, 5], 5, 1)).toBe(5);
    expect(moveCurrentInMatches([0, 2, 5], 100, 1)).toBe(5);
  });

  it("moves backward to previous index less than current", () => {
    expect(moveCurrentInMatches([0, 2, 5], 5, -1)).toBe(2);
    expect(moveCurrentInMatches([0, 2, 5], 2, -1)).toBe(0);
  });

  it("returns first element when moving backward past start", () => {
    expect(moveCurrentInMatches([0, 2, 5], 0, -1)).toBe(0);
    expect(moveCurrentInMatches([2, 5, 9], -10, -1)).toBe(2);
  });
});

describe("resolvePlaylistWindowStart", () => {
  it("returns 0 for empty filteredIndices", () => {
    expect(resolvePlaylistWindowStart([], 0, 5, 0)).toBe(0);
  });

  it("keeps windowStart at 0 when content fits in view", () => {
    expect(resolvePlaylistWindowStart([0, 1, 2], 1, 5, 0)).toBe(0);
  });

  it("keeps viewport stable while playing row stays above the bottom buffer threshold", () => {
    const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const result = resolvePlaylistWindowStart(indices, 4, 10, 0);
    expect(result).toBe(0);
  });

  it("scrolls when the playing row crosses the bottom buffer threshold", () => {
    const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const result = resolvePlaylistWindowStart(indices, 7, 10, 0);
    expect(result).toBe(2);
  });

  it("scrolls up when the playing row moves above the viewport top", () => {
    const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const result = resolvePlaylistWindowStart(indices, 2, 5, 7);
    expect(result).toBe(2);
  });

  it("clamps windowStart to maxWindowStart", () => {
    const indices = [0, 1, 2, 3, 4];
    const result = resolvePlaylistWindowStart(indices, 4, 5, 100);
    // maxWindowStart = max(0, 5-5) = 0
    expect(result).toBe(0);
  });

  it("keeps the existing window when the playing row is not in the filtered set", () => {
    const indices = [0, 1, 2, 3, 4];
    const result = resolvePlaylistWindowStart(indices, 99, 5, 3);
    expect(result).toBe(0);
  });
});

describe("resolvePlaylistWindowRows", () => {
  // MINIMUM_PLAYLIST_WINDOW_ROWS = 7, STATION_SCREEN_RESERVED_ROWS = 22
  it("returns MINIMUM_PLAYLIST_WINDOW_ROWS when terminal is very small", () => {
    // visibleRows = max(7, 5-22) = 7 (very small terminal)
    expect(resolvePlaylistWindowRows(100, 5)).toBe(7);
  });

  it("returns queue length when queue fits in visible rows", () => {
    // visibleRows = max(7, 30-22) = max(7, 8) = 8, min(5, 8) = 5, max(7, 5) = 7
    expect(resolvePlaylistWindowRows(5, 30)).toBe(7);
  });

  it("returns visible rows when queue is larger than terminal allows", () => {
    // visibleRows = max(7, 50-22) = 28, min(100, 28) = 28, max(7, 28) = 28
    expect(resolvePlaylistWindowRows(100, 50)).toBe(28);
  });

  it("returns MINIMUM_PLAYLIST_WINDOW_ROWS as minimum", () => {
    expect(resolvePlaylistWindowRows(0, 100)).toBe(7);
  });
});
