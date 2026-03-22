/**
 * StationSimulator — pure synchronous state machine that mirrors the station
 * inner event loop from packages/sidflow-play/src/station/run.ts.
 *
 * Use this in tests to drive the station through deterministic action sequences
 * and inspect the resulting rendered screen after every step.
 */

import path from "node:path";
import {
  clampSelectionToMatches,
  getFilteredTrackIndicesWithRatings,
  getStationReservedRows,
  moveCurrentInMatches,
  moveSelectionInMatches,
  normalizeFilterQuery,
  normalizeRatingFilterQuery,
  parseMinimumRatingFilter,
  renderStationScreen,
  resolvePlaylistWindowRowsForScreen,
  resolvePlaylistWindowStart,
} from "../../src/station/screen.js";
import { shuffleQueueKeepingCurrent } from "../../src/station/queue.js";
import type { StationAction, StationScreenState, StationTrackDetails } from "../../src/station/types.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface SimulatorState {
  stationIndex: number;
  selectedIndex: number;
  playlistWindowStart: number;
  stationFilter: string;
  filterEditing: boolean;
  ratingFilterQuery: string;
  ratingFilterEditing: boolean;
  minimumRating: number | undefined;
  paused: boolean;
  stationStatus: string;
  queueLength: number;
  ratings: Map<string, number>;
}

export interface SimulatorOptions {
  cols?: number;
  rows?: number;
  ratedTarget?: number;
  featuresJsonl?: string;
}

// ─── Factory ───────────────────────────────────────────────────────────────────

export function makeTrack(index: number, overrides: Partial<StationTrackDetails> = {}): StationTrackDetails {
  return {
    track_id: `track-${index}`,
    sid_path: `/music/track-${index}.sid`,
    song_index: 1,
    e: 3,
    m: 3,
    c: 3,
    p: null,
    likes: 0,
    dislikes: 0,
    skips: 0,
    plays: 0,
    last_played: null,
    absolutePath: `/music/track-${index}.sid`,
    title: `Track ${index}`,
    author: `Author ${index}`,
    released: "1987",
    year: "1987",
    durationMs: 120_000,
    ...overrides,
  };
}

export function makeQueue(count: number): StationTrackDetails[] {
  return Array.from({ length: count }, (_, index) => makeTrack(index));
}

// ─── StationSimulator ──────────────────────────────────────────────────────────

export class StationSimulator {
  private stationQueue: StationTrackDetails[];
  private stationIndex: number;
  private selectedIndex: number;
  private playlistWindowStart: number;
  private stationFilter: string;
  private filterEditing: boolean;
  private ratingFilterQuery: string;
  private ratingFilterEditing: boolean;
  private minimumRating: number | undefined;
  private ratings: Map<string, number>;
  private paused: boolean;
  private stationStatus: string;
  private readonly cols: number;
  private readonly rows: number;
  private readonly ratedTarget: number;
  private readonly featuresJsonl: string | undefined;
  /** Deterministic random function; replace for shuffle tests */
  random: () => number = Math.random;

  constructor(queue: StationTrackDetails[], startIndex = 0, options?: SimulatorOptions) {
    this.stationQueue = [...queue];
    this.stationIndex = Math.max(0, Math.min(startIndex, queue.length - 1));
    this.selectedIndex = this.stationIndex;
    this.playlistWindowStart = 0;
    this.stationFilter = "";
    this.filterEditing = false;
    this.ratingFilterQuery = "";
    this.ratingFilterEditing = false;
    this.minimumRating = undefined;
    this.ratings = new Map();
    this.paused = false;
    this.stationStatus = "Station ready.";
    this.cols = options?.cols ?? 120;
    this.rows = options?.rows ?? 40;
    this.ratedTarget = options?.ratedTarget ?? 10;
    this.featuresJsonl = options?.featuresJsonl;
  }

  // ─── State accessors ───────────────────────────────────────────────────────

  getState(): SimulatorState {
    return {
      stationIndex: this.stationIndex,
      selectedIndex: this.selectedIndex,
      playlistWindowStart: this.playlistWindowStart,
      stationFilter: this.stationFilter,
      filterEditing: this.filterEditing,
      ratingFilterQuery: this.ratingFilterQuery,
      ratingFilterEditing: this.ratingFilterEditing,
      minimumRating: this.minimumRating,
      paused: this.paused,
      stationStatus: this.stationStatus,
      queueLength: this.stationQueue.length,
      ratings: new Map(this.ratings),
    };
  }

  getCurrentIndex(): number {
    return this.stationIndex;
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getEffectiveSelectedIndex(): number {
    const filteredIndices = this.getFilteredIndices();
    return clampSelectionToMatches(filteredIndices, this.selectedIndex, this.stationIndex);
  }

  getFilteredIndices(): number[] {
    return getFilteredTrackIndicesWithRatings(
      this.stationQueue,
      this.stationFilter,
      this.ratings,
      this.minimumRating,
    );
  }

  getStatus(): string {
    return this.stationStatus;
  }

  getQueue(): StationTrackDetails[] {
    return [...this.stationQueue];
  }

  setRating(trackId: string, rating: number): void {
    this.ratings.set(trackId, rating);
  }

  // ─── Action application ────────────────────────────────────────────────────

  /**
   * Apply one StationAction exactly as run.ts would, then return the
   * rendered screen string so tests can immediately assert on the output.
   */
  applyAction(action: StationAction): string {
    this.handleAction(action);
    return this.renderScreen();
  }

  /**
   * Apply a sequence of actions and return all intermediate screens.
   */
  applyActions(actions: StationAction[]): string[] {
    return actions.map((a) => this.applyAction(a));
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  renderScreen(): string {
    const filteredIndices = this.getFilteredIndices();
    const effectiveSelectedIndex = clampSelectionToMatches(filteredIndices, this.selectedIndex, this.stationIndex);
    const reservedRows = getStationReservedRows(this.featuresJsonl);
    const playlistRows = resolvePlaylistWindowRowsForScreen(
      this.stationQueue.length,
      this.rows,
      reservedRows,
    );
    this.playlistWindowStart = resolvePlaylistWindowStart(
      filteredIndices,
      this.stationIndex,
      effectiveSelectedIndex,
      playlistRows,
      this.playlistWindowStart,
    );

    const current = this.stationQueue[this.stationIndex]!;
    const durationMs = current.durationMs ?? 120_000;
    const selectedTrack = this.stationQueue[effectiveSelectedIndex];

    const hintLine =
      selectedTrack && selectedTrack.track_id !== current.track_id
        ? `Selected ${effectiveSelectedIndex + 1}/${this.stationQueue.length}: ${selectedTrack.title || path.basename(selectedTrack.sid_path)}`
        : `Playhead ${this.stationIndex + 1}/${this.stationQueue.length}. Browse with ↑/↓/PgUp/PgDn, Enter plays the selected track.`;

    const state: StationScreenState = {
      phase: "station",
      current,
      index: this.stationIndex,
      selectedIndex: effectiveSelectedIndex,
      playlistWindowStart: this.playlistWindowStart,
      total: this.stationQueue.length,
      ratedCount: this.ratings.size,
      ratedTarget: this.ratedTarget,
      ratings: this.ratings,
      playbackMode: "none",
      adventure: 3,
      dataSource: "test",
      dbPath: "test.sqlite",
      featuresJsonl: this.featuresJsonl,
      queue: this.stationQueue,
      currentRating: this.ratings.get(current.track_id),
      minDurationSeconds: 15,
      elapsedMs: 0,
      durationMs,
      filterQuery: this.stationFilter,
      filterEditing: this.filterEditing,
      ratingFilterQuery: this.ratingFilterQuery,
      ratingFilterEditing: this.ratingFilterEditing,
      minimumRating: this.minimumRating,
      filterMatchCount: filteredIndices.length,
      paused: this.paused,
      statusLine: this.stationStatus,
      hintLine,
    };

    return renderStationScreen(state, false, this.cols, this.rows);
  }

  // ─── Action handlers (mirror run.ts station-loop exactly) ──────────────────

  private handleAction(action: StationAction): void {
    const filteredIndices = this.getFilteredIndices();
    const current = this.stationQueue[this.stationIndex]!;

    switch (action.type) {
      // ── Playback progression ──────────────────────────────────────────────
      case "timeout": {
        if (this.stationQueue.length === 1) {
          this.stationStatus = "Only one track is available, replaying it.";
          break;
        }
        this.stationIndex = Math.min(this.stationQueue.length - 1, this.stationIndex + 1);
        this.selectedIndex = this.stationIndex;
        this.stationStatus = "Advanced to the next track.";
        break;
      }

      case "next": {
        const nextIndex = this.stationFilter
          ? moveCurrentInMatches(filteredIndices, this.stationIndex, 1)
          : Math.min(this.stationQueue.length - 1, this.stationIndex + 1);
        if (nextIndex === null || nextIndex === this.stationIndex) {
          this.stationStatus = this.stationFilter
            ? `Already at the end of the filtered playlist for "${this.stationFilter}".`
            : "Already at the end of the station playlist.";
          break;
        }
        this.stationIndex = nextIndex;
        this.selectedIndex = this.stationIndex;
        this.stationStatus = "Moved to the next station track.";
        break;
      }

      case "back": {
        const previousIndex = this.stationFilter
          ? moveCurrentInMatches(filteredIndices, this.stationIndex, -1)
          : Math.max(0, this.stationIndex - 1);
        if (previousIndex === null || previousIndex === this.stationIndex) {
          this.stationStatus = this.stationFilter
            ? `Already at the start of the filtered playlist for "${this.stationFilter}".`
            : "Already at the start of the station playlist.";
          break;
        }
        this.stationIndex = previousIndex;
        this.selectedIndex = this.stationIndex;
        this.stationStatus = "Moved to the previous station track.";
        break;
      }

      case "playSelected": {
        if (filteredIndices.length === 0) {
          this.stationStatus = this.stationFilter
            ? `No playlist matches for "${this.stationFilter}". Press Esc or / to adjust the filter.`
            : "The playlist is empty.";
          break;
        }
        if (this.selectedIndex === this.stationIndex) {
          this.stationStatus = this.paused
            ? "Selection is already paused on the current song. Press space to resume."
            : "Selection is already the live song.";
          break;
        }
        this.stationIndex = this.selectedIndex;
        this.stationStatus = `Started selected track ${this.stationIndex + 1}/${this.stationQueue.length}.`;
        break;
      }

      // ── Navigation (cursor) ───────────────────────────────────────────────
      case "cursorUp": {
        this.selectedIndex = this.stationFilter
          ? (moveSelectionInMatches(filteredIndices, this.selectedIndex, -1) ?? this.selectedIndex)
          : Math.max(0, this.selectedIndex - 1);
        this.stationStatus = `Selected track ${this.selectedIndex + 1}/${this.stationQueue.length} without interrupting playback.`;
        break;
      }

      case "cursorDown": {
        this.selectedIndex = this.stationFilter
          ? (moveSelectionInMatches(filteredIndices, this.selectedIndex, 1) ?? this.selectedIndex)
          : Math.min(this.stationQueue.length - 1, this.selectedIndex + 1);
        this.stationStatus = `Selected track ${this.selectedIndex + 1}/${this.stationQueue.length} without interrupting playback.`;
        break;
      }

      case "pageUp": {
        const pageSize = Math.max(
          1,
          resolvePlaylistWindowRowsForScreen(
            this.stationQueue.length,
            this.rows,
            getStationReservedRows(this.featuresJsonl),
          ),
        );
        this.selectedIndex = this.stationFilter
          ? (moveSelectionInMatches(filteredIndices, this.selectedIndex, -pageSize) ?? this.selectedIndex)
          : Math.max(0, this.selectedIndex - pageSize);
        this.stationStatus = `Jumped selection to track ${this.selectedIndex + 1}/${this.stationQueue.length}.`;
        break;
      }

      case "pageDown": {
        const pageSize = Math.max(
          1,
          resolvePlaylistWindowRowsForScreen(
            this.stationQueue.length,
            this.rows,
            getStationReservedRows(this.featuresJsonl),
          ),
        );
        this.selectedIndex = this.stationFilter
          ? (moveSelectionInMatches(filteredIndices, this.selectedIndex, pageSize) ?? this.selectedIndex)
          : Math.min(this.stationQueue.length - 1, this.selectedIndex + pageSize);
        this.stationStatus = `Jumped selection to track ${this.selectedIndex + 1}/${this.stationQueue.length}.`;
        break;
      }

      // ── Playback control ──────────────────────────────────────────────────
      case "togglePause": {
        this.paused = !this.paused;
        this.stationStatus = this.paused
          ? `Paused ${current.title || path.basename(current.sid_path)}.`
          : `Resumed ${current.title || path.basename(current.sid_path)}.`;
        break;
      }

      // ── Filter: text / rating ─────────────────────────────────────────────
      case "setFilter": {
        const newFilterValue = normalizeFilterQuery(action.value);
        if (!action.editing || newFilterValue !== "" || this.filterEditing) {
          this.stationFilter = newFilterValue;
        }
        this.filterEditing = action.editing;
        const newFiltered = getFilteredTrackIndicesWithRatings(
          this.stationQueue, this.stationFilter, this.ratings, this.minimumRating,
        );
        if (newFiltered.length > 0) {
          this.selectedIndex = clampSelectionToMatches(newFiltered, this.selectedIndex, this.stationIndex);
          this.stationStatus = this.stationFilter
            ? `Text filter "${this.stationFilter}"  ${newFiltered.length}/${this.stationQueue.length}.`
            : this.minimumRating !== undefined
              ? `Text filter cleared. Stars ${this.minimumRating}+ still active.`
              : "Text filter cleared.";
        } else {
          this.stationStatus = this.stationFilter
            ? `No matches for text "${this.stationFilter}". Esc clears.`
            : this.minimumRating !== undefined
              ? `Text filter cleared. Stars ${this.minimumRating}+ still active.`
              : "Text filter cleared.";
        }
        break;
      }

      case "setRatingFilter": {
        const nextQuery = normalizeRatingFilterQuery(action.value);
        if (!action.editing) {
          const parsedMinimum = parseMinimumRatingFilter(nextQuery);
          if (nextQuery && parsedMinimum === undefined) {
            this.ratingFilterEditing = false;
            this.stationStatus = "Star filter must be *0 through *5.";
            break;
          }
          this.minimumRating = parsedMinimum;
          this.ratingFilterQuery = parsedMinimum === undefined ? "" : `*${parsedMinimum}`;
        } else {
          this.ratingFilterQuery = nextQuery;
        }
        this.ratingFilterEditing = action.editing;
        const ratingFiltered = getFilteredTrackIndicesWithRatings(
          this.stationQueue, this.stationFilter, this.ratings, this.minimumRating,
        );
        if (ratingFiltered.length > 0) {
          this.selectedIndex = clampSelectionToMatches(ratingFiltered, this.selectedIndex, this.stationIndex);
          this.stationStatus =
            this.minimumRating === undefined
              ? this.stationFilter
                ? `Stars cleared. Text "${this.stationFilter}" still active.`
                : "Star filter cleared."
              : `Stars ${this.minimumRating}+  ${ratingFiltered.length}/${this.stationQueue.length}.`;
        } else {
          this.stationStatus =
            this.minimumRating === undefined
              ? this.stationFilter
                ? `Stars cleared. Text "${this.stationFilter}" still active.`
                : "Star filter cleared."
              : `No matches for stars ${this.minimumRating}+. Esc clears.`;
        }
        break;
      }

      case "clearFilters": {
        if (this.stationFilter || this.minimumRating !== undefined) {
          this.stationFilter = "";
          this.filterEditing = false;
          this.ratingFilterQuery = "";
          this.ratingFilterEditing = false;
          this.minimumRating = undefined;
          this.stationStatus = "Filters cleared.";
        }
        break;
      }

      case "cancelInput": {
        this.ratingFilterEditing = false;
        this.ratingFilterQuery = this.minimumRating === undefined ? "" : String(this.minimumRating);
        this.stationStatus = "Input cancelled.";
        break;
      }

      // ── Queue management ──────────────────────────────────────────────────
      case "shuffle": {
        const currentTrackId = current.track_id;
        this.stationQueue = shuffleQueueKeepingCurrent(this.stationQueue, this.stationIndex, this.random);
        this.stationIndex = Math.max(
          0,
          this.stationQueue.findIndex((track) => track.track_id === currentTrackId),
        );
        this.selectedIndex = clampSelectionToMatches(
          getFilteredTrackIndicesWithRatings(this.stationQueue, this.stationFilter, this.ratings, this.minimumRating),
          this.selectedIndex,
          this.stationIndex,
        );
        this.stationStatus = "Reshuffled the current playlist without changing its songs.";
        break;
      }

      case "rate": {
        this.ratings.set(current.track_id, action.rating);
        this.stationStatus = action.rating === 5
          ? "Liked current track. Queue unchanged. Press g to rebuild recommendations."
          : `Stored ${action.rating}/5. Queue unchanged. Press g to rebuild recommendations.`;
        break;
      }

      case "skip": {
        this.ratings.set(current.track_id, 0);
        const nextIndex = this.stationIndex < this.stationQueue.length - 1
          ? this.stationIndex + 1
          : this.stationIndex;
        if (nextIndex === this.stationIndex) {
          this.stationStatus = "Skipped current track. Queue unchanged. Press g to rebuild recommendations.";
          break;
        }
        this.stationIndex = nextIndex;
        this.selectedIndex = clampSelectionToMatches(
          getFilteredTrackIndicesWithRatings(this.stationQueue, this.stationFilter, this.ratings, this.minimumRating),
          this.stationIndex,
          this.stationIndex,
        );
        this.stationStatus = "Skipped current track. Queue unchanged. Press g to rebuild recommendations.";
        break;
      }

      case "refresh": {
        this.stationStatus = "Screen refreshed.";
        break;
      }

      // ── Unimplemented in simulator (no-op or not needed for UI tests) ─────
      case "rebuild":
      case "openSavePlaylistDialog":
      case "openLoadPlaylistDialog":
      case "updateSavePlaylistName":
      case "submitSavePlaylistDialog":
      case "movePlaylistDialogSelection":
      case "confirmPlaylistDialog":
      case "cancelPlaylistDialog":
      case "quit": {
        // Not simulated; these require async I/O or dialog state
        break;
      }

      default: {
        // Exhaustive type check
        const _exhaustive: never = action;
        void _exhaustive;
      }
    }
  }
}
