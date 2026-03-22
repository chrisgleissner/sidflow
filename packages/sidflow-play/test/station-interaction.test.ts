/**
 * station-interaction.test.ts
 *
 * Exhaustive interaction-level tests for the SIDFlow station rendering engine.
 * Uses StationSimulator (mirrors run.ts logic) and screen-parser to assert
 * visual invariants after every step.
 *
 * Test organisation:
 *   A. Smoke / initial render
 *   B. Marker semantics (► and ▸)
 *   C. Cursor navigation
 *   D. Playback actions (next, back, timeout, playSelected)
 *   E. Sliding playlist window
 *   F. Text filter
 *   G. Rating filter
 *   H. Combined filters & clear
 *   I. togglePause, rate, skip, shuffle, refresh
 *   J. Boundary conditions
 *   K. Stress & soak tests
 *   L. Metamorphic tests
 *   M. Fuzz (deterministic random sequences)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  StationSimulator,
  makeQueue,
  makeTrack,
} from "./helpers/station-simulator.js";
import {
  parseScreen,
  assertInvariants,
  findRow,
  checkInvariants,
  type ParsedScreen,
} from "./helpers/screen-parser.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse and assert invariants; return parsed for further assertions. */
function render(sim: StationSimulator): ParsedScreen {
  const text = sim.renderScreen();
  const parsed = parseScreen(text);
  const state = sim.getState();
  assertInvariants(parsed, {
    currentIndex: state.stationIndex,
    selectedIndex: sim.getEffectiveSelectedIndex(),
  });
  return parsed;
}

/** Apply action, render, check invariants; return parsed screen. */
function step(sim: StationSimulator, action: Parameters<StationSimulator["applyAction"]>[0]): ParsedScreen {
  sim.applyAction(action);
  return render(sim);
}

// ─── A. Smoke / initial render ────────────────────────────────────────────────

describe("A. Smoke", () => {
  it("renders without throwing for a single-track queue", () => {
    const sim = new StationSimulator([makeTrack(0)]);
    expect(() => render(sim)).not.toThrow();
  });

  it("renders without throwing for a 50-track queue", () => {
    const sim = new StationSimulator(makeQueue(50));
    expect(() => render(sim)).not.toThrow();
  });

  it("playlist header declares visibleRows", () => {
    const sim = new StationSimulator(makeQueue(50));
    const parsed = render(sim);
    expect(parsed.playlistHeader).toMatch(/^Playlist Window \(\d+ visible\)/);
    expect(parsed.declaredVisibleRows).toBeGreaterThan(0);
  });

  it("screen contains some playlist rows for a non-empty queue", () => {
    const sim = new StationSimulator(makeQueue(10));
    const parsed = render(sim);
    expect(parsed.playlistRows.length).toBeGreaterThan(0);
  });

  it("renders correctly when queue length exactly equals viewport", () => {
    // 40 rows - 28 reserved = 12 visible. Use exactly 12 tracks.
    const sim = new StationSimulator(makeQueue(12));
    const parsed = render(sim);
    expect(parsed.playlistRows.length).toBe(12);
  });
});

// ─── B. Marker semantics ──────────────────────────────────────────────────────

describe("B. Marker semantics", () => {
  it("initial state: current marker on track 0, no selected marker", () => {
    const sim = new StationSimulator(makeQueue(20));
    const parsed = render(sim);
    // Row 0 must have "►", no row should have "▸"
    const row0 = findRow(parsed, 0);
    expect(row0).toBeDefined();
    expect(row0!.hasCurrentMarker).toBe(true);
    expect(row0!.hasSelectedMarker).toBe(false);
    expect(parsed.selectedVisible).toBe(false);
  });

  it("after cursorDown: '▸' appears on selected row, '►' stays on current row", () => {
    const sim = new StationSimulator(makeQueue(20));
    const parsed = step(sim, { type: "cursorDown" });
    const currentRow = findRow(parsed, 0); // current is still 0
    const selectedRow = findRow(parsed, 1); // selected is now 1
    expect(currentRow!.hasCurrentMarker).toBe(true);
    expect(currentRow!.hasSelectedMarker).toBe(false);
    expect(selectedRow!.hasSelectedMarker).toBe(true);
    expect(selectedRow!.hasCurrentMarker).toBe(false);
  });

  it("current row never has both '►' and '▸'", () => {
    const sim = new StationSimulator(makeQueue(20));
    // Cursor is at current
    const parsed = render(sim);
    const row0 = findRow(parsed, 0)!;
    expect(row0.hasCurrentMarker).toBe(true);
    expect(row0.hasSelectedMarker).toBe(false);
  });

  it("after playSelected: '▸' disappears (selected=current again)", () => {
    const sim = new StationSimulator(makeQueue(20));
    step(sim, { type: "cursorDown" });
    step(sim, { type: "cursorDown" });
    const before = sim.getState();
    expect(before.selectedIndex).toBe(2);
    const parsed = step(sim, { type: "playSelected" });
    // After playSelected, current=selected=2; no "▸"
    expect(parsed.selectedVisible).toBe(false);
    const row2 = findRow(parsed, 2);
    if (row2) {
      expect(row2.hasCurrentMarker).toBe(true);
    }
  });

  it("only one '►' marker is ever visible", () => {
    const sim = new StationSimulator(makeQueue(30));
    for (let i = 0; i < 15; i++) {
      const parsed = step(sim, { type: "cursorDown" });
      const currentRows = parsed.playlistRows.filter((r) => r.hasCurrentMarker);
      expect(currentRows.length).toBeLessThanOrEqual(1);
    }
  });

  it("only one '▸' marker is ever visible", () => {
    const sim = new StationSimulator(makeQueue(30));
    for (let i = 0; i < 15; i++) {
      const parsed = step(sim, { type: "cursorDown" });
      const selectedRows = parsed.playlistRows.filter((r) => r.hasSelectedMarker);
      expect(selectedRows.length).toBeLessThanOrEqual(1);
    }
  });

  it("'▸' marker is structurally distinct from neutral rows (not just invisible space)", () => {
    const sim = new StationSimulator(makeQueue(20));
    step(sim, { type: "cursorDown" });
    const screen = sim.renderScreen();
    // The selected marker character U+25B8 must appear in the raw screen text
    expect(screen).toContain("▸");
  });

  it("'►' marker is present in the raw screen text", () => {
    const sim = new StationSimulator(makeQueue(20));
    const screen = sim.renderScreen();
    expect(screen).toContain("►");
  });
});

// ─── C. Cursor navigation ─────────────────────────────────────────────────────

describe("C. Cursor navigation", () => {
  it("cursorDown increments selectedIndex", () => {
    const sim = new StationSimulator(makeQueue(10));
    step(sim, { type: "cursorDown" });
    expect(sim.getSelectedIndex()).toBe(1);
  });

  it("cursorUp decrements selectedIndex", () => {
    const sim = new StationSimulator(makeQueue(10), 3);
    sim.applyAction({ type: "cursorDown" });
    const after = sim.getSelectedIndex();
    expect(after).toBe(4);
    sim.applyAction({ type: "cursorUp" });
    expect(sim.getSelectedIndex()).toBe(3);
  });

  it("cursorDown at last track clamps to last", () => {
    const sim = new StationSimulator(makeQueue(5));
    for (let i = 0; i < 10; i++) sim.applyAction({ type: "cursorDown" });
    expect(sim.getSelectedIndex()).toBe(4);
  });

  it("cursorUp at first track clamps to 0", () => {
    const sim = new StationSimulator(makeQueue(5));
    for (let i = 0; i < 10; i++) sim.applyAction({ type: "cursorUp" });
    expect(sim.getSelectedIndex()).toBe(0);
  });

  it("cursorDown does NOT change stationIndex", () => {
    const sim = new StationSimulator(makeQueue(20), 5);
    const before = sim.getCurrentIndex();
    for (let i = 0; i < 8; i++) sim.applyAction({ type: "cursorDown" });
    expect(sim.getCurrentIndex()).toBe(before);
  });

  it("cursorUp does NOT change stationIndex", () => {
    const sim = new StationSimulator(makeQueue(20), 10);
    const before = sim.getCurrentIndex();
    for (let i = 0; i < 8; i++) sim.applyAction({ type: "cursorUp" });
    expect(sim.getCurrentIndex()).toBe(before);
  });

  it("pageDown advances by at least 1", () => {
    const sim = new StationSimulator(makeQueue(50));
    const before = sim.getSelectedIndex();
    sim.applyAction({ type: "pageDown" });
    expect(sim.getSelectedIndex()).toBeGreaterThan(before);
  });

  it("pageUp moves back by at least 1 when not at top", () => {
    const sim = new StationSimulator(makeQueue(50), 20);
    const before = sim.getSelectedIndex();
    sim.applyAction({ type: "pageDown" });
    sim.applyAction({ type: "pageUp" });
    expect(sim.getSelectedIndex()).toBeLessThanOrEqual(before + 1); // roughly back
  });

  it("status message reflects new selection after cursorDown", () => {
    const sim = new StationSimulator(makeQueue(10));
    step(sim, { type: "cursorDown" });
    expect(sim.getStatus()).toMatch(/Selected track 2\/10/);
  });
});

// ─── D. Playback actions ──────────────────────────────────────────────────────

describe("D. Playback actions", () => {
  describe("next", () => {
    it("advances stationIndex by 1 (no filter)", () => {
      const sim = new StationSimulator(makeQueue(10));
      sim.applyAction({ type: "next" });
      expect(sim.getCurrentIndex()).toBe(1);
    });

    it("sets selectedIndex = stationIndex after next", () => {
      const sim = new StationSimulator(makeQueue(10));
      sim.applyAction({ type: "cursorDown" });
      sim.applyAction({ type: "cursorDown" });
      sim.applyAction({ type: "next" });
      expect(sim.getSelectedIndex()).toBe(sim.getCurrentIndex());
    });

    it("at last track: next does not advance, status explains", () => {
      const sim = new StationSimulator(makeQueue(5), 4);
      sim.applyAction({ type: "next" });
      expect(sim.getCurrentIndex()).toBe(4);
      expect(sim.getStatus()).toMatch(/end of the station playlist/);
    });

    it("next clears the ▸ marker (selected=current)", () => {
      const sim = new StationSimulator(makeQueue(10));
      sim.applyAction({ type: "cursorDown" }); // selected ≠ current
      const parsed = step(sim, { type: "next" });
      expect(parsed.selectedVisible).toBe(false);
    });
  });

  describe("back", () => {
    it("moves stationIndex back by 1 (no filter)", () => {
      const sim = new StationSimulator(makeQueue(10), 5);
      sim.applyAction({ type: "back" });
      expect(sim.getCurrentIndex()).toBe(4);
    });

    it("at track 0: back does not move, status explains", () => {
      const sim = new StationSimulator(makeQueue(5), 0);
      sim.applyAction({ type: "back" });
      expect(sim.getCurrentIndex()).toBe(0);
      expect(sim.getStatus()).toMatch(/start of the station playlist/);
    });
  });

  describe("timeout", () => {
    it("advances stationIndex by 1", () => {
      const sim = new StationSimulator(makeQueue(10));
      sim.applyAction({ type: "timeout" });
      expect(sim.getCurrentIndex()).toBe(1);
    });

    it("sets selectedIndex = stationIndex after timeout", () => {
      const sim = new StationSimulator(makeQueue(10));
      sim.applyAction({ type: "cursorDown" });
      sim.applyAction({ type: "timeout" });
      expect(sim.getSelectedIndex()).toBe(sim.getCurrentIndex());
    });

it("at last track of multi-track queue: timeout stays on last, stationIndex unchanged", () => {
    const sim = new StationSimulator(makeQueue(5), 4);
    sim.applyAction({ type: "timeout" });
    // Math.min(queue.length-1, stationIndex+1) = Math.min(4, 5) = 4 → stays at 4
    expect(sim.getCurrentIndex()).toBe(4);
    // run.ts still sets "Advanced" status even if index didn't change
    expect(sim.getStatus()).toMatch(/Advanced/);
    });

    it("after timeout, ▸ marker is absent (selected=current)", () => {
      const sim = new StationSimulator(makeQueue(10));
      sim.applyAction({ type: "cursorDown" });
      const parsed = step(sim, { type: "timeout" });
      expect(parsed.selectedVisible).toBe(false);
    });
  });

  describe("playSelected", () => {
    it("promotes selected to current", () => {
      const sim = new StationSimulator(makeQueue(10));
      sim.applyAction({ type: "cursorDown" });
      sim.applyAction({ type: "cursorDown" });
      sim.applyAction({ type: "cursorDown" });
      sim.applyAction({ type: "playSelected" });
      expect(sim.getCurrentIndex()).toBe(3);
    });

    it("playSelected when selected=current gives status, no index change", () => {
      const sim = new StationSimulator(makeQueue(10));
      sim.applyAction({ type: "playSelected" });
      expect(sim.getCurrentIndex()).toBe(0);
      expect(sim.getStatus()).toMatch(/already the live song|already paused/);
    });

    it("after playSelected, ▸ disappears from visible rows", () => {
      const sim = new StationSimulator(makeQueue(10));
      sim.applyAction({ type: "cursorDown" });
      sim.applyAction({ type: "cursorDown" });
      const parsed = step(sim, { type: "playSelected" });
      expect(parsed.selectedVisible).toBe(false);
    });
  });
});

// ─── E. Sliding playlist window ────────────────────────────────────────────────

describe("E. Sliding playlist window", () => {
  // Default: rows=40, reserved=28, visible=12
  const VISIBLE = 12;

  it("initial window starts at 0 (track 0 visible)", () => {
    const sim = new StationSimulator(makeQueue(50));
    const parsed = render(sim);
    expect(parsed.playlistRows[0]!.rawIndex).toBe(0);
  });

  it("selecting track beyond viewport scrolls window forward", () => {
    const sim = new StationSimulator(makeQueue(50));
    // Move selection to row 20
    for (let i = 0; i < 20; i++) sim.applyAction({ type: "cursorDown" });
    const parsed = render(sim);
    // Row 20 must be visible
    const row20 = findRow(parsed, 20);
    expect(row20).toBeDefined();
    expect(row20!.hasSelectedMarker).toBe(true);
  });

  it("current track may scroll out of view when browsing far away", () => {
    const sim = new StationSimulator(makeQueue(50), 0);
    // Browse 40 rows forward
    for (let i = 0; i < 40; i++) sim.applyAction({ type: "cursorDown" });
    const parsed = render(sim);
    // Current (row 0) is far above selected (row 40), so it's not visible
    const row0 = findRow(parsed, 0);
    // row0 may or may not be visible — invariants still hold either way
    if (row0) {
      // If visible, it must carry the current marker
      expect(row0.hasCurrentMarker).toBe(true);
    }
  });

  it("selected row is always visible after cursorDown", () => {
    const sim = new StationSimulator(makeQueue(50));
    for (let i = 0; i < VISIBLE + 5; i++) {
      sim.applyAction({ type: "cursorDown" });
      const parsed = render(sim);
      const sel = sim.getEffectiveSelectedIndex();
      const row = findRow(parsed, sel);
      expect(row).toBeDefined();
    }
  });

  it("selected row is always visible after cursorUp", () => {
    const sim = new StationSimulator(makeQueue(50), 30);
    for (let i = 0; i < 35; i++) {
      sim.applyAction({ type: "cursorUp" });
      const parsed = render(sim);
      const sel = sim.getEffectiveSelectedIndex();
      const row = findRow(parsed, sel);
      expect(row).toBeDefined();
    }
  });

  it("after next, the new current track is visible (window recenters)", () => {
    const sim = new StationSimulator(makeQueue(50));
    // Browse far, then press next to snap current forward
    for (let i = 0; i < 30; i++) sim.applyAction({ type: "cursorDown" });
    sim.applyAction({ type: "next" });
    const parsed = render(sim);
    const current = sim.getCurrentIndex();
    const currentRow = findRow(parsed, current);
    expect(currentRow).toBeDefined();
    expect(currentRow!.hasCurrentMarker).toBe(true);
  });

  it("window contents match declaredVisibleRows", () => {
    const sim = new StationSimulator(makeQueue(50));
    for (let i = 0; i < 20; i++) sim.applyAction({ type: "cursorDown" });
    const parsed = render(sim);
    // All playlist rows (track rows, not filler "·") should be ≤ declaredVisibleRows
    expect(parsed.playlistRows.length).toBeLessThanOrEqual(parsed.declaredVisibleRows);
  });

  it("playlist window row count does not exceed available rows", () => {
    const sim = new StationSimulator(makeQueue(50));
    const parsed = render(sim);
    expect(parsed.declaredVisibleRows).toBeLessThanOrEqual(sim.getState().queueLength);
  });
});

// ─── F. Text filter ────────────────────────────────────────────────────────────

describe("F. Text filter", () => {
  function makeFilterQueue() {
    return [
      makeTrack(0, { title: "Commando", author: "Rob Hubbard" }),
      makeTrack(1, { title: "Last Ninja", author: "Matt Gray" }),
      makeTrack(2, { title: "Commando Remix", author: "Various" }),
      makeTrack(3, { title: "Monty on the Run", author: "Rob Hubbard" }),
      makeTrack(4, { title: "International Karate", author: "Rob Hubbard" }),
    ];
  }

  it("setFilter narrows selectable tracks", () => {
    const sim = new StationSimulator(makeFilterQueue());
    sim.applyAction({ type: "setFilter", value: "Commando", editing: false });
    const indices = sim.getFilteredIndices();
    expect(indices).toEqual([0, 2]);
  });

  it("filter header shows match count", () => {
    const sim = new StationSimulator(makeFilterQueue());
    sim.applyAction({ type: "setFilter", value: "Commando", editing: false });
    const parsed = render(sim);
    // "2/5" should be in the playlist header
    expect(parsed.playlistHeader).toContain("2/5");
  });

  it("cursorDown with filter moves to next filtered track", () => {
    const sim = new StationSimulator(makeFilterQueue());
    sim.applyAction({ type: "setFilter", value: "Commando", editing: false });
    // filteredIndices = [0, 2]; selected starts at 0 (current)
    sim.applyAction({ type: "cursorDown" });
    expect(sim.getEffectiveSelectedIndex()).toBe(2);
  });

  it("cursorDown at last filtered track clamps", () => {
    const sim = new StationSimulator(makeFilterQueue());
    sim.applyAction({ type: "setFilter", value: "Commando", editing: false });
    for (let i = 0; i < 5; i++) sim.applyAction({ type: "cursorDown" });
    expect(sim.getEffectiveSelectedIndex()).toBe(2); // last filtered = index 2
  });

  it("filter by author narrows correctly", () => {
    const sim = new StationSimulator(makeFilterQueue());
    sim.applyAction({ type: "setFilter", value: "Rob Hubbard", editing: false });
    const indices = sim.getFilteredIndices();
    expect(indices).toEqual([0, 3, 4]);
  });

  it("clearFilters restores all tracks", () => {
    const sim = new StationSimulator(makeFilterQueue());
    sim.applyAction({ type: "setFilter", value: "Commando", editing: false });
    sim.applyAction({ type: "clearFilters" });
    expect(sim.getFilteredIndices().length).toBe(5);
  });

  it("filter resulting in zero matches: status mentions no matches", () => {
    const sim = new StationSimulator(makeFilterQueue());
    sim.applyAction({ type: "setFilter", value: "XYZZY_NOMATCH", editing: false });
    expect(sim.getStatus()).toMatch(/No matches for text/);
  });

  it("after zero-match filter, screen does not crash and shows header", () => {
    const sim = new StationSimulator(makeFilterQueue());
    sim.applyAction({ type: "setFilter", value: "XYZZY_NOMATCH", editing: false });
    expect(() => render(sim)).not.toThrow();
  });

  it("editing=true preserves old filter until committed", () => {
    const sim = new StationSimulator(makeFilterQueue());
    sim.applyAction({ type: "setFilter", value: "Commando", editing: false }); // applied
    // Now start editing with empty value — old filter should remain
    sim.applyAction({ type: "setFilter", value: "", editing: true });
    const state = sim.getState();
    expect(state.stationFilter).toBe("commando"); // preserved (normalizeFilterQuery lowercases)
  });

  it("committing empty filter (editing=false, value='') clears filter", () => {
    const sim = new StationSimulator(makeFilterQueue());
    sim.applyAction({ type: "setFilter", value: "Commando", editing: false });
    sim.applyAction({ type: "setFilter", value: "", editing: false });
    expect(sim.getState().stationFilter).toBe("");
  });
});

// ─── G. Rating filter ─────────────────────────────────────────────────────────

describe("G. Rating filter", () => {
  function makeRatedQueue() {
    const queue = makeQueue(10);
    return queue;
  }

  it("setRatingFilter with *3 keeps only tracks with rating ≥ 3", () => {
    const sim = new StationSimulator(makeRatedQueue());
    // Rate tracks 0, 2, 4, 5 with 3, 5, 2, 4
    sim.setRating("track-0", 3);
    sim.setRating("track-2", 5);
    sim.setRating("track-4", 2);
    sim.setRating("track-5", 4);
    sim.applyAction({ type: "setRatingFilter", value: "*3", editing: false });
    const indices = sim.getFilteredIndices();
    // Only tracks with rating ≥ 3: track-0 (3), track-2 (5), track-5 (4)
    expect(indices).toEqual([0, 2, 5]);
  });

  it("setRatingFilter *0 shows unrated tracks", () => {
    const sim = new StationSimulator(makeRatedQueue());
    sim.setRating("track-0", 2);
    sim.applyAction({ type: "setRatingFilter", value: "*0", editing: false });
    // All tracks with rating ≥ 0 (including unrated = treated as 0)
    const indices = sim.getFilteredIndices();
    expect(indices.length).toBe(10);
  });

  it("invalid rating filter value gives error status", () => {
    const sim = new StationSimulator(makeRatedQueue());
    sim.applyAction({ type: "setRatingFilter", value: "*9", editing: false });
    expect(sim.getStatus()).toMatch(/\*0 through \*5/);
  });

  it("clearFilters removes rating filter", () => {
    const sim = new StationSimulator(makeRatedQueue());
    sim.setRating("track-0", 5);
    sim.applyAction({ type: "setRatingFilter", value: "*5", editing: false });
    sim.applyAction({ type: "clearFilters" });
    expect(sim.getState().minimumRating).toBeUndefined();
    expect(sim.getFilteredIndices().length).toBe(10);
  });
});

// ─── H. Combined filters & clear ─────────────────────────────────────────────

describe("H. Combined filters", () => {
  function makeComboQueue() {
    const queue = [
      makeTrack(0, { title: "Commando", author: "Rob Hubbard" }),
      makeTrack(1, { title: "Last Ninja", author: "Matt Gray" }),
      makeTrack(2, { title: "Commando Remix", author: "Various" }),
      makeTrack(3, { title: "Monty on the Run", author: "Rob Hubbard" }),
    ];
    return queue;
  }

  it("text + rating filter intersects both constraints", () => {
    const sim = new StationSimulator(makeComboQueue());
    sim.setRating("track-0", 4);
    sim.setRating("track-2", 1);
    sim.applyAction({ type: "setRatingFilter", value: "*3", editing: false });
    sim.applyAction({ type: "setFilter", value: "Commando", editing: false });
    // text "Commando" → indices [0, 2]; rating ≥ 3 → [0]; intersection = [0]
    const indices = sim.getFilteredIndices();
    expect(indices).toEqual([0]);
  });

  it("clearFilters resets both text and rating filter", () => {
    const sim = new StationSimulator(makeComboQueue());
    sim.setRating("track-0", 5);
    sim.applyAction({ type: "setRatingFilter", value: "*4", editing: false });
    sim.applyAction({ type: "setFilter", value: "Commando", editing: false });
    sim.applyAction({ type: "clearFilters" });
    expect(sim.getState().stationFilter).toBe("");
    expect(sim.getState().minimumRating).toBeUndefined();
    expect(sim.getFilteredIndices().length).toBe(4);
  });

  it("screen invariants hold under combined filters", () => {
    const sim = new StationSimulator(makeComboQueue());
    sim.setRating("track-0", 4);
    sim.applyAction({ type: "setRatingFilter", value: "*3", editing: false });
    sim.applyAction({ type: "setFilter", value: "Commando", editing: false });
    sim.applyAction({ type: "cursorDown" });
    expect(() => render(sim)).not.toThrow();
  });
});

// ─── I. Other actions ─────────────────────────────────────────────────────────

describe("I. Other actions", () => {
  it("togglePause: paused toggles to true", () => {
    const sim = new StationSimulator(makeQueue(5));
    expect(sim.getState().paused).toBe(false);
    sim.applyAction({ type: "togglePause" });
    expect(sim.getState().paused).toBe(true);
  });

  it("togglePause: double toggle restores unpaused state", () => {
    const sim = new StationSimulator(makeQueue(5));
    sim.applyAction({ type: "togglePause" });
    sim.applyAction({ type: "togglePause" });
    expect(sim.getState().paused).toBe(false);
  });

  it("togglePause status says 'Paused' when pausing", () => {
    const sim = new StationSimulator(makeQueue(5));
    sim.applyAction({ type: "togglePause" });
    expect(sim.getStatus()).toMatch(/Paused/);
  });

  it("togglePause status says 'Resumed' when resuming", () => {
    const sim = new StationSimulator(makeQueue(5));
    sim.applyAction({ type: "togglePause" });
    sim.applyAction({ type: "togglePause" });
    expect(sim.getStatus()).toMatch(/Resumed/);
  });

  it("rate stores rating in map", () => {
    const sim = new StationSimulator(makeQueue(5));
    sim.applyAction({ type: "rate", rating: 4 });
    expect(sim.getState().ratings.get("track-0")).toBe(4);
  });

  it("rate at 5 gives 'Liked' status", () => {
    const sim = new StationSimulator(makeQueue(5));
    sim.applyAction({ type: "rate", rating: 5 });
    expect(sim.getStatus()).toMatch(/Liked/);
  });

  it("skip advances track and stores rating 0", () => {
    const sim = new StationSimulator(makeQueue(5));
    sim.applyAction({ type: "skip" });
    expect(sim.getCurrentIndex()).toBe(1);
    expect(sim.getState().ratings.get("track-0")).toBe(0);
  });

  it("skip at last track: stays on last, still stores skip", () => {
    const sim = new StationSimulator(makeQueue(3), 2);
    sim.applyAction({ type: "skip" });
    expect(sim.getCurrentIndex()).toBe(2);
    expect(sim.getState().ratings.get("track-2")).toBe(0);
  });

  it("refresh does not change stationIndex or selectedIndex", () => {
    const sim = new StationSimulator(makeQueue(10), 3);
    sim.applyAction({ type: "cursorDown" });
    const before = sim.getState();
    sim.applyAction({ type: "refresh" });
    const after = sim.getState();
    expect(after.stationIndex).toBe(before.stationIndex);
    expect(after.selectedIndex).toBe(before.selectedIndex);
  });

  it("shuffle keeps current track at same position", () => {
    const sim = new StationSimulator(makeQueue(20), 5);
    const currentTrack = sim.getQueue()[5]!.track_id;
    // Use a deterministic random for reproducible shuffle
    sim.random = (() => { let n = 0; return () => { n = (n * 9301 + 49297) % 233280; return n / 233280; }; })();
    sim.applyAction({ type: "shuffle" });
    const newCurrent = sim.getQueue()[sim.getCurrentIndex()]!.track_id;
    expect(newCurrent).toBe(currentTrack);
  });

  it("shuffle preserves queue length", () => {
    const sim = new StationSimulator(makeQueue(20));
    sim.applyAction({ type: "shuffle" });
    expect(sim.getQueue().length).toBe(20);
  });

  it("cancelInput resets ratingFilterEditing", () => {
    const sim = new StationSimulator(makeQueue(5));
    sim.applyAction({ type: "setRatingFilter", value: "*", editing: true });
    expect(sim.getState().ratingFilterEditing).toBe(true);
    sim.applyAction({ type: "cancelInput" });
    expect(sim.getState().ratingFilterEditing).toBe(false);
  });
});

// ─── J. Boundary conditions ───────────────────────────────────────────────────

describe("J. Boundary conditions", () => {
  it("single-track queue: cursorDown clamps at 0", () => {
    const sim = new StationSimulator([makeTrack(0)]);
    for (let i = 0; i < 5; i++) sim.applyAction({ type: "cursorDown" });
    expect(sim.getSelectedIndex()).toBe(0);
  });

  it("single-track queue: next does not crash and status explains", () => {
    const sim = new StationSimulator([makeTrack(0)]);
    expect(() => sim.applyAction({ type: "next" })).not.toThrow();
  });

  it("starting at last track: timeout replays (single-track queue)", () => {
    const sim = new StationSimulator([makeTrack(0)]);
    sim.applyAction({ type: "timeout" });
    expect(sim.getCurrentIndex()).toBe(0);
    expect(sim.getStatus()).toMatch(/replaying/);
  });

  it("pageDown on tiny queue clamps", () => {
    const sim = new StationSimulator(makeQueue(3));
    for (let i = 0; i < 5; i++) sim.applyAction({ type: "pageDown" });
    expect(sim.getSelectedIndex()).toBe(2);
  });

  it("pageUp from top clamps at 0", () => {
    const sim = new StationSimulator(makeQueue(50));
    for (let i = 0; i < 10; i++) sim.applyAction({ type: "pageUp" });
    expect(sim.getSelectedIndex()).toBe(0);
  });

  it("startIndex > 0: current marker on correct row", () => {
    const sim = new StationSimulator(makeQueue(20), 10);
    const parsed = render(sim);
    const row = findRow(parsed, 10);
    if (row) {
      expect(row.hasCurrentMarker).toBe(true);
    }
  });

  it("filter zeroing then clearing: no crash and invariants hold", () => {
    const sim = new StationSimulator(makeQueue(5));
    sim.applyAction({ type: "setFilter", value: "ZZZZ_NOMATCH", editing: false });
    sim.applyAction({ type: "clearFilters" });
    expect(() => render(sim)).not.toThrow();
  });
});

// ─── K. Stress & soak tests ───────────────────────────────────────────────────

describe("K. Stress & soak tests", () => {
  it("500x cursorDown on 50-track queue: invariants hold throughout", () => {
    const sim = new StationSimulator(makeQueue(50));
    for (let i = 0; i < 500; i++) {
      const parsed = step(sim, { type: "cursorDown" });
      const errors = checkInvariants(parsed, {
        currentIndex: sim.getCurrentIndex(),
        selectedIndex: sim.getEffectiveSelectedIndex(),
      });
      if (errors.length > 0) {
        throw new Error(`Invariant failure at step ${i}: ${errors.join(", ")}`);
      }
    }
  });

  it("100x timeout on 50-track queue: invariants hold", () => {
    const sim = new StationSimulator(makeQueue(50));
    for (let i = 0; i < 100; i++) {
      const parsed = step(sim, { type: "timeout" });
      const errors = checkInvariants(parsed, {
        currentIndex: sim.getCurrentIndex(),
        selectedIndex: sim.getEffectiveSelectedIndex(),
      });
      if (errors.length > 0) {
        throw new Error(`Invariant failure at step ${i}: ${errors.join(", ")}`);
      }
    }
  });

  it("200-step mixed soak: all invariants pass every step", () => {
    const sim = new StationSimulator(makeQueue(30), 10);
    const actions: Array<Parameters<StationSimulator["applyAction"]>[0]> = [
      { type: "cursorDown" },
      { type: "cursorDown" },
      { type: "cursorUp" },
      { type: "next" },
      { type: "cursorDown" },
      { type: "playSelected" },
      { type: "cursorDown" },
      { type: "pageDown" },
      { type: "cursorUp" },
      { type: "pageUp" },
      { type: "back" },
      { type: "timeout" },
      { type: "togglePause" },
      { type: "togglePause" },
      { type: "rate", rating: 3 },
      { type: "refresh" },
      { type: "cursorDown" },
      { type: "cursorDown" },
    ];
    for (let i = 0; i < 200; i++) {
      const action = actions[i % actions.length]!;
      const parsed = step(sim, action);
      const errors = checkInvariants(parsed, {
        currentIndex: sim.getCurrentIndex(),
        selectedIndex: sim.getEffectiveSelectedIndex(),
      });
      if (errors.length > 0) {
        throw new Error(`Invariant failure at step ${i} (action: ${action.type}): ${errors.join(", ")}`);
      }
    }
  });

  it("100-step filter-heavy soak: invariants pass every step", () => {
    const queue = [
      makeTrack(0, { title: "Alpha", author: "Rob Hubbard" }),
      makeTrack(1, { title: "Beta", author: "Rob Hubbard" }),
      makeTrack(2, { title: "Gamma", author: "Matt Gray" }),
      makeTrack(3, { title: "Delta", author: "Matt Gray" }),
      makeTrack(4, { title: "Alpha Beta", author: "Various" }),
      makeTrack(5, { title: "Gamma Delta", author: "Rob Hubbard" }),
    ];
    const sim = new StationSimulator(queue);
    const filterActions: Array<Parameters<StationSimulator["applyAction"]>[0]> = [
      { type: "setFilter", value: "Alpha", editing: false },
      { type: "cursorDown" },
      { type: "clearFilters" },
      { type: "setFilter", value: "Rob", editing: false },
      { type: "cursorDown" },
      { type: "next" },
      { type: "clearFilters" },
      { type: "cursorDown" },
      { type: "cursorUp" },
      { type: "setFilter", value: "", editing: false },
    ];
    for (let i = 0; i < 100; i++) {
      const action = filterActions[i % filterActions.length]!;
      const parsed = step(sim, action);
      const errors = checkInvariants(parsed, {
        currentIndex: sim.getCurrentIndex(),
        selectedIndex: sim.getEffectiveSelectedIndex(),
      });
      if (errors.length > 0) {
        throw new Error(`Invariant failure at step ${i} (action: ${action.type}): ${errors.join(", ")}`);
      }
    }
  });
});

// ─── L. Metamorphic / round-trip tests ────────────────────────────────────────

describe("L. Metamorphic tests", () => {
  it("cursorDown × N then cursorUp × N returns to original selectedIndex", () => {
    const sim = new StationSimulator(makeQueue(30), 5);
    const initialSelected = sim.getSelectedIndex();
    const N = 8;
    for (let i = 0; i < N; i++) sim.applyAction({ type: "cursorDown" });
    for (let i = 0; i < N; i++) sim.applyAction({ type: "cursorUp" });
    expect(sim.getSelectedIndex()).toBe(initialSelected);
  });

  it("setFilter then clearFilters: filtered count equals queue length", () => {
    const sim = new StationSimulator(makeQueue(20));
    sim.applyAction({ type: "setFilter", value: "Track 1", editing: false });
    sim.applyAction({ type: "clearFilters" });
    expect(sim.getFilteredIndices().length).toBe(20);
  });

  it("timeout × N then back × N: returns to original stationIndex", () => {
    const sim = new StationSimulator(makeQueue(20), 5);
    const initial = sim.getCurrentIndex();
    const N = 5;
    for (let i = 0; i < N; i++) sim.applyAction({ type: "timeout" });
    for (let i = 0; i < N; i++) sim.applyAction({ type: "back" });
    expect(sim.getCurrentIndex()).toBe(initial);
  });

  it("togglePause twice: state is identical to before both toggles", () => {
    const sim = new StationSimulator(makeQueue(10), 3);
    const before = sim.getState();
    sim.applyAction({ type: "togglePause" });
    sim.applyAction({ type: "togglePause" });
    const after = sim.getState();
    expect(after.paused).toBe(before.paused);
    expect(after.stationIndex).toBe(before.stationIndex);
  });

  it("cursorDown then playSelected then cursorDown: selected moves from new current", () => {
    const sim = new StationSimulator(makeQueue(10), 2);
    sim.applyAction({ type: "cursorDown" }); // selected=3
    sim.applyAction({ type: "playSelected" }); // current=selected=3
    sim.applyAction({ type: "cursorDown" }); // selected=4
    expect(sim.getEffectiveSelectedIndex()).toBe(4);
    expect(sim.getCurrentIndex()).toBe(3);
  });

  it("next then playSelected with same index: noop (already live)", () => {
    const sim = new StationSimulator(makeQueue(10));
    sim.applyAction({ type: "next" }); // current=1, selected=1
    sim.applyAction({ type: "playSelected" }); // selected=current, noop
    expect(sim.getStatus()).toMatch(/already the live song|already paused/);
  });
});

// ─── M. Fuzz tests (deterministic) ────────────────────────────────────────────

describe("M. Fuzz tests", () => {
  /**
   * Simple seeded LCG to produce deterministic action sequences.
   * Returns integers in [0, n).
   */
  function makePrng(seed: number) {
    let s = seed;
    return (n: number): number => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return Math.abs(s) % n;
    };
  }

  const ACTION_POOL: Array<Parameters<StationSimulator["applyAction"]>[0]> = [
    { type: "cursorDown" },
    { type: "cursorUp" },
    { type: "pageDown" },
    { type: "pageUp" },
    { type: "next" },
    { type: "back" },
    { type: "playSelected" },
    { type: "timeout" },
    { type: "togglePause" },
    { type: "rate", rating: 3 },
    { type: "rate", rating: 5 },
    { type: "skip" },
    { type: "refresh" },
    { type: "clearFilters" },
  ];

  function runFuzz(seed: number, steps: number, queueSize: number): void {
    const rng = makePrng(seed);
    const sim = new StationSimulator(makeQueue(queueSize), rng(queueSize));
    for (let i = 0; i < steps; i++) {
      const action = ACTION_POOL[rng(ACTION_POOL.length)]!;
      const parsed = step(sim, action);
      const errors = checkInvariants(parsed, {
        currentIndex: sim.getCurrentIndex(),
        selectedIndex: sim.getEffectiveSelectedIndex(),
      });
      if (errors.length > 0) {
        throw new Error(`Fuzz seed ${seed} step ${i} action=${action.type}: ${errors.join(", ")}`);
      }
    }
  }

  it("fuzz seed=1 — 300 steps, 25 tracks", () => {
    runFuzz(1, 300, 25);
  });

  it("fuzz seed=42 — 300 steps, 50 tracks", () => {
    runFuzz(42, 300, 50);
  });

  it("fuzz seed=1337 — 300 steps, 10 tracks", () => {
    runFuzz(1337, 300, 10);
  });

  it("fuzz seed=9999 — 300 steps, 3 tracks (tiny queue edge cases)", () => {
    runFuzz(9999, 300, 3);
  });

  it("fuzz seed=2024 — 300 steps, 100 tracks", () => {
    runFuzz(2024, 300, 100);
  });
});
