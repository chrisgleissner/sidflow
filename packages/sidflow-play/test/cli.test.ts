/// <reference types="bun-types" />

import { describe, expect, test, it } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Writable } from "node:stream";
import type { Stats } from "node:fs";

import { parsePlayArgs, runPlayCli } from "../src/cli.js";
import {
  __stationDemoTestUtils,
  normalizeRating,
  parseStationDemoArgs as parseStationArgs,
  readPersistedStationSelections,
  renderStars,
  runStationDemoCli as runStationCli,
  normalizeFilterQuery,
  trackMatchesFilter,
  getFilteredTrackIndices,
  mapStationToken,
  decodeTerminalInput,
} from "../src/sid-station.js";
import { PlaybackState, type PlaybackEvent } from "../src/index.js";
import type { Recommendation } from "@sidflow/common";
import type { SidFileMetadata } from "@sidflow/common";
import type { Playlist, PlaylistConfig } from "../src/playlist.js";
import type { PlaybackOptions } from "../src/playback.js";

async function createStationDemoFixture(): Promise<{ dbPath: string; workspace: string }> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "sidflow-station-demo-"));
  const dbPath = path.join(workspace, "sidcorr.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE tracks (
      track_id TEXT PRIMARY KEY,
      sid_path TEXT NOT NULL,
      song_index INTEGER NOT NULL,
      vector_json TEXT,
      e INTEGER NOT NULL,
      m INTEGER NOT NULL,
      c INTEGER NOT NULL,
      p INTEGER,
      likes INTEGER NOT NULL DEFAULT 0,
      dislikes INTEGER NOT NULL DEFAULT 0,
      skips INTEGER NOT NULL DEFAULT 0,
      plays INTEGER NOT NULL DEFAULT 0,
      last_played TEXT
    );
  `);
  const insert = db.query(`
    INSERT INTO tracks (track_id, sid_path, song_index, vector_json, e, m, c, p, likes, dislikes, skips, plays, last_played)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const rows: Array<[string, string, [number, number, number], number, number, number, number, number, number, number, number]> = [
    ["A/song1.sid#1", "A/song1.sid", [1, 0, 0], 5, 4, 2, 4, 2, 0, 0, 5],
    ["A/song2.sid#1", "A/song2.sid", [0.97, 0.03, 0], 5, 5, 2, 5, 1, 0, 0, 3],
    ["A/song3.sid#1", "A/song3.sid", [0.95, 0.05, 0], 4, 5, 2, 5, 1, 0, 0, 2],
    ["A/song4.sid#1", "A/song4.sid", [0.93, 0.07, 0], 5, 4, 3, 4, 2, 0, 0, 4],
    ["A/song5.sid#1", "A/song5.sid", [0.91, 0.09, 0], 4, 4, 3, 4, 1, 0, 0, 4],
    ["A/song6.sid#1", "A/song6.sid", [0.89, 0.11, 0], 4, 4, 2, 4, 0, 0, 0, 1],
    ["B/song7.sid#1", "B/song7.sid", [0, 1, 0], 2, 2, 4, 2, 0, 0, 0, 1],
    ["B/song8.sid#1", "B/song8.sid", [0.1, 0.9, 0], 2, 3, 4, 2, 0, 0, 0, 1],
    ["C/song9.sid#1", "C/song9.sid", [0.94, 0.06, 0], 5, 5, 3, 5, 3, 0, 0, 8],
    ["D/song10.sid#1", "D/song10.sid", [0.87, 0.13, 0], 4, 4, 3, 4, 2, 0, 0, 4],
    ["E/song11.sid#1", "E/song11.sid", [0.86, 0.14, 0], 4, 4, 3, 4, 2, 0, 0, 4],
    ["F/song12.sid#1", "F/song12.sid", [0.84, 0.16, 0], 4, 4, 3, 4, 2, 0, 0, 4],
  ];

  for (let index = 13; index <= 140; index += 1) {
    const group = String.fromCharCode(65 + ((index - 1) % 20));
    const sidPath = `${group}/song${index}.sid`;
    const energy = Math.max(0.2, 0.99 - (index * 0.003));
    const mood = Number((1 - energy).toFixed(3));
    rows.push([
      `${sidPath}#1`,
      sidPath,
      [Number(energy.toFixed(3)), mood, 0],
      4,
      4,
      3,
      4,
      1,
      0,
      0,
      2,
    ]);
  }

  for (const [trackId, sidPath, vector, e, m, c, p, likes, dislikes, skips, plays] of rows) {
    insert.run(trackId, sidPath, 1, JSON.stringify(vector), e, m, c, p, likes, dislikes, skips, plays, null);
    await mkdir(path.dirname(path.join(workspace, sidPath)), { recursive: true });
    await writeFile(path.join(workspace, sidPath), "PSID", "utf8");
  }
  db.close();
  return { dbPath, workspace };
}

async function createLargeStationQueueFixture(
  mode: "uniform" | "clustered",
): Promise<{ dbPath: string; workspace: string; ratedTrackIds: string[]; preferredBucketPrefixes: string[] }> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), `sidflow-station-queue-${mode}-`));
  const dbPath = path.join(workspace, "sidcorr.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE tracks (
      track_id TEXT PRIMARY KEY,
      sid_path TEXT NOT NULL,
      song_index INTEGER NOT NULL,
      vector_json TEXT,
      e INTEGER NOT NULL,
      m INTEGER NOT NULL,
      c INTEGER NOT NULL,
      p INTEGER,
      likes INTEGER NOT NULL DEFAULT 0,
      dislikes INTEGER NOT NULL DEFAULT 0,
      skips INTEGER NOT NULL DEFAULT 0,
      plays INTEGER NOT NULL DEFAULT 0,
      last_played TEXT
    );
  `);
  const insert = db.query(`
    INSERT INTO tracks (track_id, sid_path, song_index, vector_json, e, m, c, p, likes, dislikes, skips, plays, last_played)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const bucketPrefixes = [
    "DEMOS/A-F",
    "DEMOS/G-L",
    "GAMES/A-F",
    "GAMES/G-L",
    "MUSICIANS/A-F",
    "MUSICIANS/G-L",
  ] as const;
  const preferredBucketPrefixes = ["DEMOS/G-L", "GAMES/G-L", "MUSICIANS/G-L"];
  const ratedTrackIds: string[] = [];
  let globalIndex = 1;

  for (const bucketPrefix of bucketPrefixes) {
    for (let trackOffset = 1; trackOffset <= 200; trackOffset += 1) {
      const sidPath = `${bucketPrefix}/song${String(globalIndex).padStart(4, "0")}.sid`;
      const bucketIsPreferred = preferredBucketPrefixes.includes(bucketPrefix);
      const vector = mode === "uniform"
        ? [1, 1, 1]
        : bucketIsPreferred
          ? [0.02, 0.98, Number(((trackOffset % 7) * 0.001).toFixed(3))]
          : [0.98, 0.02, Number(((trackOffset % 7) * 0.001).toFixed(3))];
      const e = bucketIsPreferred ? 2 : 5;
      const m = bucketIsPreferred ? 5 : 2;
      const c = 3;
      const p = bucketIsPreferred ? 5 : 2;
      const trackId = `${sidPath}#1`;
      insert.run(trackId, sidPath, 1, JSON.stringify(vector), e, m, c, p, 0, 0, 0, 1, null);
      await mkdir(path.dirname(path.join(workspace, sidPath)), { recursive: true });
      await writeFile(path.join(workspace, sidPath), "PSID", "utf8");

      if (bucketIsPreferred && ratedTrackIds.length < 10 && trackOffset <= 4) {
        ratedTrackIds.push(trackId);
      }
      if (mode === "uniform" && ratedTrackIds.length < 10 && trackOffset <= 4) {
        ratedTrackIds.push(trackId);
      }
      globalIndex += 1;
    }
  }

  db.close();
  return { dbPath, workspace, ratedTrackIds, preferredBucketPrefixes: [...preferredBucketPrefixes] };
}

function createStationRuntime(workspace: string) {
  return {
    random: (() => {
      const values = [0.91, 0.17, 0.73, 0.29, 0.64, 0.43, 0.87, 0.35];
      let index = 0;
      return () => values[index++ % values.length]!;
    })(),
    parseSidFile: async (filePath: string): Promise<SidFileMetadata> => ({
      type: "PSID",
      version: 2,
      title: path.basename(filePath),
      author: path.dirname(filePath).split(path.sep).slice(-2).join(" / "),
      released: "1989 Test Release",
      songs: 1,
      startSong: 1,
      clock: "PAL",
      sidModel1: "MOS6581",
      loadAddress: 0,
      initAddress: 0,
      playAddress: 0,
    }),
    lookupSongDurationMs: async () => 60_000,
    loadConfig: async () => ({
      sidPath: workspace,
      audioCachePath: workspace,
      tagsPath: workspace,
      classifiedPath: workspace,
      sidplayPath: "/usr/bin/sidplayfp",
      threads: 0,
      classificationDepth: 3,
    }),
    fetchImpl: globalThis.fetch,
    stdout: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    stderr: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    stdin: process.stdin,
    cwd: () => workspace,
    now: () => new Date("2026-03-20T12:00:00.000Z"),
    onSignal: () => undefined,
    offSignal: () => undefined,
  };
}

async function seedStationDemoReleaseCache(
  workspace: string,
  dbPath: string,
  checkedAt: string,
  releaseTag = "sidcorr-hvsc-full-20260315T095426Z",
): Promise<void> {
  const cacheDir = path.join(workspace, "data", "cache", "station-demo", "sidflow-data");
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    path.join(cacheDir, "latest-release.json"),
    JSON.stringify({
      assetName: "hvsc-full-sidcorr-1-20260315T095426Z.tar.gz",
      assetUrl: "https://example.invalid/hvsc-full-sidcorr-1-20260315T095426Z.tar.gz",
      bundleDir: path.join(cacheDir, "releases", releaseTag, "bundle"),
      checkedAt,
      dbPath,
      manifestPath: dbPath.replace(/\.sqlite$/, ".manifest.json"),
      publishedAt: "2026-03-15T09:54:33Z",
      releaseTag,
    }, null, 2),
    "utf8",
  );
}

describe("CLI argument parsing", () => {
  test("parses help flag", () => {
    const result = parsePlayArgs(["--help"]);
    expect(result.helpRequested).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("parses mood option", () => {
    const result = parsePlayArgs(["--mood", "energetic"]);
    expect(result.options.mood).toBe("energetic");
    expect(result.errors).toHaveLength(0);
  });

  test("parses filters option", () => {
    const result = parsePlayArgs(["--filters", "e>=4,m>=3"]);
    expect(result.options.filters).toBe("e>=4,m>=3");
    expect(result.errors).toHaveLength(0);
  });

  test("parses limit option", () => {
    const result = parsePlayArgs(["--limit", "30"]);
    expect(result.options.limit).toBe(30);
    expect(result.errors).toHaveLength(0);
  });

  test("parses exploration option", () => {
    const result = parsePlayArgs(["--exploration", "0.5"]);
    expect(result.options.exploration).toBe(0.5);
    expect(result.errors).toHaveLength(0);
  });

  test("parses diversity option", () => {
    const result = parsePlayArgs(["--diversity", "0.3"]);
    expect(result.options.diversity).toBe(0.3);
    expect(result.errors).toHaveLength(0);
  });

  test("parses export options", () => {
    const result = parsePlayArgs([
      "--export", "playlist.json",
      "--export-format", "json"
    ]);
    expect(result.options.export).toBe("playlist.json");
    expect(result.options.exportFormat).toBe("json");
    expect(result.errors).toHaveLength(0);
  });

  test("parses min-duration option", () => {
    const result = parsePlayArgs(["--min-duration", "30"]);
    expect(result.options.minDuration).toBe(30);
    expect(result.errors).toHaveLength(0);
  });

  test("returns error for invalid min-duration", () => {
    const result = parsePlayArgs(["--min-duration", "0"]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("must be at least 1");
  });

  test("parses export-only flag", () => {
    const result = parsePlayArgs(["--export-only"]);
    expect(result.options.exportOnly).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("parses play-only flag", () => {
    const result = parsePlayArgs(["--play-only"]);
    expect(result.options.playOnly).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("parses multiple options", () => {
    const result = parsePlayArgs([
      "--mood", "energetic",
      "--limit", "50",
      "--exploration", "0.4",
      "--export", "out.json"
    ]);
    expect(result.options.mood).toBe("energetic");
    expect(result.options.limit).toBe(50);
    expect(result.options.exploration).toBe(0.4);
    expect(result.options.export).toBe("out.json");
    expect(result.errors).toHaveLength(0);
  });

  test("returns error for missing option value", () => {
    const result = parsePlayArgs(["--mood"]);
    expect(result.errors).toContain("--mood requires a value");
  });

  test("returns error for invalid limit", () => {
    const result = parsePlayArgs(["--limit", "invalid"]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("must be an integer");
  });

  test("returns error for invalid exploration", () => {
    const result = parsePlayArgs(["--exploration", "2.0"]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("must be at most 1");
  });

  // Note: export-format validation is now done at runtime, not in parseArgs
  test("accepts export format during parsing", () => {
    const result = parsePlayArgs(["--export-format", "invalid"]);
    // The parser accepts it; validation happens later in runPlayCli
    expect(result.options.exportFormat).toBe("invalid");
  });

  test("returns error for unknown option", () => {
    const result = parsePlayArgs(["--unknown"]);
    expect(result.errors).toContain("Unknown option: --unknown");
  });

  test("returns error for unexpected argument", () => {
    const result = parsePlayArgs(["unexpected"]);
    expect(result.errors).toContain("Unexpected argument: unexpected");
  });
});

describe("station demo CLI argument parsing", () => {
  test("parses station demo defaults", () => {
    const result = parseStationArgs([]);
    expect(result.options.playback).toBeUndefined();
    expect(result.options.adventure).toBe(3);
    expect(result.options.forceLocalDb).toBeUndefined();
    expect(result.options.localDb).toBeUndefined();
    expect(result.options.sampleSize).toBe(10);
    expect(result.options.stationSize).toBe(100);
    expect(result.options.minDuration).toBe(15);
    expect(result.errors).toHaveLength(0);
  });

  test("parses local dataset override flags", () => {
    const result = parseStationArgs(["--force-local-db", "--local-db", "custom.sqlite"]);
    expect(result.options.forceLocalDb).toBe(true);
    expect(result.options.localDb).toBe("custom.sqlite");
    expect(result.errors).toHaveLength(0);
  });

  test("rejects invalid adventure during parsing", () => {
    const result = parseStationArgs(["--adventure", "9"]);
    expect(result.errors[0]).toContain("must be at most 5");
  });

  test("rejects invalid min-duration during parsing", () => {
    const result = parseStationArgs(["--min-duration", "0"]);
    expect(result.errors[0]).toContain("must be at least 1");
  });

  test("parses reset-selections flag", () => {
    const result = parseStationArgs(["--reset-selections"]);
    expect(result.options.resetSelections).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("station demo backend queue building", () => {
  it("builds a random-rating station across collection buckets instead of collapsing into early alphabetical paths", async () => {
    const fixture = await createLargeStationQueueFixture("uniform");
    const ratings = new Map(fixture.ratedTrackIds.map((trackId, index) => [trackId, (index % 6)]));

    const queue = await __stationDemoTestUtils.buildStationQueue(
      fixture.dbPath,
      fixture.workspace,
      ratings,
      100,
      3,
      15,
      createStationRuntime(fixture.workspace),
      new Map(),
    );

    expect(queue).toHaveLength(100);
    const firstThirtyBuckets = new Set(queue.slice(0, 30).map((track) => __stationDemoTestUtils.deriveStationBucketKey(track.sid_path)));
    expect(firstThirtyBuckets.size).toBeGreaterThanOrEqual(4);
    const sortedPaths = [...queue].map((track) => track.sid_path).sort();
    expect(queue.map((track) => track.sid_path)).not.toEqual(sortedPaths);
    const topLevelRoots = new Set(queue.map((track) => track.sid_path.split("/")[0]));
    expect(topLevelRoots.size).toBeGreaterThanOrEqual(2);
  });

  it("keeps recommendations aligned with the preferred classification cluster without reverting to alphabetical order", async () => {
    const fixture = await createLargeStationQueueFixture("clustered");
    const ratings = new Map(fixture.ratedTrackIds.map((trackId, index) => [trackId, index % 2 === 0 ? 5 : 4]));

    const queue = await __stationDemoTestUtils.buildStationQueue(
      fixture.dbPath,
      fixture.workspace,
      ratings,
      100,
      3,
      15,
      createStationRuntime(fixture.workspace),
      new Map(),
    );

    expect(queue).toHaveLength(100);
    const preferredTracks = queue.filter((track) => fixture.preferredBucketPrefixes.some((prefix) => track.sid_path.startsWith(prefix)));
    expect(preferredTracks.length).toBeGreaterThanOrEqual(80);
    const preferredBuckets = new Set(preferredTracks.slice(0, 30).map((track) => __stationDemoTestUtils.deriveStationBucketKey(track.sid_path)));
    expect(preferredBuckets.size).toBeGreaterThanOrEqual(3);
    const sortedPreferredPaths = [...preferredTracks].map((track) => track.sid_path).sort();
    expect(preferredTracks.map((track) => track.sid_path)).not.toEqual(sortedPreferredPaths);
  });
});

describe("runPlayCli", () => {
  it("runs full playback flow with overrides", async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    });

    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        stderrChunks.push(chunk.toString());
        callback();
      }
    });

    let builderConnected = false;
    let builderDisconnected = false;
    let exportInvocation: { format: string; path: string } | null = null;
    const registeredHandlers: Array<() => void> = [];
    const sleepCalls: number[] = [];
    const recordedEvents: PlaybackEvent[] = [];
    let sessionStarts = 0;
    let sessionEnds = 0;

    const config = {
      sidPath: "/music",
      audioCachePath: "/wav",
      tagsPath: "/tags",
      threads: 4,
      classificationDepth: 2
    };

    const song: Recommendation = {
      sid_path: "relative/song.sid",
      score: 0.9,
      similarity: 0.85,
      songFeedback: 0.2,
      userAffinity: 0.3,
      ratings: { e: 3, m: 3, c: 3 },
      feedback: { likes: 1, dislikes: 0, skips: 0, plays: 1 }
    };

    const playlist: Playlist = {
      metadata: {
        createdAt: new Date().toISOString(),
        seed: "quiet",
        count: 1,
        filters: { energyRange: [4, 5] }
      },
      songs: [song]
    };

    const exitCode = await runPlayCli(
      [
        "--mood",
        "quiet",
        "--limit",
        "10",
        "--filters",
        "e>=4",
        "--export",
        "/tmp/list.json",
        "--export-format",
        "json"
      ],
      {
        stdout,
        stderr,
        loadConfig: async () => config,
        cwd: () => "/workspace",
        stat: async (_path: string) => ({}) as Stats,
        parseFilters: (expression: string) => {
          expect(expression).toBe("e>=4");
          return { energyRange: [4, 5] };
        },
        createPlaylistBuilder: () => ({
          connect: async () => {
            builderConnected = true;
          },
          build: async (buildConfig: PlaylistConfig) => {
            expect(buildConfig.seed).toBe("quiet");
            expect(buildConfig.limit).toBe(10);
            expect(buildConfig.filters?.energyRange).toEqual([4, 5]);
            return playlist;
          },
          disconnect: async () => {
            builderDisconnected = true;
          }
        }),
        createSessionManager: () => ({
          startSession: async () => {
            sessionStarts += 1;
          },
          recordEvent: (event: PlaybackEvent) => {
            recordedEvents.push(event);
          },
          endSession: async () => {
            sessionEnds += 1;
          }
        }),
        createPlaybackController: (options: PlaybackOptions) => {
          let state: PlaybackState = PlaybackState.IDLE;
          let queue: Recommendation[] = [];

          return {
            loadQueue: (songs: Recommendation[]) => {
              queue = songs;
            },
            play: async () => {
              state = PlaybackState.PLAYING;
              const current = queue[0];
              options.onEvent?.({ type: "started", song: current } as PlaybackEvent);
              options.onEvent?.({ type: "finished", song: current } as PlaybackEvent);
              state = PlaybackState.IDLE;
              for (const handler of registeredHandlers) {
                handler();
              }
            },
            stop: async () => {
              state = PlaybackState.IDLE;
            },
            getState: () => state
          };
        },
        exportPlaylist: async (value, descriptor) => {
          expect(value.songs).toHaveLength(1);
          exportInvocation = { format: descriptor.format, path: descriptor.outputPath };
        },
        onSignal: (_signal, handler) => {
          registeredHandlers.push(handler);
        },
        offSignal: (_signal, handler) => {
          const index = registeredHandlers.indexOf(handler);
          if (index >= 0) {
            registeredHandlers.splice(index, 1);
          }
        },
        sleep: async (ms: number) => {
          sleepCalls.push(ms);
        }
      }
    );

    expect(exitCode).toBe(0);
    expect(builderConnected).toBe(true);
    expect(builderDisconnected).toBe(true);
    expect(exportInvocation).not.toBeNull();
    const invocation = exportInvocation!;
    expect(invocation).toEqual({ format: "json", path: "/tmp/list.json" });
    expect(sessionStarts).toBe(1);
    expect(sessionEnds).toBeGreaterThanOrEqual(1);
    expect(recordedEvents.some((event) => event.type === "started")).toBe(true);
    expect(stdoutChunks.join("\n")).toContain("Generating playlist");
    expect(stdoutChunks.join("\n")).toContain("Starting playback");
    expect(stdoutChunks.join("\n")).toContain("Stopping playback");
    expect(sleepCalls).toHaveLength(0);
  });

  it("handles export-only mode without playback", async () => {
    let playInvoked = false;

    const stdout = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    });

    const exitCode = await runPlayCli([
      "--export",
      "/tmp/list.json",
      "--export-only"
    ], {
      stdout,
      loadConfig: async () => ({
        sidPath: "/music",
        audioCachePath: "/wav",
        tagsPath: "/tags",
        threads: 2,
        classificationDepth: 1
      }),
      cwd: () => "/workspace",
      stat: async (_path: string) => ({}) as Stats,
      parseFilters: () => ({}),
      createPlaylistBuilder: () => ({
        connect: async () => undefined,
        build: async (_config: PlaylistConfig) => ({
          metadata: {
            createdAt: new Date().toISOString(),
            seed: "ambient",
            count: 0
          },
          songs: []
        } satisfies Playlist),
        disconnect: async () => undefined
      }),
      exportPlaylist: async () => undefined,
      createSessionManager: () => ({
        startSession: async () => undefined,
        recordEvent: () => undefined,
        endSession: async () => undefined
      }),
      createPlaybackController: () => ({
        loadQueue: (_songs: Recommendation[]) => undefined,
        play: async () => {
          playInvoked = true;
        },
        stop: async () => undefined,
        getState: () => PlaybackState.IDLE
      }),
      onSignal: () => undefined,
      offSignal: () => undefined,
      sleep: async () => undefined
    });

    expect(exitCode).toBe(0);
    expect(playInvoked).toBe(false);
  });

  it("reports unknown mood presets", async () => {
    const errors: string[] = [];
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        errors.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runPlayCli(["--mood", "unknown"], {
      stderr,
      loadConfig: async () => ({
        sidPath: "/music",
        audioCachePath: "/wav",
        tagsPath: "/tags",
        threads: 2,
        classificationDepth: 1
      }),
      cwd: () => "/workspace",
      stat: async (_path: string) => ({}) as Stats,
      parseFilters: () => ({}),
      createPlaylistBuilder: () => ({
        connect: async () => undefined,
        build: async () => {
          throw new Error("should not build");
        },
        disconnect: async () => undefined
      }),
      createSessionManager: () => ({
        startSession: async () => undefined,
        recordEvent: () => undefined,
        endSession: async () => undefined
      }),
      createPlaybackController: () => ({
        loadQueue: (_songs: Recommendation[]) => undefined,
        play: async () => undefined,
        stop: async () => undefined,
        getState: () => PlaybackState.IDLE
      }),
      onSignal: () => undefined,
      offSignal: () => undefined,
      sleep: async () => undefined
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("Unknown mood preset");
  });

  it("reports database missing errors", async () => {
    const errors: string[] = [];
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        errors.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runPlayCli([], {
      stderr,
      loadConfig: async () => ({
        sidPath: "/music",
        audioCachePath: "/wav",
        tagsPath: "/tags",
        threads: 2,
        classificationDepth: 1
      }),
      cwd: () => "/workspace",
      stat: async (_path: string) => {
        throw new Error("missing");
      },
      parseFilters: () => ({}),
      createPlaylistBuilder: () => ({
        connect: async () => undefined,
        build: async (_config: PlaylistConfig) => ({
          metadata: {
            createdAt: new Date().toISOString(),
            seed: "ambient",
            count: 0
          },
          songs: []
        } satisfies Playlist),
        disconnect: async () => undefined
      }),
      createSessionManager: () => ({
        startSession: async () => undefined,
        recordEvent: () => undefined,
        endSession: async () => undefined
      }),
      createPlaybackController: () => ({
        loadQueue: (_songs: Recommendation[]) => undefined,
        play: async () => undefined,
        stop: async () => undefined,
        getState: () => PlaybackState.IDLE
      }),
      onSignal: () => undefined,
      offSignal: () => undefined,
      sleep: async () => undefined
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("LanceDB database not found");
  });

  it("handles filter parsing errors", async () => {
    const errors: string[] = [];
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        errors.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runPlayCli(["--filters", "invalid"], {
      stderr,
      loadConfig: async () => ({
        sidPath: "/music",
        audioCachePath: "/wav",
        tagsPath: "/tags",
        threads: 2,
        classificationDepth: 1
      }),
      cwd: () => "/workspace",
      stat: async (_path: string) => ({}) as Stats,
      parseFilters: () => {
        throw new Error("bad filters");
      },
      createPlaylistBuilder: () => ({
        connect: async () => undefined,
        build: async (_config: PlaylistConfig) => ({
          metadata: {
            createdAt: new Date().toISOString(),
            seed: "ambient",
            count: 0
          },
          songs: []
        } satisfies Playlist),
        disconnect: async () => undefined
      }),
      createSessionManager: () => ({
        startSession: async () => undefined,
        recordEvent: () => undefined,
        endSession: async () => undefined
      }),
      createPlaybackController: () => ({
        loadQueue: (_songs: Recommendation[]) => undefined,
        play: async () => undefined,
        stop: async () => undefined,
        getState: () => PlaybackState.IDLE
      }),
      onSignal: () => undefined,
      offSignal: () => undefined,
      sleep: async () => undefined
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("bad filters");
  });

  it("prints help when requested", async () => {
    const captured: string[] = [];
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        captured.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runPlayCli(["--help"], { stdout });

    expect(exitCode).toBe(0);
    expect(captured.join("")).toContain("Usage: sidflow-play");
  });

  it("reports argument parsing errors", async () => {
    const errors: string[] = [];
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        errors.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runPlayCli(["--limit", "0"], { stderr });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("--limit must be a positive number");
  });

  it("reports invalid export format at runtime", async () => {
    const errors: string[] = [];
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        errors.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runPlayCli(["--export-format", "invalid"], {
      stderr,
      loadConfig: async () => ({
        sidPath: "/music",
        audioCachePath: "/wav",
        tagsPath: "/tags",
        threads: 2,
        classificationDepth: 1
      })
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("must be json, m3u, or m3u8");
  });

  it("runs the station demo against the exported sqlite without playback", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    });

    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        stderrChunks.push(chunk.toString());
        callback();
      }
    });

    const answers = ["5", "5", "4", "4", "5", "4", "5", "4", "5", "4", "right", "q"];
    const exitCode = await runStationCli(
      [
        "--db", fixture.dbPath,
        "--hvsc", fixture.workspace,
        "--playback", "none",
        "--sample-size", "10",
        "--station-size", "2",
        "--adventure", "2",
      ],
      {
        stdout,
        stderr,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => answers.shift() ?? "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async (filePath: string) => filePath.includes("song8.sid") ? 10_000 : 123_000,
      },
    );

    expect(exitCode).toBe(0);
    expect(stderrChunks.join("")).toBe("");
    const output = stdoutChunks.join("");
    expect(output).toContain("SID Flow Station  |  C64U Live");
    expect(output).toContain("Now Playing");
    expect(output).toContain("Playlist Window");
    expect(output).toContain("[Filter] none");
    expect(output).toContain("Browse    PgUp/PgDn page   ↑/↓ step   Enter on live track = no-op");
    expect(output).toContain("Flow is sequenced by simila");
    expect(output).not.toContain("song8.sid");
  });

  it("sizes the playlist window to the available terminal height", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const stdout = Object.assign(new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    }), { rows: 40, columns: 140 });
    const answers = ["5", "5", "4", "4", "5", "4", "5", "4", "5", "4", "q"];

    const exitCode = await runStationCli(
      ["--db", fixture.dbPath, "--hvsc", fixture.workspace, "--playback", "none", "--sample-size", "10"],
      {
        stdout,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => answers.shift() ?? "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 123_000,
      },
    );

    expect(exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("Playlist Window (12 visible)");
    expect(output).toContain("012/100");
  });

  it("keeps station redraws within the terminal height and uses distinct green highlights", () => {
    const queue = Array.from({ length: 20 }, (_, index) => ({
      track_id: `track-${index + 1}`,
      sid_path: `A/song${index + 1}.sid`,
      song_index: 1,
      e: 4,
      m: 4,
      c: 3,
      p: 4,
      likes: 0,
      dislikes: 0,
      skips: 0,
      plays: 1,
      last_played: null,
      absolutePath: `/tmp/song${index + 1}.sid`,
      title: `Song ${index + 1}`,
      author: "Test Composer",
      released: "1989 Test Release",
      durationMs: 60_000,
    }));

    const screen = __stationDemoTestUtils.renderStationScreen(
      {
        phase: "station",
        current: queue[0]!,
        index: 0,
        selectedIndex: 1,
        playlistWindowStart: 0,
        total: queue.length,
        ratedCount: 10,
        ratedTarget: 10,
        ratings: new Map([[queue[0]!.track_id, 5]]),
        playbackMode: "local",
        adventure: 3,
        dataSource: "test dataset",
        dbPath: "/tmp/test.sqlite",
        queue,
        currentRating: 5,
        minDurationSeconds: 15,
        elapsedMs: 5_000,
        durationMs: 60_000,
        playlistElapsedMs: 5_000,
        playlistDurationMs: 60_000 * queue.length,
        statusLine: "Station ready.",
      },
      true,
      120,
      32,
    );

    expect(screen.split("\n").length).toBeLessThanOrEqual(32);
    expect(screen).toContain(`${String.fromCharCode(27)}[92m001/020  ►`);
    expect(screen).toContain(`${String.fromCharCode(27)}[7m`);
    expect(screen).toContain("[★★★★★]");
    expect(screen).toContain("[☆☆☆☆☆]");
    expect(screen).toContain("Playlist Window (4 visible)");
    expect(screen).toContain("[Filter]");
    expect(screen).toContain("none");
  });

  it("skips to the next song without rebuilding when a playing track is disliked", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const actions = ["5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "s", "q"];
    const playbackEvents: string[] = [];

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runStationCli(
      [
        "--db", fixture.dbPath,
        "--hvsc", fixture.workspace,
        "--playback", "none",
        "--sample-size", "10",
      ],
      {
        stdout,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        createPlaybackAdapter: async () => ({
          start: async (track) => {
            playbackEvents.push(`start:${track.track_id}`);
          },
          stop: async () => {
            playbackEvents.push("stop");
          },
          pause: async () => undefined,
          resume: async () => undefined,
        }),
        prompt: async () => actions.shift() ?? "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 60_000,
      },
    );

    expect(exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("Skipped current track. Queue unchanged. Press g to rebuild recommendations.");
    const stationStarts = playbackEvents.filter((event) => event.startsWith("start:")).slice(-2);
    expect(stationStarts).toHaveLength(2);
    expect(stationStarts[0]).not.toBe(stationStarts[1]);
    expect(playbackEvents).toContain("stop");
  });

  it("reuses a fresh sidflow-data cache without checking GitHub again", async () => {
    const fixture = await createStationDemoFixture();
    await writeFile(fixture.dbPath.replace(/\.sqlite$/, ".manifest.json"), "{}", "utf8");
    await seedStationDemoReleaseCache(fixture.workspace, fixture.dbPath, "2026-03-20T12:00:00.000Z");
    const stdoutChunks: string[] = [];
    let fetchCalls = 0;

    const exitCode = await runStationCli(
      ["--hvsc", fixture.workspace, "--playback", "none"],
      {
        stdout: new Writable({
          write(chunk, _encoding, callback) {
            stdoutChunks.push(chunk.toString());
            callback();
          }
        }),
        cwd: () => fixture.workspace,
        now: () => new Date("2026-03-20T18:00:00.000Z"),
        fetchImpl: (async () => {
          fetchCalls += 1;
          throw new Error("network should not be touched when the cache is fresh");
        }) as unknown as typeof fetch,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 123_000,
      },
    );

    expect(exitCode).toBe(0);
    expect(fetchCalls).toBe(0);
    expect(stdoutChunks.join("")).toContain("SID Flow Station  |  C64U Live");
  });

  it("checks sidflow-data once per week and keeps the cached bundle when the latest tag is unchanged", async () => {
    const fixture = await createStationDemoFixture();
    await writeFile(fixture.dbPath.replace(/\.sqlite$/, ".manifest.json"), "{}", "utf8");
    await seedStationDemoReleaseCache(fixture.workspace, fixture.dbPath, "2026-03-10T09:00:00.000Z");
    const stdoutChunks: string[] = [];
    let latestReleaseChecks = 0;
    let assetDownloads = 0;

    const exitCode = await runStationCli(
      ["--hvsc", fixture.workspace, "--playback", "none"],
      {
        stdout: new Writable({
          write(chunk, _encoding, callback) {
            stdoutChunks.push(chunk.toString());
            callback();
          }
        }),
        cwd: () => fixture.workspace,
        now: () => new Date("2026-03-20T18:00:00.000Z"),
        fetchImpl: (async (url: string | URL | Request) => {
          const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
          if (href.endsWith("/releases/latest")) {
            latestReleaseChecks += 1;
            return new Response(JSON.stringify({
              tag_name: "sidcorr-hvsc-full-20260315T095426Z",
              published_at: "2026-03-15T09:54:33Z",
              assets: [
                {
                  name: "hvsc-full-sidcorr-1-20260315T095426Z.tar.gz",
                  browser_download_url: "https://example.invalid/hvsc-full-sidcorr-1-20260315T095426Z.tar.gz",
                },
              ],
            }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          assetDownloads += 1;
          throw new Error(`unexpected download ${href}`);
        }) as typeof fetch,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 123_000,
      },
    );

    expect(exitCode).toBe(0);
    expect(latestReleaseChecks).toBe(1);
    expect(assetDownloads).toBe(0);
    expect(stdoutChunks.join("")).toContain("SID Flow Station  |  C64U Live");
  });

  it("uses an explicit local database override without touching sidflow-data", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const explicitLocalDb = path.join(fixture.workspace, "custom", "override.sqlite");
    await mkdir(path.dirname(explicitLocalDb), { recursive: true });
    await copyFile(fixture.dbPath, explicitLocalDb);

    let fetchCalls = 0;
    const exitCode = await runStationCli(
      ["--local-db", explicitLocalDb, "--hvsc", fixture.workspace, "--playback", "none"],
      {
        stdout: new Writable({
          write(chunk, _encoding, callback) {
            stdoutChunks.push(chunk.toString());
            callback();
          }
        }),
        cwd: () => fixture.workspace,
        fetchImpl: (async () => {
          fetchCalls += 1;
          throw new Error("explicit local DB should bypass sidflow-data");
        }) as unknown as typeof fetch,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 123_000,
      },
    );

    expect(exitCode).toBe(0);
    expect(fetchCalls).toBe(0);
    expect(stdoutChunks.join("")).toContain("SID Flow Station  |  C64U Live");
  });

  it("refreshes the remaining queue only when explicitly requested", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const answers = ["5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "right", "g", "q"];
    const playbackEvents: string[] = [];

    const exitCode = await runStationCli(
      ["--db", fixture.dbPath, "--hvsc", fixture.workspace, "--playback", "none", "--sample-size", "10"],
      {
        stdout: new Writable({
          write(chunk, _encoding, callback) {
            stdoutChunks.push(chunk.toString());
            callback();
          }
        }),
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        createPlaybackAdapter: async () => ({
          start: async (track) => {
            playbackEvents.push(`start:${track.track_id}`);
          },
          stop: async () => {
            playbackEvents.push("stop");
          },
          pause: async () => undefined,
          resume: async () => undefined,
        }),
        prompt: async () => answers.shift() ?? "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 123_000,
      },
    );

    expect(exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("Moved to the next station track.");
    expect(output).toContain("Refreshed queue from 10 ratings; live track pinned at 2/100");
    expect(playbackEvents.filter((event) => event.startsWith("start:")).slice(-2)).toHaveLength(2);
  });

  it("supports like and dislike shortcuts while songs are playing", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const answers = ["l", "d", "5", "5", "5", "5", "5", "5", "5", "5", "5", "s", "q"];

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runStationCli(
      [
        "--db", fixture.dbPath,
        "--hvsc", fixture.workspace,
        "--playback", "none",
        "--sample-size", "10",
        "--station-size", "2",
      ],
      {
        stdout,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => answers.shift() ?? "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 60_000,
      },
    );

    expect(exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("Rate      0-5 rate   l like   d dislike   s skip");
    expect(output).toContain("Liked current track. Queue unchanged. Press g to rebuild recommendations.");
    expect(output).toContain("Disliked ");
    expect(output).toContain("Skipped current track. Queue unchanged. Press g to rebuild recommendations.");
  });

  it("treats next navigation as unrated movement", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const answers = ["5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "right", "q"];

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runStationCli(
      [
        "--db", fixture.dbPath,
        "--hvsc", fixture.workspace,
        "--playback", "none",
        "--sample-size", "10",
        "--station-size", "2",
      ],
      {
        stdout,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => answers.shift() ?? "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 60_000,
      },
    );

    expect(exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("Moved to the next station track.");
    expect(output).not.toContain("Disliked this track");
  });

  it("supports browse-only navigation plus play-selected and pause/resume", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const actions = ["5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "down", "down", "enter", "space", "space", "q"];
    const playbackEvents: string[] = [];

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runStationCli(
      [
        "--db", fixture.dbPath,
        "--hvsc", fixture.workspace,
        "--playback", "none",
        "--sample-size", "10",
      ],
      {
        stdout,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        createPlaybackAdapter: async () => ({
          start: async (track) => {
            playbackEvents.push(`start:${track.sid_path}`);
          },
          stop: async () => {
            playbackEvents.push("stop");
          },
          pause: async () => {
            playbackEvents.push("pause");
          },
          resume: async () => {
            playbackEvents.push("resume");
          },
        }),
        prompt: async () => actions.shift() ?? "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 60_000,
      },
    );

    expect(exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("Selected track 2/100 without interrupting playback.");
    expect(output).toContain("Selected 3/100:");
    expect(output).toContain("Started selected track 3/100.");
    expect(output).toContain("001/100  ► [");
    expect(output).toContain("002/100    [");
    expect(output).toContain("Paused ");
    expect(output).toContain("Resumed ");
    expect(playbackEvents).toContain("pause");
    expect(playbackEvents).toContain("resume");
  });

  it("filters the playlist by title or artist from the dedicated filter command", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    // Filter by "galway" — only tracks in group E/ get "Martin Galway";
    // all others get "Rob Hubbard", so non-matching tracks exist in the queue.
    const actions = ["5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "/", "galway", "q"];

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runStationCli(
      [
        "--db", fixture.dbPath,
        "--hvsc", fixture.workspace,
        "--playback", "none",
        "--sample-size", "10",
      ],
      {
        stdout,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => actions.shift() ?? "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          // Tracks in E/ get "Martin Galway"; everything else gets "Rob Hubbard"
          author: filePath.includes("/E/") || filePath.includes("\\E\\") ? "Martin Galway" : "Rob Hubbard",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 60_000,
      },
    );

    expect(exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("/ text");
    expect(output).toContain("Text filter \"galway\"");
    expect(output).toContain("[Filter]");
    expect(output).toContain('text="galway"');
    expect(output).toContain("Playlist Window");
    expect(output).toMatch(/text="galway"/);
    expect(output).toMatch(/\d+\/\d+/);
  });

  it("filters the playlist by minimum star rating from the dedicated star command", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const actions = ["5", "4", "3", "2", "1", "5", "4", "3", "2", "1", "*", "4", "q"];

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runStationCli(
      [
        "--db", fixture.dbPath,
        "--hvsc", fixture.workspace,
        "--playback", "none",
        "--sample-size", "10",
      ],
      {
        stdout,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => actions.shift() ?? "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 60_000,
      },
    );

    expect(exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("* stars");
    expect(output).toContain("[Filter]");
    expect(output).toContain("★≥4");
    expect(output).toContain("No matches for stars 4+. Esc clears.");
    expect(output).toContain("0/100");
  });

  it("reuses persisted station selections and skips seed capture by default", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const selectionStatePath = __stationDemoTestUtils.buildSelectionStatePath(
      fixture.workspace,
      fixture.dbPath,
      fixture.workspace,
    );
    const persistedRatings = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`A/song${index + 1}.sid#1`, 5]),
    );

    await mkdir(path.dirname(selectionStatePath), { recursive: true });
    await writeFile(
      selectionStatePath,
      JSON.stringify({
        dbPath: fixture.dbPath,
        hvscRoot: fixture.workspace,
        ratedTarget: 10,
        ratings: persistedRatings,
        savedAt: "2026-03-20T12:00:00.000Z",
      }),
      "utf8",
    );

    const exitCode = await runStationCli(
      ["--db", fixture.dbPath, "--hvsc", fixture.workspace, "--playback", "none", "--sample-size", "10"],
      {
        stdout: new Writable({
          write(chunk, _encoding, callback) {
            stdoutChunks.push(chunk.toString());
            callback();
          }
        }),
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 60_000,
      },
    );

    expect(exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("Reused 10 persisted ratings. Station ready immediately");
    expect(output).not.toContain("Seed 1");
    expect(output).toContain("Now Playing");
  });

  it("resets persisted station selections when explicitly requested", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const selectionStatePath = __stationDemoTestUtils.buildSelectionStatePath(
      fixture.workspace,
      fixture.dbPath,
      fixture.workspace,
    );

    await mkdir(path.dirname(selectionStatePath), { recursive: true });
    await writeFile(
      selectionStatePath,
      JSON.stringify({
        dbPath: fixture.dbPath,
        hvscRoot: fixture.workspace,
        ratedTarget: 10,
        ratings: { "A/song1.sid#1": 5, "A/song2.sid#1": 5 },
        savedAt: "2026-03-20T12:00:00.000Z",
      }),
      "utf8",
    );

    const exitCode = await runStationCli(
      ["--db", fixture.dbPath, "--hvsc", fixture.workspace, "--playback", "none", "--reset-selections"],
      {
        stdout: new Writable({
          write(chunk, _encoding, callback) {
            stdoutChunks.push(chunk.toString());
            callback();
          }
        }),
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 60_000,
      },
    );

    expect(exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("Cleared persisted ratings. Keep rating until the target is reached.");
    expect(output).toContain("Now Playing");
    const persistedContent = await readFile(selectionStatePath, "utf8").catch(() => "");
    expect(persistedContent).toBe("");
  });

  it("captures and restores Ultimate64 SID volumes around pause and resume", async () => {
    const fixture = await createStationDemoFixture();
    const actions = ["5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "space", "space", "q"];
    const fetchCalls: Array<{ url: string; method: string; body?: Uint8Array }> = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      const body = init?.body instanceof Uint8Array ? init.body : undefined;
      fetchCalls.push({ url, method, body });

      if (url.includes(":readmem")) {
        const address = new URL(url).searchParams.get("address");
        const values: Record<string, number> = {
          D418: 0x1f,
          D438: 0x2d,
          D458: 0x3a,
        };
        return new Response(Uint8Array.from([values[address ?? "D418"] ?? 0x0f]), { status: 200 });
      }

      return new Response(JSON.stringify({ errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const exitCode = await runStationCli(
        [
          "--db", fixture.dbPath,
          "--hvsc", fixture.workspace,
          "--playback", "c64u",
          "--c64u-host", "192.168.1.13",
          "--sample-size", "10",
          "--station-size", "2",
        ],
        {
          cwd: () => fixture.workspace,
          loadConfig: async () => ({
            sidPath: fixture.workspace,
            audioCachePath: fixture.workspace,
            tagsPath: fixture.workspace,
            classifiedPath: fixture.workspace,
            sidplayPath: "/usr/bin/sidplayfp",
            threads: 0,
            classificationDepth: 3,
          }),
          prompt: async () => actions.shift() ?? "q",
          random: () => 0,
          parseSidFile: async (filePath: string) => ({
            type: "PSID",
            version: 2,
            title: path.basename(filePath),
            author: "Test Composer",
            released: "1989 Test Release",
            songs: 1,
            startSong: 1,
            clock: "PAL",
            sidModel1: "MOS6581",
            loadAddress: 0,
            initAddress: 0,
            playAddress: 0,
          }),
          lookupSongDurationMs: async () => 60_000,
        },
      );

      expect(exitCode).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const writeMemBodies = fetchCalls
      .filter((call) => call.url.includes(":writemem"))
      .map((call) => Array.from(call.body ?? new Uint8Array()));
    expect(fetchCalls.filter((call) => call.url.includes(":readmem"))).toHaveLength(3);
    expect(fetchCalls.some((call) => call.url.includes(":pause"))).toBe(true);
    expect(fetchCalls.some((call) => call.url.includes(":resume"))).toBe(true);
    expect(writeMemBodies).toContainEqual([0x10]);
    expect(writeMemBodies).toContainEqual([0x20]);
    expect(writeMemBodies).toContainEqual([0x30]);
    expect(writeMemBodies).toContainEqual([0x1f]);
    expect(writeMemBodies).toContainEqual([0x2d]);
    expect(writeMemBodies).toContainEqual([0x3a]);
  });

  it("shuffles the playlist around the current song without restarting playback", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const actions = ["5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "h", "q"];
    const playbackEvents: string[] = [];

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runStationCli(
      [
        "--db", fixture.dbPath,
        "--hvsc", fixture.workspace,
        "--playback", "none",
        "--sample-size", "10",
      ],
      {
        stdout,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        createPlaybackAdapter: async () => ({
          start: async (track) => {
            playbackEvents.push(`start:${track.sid_path}`);
          },
          stop: async () => {
            playbackEvents.push("stop");
          },
          pause: async () => undefined,
          resume: async () => undefined,
        }),
        prompt: async () => actions.shift() ?? "q",
        random: (() => {
          const values = [0.8, 0.2, 0.7, 0.1, 0.6];
          let index = 0;
          return () => values[index++ % values.length]!;
        })(),
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 60_000,
      },
    );

    expect(exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("Reshuffled the current playlist without changing its songs.");
    expect(playbackEvents.filter((event) => event.startsWith("start:"))).toHaveLength(11);
  });

  it("keeps asking for seeds until 10 songs are actually rated", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const answers = ["s", "5", "s", "5", "5", "5", "5", "5", "5", "5", "5", "5", "right", "q"];

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runStationCli(
      [
        "--db", fixture.dbPath,
        "--hvsc", fixture.workspace,
        "--playback", "none",
        "--sample-size", "10",
        "--station-size", "2",
      ],
      {
        stdout,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => answers.shift() ?? "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 60_000,
      },
    );

    expect(exitCode).toBe(0);
    const output = stdoutChunks.join("");
    expect(output).toContain("Station ready from 10 ratings");
    expect(output).toContain("Skipped. It does not count toward the station target.");
  });

  it("fails when too few tracks satisfy the minimum duration gate", async () => {
    const fixture = await createStationDemoFixture();
    const stderrChunks: string[] = [];
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        stderrChunks.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runStationCli(
      [
        "--db", fixture.dbPath,
        "--hvsc", fixture.workspace,
        "--playback", "none",
        "--sample-size", "10",
        "--min-duration", "15",
      ],
      {
        stderr,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => "q",
        random: () => 0,
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 10_000,
      },
    );

    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("satisfy the 15s minimum");
  });

  it("fails clearly on legacy similarity exports without track identity columns", async () => {
    const fixture = await createStationDemoFixture();
    const legacyDbPath = path.join(fixture.workspace, "legacy.sqlite");
    const legacyDb = new Database(legacyDbPath);
    legacyDb.exec(`
      CREATE TABLE tracks (
        sid_path TEXT PRIMARY KEY,
        vector_json TEXT,
        e REAL NOT NULL,
        m REAL NOT NULL,
        c REAL NOT NULL,
        p REAL
      );
    `);
    legacyDb.close();

    const stderrChunks: string[] = [];
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        stderrChunks.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runStationCli(
      ["--db", legacyDbPath, "--hvsc", fixture.workspace, "--playback", "none"],
      {
        stderr,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => "q",
      },
    );

    expect(exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("older similarity export schema");
  });

  it("infers c64u playback when a c64u host is supplied", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const answers = ["5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "q"];

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutChunks.push(chunk.toString());
        callback();
      }
    });

    const exitCode = await runStationCli(
      [
        "--db", fixture.dbPath,
        "--hvsc", fixture.workspace,
        "--c64u-host", "192.168.1.13",
        "--sample-size", "10",
        "--station-size", "1",
      ],
      {
        stdout,
        cwd: () => fixture.workspace,
        loadConfig: async () => ({
          sidPath: fixture.workspace,
          audioCachePath: fixture.workspace,
          tagsPath: fixture.workspace,
          classifiedPath: fixture.workspace,
          sidplayPath: "/usr/bin/sidplayfp",
          threads: 0,
          classificationDepth: 3,
        }),
        prompt: async () => answers.shift() ?? "q",
        random: () => 0,
        createPlaybackAdapter: async (mode) => {
          expect(mode).toBe("c64u");
          return {
            start: async () => undefined,
            stop: async () => undefined,
            pause: async () => undefined,
            resume: async () => undefined,
          };
        },
        parseSidFile: async (filePath: string) => ({
          type: "PSID",
          version: 2,
          title: path.basename(filePath),
          author: "Test Composer",
          released: "1989 Test Release",
          songs: 1,
          startSong: 1,
          clock: "PAL",
          sidModel1: "MOS6581",
          loadAddress: 0,
          initAddress: 0,
          playAddress: 0,
        }),
        lookupSongDurationMs: async () => 30_000,
      },
    );

    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Filter unit tests — track matching, index computation, and screen rendering
// ---------------------------------------------------------------------------

function makeTrack(overrides: Partial<{
  track_id: string;
  sid_path: string;
  title: string;
  author: string;
  released: string;
  durationMs: number;
}> = {}) {
  return {
    track_id: overrides.track_id ?? "test-track",
    sid_path: overrides.sid_path ?? "A/test.sid",
    song_index: 1,
    e: 4,
    m: 4,
    c: 3,
    p: 4,
    likes: 0,
    dislikes: 0,
    skips: 0,
    plays: 1,
    last_played: null,
    absolutePath: `/tmp/${overrides.track_id ?? "test"}.sid`,
    title: overrides.title ?? "Test Song",
    author: overrides.author ?? "Test Composer",
    released: overrides.released ?? "1989",
    durationMs: overrides.durationMs ?? 60_000,
  };
}

function extractPlaylistWindowRows(screen: string, count: number): string[] {
  const lines = screen.split("\n");
  const headerIndex = lines.findIndex((line) => line.includes("Playlist Window"));
  if (headerIndex < 0) {
    return [];
  }
  return lines.slice(headerIndex + 1, headerIndex + 1 + count);
}

describe("station rating formatting", () => {
  test("normalizeRating clamps invalid inputs", () => {
    expect(normalizeRating(undefined)).toBe(0);
    expect(normalizeRating(null)).toBe(0);
    expect(normalizeRating(-3)).toBe(0);
    expect(normalizeRating(2.9)).toBe(2);
    expect(normalizeRating(5)).toBe(5);
    expect(normalizeRating(11)).toBe(5);
    expect(normalizeRating(Number.NaN)).toBe(0);
  });

  test("renderStars returns exact fixed-width strings for 0 through 5", () => {
    expect([0, 1, 2, 3, 4, 5].map((rating) => renderStars(rating))).toEqual([
      "[☆☆☆☆☆]",
      "[★☆☆☆☆]",
      "[★★☆☆☆]",
      "[★★★☆☆]",
      "[★★★★☆]",
      "[★★★★★]",
    ]);
  });

  test("renderStars keeps a constant width for random ratings", () => {
    let seed = 0x5eed1234;
    for (let index = 0; index < 512; index += 1) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const raw = (seed / 0x100000000) * 30 - 10;
      const stars = renderStars(raw);
      expect(stars.length).toBe(7);
      expect(stars.startsWith("[")).toBe(true);
      expect(stars.endsWith("]")).toBe(true);
      expect(stars.slice(1, -1).length).toBe(5);
    }
  });

  test("clamps malformed high ratings to five stars", () => {
    expect(renderStars(11)).toBe("[★★★★★]");
  });

  test("clamps malformed persisted ratings when selections are read back", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "sidflow-station-ratings-"));
    const statePath = path.join(workspace, "selections.json");
    await writeFile(statePath, JSON.stringify({
      dbPath: "/tmp/test.sqlite",
      hvscRoot: "/tmp/hvsc",
      ratedTarget: 10,
      ratings: {
        "bad-high": 11,
        "bad-low": -4,
        "good-mid": 3,
      },
      savedAt: new Date(0).toISOString(),
    }), "utf8");

    const ratings = await readPersistedStationSelections(statePath, "/tmp/test.sqlite", "/tmp/hvsc");
    expect(ratings.get("bad-high")).toBe(5);
    expect(ratings.get("bad-low")).toBe(0);
    expect(ratings.get("good-mid")).toBe(3);
  });
});

describe("station playlist rating column layout", () => {
  test("renders mixed ratings in a dense duration-first row layout", () => {
    const queue = [
      makeTrack({ track_id: "t1", title: "SX-64 Demo", author: "Katsenos", released: "1984" }),
      makeTrack({ track_id: "t2", title: "Monty on the Run", author: "Rob Hubbard", released: "1985" }),
      makeTrack({ track_id: "t3", title: "Lightforce", author: "Martin Galway", released: "1986" }),
      makeTrack({ track_id: "t4", title: "Delta", author: "Rob Hubbard", released: "1987" }),
    ];
    const screen = __stationDemoTestUtils.renderStationScreen({
      phase: "station",
      current: queue[0]!,
      index: 0,
      selectedIndex: 1,
      playlistWindowStart: 0,
      total: queue.length,
      ratedCount: 10,
      ratedTarget: 10,
      ratings: new Map([
        ["t1", 4],
        ["t2", 3],
        ["t3", 0],
        ["t4", 5],
      ]),
      playbackMode: "none",
      adventure: 3,
      dataSource: "test",
      dbPath: "/tmp/test.sqlite",
      queue,
      minDurationSeconds: 15,
      elapsedMs: 0,
      durationMs: 60_000,
      playlistElapsedMs: 0,
      playlistDurationMs: 240_000,
      statusLine: "Ready.",
    }, false, 100, 36);

    const rows = extractPlaylistWindowRows(screen, 4);
    expect(rows[0]).toContain("001/004");
    expect(rows[0]).toContain("►");
    expect(rows[0]).toContain("[★★★★☆]");
    expect(rows[0]).toContain("1:00 SX-64 Demo");
    expect(rows[1]).toContain("002/004");
    expect(rows[1]).not.toContain("> ");
    expect(rows[1]).toContain("[★★★☆☆]");
    expect(rows[1]).toContain("1:00 Monty on the Run");
    expect(rows[2]).toContain("[☆☆☆☆☆]  1:00 Lightforce");
    expect(rows[3]).toContain("[★★★★★]  1:00 Delta");
    expect(rows[0]).toContain("Katsenos");
    expect(rows[0]).toContain("1984");
    expect(rows[1]).toContain("Rob Hubbard");
    expect(rows[1]).toContain("1985");
    expect((rows[0]?.indexOf("1984") ?? -1)).toBeGreaterThan(rows[0]?.indexOf("Katsenos") ?? -1);
    expect((rows[1]?.indexOf("1985") ?? -1)).toBeGreaterThan(rows[1]?.indexOf("Rob Hubbard") ?? -1);
    expect(new Set(rows.map((row) => row.length))).toEqual(new Set([98]));
  });

  test("keeps rating and downstream columns aligned for long titles", () => {
    const queue = [
      makeTrack({
        track_id: "long-1",
        title: "A Very Long Demo Title That Should Truncate Cleanly Without Moving Stars",
        author: "Extremely Verbose Composer Name",
        released: "1988",
      }),
      makeTrack({
        track_id: "long-2",
        title: "Short Title",
        author: "Short Name",
        released: "1989",
      }),
    ];
    const screen = __stationDemoTestUtils.renderStationScreen({
      phase: "station",
      current: queue[0]!,
      index: 0,
      selectedIndex: 1,
      playlistWindowStart: 0,
      total: queue.length,
      ratedCount: 10,
      ratedTarget: 10,
      ratings: new Map([
        ["long-1", 5],
        ["long-2", 1],
      ]),
      playbackMode: "none",
      adventure: 3,
      dataSource: "test",
      dbPath: "/tmp/test.sqlite",
      queue,
      minDurationSeconds: 15,
      elapsedMs: 0,
      durationMs: 60_000,
      playlistElapsedMs: 0,
      playlistDurationMs: 120_000,
      statusLine: "Ready.",
    }, false, 92, 36);

    const rows = extractPlaylistWindowRows(screen, 2);
    expect(rows[0]).toContain("001/002");
    expect(rows[0]).toContain("►");
    expect(rows[0]).toContain("[★★★★★]");
    expect(rows[0]).toContain("1:00 A Very Long Demo Title");
    expect(rows[1]).toContain("002/002");
    expect(rows[1]).not.toContain("> ");
    expect(rows[1]).toContain("[★☆☆☆☆]");
    expect(rows[1]).toContain("1:00 Short Title");
    expect(rows[0]?.indexOf("[★★★★★]")).toBe(rows[1]?.indexOf("[★☆☆☆☆]"));
    expect(rows[0]?.indexOf("1:00")).toBe(rows[1]?.indexOf("1:00"));
  });
});

describe("normalizeFilterQuery", () => {
  test("returns empty string for undefined", () => {
    expect(normalizeFilterQuery(undefined)).toBe("");
  });
  test("trims whitespace", () => {
    expect(normalizeFilterQuery("  rob  ")).toBe("rob");
  });
  test("lowercases the query", () => {
    expect(normalizeFilterQuery("ROB HUBBARD")).toBe("rob hubbard");
  });
  test("returns empty string for whitespace-only", () => {
    expect(normalizeFilterQuery("   ")).toBe("");
  });
});

describe("trackMatchesFilter", () => {
  const hubbard = makeTrack({ title: "Thing on a Spring", author: "Rob Hubbard" });
  const galway = makeTrack({ title: "Green Beret", author: "Martin Galway" });
  const noAuthor = makeTrack({ sid_path: "A/my-track.sid", title: "", author: "" });

  test("empty filter matches every track", () => {
    expect(trackMatchesFilter(hubbard, "")).toBe(true);
    expect(trackMatchesFilter(galway, "")).toBe(true);
  });

  test("matches author case-insensitively", () => {
    expect(trackMatchesFilter(hubbard, "hubbard")).toBe(true);
    expect(trackMatchesFilter(hubbard, "HUBBARD")).toBe(true);
    expect(trackMatchesFilter(hubbard, "Rob")).toBe(true);
  });

  test("matches title case-insensitively", () => {
    expect(trackMatchesFilter(galway, "green")).toBe(true);
    expect(trackMatchesFilter(galway, "BERET")).toBe(true);
  });

  test("does not cross-match unrelated tracks", () => {
    expect(trackMatchesFilter(hubbard, "galway")).toBe(false);
    expect(trackMatchesFilter(galway, "hubbard")).toBe(false);
  });

  test("falls back to sid_path basename when title is empty", () => {
    // "my-track" is in the basename of A/my-track.sid
    expect(trackMatchesFilter(noAuthor, "my-track")).toBe(true);
    expect(trackMatchesFilter(noAuthor, "othertitle")).toBe(false);
  });

  test("partial substring match works", () => {
    expect(trackMatchesFilter(hubbard, "bba")).toBe(true);  // from "hubbard"
    expect(trackMatchesFilter(galway, "ting")).toBe(false);
  });

  test("matches within the title portion only when author is empty", () => {
    const noAuthorTrack = makeTrack({ title: "Shockwave", author: "" });
    expect(trackMatchesFilter(noAuthorTrack, "shock")).toBe(true);
    expect(trackMatchesFilter(noAuthorTrack, "galway")).toBe(false);
  });
});

describe("getFilteredTrackIndices", () => {
  const queue = [
    makeTrack({ track_id: "t1", title: "Thing on a Spring", author: "Rob Hubbard" }),
    makeTrack({ track_id: "t2", title: "Green Beret", author: "Martin Galway" }),
    makeTrack({ track_id: "t3", title: "Monty on the Run", author: "Rob Hubbard" }),
    makeTrack({ track_id: "t4", title: "Delta", author: "Rob Hubbard" }),
    makeTrack({ track_id: "t5", title: "Lightforce", author: "Martin Galway" }),
  ];

  test("empty filter returns all indices", () => {
    expect(getFilteredTrackIndices(queue, "")).toEqual([0, 1, 2, 3, 4]);
  });

  test("filter by author returns only matching indices", () => {
    expect(getFilteredTrackIndices(queue, "hubbard")).toEqual([0, 2, 3]);
    expect(getFilteredTrackIndices(queue, "galway")).toEqual([1, 4]);
  });

  test("filter by partial title matches correctly", () => {
    expect(getFilteredTrackIndices(queue, "delta")).toEqual([3]);
    expect(getFilteredTrackIndices(queue, "on")).toEqual([0, 2]);  // "Thing on" and "Monty on"
  });

  test("case-insensitive filter", () => {
    expect(getFilteredTrackIndices(queue, "HUBBARD")).toEqual([0, 2, 3]);
    expect(getFilteredTrackIndices(queue, "Martin")).toEqual([1, 4]);
  });

  test("filter that matches nothing returns empty array", () => {
    expect(getFilteredTrackIndices(queue, "zimmer")).toEqual([]);
  });

  test("empty queue returns empty array", () => {
    expect(getFilteredTrackIndices([], "hubbard")).toEqual([]);
  });

  test("whitespace-only filter returns all indices (treated as empty)", () => {
    expect(getFilteredTrackIndices(queue, "   ")).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("renderStationScreen filter", () => {
  const hubbardTracks = Array.from({ length: 5 }, (_, i) => makeTrack({
    track_id: `h${i}`,
    sid_path: `H/track${i}.sid`,
    title: `Hubbard Track ${i}`,
    author: "Rob Hubbard",
  }));
  const galwayTracks = Array.from({ length: 5 }, (_, i) => makeTrack({
    track_id: `g${i}`,
    sid_path: `G/track${i}.sid`,
    title: `Galway Track ${i}`,
    author: "Martin Galway",
  }));
  const mixedQueue = [...hubbardTracks, ...galwayTracks];

  function makeState(extra: {
    current?: ReturnType<typeof makeTrack>;
    filterQuery?: string;
    filterEditing?: boolean;
    ratingFilterQuery?: string;
    ratingFilterEditing?: boolean;
    minimumRating?: number;
    ratings?: Map<string, number>;
  } = {}) {
    return {
      phase: "station" as const,
      current: extra.current ?? mixedQueue[0]!,
      index: 0,
      selectedIndex: 0,
      playlistWindowStart: 0,
      total: mixedQueue.length,
      ratedCount: 10,
      ratedTarget: 10,
      ratings: extra.ratings ?? new Map<string, number>(),
      playbackMode: "none" as const,
      adventure: 3,
      dataSource: "test",
      dbPath: "/tmp/test.sqlite",
      queue: mixedQueue,
      currentRating: undefined,
      minDurationSeconds: 15,
      elapsedMs: 0,
      durationMs: 60_000,
      playlistElapsedMs: 0,
      playlistDurationMs: 600_000,
      statusLine: "Ready.",
      filterQuery: extra.filterQuery ?? "",
      filterEditing: extra.filterEditing ?? false,
      ratingFilterQuery: extra.ratingFilterQuery ?? "",
      ratingFilterEditing: extra.ratingFilterEditing ?? false,
      minimumRating: extra.minimumRating,
    };
  }

  test("no filter shows all tracks in playlist window", () => {
    const screen = __stationDemoTestUtils.renderStationScreen(makeState(), false, 120, 60);
    const windowSection = screen.split("Playlist")[1] ?? "";
    expect(windowSection).toContain("Rob Hubbard");
    expect(windowSection).toContain("Martin Galway");
    expect(screen).toContain("[Filter] none");
  });

  test("filter by 'hubbard' hides Martin Galway from the playlist window", () => {
    // Use a Hubbard track as current so Now Playing doesn't confuse assertions
    const screen = __stationDemoTestUtils.renderStationScreen(
      makeState({ current: hubbardTracks[0], filterQuery: "hubbard" }),
      false, 120, 60,
    );
    const windowSection = screen.split("Playlist")[1] ?? "";
    expect(windowSection).toContain("Rob Hubbard");
    expect(windowSection).not.toContain("Martin Galway");
  });

  test("filter by 'galway' hides Rob Hubbard from the playlist window", () => {
    // Use a Galway track as current so Now Playing doesn't confuse assertions
    const screen = __stationDemoTestUtils.renderStationScreen(
      makeState({ current: galwayTracks[0], filterQuery: "galway" }),
      false, 120, 60,
    );
    const windowSection = screen.split("Playlist")[1] ?? "";
    expect(windowSection).toContain("Martin Galway");
    expect(windowSection).not.toContain("Rob Hubbard");
  });

  test("filter is case-insensitive in the playlist window", () => {
    const lower = __stationDemoTestUtils.renderStationScreen(
      makeState({ current: galwayTracks[0], filterQuery: "galway" }),
      false, 120, 60,
    );
    const upper = __stationDemoTestUtils.renderStationScreen(
      makeState({ current: galwayTracks[0], filterQuery: "GALWAY" }),
      false, 120, 60,
    );
    for (const screen of [lower, upper]) {
      const windowSection = screen.split("Playlist")[1] ?? "";
      expect(windowSection).toContain("Martin Galway");
      expect(windowSection).not.toContain("Rob Hubbard");
    }
  });

  test("filter matching nothing shows 'No playlist matches' in playlist window", () => {
    const screen = __stationDemoTestUtils.renderStationScreen(
      makeState({ filterQuery: "zimmer" }),
      false, 120, 60,
    );
    const windowSection = screen.split("Playlist")[1] ?? "";
    expect(windowSection).toContain("No playlist matches");
    expect(windowSection).not.toContain("Rob Hubbard");
    expect(windowSection).not.toContain("Martin Galway");
    expect(screen).toContain('[Filter] text="zimmer"');
    expect(screen).toContain("0/10");
  });

  test("filter badge shows editing state when filterEditing is true", () => {
    const screen = __stationDemoTestUtils.renderStationScreen(
      makeState({ filterQuery: "hub", filterEditing: true }),
      false, 120, 60,
    );
    expect(screen).toContain('[Filter] text="hub"');
  });

  test("filter badge shows committed state when filterEditing is false", () => {
    const screen = __stationDemoTestUtils.renderStationScreen(
      makeState({ filterQuery: "hub", filterEditing: false }),
      false, 120, 60,
    );
    expect(screen).toContain('[Filter] text="hub"');
  });

  test("filter badge reports correct match count", () => {
    const screen = __stationDemoTestUtils.renderStationScreen(
      makeState({ filterQuery: "hubbard" }),
      false, 120, 60,
    );
    // 5 hubbard + 5 galway = 10 total, 5 match "hubbard"
    expect(screen).toContain('[Filter] text="hubbard"');
    expect(screen).toContain("5/10");
  });

  test("star filter badge shows active threshold and combines with text filters", () => {
    const screen = __stationDemoTestUtils.renderStationScreen(
      makeState({
        filterQuery: "galway",
        minimumRating: 4,
        ratingFilterQuery: "*4",
        ratings: new Map([
          [mixedQueue[5]!.track_id, 5],
          [mixedQueue[6]!.track_id, 4],
          [mixedQueue[7]!.track_id, 3],
        ]),
      }),
      false, 120, 60,
    );
    expect(screen).toContain('[Filter] ★≥4  |  text="galway"');
    expect(screen).toContain("2/10");
  });
});

describe("station playlist persistence and uniqueness", () => {
  test("shuffle keeps the playlist membership unique", () => {
    const queue = [
      makeTrack({ track_id: "a", sid_path: "A/one.sid" }),
      makeTrack({ track_id: "b", sid_path: "B/two.sid" }),
      makeTrack({ track_id: "c", sid_path: "A/one.sid" }),
    ];

    const shuffled = __stationDemoTestUtils.shuffleQueueKeepingCurrent(queue, 0, () => 0.5);
    const keys = shuffled.map((track) => __stationDemoTestUtils.buildStationSongKey(track));

    expect(keys).toEqual(["A/one.sid#1", "B/two.sid#1"]);
  });

  test("saved playlists are listed and reloaded by name", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "sidflow-station-playlists-"));
    const statePath = __stationDemoTestUtils.buildPlaylistStatePath(workspace, "/tmp/test.sqlite", "/tmp/hvsc", "Night Ride");

    await __stationDemoTestUtils.writePersistedStationPlaylist(
      statePath,
      "/tmp/test.sqlite",
      "/tmp/hvsc",
      "Night Ride",
      1,
      ["track-a", "track-b", "track-a"],
      "2026-03-21T12:00:00.000Z",
    );

    const playlists = await __stationDemoTestUtils.listPersistedStationPlaylists(workspace, "/tmp/test.sqlite", "/tmp/hvsc");
    expect(playlists).toHaveLength(1);
    expect(playlists[0]?.name).toBe("Night Ride");
    expect(playlists[0]?.trackIds).toEqual(["track-a", "track-b"]);

    const persisted = await __stationDemoTestUtils.readPersistedStationPlaylist(statePath, "/tmp/test.sqlite", "/tmp/hvsc");
    expect(persisted?.currentIndex).toBe(1);
    expect(persisted?.trackIds).toEqual(["track-a", "track-b"]);
  });
});

describe("mapStationToken filter keys", () => {
  test("'/' enters filter editing mode", () => {
    const action = mapStationToken("/");
    expect(action).toEqual({ type: "setFilter", value: "", editing: true });
  });

  test("'*' enters star filter editing mode", () => {
    const action = mapStationToken("*");
    expect(action).toEqual({ type: "setRatingFilter", value: "", editing: true });
  });

  test("'f' no longer maps to any action", () => {
    const action = mapStationToken("f");
    expect(action).toBeNull();
  });
});

describe("decodeTerminalInput", () => {
  test("decodes slash as '/'", () => {
    expect(decodeTerminalInput("/")).toEqual(["/"]);
  });

  test("decodes star as '*'", () => {
    expect(decodeTerminalInput("*")).toEqual(["*"]);
  });

  test("decodes escape sequence", () => {
    expect(decodeTerminalInput("\u001b")).toEqual(["escape"]);
  });

  test("decodes enter as empty string", () => {
    expect(decodeTerminalInput("\r")).toEqual([""]);
    expect(decodeTerminalInput("\n")).toEqual([""]);
  });

  test("decodes backspace", () => {
    expect(decodeTerminalInput("\u007f")).toEqual(["backspace"]);
  });

  test("decodes mixed input stream", () => {
    expect(decodeTerminalInput("/rob\r")).toEqual(["/", "r", "o", "b", ""]);
  });
});
