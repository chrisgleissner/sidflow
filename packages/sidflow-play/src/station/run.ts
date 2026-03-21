import process from "node:process";
import path from "node:path";
import { rm } from "node:fs/promises";
import {
  handleParseResult,
  loadConfig,
  lookupSongDurationMs,
  parseSidFile,
  pathExists,
  type SidFileMetadata,
} from "@sidflow/common";
import type {
  PlaybackMode,
  StationCliOptions,
  StationRuntime,
  StationScreenState,
  StationTrackDetails,
} from "./types.js";
import { MINIMUM_RATED_TRACKS, MINIMUM_STATION_TRACKS } from "./constants.js";
import { parseStationArgs, HELP_TEXT } from "./args.js";
import { getTerminalSize, isTrackLongEnough, resolveTrackDurationMs } from "./formatting.js";
import {
  ScreenRenderer,
  clampSelectionToMatches,
  getFilteredTrackIndicesWithRatings,
  getStationReservedRows,
  moveCurrentInMatches,
  moveSelectionInMatches,
  normalizeFilterQuery,
  normalizeRatingFilterQuery,
  parseMinimumRatingFilter,
  resolvePlaylistWindowRowsForScreen,
  resolvePlaylistWindowStart,
} from "./screen.js";
import { createInputController } from "./input.js";
import { createPlaybackAdapter } from "./playback-adapters.js";
import { resolveStationDataset } from "./dataset.js";
import {
  buildStationQueue,
  inspectExportDatabase,
  mergeQueueKeepingCurrent,
  readRandomTracksExcluding,
  resolvePlaylistPositionMs,
  resolveTrackDetails,
  shuffleQueueKeepingCurrent,
  summarizeRatingAnchors,
  sumPlaylistDurationMs,
} from "./queue.js";
import {
  buildSelectionStatePath,
  readPersistedStationSelections,
  writePersistedStationSelections,
} from "./persistence.js";

function normalizePlaybackMode(value: string | undefined): PlaybackMode | null {
  if (!value) {
    return "local";
  }
  if (value === "local" || value === "c64u" || value === "none") {
    return value;
  }
  return null;
}

function resolvePlaybackMode(options: StationCliOptions): PlaybackMode | null {
  if (options.playback) {
    return normalizePlaybackMode(options.playback);
  }
  if (options.c64uHost) {
    return "c64u";
  }
  return "local";
}

const defaultRuntime: StationRuntime = {
  loadConfig,
  parseSidFile,
  lookupSongDurationMs,
  fetchImpl: fetch,
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
  cwd: () => process.cwd(),
  now: () => new Date(),
  random: () => Math.random(),
  onSignal: (signal, handler) => {
    process.on(signal, handler);
  },
  offSignal: (signal, handler) => {
    process.off(signal, handler);
  },
};

function mergeRuntime(overrides?: Partial<StationRuntime>): StationRuntime {
  if (!overrides) {
    return defaultRuntime;
  }
  return {
    ...defaultRuntime,
    ...overrides,
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    stdin: overrides.stdin ?? process.stdin,
  };
}

function buildInitialSeedStatus(
  dataSource: string,
  dbPath: string,
  playbackMode: PlaybackMode,
  adventure: number,
  ratedCount: number,
  ratedTarget: number,
  current: StationTrackDetails,
  currentRating: number | undefined,
  featuresJsonl: string | undefined,
  index: number,
  minDurationSeconds: number,
): StationScreenState {
  return {
    phase: "rating",
    current,
    index,
    total: ratedTarget,
    ratedCount,
    ratedTarget,
    ratings: new Map(),
    playbackMode,
    adventure,
    dataSource,
    dbPath,
    featuresJsonl,
    currentRating,
    durationMs: resolveTrackDurationMs(current),
    minDurationSeconds,
    elapsedMs: 0,
  };
}

export async function runStationCli(
  argv: string[],
  overrides?: Partial<StationRuntime>,
): Promise<number> {
  const runtime = mergeRuntime(overrides);
  const result = parseStationArgs(argv);
  const exitCode = handleParseResult(result, HELP_TEXT, runtime.stdout, runtime.stderr);
  if (exitCode !== undefined) {
    return exitCode;
  }

  const { options } = result;
  const playbackMode = resolvePlaybackMode(options);
  if (!playbackMode) {
    runtime.stderr.write("Error: --playback must be local, c64u, or none\n");
    return 1;
  }

  const config = await runtime.loadConfig(options.config);
  const hvscRoot = path.resolve(runtime.cwd(), options.hvsc ?? config.sidPath);
  let dataset;
  try {
    dataset = await resolveStationDataset(runtime, options, config);
  } catch (error) {
    runtime.stderr.write(`Error: ${(error as Error).message}\n`);
    return 1;
  }
  const { dataSource, dbPath, featuresJsonl } = dataset;

  if (!(await pathExists(dbPath))) {
    runtime.stderr.write(`Error: similarity export database not found at ${dbPath}\n`);
    return 1;
  }

  if (!(await pathExists(hvscRoot))) {
    runtime.stderr.write(`Error: SID collection root not found at ${hvscRoot}\n`);
    return 1;
  }

  const exportInfo = inspectExportDatabase(dbPath);
  if (!exportInfo.hasTrackIdentity) {
    runtime.stderr.write(
      `Error: ${dbPath} is an older similarity export schema without track-level identity columns (track_id, song_index).\n`,
    );
    runtime.stderr.write("Build or point to a newer Phase 5 similarity export before running SID CLI Station.\n");
    return 1;
  }
  if (!exportInfo.hasVectorData) {
    runtime.stderr.write(`Error: ${dbPath} does not contain vector_json data, so station recommendations cannot be rebuilt.\n`);
    return 1;
  }
  if (exportInfo.trackCount === 0) {
    runtime.stderr.write("Error: export database does not contain any tracks\n");
    return 1;
  }

  const input = createInputController(runtime);
  const renderer = new ScreenRenderer(runtime);
  const playback = runtime.createPlaybackAdapter
    ? await runtime.createPlaybackAdapter(playbackMode, config, options)
    : await createPlaybackAdapter(playbackMode, config, options);
  const metadataCache = new Map<string, Promise<{ metadata?: SidFileMetadata; durationMs?: number }>>();
  const ratedTarget = Math.max(MINIMUM_RATED_TRACKS, options.sampleSize ?? MINIMUM_RATED_TRACKS);
  const stationTarget = Math.max(MINIMUM_STATION_TRACKS, options.stationSize ?? MINIMUM_STATION_TRACKS);
  const minDurationSeconds = Math.max(1, options.minDuration ?? 15);
  const selectionStatePath = buildSelectionStatePath(runtime.cwd(), dbPath, hvscRoot);

  if (options.resetSelections) {
    await rm(selectionStatePath, { force: true });
  }

  const stopPlayback = async (): Promise<void> => {
    try {
      await playback.stop();
    } catch {
      // ignore cleanup errors
    }
  };

  const pausePlayback = async (): Promise<void> => {
    try {
      await playback.pause();
    } catch {
      // ignore pause errors
    }
  };

  const resumePlayback = async (): Promise<void> => {
    try {
      await playback.resume();
    } catch {
      // ignore resume errors
    }
  };

  let interrupted = false;
  const handleSigint = (): void => {
    interrupted = true;
    void stopPlayback();
  };

  runtime.onSignal("SIGINT", handleSigint);

  try {
    const ratings = options.resetSelections
      ? new Map<string, number>()
      : await readPersistedStationSelections(selectionStatePath, dbPath, hvscRoot);
    const seenTrackIds = new Set<string>();
    const seeds: StationTrackDetails[] = [];
    let seedIndex = 0;
    const reusedPersistedRatings = !options.resetSelections && ratings.size >= ratedTarget;
    let seedStatus = reusedPersistedRatings
      ? `Reused ${ratings.size} persisted ratings. Starting the station immediately.`
      : ratings.size > 0
        ? `Loaded ${ratings.size} persisted ratings. Keep rating until ${ratedTarget} songs are scored.`
        : options.resetSelections
          ? "Cleared persisted ratings. Keep rating until the target is reached."
          : "Skipped songs do not count. Keep rating until the target is reached.";

    while (!interrupted && ratings.size < ratedTarget) {
      if (seedIndex >= seeds.length) {
        const batchSize = Math.max(12, (ratedTarget - ratings.size) * 3);
        const nextRows = readRandomTracksExcluding(dbPath, batchSize, seenTrackIds);
        if (nextRows.length === 0) {
          break;
        }
        for (const row of nextRows) {
          if (seenTrackIds.has(row.track_id)) {
            continue;
          }
          seenTrackIds.add(row.track_id);
          const resolved = await resolveTrackDetails(row, hvscRoot, runtime, metadataCache);
          if (!isTrackLongEnough(resolved, minDurationSeconds)) {
            continue;
          }
          seeds.push(resolved);
        }
      }

      if (seedIndex >= seeds.length) {
        break;
      }

      const current = seeds[seedIndex];
      let startedAt = Date.now();
      await playback.start(current);

      while (!interrupted) {
        const elapsedMs = Date.now() - startedAt;
        const currentRating = ratings.get(current.track_id);
        renderer.render({
          ...buildInitialSeedStatus(
            dataSource,
            dbPath,
            playbackMode,
            options.adventure ?? 3,
            ratings.size,
            ratedTarget,
            current,
            currentRating,
            featuresJsonl,
            seedIndex,
            minDurationSeconds,
          ),
          ratings,
          statusLine: seedStatus,
          hintLine: `Seen ${seenTrackIds.size}/${exportInfo.trackCount} tracks so far.`,
          elapsedMs,
        });

        const action = await input.readSeedAction();
        if (action.type === "quit") {
          renderer.render({
            ...buildInitialSeedStatus(
              dataSource,
              dbPath,
              playbackMode,
              options.adventure ?? 3,
              ratings.size,
              ratedTarget,
              current,
              ratings.get(current.track_id),
              featuresJsonl,
              seedIndex,
              minDurationSeconds,
            ),
            ratings,
            statusLine: "Session ended.",
            elapsedMs: Date.now() - startedAt,
          });
          return 0;
        }
        if (action.type === "replay") {
          await stopPlayback();
          await playback.start(current);
          startedAt = Date.now();
          seedStatus = `Replaying ${current.title || path.basename(current.sid_path)}.`;
          continue;
        }
        if (action.type === "back") {
          await stopPlayback();
          seedIndex = Math.max(0, seedIndex - 1);
          seedStatus = "Moved back to the previous seed.";
          break;
        }
        if (action.type === "skip") {
          ratings.delete(current.track_id);
          await stopPlayback();
          seedIndex += 1;
          seedStatus = "Skipped. It does not count toward the station target.";
          break;
        }

        ratings.set(current.track_id, action.rating);
        await writePersistedStationSelections(selectionStatePath, dbPath, hvscRoot, ratedTarget, ratings, runtime.now().toISOString());
        await stopPlayback();
        seedIndex += 1;
        seedStatus = action.rating === 5
          ? `Liked ${current.title || path.basename(current.sid_path)}.`
          : action.rating === 0
            ? `Disliked ${current.title || path.basename(current.sid_path)}.`
            : `Stored ${action.rating}/5 for ${current.title || path.basename(current.sid_path)}.`;
        break;
      }
    }

    if (ratings.size < ratedTarget) {
      runtime.stderr.write(
        `Error: only ${ratings.size} songs were rated before the export ran out of unseen tracks that satisfy the ${minDurationSeconds}s minimum; the target is ${ratedTarget}.\n`,
      );
      return 1;
    }

    let stationQueue = await buildStationQueue(
      dbPath,
      hvscRoot,
      ratings,
      stationTarget,
      options.adventure ?? 3,
      minDurationSeconds,
      runtime,
      metadataCache,
    );

    if (stationQueue.length === 0) {
      runtime.stderr.write("Error: no station candidates were produced from the supplied ratings\n");
      return 1;
    }
    if (stationQueue.length < stationTarget) {
      runtime.stderr.write(
        `Error: only ${stationQueue.length} long-enough station tracks were available; at least ${stationTarget} are required for the playlist.\n`,
      );
      return 1;
    }

    let stationIndex = 0;
    let selectedIndex = 0;
    let playlistWindowStart = 0;
    let stationFilter = "";
    let filterEditing = false;
    let ratingFilterQuery = "";
    let ratingFilterEditing = false;
    let minimumRating: number | undefined;
    const initialSummary = summarizeRatingAnchors(ratings);
    let stationStatus = reusedPersistedRatings
      ? `Reused ${ratings.size} persisted ratings. Station ready immediately (${initialSummary.strong} strong anchors, ${initialSummary.excluded} excluded dislikes). Flow is sequenced by similarity.`
      : `Station ready from ${ratings.size} ratings (${initialSummary.strong} strong anchors, ${initialSummary.excluded} excluded dislikes). Flow is sequenced by similarity.`;

    while (!interrupted && stationQueue.length > 0) {
      const current = stationQueue[stationIndex];
      const durationMs = resolveTrackDurationMs(current);
      let elapsedBeforePauseMs = 0;
      let startedAt = Date.now();
      let paused = false;
      await playback.start(current);

      while (!interrupted) {
        const getCurrentElapsedMs = () => (
          paused
            ? elapsedBeforePauseMs
            : Math.min(durationMs, elapsedBeforePauseMs + (Date.now() - startedAt))
        );
        const render = () => {
          const terminalSize = getTerminalSize(runtime.stdout);
          const liveElapsedMs = getCurrentElapsedMs();
          const livePlaylistDurationMs = sumPlaylistDurationMs(stationQueue);
          const livePlaylistElapsedMs = resolvePlaylistPositionMs(stationQueue, stationIndex, liveElapsedMs);
          const filteredIndices = getFilteredTrackIndicesWithRatings(stationQueue, stationFilter, ratings, minimumRating);
          const effectiveSelectedIndex = clampSelectionToMatches(filteredIndices, selectedIndex, stationIndex);
          const playlistRows = resolvePlaylistWindowRowsForScreen(
            stationQueue.length,
            terminalSize.rows,
            getStationReservedRows(featuresJsonl),
          );
          playlistWindowStart = resolvePlaylistWindowStart(filteredIndices, effectiveSelectedIndex, playlistRows, playlistWindowStart);
          const selectedTrack = stationQueue[effectiveSelectedIndex];
          renderer.render({
            phase: "station",
            current,
            index: stationIndex,
            selectedIndex: effectiveSelectedIndex,
            playlistWindowStart,
            total: stationQueue.length,
            ratedCount: ratings.size,
            ratedTarget,
            ratings,
            playbackMode,
            adventure: options.adventure ?? 3,
            dataSource,
            dbPath,
            featuresJsonl,
            queue: stationQueue,
            currentRating: ratings.get(current.track_id),
            minDurationSeconds,
            elapsedMs: liveElapsedMs,
            durationMs,
            playlistElapsedMs: livePlaylistElapsedMs,
            playlistDurationMs: livePlaylistDurationMs,
            filterQuery: stationFilter,
            filterEditing,
            ratingFilterQuery,
            ratingFilterEditing,
            minimumRating,
            filterMatchCount: filteredIndices.length,
            paused,
            statusLine: stationStatus,
            hintLine: selectedTrack && selectedTrack.track_id !== current.track_id
              ? `Selected ${effectiveSelectedIndex + 1}/${stationQueue.length}: ${selectedTrack.title || path.basename(selectedTrack.sid_path)}`
              : `Playhead ${stationIndex + 1}/${stationQueue.length}. Browse with ↑/↓/PgUp/PgDn, Enter plays the selected track.`,
          });
        };

        render();
        const currentElapsedMs = getCurrentElapsedMs();
        const remainingMs = paused ? 86_400_000 : Math.max(1, durationMs - currentElapsedMs);
        const action = await input.readStationAction(remainingMs, render);
        render();

        if (action.type === "timeout") {
          await stopPlayback();
          if (stationQueue.length === 1) {
            startedAt = Date.now();
            elapsedBeforePauseMs = 0;
            paused = false;
            await playback.start(current);
            stationStatus = "Only one track is available, replaying it.";
            continue;
          }
          stationIndex = Math.min(stationQueue.length - 1, stationIndex + 1);
          selectedIndex = stationIndex;
          stationStatus = "Advanced to the next track.";
          break;
        }

        if (action.type === "quit") {
          const liveElapsedMs = getCurrentElapsedMs();
          const livePlaylistDurationMs = sumPlaylistDurationMs(stationQueue);
          const livePlaylistElapsedMs = resolvePlaylistPositionMs(stationQueue, stationIndex, liveElapsedMs);
          const filteredIndices = getFilteredTrackIndicesWithRatings(stationQueue, stationFilter, ratings, minimumRating);
          renderer.render({
            phase: "station",
            current,
            index: stationIndex,
            selectedIndex: clampSelectionToMatches(filteredIndices, selectedIndex, stationIndex),
            playlistWindowStart,
            total: stationQueue.length,
            ratedCount: ratings.size,
            ratedTarget,
            ratings,
            playbackMode,
            adventure: options.adventure ?? 3,
            dataSource,
            dbPath,
            featuresJsonl,
            queue: stationQueue,
            currentRating: ratings.get(current.track_id),
            minDurationSeconds,
            elapsedMs: liveElapsedMs,
            durationMs,
            playlistElapsedMs: livePlaylistElapsedMs,
            playlistDurationMs: livePlaylistDurationMs,
            filterQuery: stationFilter,
            filterEditing,
            ratingFilterQuery,
            ratingFilterEditing,
            minimumRating,
            filterMatchCount: filteredIndices.length,
            paused,
            statusLine: "Station session ended.",
          });
          return 0;
        }

        if (action.type === "replay") {
          await stopPlayback();
          await playback.start(current);
          startedAt = Date.now();
          elapsedBeforePauseMs = 0;
          paused = false;
          selectedIndex = clampSelectionToMatches(
            getFilteredTrackIndicesWithRatings(stationQueue, stationFilter, ratings, minimumRating),
            stationIndex,
            stationIndex,
          );
          playlistWindowStart = 0;
          stationStatus = `Replaying ${current.title || path.basename(current.sid_path)}.`;
          continue;
        }

        if (action.type === "setFilter") {
          const newFilterValue = normalizeFilterQuery(action.value);
          // When entering editing mode (editing:true) with an empty value the
          // user just pressed "/" to start a new query. Preserve the existing
          // stationFilter so the playlist doesn't flash back to unfiltered
          // while the user hasn't typed anything yet. Once the user types the
          // first character (non-empty value) or commits/cancels (editing:false)
          // the filter is updated normally.
          if (!action.editing || newFilterValue !== "" || filterEditing) {
            stationFilter = newFilterValue;
          }
          filterEditing = action.editing;
          const filteredIndices = getFilteredTrackIndicesWithRatings(stationQueue, stationFilter, ratings, minimumRating);
          if (filteredIndices.length > 0) {
            selectedIndex = clampSelectionToMatches(filteredIndices, selectedIndex, stationIndex);
            playlistWindowStart = resolvePlaylistWindowStart(
              filteredIndices,
              selectedIndex,
              resolvePlaylistWindowRowsForScreen(
                stationQueue.length,
                getTerminalSize(runtime.stdout).rows,
                getStationReservedRows(featuresJsonl),
              ),
              playlistWindowStart,
            );
            stationStatus = stationFilter
              ? `Text filter \"${stationFilter}\"  ${filteredIndices.length}/${stationQueue.length}.`
              : minimumRating !== undefined
                ? `Text filter cleared. Stars ${minimumRating}+ still active.`
                : "Text filter cleared.";
          } else {
            playlistWindowStart = 0;
            stationStatus = stationFilter
              ? `No matches for text \"${stationFilter}\". Esc clears.`
              : minimumRating !== undefined
                ? `Text filter cleared. Stars ${minimumRating}+ still active.`
                : "Text filter cleared.";
          }
          continue;
        }

        if (action.type === "setRatingFilter") {
          const nextQuery = normalizeRatingFilterQuery(action.value);
          if (!action.editing) {
            const parsedMinimum = parseMinimumRatingFilter(nextQuery);
            if (nextQuery && parsedMinimum === undefined) {
              ratingFilterEditing = false;
              stationStatus = "Star filter must be *0 through *5.";
              continue;
            }
            minimumRating = parsedMinimum;
            ratingFilterQuery = parsedMinimum === undefined ? "" : `*${parsedMinimum}`;
          } else {
            ratingFilterQuery = nextQuery;
          }
          ratingFilterEditing = action.editing;
          const filteredIndices = getFilteredTrackIndicesWithRatings(stationQueue, stationFilter, ratings, minimumRating);
          if (filteredIndices.length > 0) {
            selectedIndex = clampSelectionToMatches(filteredIndices, selectedIndex, stationIndex);
            playlistWindowStart = resolvePlaylistWindowStart(
              filteredIndices,
              selectedIndex,
              resolvePlaylistWindowRowsForScreen(
                stationQueue.length,
                getTerminalSize(runtime.stdout).rows,
                getStationReservedRows(featuresJsonl),
              ),
              playlistWindowStart,
            );
            stationStatus = minimumRating === undefined
              ? stationFilter
                ? `Stars cleared. Text \"${stationFilter}\" still active.`
                : "Star filter cleared."
              : `Stars ${minimumRating}+  ${filteredIndices.length}/${stationQueue.length}.`;
          } else {
            playlistWindowStart = 0;
            stationStatus = minimumRating === undefined
              ? stationFilter
                ? `Stars cleared. Text \"${stationFilter}\" still active.`
                : "Star filter cleared."
              : `No matches for stars ${minimumRating}+. Esc clears.`;
          }
          continue;
        }

        const filteredIndices = getFilteredTrackIndicesWithRatings(stationQueue, stationFilter, ratings, minimumRating);

        if (action.type === "next") {
          const nextIndex = stationFilter
            ? moveCurrentInMatches(filteredIndices, stationIndex, 1)
            : Math.min(stationQueue.length - 1, stationIndex + 1);
          if (nextIndex === null || nextIndex === stationIndex) {
            stationStatus = stationFilter
              ? `Already at the end of the filtered playlist for \"${stationFilter}\".`
              : "Already at the end of the station playlist.";
            continue;
          }
          await stopPlayback();
          stationIndex = nextIndex;
          selectedIndex = stationIndex;
          playlistWindowStart = 0;
          stationStatus = "Moved to the next station track.";
          break;
        }

        if (action.type === "back") {
          const previousIndex = stationFilter
            ? moveCurrentInMatches(filteredIndices, stationIndex, -1)
            : Math.max(0, stationIndex - 1);
          if (previousIndex === null || previousIndex === stationIndex) {
            stationStatus = stationFilter
              ? `Already at the start of the filtered playlist for \"${stationFilter}\".`
              : "Already at the start of the station playlist.";
            continue;
          }
          await stopPlayback();
          stationIndex = previousIndex;
          selectedIndex = stationIndex;
          playlistWindowStart = 0;
          stationStatus = "Moved to the previous station track.";
          break;
        }

        if (action.type === "cursorUp") {
          selectedIndex = stationFilter
            ? moveSelectionInMatches(filteredIndices, selectedIndex, -1) ?? selectedIndex
            : Math.max(0, selectedIndex - 1);
          stationStatus = `Selected track ${selectedIndex + 1}/${stationQueue.length} without interrupting playback.`;
          continue;
        }

        if (action.type === "cursorDown") {
          selectedIndex = stationFilter
            ? moveSelectionInMatches(filteredIndices, selectedIndex, 1) ?? selectedIndex
            : Math.min(stationQueue.length - 1, selectedIndex + 1);
          stationStatus = `Selected track ${selectedIndex + 1}/${stationQueue.length} without interrupting playback.`;
          continue;
        }

        if (action.type === "pageUp") {
          selectedIndex = stationFilter
            ? moveSelectionInMatches(filteredIndices, selectedIndex, -1) ?? selectedIndex
            : Math.max(0, selectedIndex - 10);
          stationStatus = `Jumped selection to track ${selectedIndex + 1}/${stationQueue.length}.`;
          continue;
        }

        if (action.type === "pageDown") {
          selectedIndex = stationFilter
            ? moveSelectionInMatches(filteredIndices, selectedIndex, 1) ?? selectedIndex
            : Math.min(stationQueue.length - 1, selectedIndex + 10);
          stationStatus = `Jumped selection to track ${selectedIndex + 1}/${stationQueue.length}.`;
          continue;
        }

        if (action.type === "playSelected") {
          if (filteredIndices.length === 0) {
            stationStatus = stationFilter
              ? `No playlist matches for \"${stationFilter}\". Press Esc or / to adjust the filter.`
              : "The playlist is empty.";
            continue;
          }
          if (selectedIndex === stationIndex) {
            stationStatus = paused
              ? "Selection is already paused on the current song. Press space to resume."
              : "Selection is already the live song.";
            continue;
          }
          await stopPlayback();
          stationIndex = selectedIndex;
          playlistWindowStart = 0;
          stationStatus = `Started selected track ${stationIndex + 1}/${stationQueue.length}.`;
          break;
        }

        if (action.type === "togglePause") {
          if (paused) {
            await resumePlayback();
            startedAt = Date.now();
            paused = false;
            stationStatus = `Resumed ${current.title || path.basename(current.sid_path)}.`;
          } else {
            elapsedBeforePauseMs = currentElapsedMs;
            await pausePlayback();
            paused = true;
            stationStatus = `Paused ${current.title || path.basename(current.sid_path)}.`;
          }
          continue;
        }

        if (action.type === "shuffle") {
          stationQueue = shuffleQueueKeepingCurrent(stationQueue, stationIndex, runtime.random);
          stationIndex = 0;
          selectedIndex = clampSelectionToMatches(getFilteredTrackIndicesWithRatings(stationQueue, stationFilter, ratings, minimumRating), 0, 0);
          playlistWindowStart = 0;
          stationStatus = "Shuffled the remaining playlist around the current song.";
          continue;
        }

        if (action.type === "rate") {
          ratings.set(current.track_id, action.rating);
          await writePersistedStationSelections(selectionStatePath, dbPath, hvscRoot, ratedTarget, ratings, runtime.now().toISOString());
          if (action.rating === 0) {
            const nextIndex = stationIndex < stationQueue.length - 1 ? stationIndex + 1 : stationIndex;
            if (nextIndex === stationIndex) {
              stationStatus = "Skipped current track. Queue unchanged. Refresh with u.";
              continue;
            }
            await stopPlayback();
            stationIndex = nextIndex;
            selectedIndex = clampSelectionToMatches(
              getFilteredTrackIndicesWithRatings(stationQueue, stationFilter, ratings, minimumRating),
              stationIndex,
              stationIndex,
            );
            playlistWindowStart = 0;
            stationStatus = "Skipped current track. Queue unchanged. Refresh with u.";
            break;
          } else {
            stationStatus = action.rating === 5
              ? "Liked current track. Queue unchanged. Refresh with u."
              : `Stored ${action.rating}/5. Queue unchanged. Refresh with u.`;
          }
          continue;
        }

        const rebuilt = await buildStationQueue(
          dbPath,
          hvscRoot,
          ratings,
          stationTarget,
          options.adventure ?? 3,
          minDurationSeconds,
          runtime,
          metadataCache,
        );
        if (rebuilt.length >= stationTarget) {
          const merged = mergeQueueKeepingCurrent(current, rebuilt, stationIndex);
          stationQueue = merged.queue;
          stationIndex = merged.index;
          selectedIndex = clampSelectionToMatches(getFilteredTrackIndicesWithRatings(stationQueue, stationFilter, ratings, minimumRating), stationIndex, stationIndex);
          playlistWindowStart = 0;
          await writePersistedStationSelections(selectionStatePath, dbPath, hvscRoot, ratedTarget, ratings, runtime.now().toISOString());
          const rebuiltSummary = summarizeRatingAnchors(ratings);
          stationStatus = `Refreshed queue from ${ratings.size} ratings; live track pinned at ${stationIndex + 1}/${stationQueue.length} (${rebuiltSummary.strong} strong, ${rebuiltSummary.excluded} blocked).`;
        } else {
          stationStatus = "Refresh did not produce a full queue; playlist unchanged.";
        }
      }
    }

    return 0;
  } catch (error) {
    runtime.stderr.write(`Error: ${(error as Error).message}\n`);
    return 1;
  } finally {
    runtime.offSignal("SIGINT", handleSigint);
    input.close();
    renderer.close();
    await stopPlayback();
  }
}
