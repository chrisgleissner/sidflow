/// <reference types="bun-types" />

import { describe, expect, test, it } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Writable } from "node:stream";
import type { Stats } from "node:fs";

import { parsePlayArgs, runPlayCli } from "../src/cli.js";
import { parseStationDemoArgs, runStationDemoCli } from "../src/station-demo-cli.js";
import { PlaybackState, type PlaybackEvent } from "../src/index.js";
import type { Recommendation } from "@sidflow/common";
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
    const result = parseStationDemoArgs([]);
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
    const result = parseStationDemoArgs(["--force-local-db", "--local-db", "custom.sqlite"]);
    expect(result.options.forceLocalDb).toBe(true);
    expect(result.options.localDb).toBe("custom.sqlite");
    expect(result.errors).toHaveLength(0);
  });

  test("rejects invalid adventure during parsing", () => {
    const result = parseStationDemoArgs(["--adventure", "9"]);
    expect(result.errors[0]).toContain("must be at most 5");
  });

  test("rejects invalid min-duration during parsing", () => {
    const result = parseStationDemoArgs(["--min-duration", "0"]);
    expect(result.errors[0]).toContain("must be at least 1");
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
    const exitCode = await runStationDemoCli(
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
    expect(output).toContain("Legend");
    expect(output).toContain("5 locks the vibe in");
    expect(output).toContain("Playlist Window");
    expect(output).toContain("Song Progress");
    expect(output).toContain("Playlist Pos ");
    expect(output).toContain("Station 1/100");
    expect(output).toContain("Duration gate");
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

    const exitCode = await runStationDemoCli(
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
    expect(output).toContain("Playlist Window (18 visible)");
    expect(output).toContain("018/100");
  });

  it("reuses a fresh sidflow-data cache without checking GitHub again", async () => {
    const fixture = await createStationDemoFixture();
    await writeFile(fixture.dbPath.replace(/\.sqlite$/, ".manifest.json"), "{}", "utf8");
    await seedStationDemoReleaseCache(fixture.workspace, fixture.dbPath, "2026-03-20T12:00:00.000Z");
    const stdoutChunks: string[] = [];
    let fetchCalls = 0;

    const exitCode = await runStationDemoCli(
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
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error("network should not be touched when the cache is fresh");
        },
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
    expect(stdoutChunks.join("")).toContain("sidflow-data release sidcorr-hvsc-full-20260315T095426Z (cached)");
  });

  it("checks sidflow-data once per day and keeps the cached bundle when the latest tag is unchanged", async () => {
    const fixture = await createStationDemoFixture();
    await writeFile(fixture.dbPath.replace(/\.sqlite$/, ".manifest.json"), "{}", "utf8");
    await seedStationDemoReleaseCache(fixture.workspace, fixture.dbPath, "2026-03-18T09:00:00.000Z");
    const stdoutChunks: string[] = [];
    let latestReleaseChecks = 0;
    let assetDownloads = 0;

    const exitCode = await runStationDemoCli(
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
        fetchImpl: async (url: string | URL | Request) => {
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
        },
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
    expect(stdoutChunks.join("")).toContain("cached, checked today");
  });

  it("uses an explicit local database override without touching sidflow-data", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const explicitLocalDb = path.join(fixture.workspace, "custom", "override.sqlite");
    await mkdir(path.dirname(explicitLocalDb), { recursive: true });
    await copyFile(fixture.dbPath, explicitLocalDb);

    let fetchCalls = 0;
    const exitCode = await runStationDemoCli(
      ["--local-db", explicitLocalDb, "--hvsc", fixture.workspace, "--playback", "none"],
      {
        stdout: new Writable({
          write(chunk, _encoding, callback) {
            stdoutChunks.push(chunk.toString());
            callback();
          }
        }),
        cwd: () => fixture.workspace,
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error("explicit local DB should bypass sidflow-data");
        },
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
    expect(stdoutChunks.join("")).toContain("local SQLite override");
  });

  it("rebuilds the remaining queue from updated playback ratings", async () => {
    const fixture = await createStationDemoFixture();
    const stdoutChunks: string[] = [];
    const answers = ["5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "q"];

    const exitCode = await runStationDemoCli(
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
    expect(output).toContain("Rebuilt from 11 ratings");
    expect(output).toContain("remaining queue re-sequenced by sim");
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

    const exitCode = await runStationDemoCli(
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
    expect(output).toContain("l like(5)");
    expect(output).toContain("d dislike(0)");
    expect(output).toContain("Liked ");
    expect(output).toContain("Disliked ");
    expect(output).toContain("Disliked this track. Rebuilt from");
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

    const exitCode = await runStationDemoCli(
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

    const exitCode = await runStationDemoCli(
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
    expect(output).toContain("Selected track 2/100");
    expect(output).toContain("Started selected track 3/100.");
    expect(output).toContain("Paused ");
    expect(output).toContain("Resumed ");
    expect(playbackEvents).toContain("pause");
    expect(playbackEvents).toContain("resume");
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

    const exitCode = await runStationDemoCli(
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
    expect(output).toContain("Shuffled the remaining playlist around the current song.");
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

    const exitCode = await runStationDemoCli(
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
    expect(output).toContain("You rated 10/10");
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

    const exitCode = await runStationDemoCli(
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

    const exitCode = await runStationDemoCli(
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

    const exitCode = await runStationDemoCli(
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
    expect(stdoutChunks.join("")).toContain("c64u");
  });
});
